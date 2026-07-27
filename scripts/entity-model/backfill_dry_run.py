#!/usr/bin/env python3
"""Dry-run / apply backfill for entity registry + category mapping.

DEFAULT: dry-run only (no writes).

Usage:
  python3 scripts/entity-model/backfill_dry_run.py
  python3 scripts/entity-model/backfill_dry_run.py --report-json /tmp/entity_backfill_report.json
  python3 scripts/entity-model/backfill_dry_run.py --apply   # ONLY after schema migration applied

Safety:
  - Never writes contacts into entities
  - Does not modify businesses / listings rows
  - Does not delete legacy category FKs
  - --apply refuses unless entities + platform_categories tables exist
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import load_env  # noqa: E402

MAPPING_PATH = ROOT / "docs/architecture/entity-model-v1/category_mapping.json"

OFFER_KIND_MAP = {
    "sell": "sell",
    "free": "giveaway",
    "exchange": "exchange",
    "wanted": "seek",
}


def rest(
    base: str,
    key: str,
    path: str,
    *,
    method: str = "GET",
    body: dict | list | None = None,
    prefer: str | None = None,
) -> Any:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if prefer:
        headers["Prefer"] = prefer
    req = request.Request(f"{base}/rest/v1/{path}", method=method, data=data, headers=headers)
    try:
        with request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"HTTP {exc.code} {path}: {detail}") from exc


def count_exact(base: str, key: str, path: str) -> int:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Prefer": "count=exact",
        "Range": "0-0",
    }
    req = request.Request(f"{base}/rest/v1/{path}", headers=headers)
    with request.urlopen(req, timeout=60) as resp:
        cr = resp.headers.get("content-range") or resp.headers.get("Content-Range") or ""
        # 0-0/307 or */0
        if "/" in cr:
            total = cr.split("/")[-1]
            return int(total) if total.isdigit() else 0
        return 0


def table_exists(base: str, key: str, table: str) -> bool:
    try:
        rest(base, key, f"{table}?select=id&limit=1")
        return True
    except RuntimeError as exc:
        msg = str(exc).lower()
        if "404" in msg or "does not exist" in msg or "pgrst" in msg:
            return False
        # permission / empty still means exists
        if "42501" in msg:
            return True
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Write registry rows (requires schema)")
    parser.add_argument("--report-json", type=str, default="")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    load_env()
    base = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    mapping = json.loads(MAPPING_PATH.read_text())
    biz_map = {row["old_slug"]: row for row in mapping["business_categories"]}
    list_map = {row["old_slug"]: row for row in mapping["listing_categories"]}

    report: dict[str, Any] = {
        "mode": "apply" if args.apply else "dry_run",
        "mapping_version": mapping.get("version"),
        "counts": {},
        "category_unmapped": {"business": [], "listing": []},
        "entity_backfill": {"business": {}, "marketplace_item": {}},
        "offer_kind_samples": [],
        "anti_scrape_checks": [],
        "errors": [],
    }

    # --- live category inventory ---
    cats = rest(base, key, "categories?select=id,slug,name,domain,is_active&order=slug.asc") or []
    lcats = (
        rest(
            base,
            key,
            "listing_categories?select=id,slug,name_ru,domain,listing_type,is_active&order=domain.asc,slug.asc",
        )
        or []
    )

    for c in cats:
        slug = c["slug"]
        if slug not in biz_map:
            report["category_unmapped"]["business"].append(c)

    for c in lcats:
        slug = c["slug"]
        if slug not in list_map:
            report["category_unmapped"]["listing"].append(c)

    report["counts"]["legacy_business_categories"] = len(cats)
    report["counts"]["legacy_listing_categories"] = len(lcats)
    report["counts"]["mapped_business_categories"] = len(cats) - len(
        report["category_unmapped"]["business"]
    )
    report["counts"]["mapped_listing_categories"] = len(lcats) - len(
        report["category_unmapped"]["listing"]
    )

    report["counts"]["approved_businesses"] = count_exact(
        base, key, "businesses?select=id&status=eq.approved"
    )
    report["counts"]["active_marketplace"] = count_exact(
        base,
        key,
        "listings?select=id&listing_type=eq.marketplace_item&status=eq.active",
    )
    report["counts"]["active_services"] = count_exact(
        base, key, "listings?select=id&listing_type=eq.service&status=eq.active"
    )

    # --- business category coverage ---
    biz_rows = (
        rest(
            base,
            key,
            "businesses?select=id,slug,status,category_id,categories(slug)&status=eq.approved&order=name.asc"
            + (f"&limit={args.limit}" if args.limit else ""),
        )
        or []
    )
    biz_missing_cat = []
    biz_ok = 0
    for b in biz_rows:
        cat_slug = (b.get("categories") or {}).get("slug") if isinstance(b.get("categories"), dict) else None
        if not cat_slug or cat_slug not in biz_map:
            biz_missing_cat.append({"id": b["id"], "slug": b.get("slug"), "category_slug": cat_slug})
        else:
            biz_ok += 1
    report["entity_backfill"]["business"] = {
        "candidates": len(biz_rows),
        "with_mapped_primary": biz_ok,
        "unmapped_or_null_category": biz_missing_cat[:50],
        "unmapped_or_null_category_count": len(biz_missing_cat),
    }

    # --- marketplace items ---
    mkt = (
        rest(
            base,
            key,
            "listings?select=id,title,status,listing_type,marketplace_listing_details(category_id,transaction_type,listing_categories:category_id(slug))"
            "&listing_type=eq.marketplace_item&status=eq.active"
            + (f"&limit={args.limit}" if args.limit else ""),
        )
        or []
    )
    # PostgREST embed may need simpler select if nested fails
    if not mkt:
        mkt = (
            rest(
                base,
                key,
                "listings?select=id,title,status&listing_type=eq.marketplace_item&status=eq.active"
                + (f"&limit={args.limit}" if args.limit else ""),
            )
            or []
        )

    mkt_ok = 0
    mkt_unmapped = []
    offer_kind_counter: Counter[str] = Counter()
    details = (
        rest(
            base,
            key,
            "marketplace_listing_details?select=listing_id,transaction_type,category_id,listing_categories(slug)",
        )
        or []
    )
    details_by_listing = {d["listing_id"]: d for d in details if d.get("listing_id")}

    for row in mkt:
        d = details_by_listing.get(row["id"])
        cat_slug = None
        tx = None
        if d:
            tx = d.get("transaction_type")
            lc = d.get("listing_categories")
            if isinstance(lc, dict):
                cat_slug = lc.get("slug")
        if tx:
            offer_kind_counter[OFFER_KIND_MAP.get(tx, f"UNMAPPED:{tx}")] += 1
        if cat_slug and cat_slug in list_map and list_map[cat_slug]["domain"] == "marketplace":
            mkt_ok += 1
        else:
            mkt_unmapped.append(
                {"id": row["id"], "title": row.get("title"), "category_slug": cat_slug, "transaction_type": tx}
            )

    report["entity_backfill"]["marketplace_item"] = {
        "candidates": len(mkt),
        "with_mapped_primary": mkt_ok,
        "unmapped_category_count": len(mkt_unmapped),
        "unmapped_sample": mkt_unmapped[:50],
        "offer_kind_histogram": dict(offer_kind_counter),
    }

    # --- anti-scrape checks (read-only) ---
    anon_key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    if anon_key:
        try:
            rest(base, anon_key, "businesses?select=id,phone&limit=1")
            report["anti_scrape_checks"].append(
                {"check": "anon_select_businesses", "ok": False, "detail": "UNEXPECTED success"}
            )
        except RuntimeError as exc:
            report["anti_scrape_checks"].append(
                {
                    "check": "anon_select_businesses",
                    "ok": "42501" in str(exc) or "401" in str(exc) or "permission" in str(exc).lower(),
                    "detail": str(exc)[:200],
                }
            )
        try:
            rows = rest(base, anon_key, "businesses_public?select=*&limit=1") or []
            row = rows[0] if rows else {}
            leaked = [k for k in ("phone", "email", "website", "instagram_url") if k in row]
            report["anti_scrape_checks"].append(
                {
                    "check": "businesses_public_no_contacts",
                    "ok": len(leaked) == 0,
                    "detail": f"keys_sample={sorted(row.keys())[:12]} leaked={leaked}",
                }
            )
        except RuntimeError as exc:
            report["anti_scrape_checks"].append(
                {"check": "businesses_public_no_contacts", "ok": False, "detail": str(exc)[:200]}
            )

    # --- apply (registry only) ---
    if args.apply:
        if not table_exists(base, key, "entities"):
            report["errors"].append("entities table missing — refuse apply")
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 2
        if not table_exists(base, key, "platform_categories"):
            report["errors"].append("platform_categories missing — refuse apply")
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 2

        # Upsert entities for approved businesses
        legacy = (
            rest(
                base,
                key,
                "platform_category_legacy_map?select=source_table,source_id,platform_category_id,source_slug&source_table=eq.categories",
            )
            or []
        )
        cat_id_to_platform = {r["source_id"]: r["platform_category_id"] for r in legacy}

        inserted_entities = 0
        linked_primary = 0
        for b in biz_rows:
            payload = {
                "entity_type": "business",
                "source_id": b["id"],
                "status": "published",
            }
            rows = rest(
                base,
                key,
                "entities?on_conflict=entity_type,source_id",
                method="POST",
                body=payload,
                prefer="resolution=merge-duplicates,return=representation",
            )
            ent = rows[0] if isinstance(rows, list) and rows else None
            if not ent:
                continue
            inserted_entities += 1
            platform_cat = cat_id_to_platform.get(b.get("category_id"))
            if platform_cat:
                rest(
                    base,
                    key,
                    "entity_categories?on_conflict=entity_id,category_id",
                    method="POST",
                    body={
                        "entity_id": ent["id"],
                        "category_id": platform_cat,
                        "role": "primary",
                    },
                    prefer="resolution=merge-duplicates,return=minimal",
                )
                linked_primary += 1

        # Marketplace
        mkt_legacy = (
            rest(
                base,
                key,
                "platform_category_legacy_map?select=source_id,platform_category_id&source_table=eq.listing_categories",
            )
            or []
        )
        lc_to_platform = {r["source_id"]: r["platform_category_id"] for r in mkt_legacy}

        mkt_entities = 0
        mkt_linked = 0
        for row in mkt:
            rows = rest(
                base,
                key,
                "entities?on_conflict=entity_type,source_id",
                method="POST",
                body={
                    "entity_type": "marketplace_item",
                    "source_id": row["id"],
                    "status": "published",
                },
                prefer="resolution=merge-duplicates,return=representation",
            )
            ent = rows[0] if isinstance(rows, list) and rows else None
            if not ent:
                continue
            mkt_entities += 1
            d = details_by_listing.get(row["id"]) or {}
            platform_cat = lc_to_platform.get(d.get("category_id"))
            if platform_cat:
                rest(
                    base,
                    key,
                    "entity_categories?on_conflict=entity_id,category_id",
                    method="POST",
                    body={
                        "entity_id": ent["id"],
                        "category_id": platform_cat,
                        "role": "primary",
                    },
                    prefer="resolution=merge-duplicates,return=minimal",
                )
                mkt_linked += 1

        report["apply_result"] = {
            "business_entities_upserted": inserted_entities,
            "business_primary_links": linked_primary,
            "marketplace_entities_upserted": mkt_entities,
            "marketplace_primary_links": mkt_linked,
        }

    # --- print summary ---
    print("=== entity-model backfill ===")
    print("mode:", report["mode"])
    print("counts:", json.dumps(report["counts"], ensure_ascii=False))
    print(
        "unmapped business cats:",
        len(report["category_unmapped"]["business"]),
        "listing cats:",
        len(report["category_unmapped"]["listing"]),
    )
    print("business primary coverage:", report["entity_backfill"]["business"])
    print("marketplace coverage:", report["entity_backfill"]["marketplace_item"])
    print("anti_scrape:", report["anti_scrape_checks"])
    if report.get("errors"):
        print("ERRORS:", report["errors"])

    if args.report_json:
        Path(args.report_json).write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print("wrote", args.report_json)

    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
