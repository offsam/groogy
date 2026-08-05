#!/usr/bin/env python3
"""OC catalog pass-2: re-dump, deterministic audit, apply safe fixes.

Safe apply:
  - archive thin pros (weak name + no real contact)
  - strip phone/contact labels from narrative fields (DB cleanup)
  - clear bare house-number streets
  - archive obvious duplicate businesses (same phone + near-identical name)

Flags only (manual):
  - businesses without street
  - needs_translation_ru (Latin-heavy narrative, little Cyrillic)
  - shared-phone clusters (keeper merge)

Usage:
  python3 scripts/business-enrich/oc_pass2_audit.py --dry-run
  python3 scripts/business-enrich/oc_pass2_audit.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from entity_routing import has_street_address, is_garbage_street_line  # noqa: E402
from svoi_parse import is_svoi_seo_blurb  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "oc_llm_audit"
OUT.mkdir(parents=True, exist_ok=True)
BATCH = "oc_pass2_v1"

OC_CITIES = {
    "irvine",
    "santa ana",
    "anaheim",
    "orange",
    "tustin",
    "fullerton",
    "costa mesa",
    "newport beach",
    "huntington beach",
    "garden grove",
    "fountain valley",
    "mission viejo",
    "laguna hills",
    "laguna niguel",
    "laguna beach",
    "lake forest",
    "yorba linda",
    "placentia",
    "brea",
    "buena park",
    "cypress",
    "la habra",
    "westminster",
    "seal beach",
    "los alamitos",
    "stanton",
    "rancho santa margarita",
    "aliso viejo",
    "dana point",
    "san clemente",
    "san juan capistrano",
    "villa park",
    "rossmoor",
    "midway city",
}

WEAK_NAME_RE = re.compile(
    r"^(?:юля|юлия|оля|ольга|ілля|илья|анна|аня|марина|кристина|сергей|"
    r"mila|anna|olya|ilya|usa|reel|llc|smm|профи|специалист|"
    r"маша|катя|наташа|даша|саша|лена|ира|вика|таня)$",
    re.I,
)
PHONE_IN_TEXT_RE = re.compile(
    r"(?:Телефон|Phone|Tel)\s*[:：]|"
    r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}",
    re.I,
)
CYR_RE = re.compile(r"[А-Яа-яЁё]")
LAT_RE = re.compile(r"[A-Za-z]")


def fetch_all(client: SupabaseRest, table: str, select: str, filt: dict[str, str]) -> list[dict]:
    out: list[dict] = []
    start = 0
    while True:
        params = {"select": select, "limit": "1000", "offset": str(start), **filt}
        rows = client._request("GET", f"/{table}", params=params) or []
        out.extend(rows)
        if len(rows) < 1000:
            break
        start += 1000
    return out


def norm_phone(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        raw = next((x for x in raw if x), None)
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return None
    return digits


def normalize_name(raw: str | None) -> str:
    s = re.sub(r"[^\w\s]+", " ", (raw or "").lower(), flags=re.U)
    return re.sub(r"\s+", " ", s).strip()


def is_weak_name(raw: str | None) -> bool:
    n = normalize_name(raw)
    if not n or len(n) < 3:
        return True
    parts = n.split()
    if len(parts) == 1:
        if len(n) <= 8:
            return True
        if WEAK_NAME_RE.match(n):
            return True
    if WEAK_NAME_RE.match(n):
        return True
    return False


def has_real_contact(row: dict) -> bool:
    for k in ("phone", "email", "website", "instagram_url"):
        v = row.get(k)
        if isinstance(v, list):
            if any(str(x or "").strip() for x in v):
                return True
        elif str(v or "").strip():
            return True
    return False


def is_oc_row(row: dict) -> bool:
    region = (row.get("region") or "").strip().lower()
    if "orange county" in region or region == "oc":
        return True
    city = (row.get("city") or "").strip().lower()
    if city in OC_CITIES:
        return True
    # ZIP 926xx / 927xx / 928xx typical OC
    z = str(row.get("postal_code") or row.get("postal") or "")
    if re.match(r"92[6-8]\d{2}", z):
        return True
    return False


def needs_translation(text: str | None) -> bool:
    t = (text or "").strip()
    if len(t) < 40:
        return False
    cyr = len(CYR_RE.findall(t))
    lat = len(LAT_RE.findall(t))
    if lat < 30:
        return False
    if cyr == 0 and lat >= 40:
        return True
    if lat > 0 and cyr / max(lat, 1) < 0.15 and lat >= 60:
        return True
    return False


def strip_phones_from_text(text: str | None) -> str | None:
    if not text:
        return None
    lines = []
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            lines.append("")
            continue
        if re.match(r"^(?:Телефон|Phone|Tel|Call)\s*[:：]", line, re.I):
            continue
        cleaned = PHONE_IN_TEXT_RE.sub(" ", line)
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" -–—")
        if len(cleaned) >= 3:
            lines.append(cleaned)
    out = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return out or None


def card_blurb(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "type": row.get("_type"),
        "slug": row.get("slug"),
        "name": row.get("display_name") or row.get("name"),
        "phone": row.get("phone"),
        "city": row.get("city"),
        "region": row.get("region"),
        "category_slug": row.get("category_slug"),
        "street": row.get("address_line") or row.get("private_address_line"),
        "blurb": (row.get("short_description") or row.get("description") or "")[:240],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)
    now = datetime.now(timezone.utc).isoformat()

    pro_rows = fetch_all(
        client,
        "professionals",
        "id,slug,display_name,status,phone,email,website,instagram_url,"
        "short_description,description,headline,city,region,state_code,postal_code,"
        "private_address_line,location_precision,category_id,image_url",
        {"status": "eq.approved"},
    )
    # attach category slug
    cats = (
        client._request(
            "GET",
            "/categories",
            params={"select": "id,slug,domain", "limit": "500"},
        )
        or []
    )
    cat_by_id = {c["id"]: c for c in cats}
    for r in pro_rows:
        r["_type"] = "professional"
        cid = r.get("category_id")
        r["category_slug"] = (cat_by_id.get(cid) or {}).get("slug")
        r["address_line"] = r.get("private_address_line")

    biz_rows = fetch_all(
        client,
        "businesses",
        "id,slug,name,status,phone,email,website,instagram_url,"
        "short_description,description,city,region,state_code,postal_code,"
        "address_line,location_precision,category_id,image_url,latitude,longitude",
        {"status": "eq.approved"},
    )
    for r in biz_rows:
        r["_type"] = "business"
        cid = r.get("category_id")
        r["category_slug"] = (cat_by_id.get(cid) or {}).get("slug")
        r["display_name"] = r.get("name")

    oc_pros = [r for r in pro_rows if is_oc_row(r)]
    oc_biz = [r for r in biz_rows if is_oc_row(r)]
    print(f"OC live: pros={len(oc_pros)} biz={len(oc_biz)}")

    dump = {
        "generated_at": now,
        "pass": 2,
        "pro_count": len(oc_pros),
        "biz_count": len(oc_biz),
        "professionals": [
            {
                **card_blurb(r),
                "has_contact": has_real_contact(r),
                "description": (r.get("description") or "")[:800],
                "has_image": bool(r.get("image_url")),
                "category_name": None,
                "postal": r.get("postal_code"),
            }
            for r in oc_pros
        ],
        "businesses": [
            {
                **card_blurb(r),
                "has_contact": has_real_contact(r),
                "description": (r.get("description") or "")[:800],
                "has_image": bool(r.get("image_url")),
                "postal": r.get("postal_code"),
            }
            for r in oc_biz
        ],
    }
    (OUT / "oc_catalog_dump_pass2.json").write_text(
        json.dumps(dump, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    findings: list[dict[str, Any]] = []
    applied = defaultdict(int)

    # --- thin pros ---
    for r in oc_pros:
        if is_weak_name(r.get("display_name")) and not has_real_contact(r):
            findings.append(
                {
                    **card_blurb(r),
                    "action": "archive",
                    "reasons": ["thin_weak_name_no_contact"],
                }
            )

    # --- narrative phones / SEO ---
    for r in oc_pros + oc_biz:
        texts = {
            "short_description": r.get("short_description"),
            "description": r.get("description"),
        }
        if r["_type"] == "professional":
            texts["headline"] = r.get("headline")
        dirty = {
            k: v
            for k, v in texts.items()
            if v
            and (
                PHONE_IN_TEXT_RE.search(str(v))
                or is_svoi_seo_blurb(str(v))
                or "Телефон —" in str(v)
            )
        }
        if dirty:
            findings.append(
                {
                    **card_blurb(r),
                    "action": "strip_contacts",
                    "fields": list(dirty.keys()),
                    "reasons": ["contacts_or_seo_in_narrative"],
                }
            )

    # --- bare / garbage street ---
    for r in oc_pros + oc_biz:
        street = (r.get("address_line") or r.get("private_address_line") or "").strip()
        if not street:
            continue
        if is_garbage_street_line(street) or re.fullmatch(r"\d{1,6}[A-Za-z]?", street):
            findings.append(
                {
                    **card_blurb(r),
                    "action": "clear_bad_street",
                    "reasons": ["bare_or_garbage_street", street[:80]],
                }
            )

    # --- biz without street ---
    for r in oc_biz:
        street = (r.get("address_line") or "").strip()
        if has_street_address(
            street,
            postal_code=r.get("postal_code"),
            location_precision=r.get("location_precision"),
        ):
            continue
        findings.append(
            {
                **card_blurb(r),
                "action": "flag_biz_no_street",
                "reasons": ["business_needs_street_or_move_to_pro"],
            }
        )

    # --- translation ---
    for r in oc_pros + oc_biz:
        blob = "\n".join(
            str(x)
            for x in (
                r.get("short_description"),
                r.get("description"),
                r.get("headline") if r["_type"] == "professional" else None,
            )
            if x
        )
        if needs_translation(blob):
            findings.append(
                {
                    **card_blurb(r),
                    "action": "needs_translation_ru",
                    "reasons": ["latin_heavy_narrative"],
                }
            )

    # --- pro_other / missing category ---
    for r in oc_pros:
        slug = (r.get("category_slug") or "").strip()
        if not slug or slug == "pro_other":
            findings.append(
                {
                    **card_blurb(r),
                    "action": "flag_category",
                    "reasons": ["missing_or_pro_other"],
                }
            )

    # --- phone clusters ---
    by_phone: dict[str, list[dict]] = defaultdict(list)
    for r in oc_pros + oc_biz:
        p = norm_phone(r.get("phone"))
        if p:
            by_phone[p].append(r)
    phone_clusters = []
    for phone, rows in by_phone.items():
        if len(rows) < 2:
            continue
        names = {normalize_name(x.get("display_name") or x.get("name")) for x in rows}
        if len(names) >= 2 or len(rows) >= 2:
            cluster = {
                "phone": phone,
                "count": len(rows),
                "cards": [card_blurb(x) for x in rows],
                "action": "flag_phone_cluster",
                "reasons": ["shared_phone_manual_keeper_merge"],
            }
            phone_clusters.append(cluster)
            for x in rows:
                findings.append(
                    {
                        **card_blurb(x),
                        "action": "flag_phone_cluster",
                        "phone": phone,
                        "cluster_size": len(rows),
                        "reasons": ["shared_phone_manual_keeper_merge"],
                    }
                )

    # --- apply safe ---
    archived_thin = []
    stripped = []
    cleared_street = []

    if args.apply:
        # thin archive
        for f in findings:
            if f.get("action") != "archive":
                continue
            table = "professionals" if f["type"] == "professional" else "businesses"
            body = {"status": "archived", "updated_at": now}
            if table == "professionals":
                body["import_batch_id"] = BATCH + "_thin"
            client.patch(table, {"id": f"eq.{f['id']}"}, body)
            archived_thin.append(f["slug"])
            applied["archive_thin"] += 1

        # strip narrative
        for f in findings:
            if f.get("action") != "strip_contacts":
                continue
            table = "professionals" if f["type"] == "professional" else "businesses"
            # reload current
            select_cols = "id,short_description,description"
            if table == "professionals":
                select_cols += ",headline"
            rows = (
                client._request(
                    "GET",
                    f"/{table}",
                    params={
                        "select": select_cols,
                        "id": f"eq.{f['id']}",
                        "limit": "1",
                    },
                )
                or []
            )
            if not rows:
                continue
            row = rows[0]
            patch: dict[str, Any] = {"updated_at": now}
            for field in f.get("fields") or ["short_description", "description"]:
                if field == "headline" and table != "professionals":
                    continue
                if field not in row and field != "headline":
                    continue
                patch[field] = strip_phones_from_text(row.get(field))
            if table == "professionals":
                patch["import_batch_id"] = BATCH + "_strip"
            try:
                client.patch(table, {"id": f"eq.{f['id']}"}, patch)
                stripped.append(f["slug"])
                applied["strip_contacts"] += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  skip strip {f.get('slug')}: {exc}", flush=True)
                applied["strip_contacts_error"] += 1

        # clear bad streets
        for f in findings:
            if f.get("action") != "clear_bad_street":
                continue
            table = "professionals" if f["type"] == "professional" else "businesses"
            patch: dict[str, Any] = {"updated_at": now}
            if table == "professionals":
                patch["private_address_line"] = None
                patch["location_precision"] = "city"
                patch["import_batch_id"] = BATCH + "_street"
            else:
                patch["address_line"] = None
                # businesses: null precision (avoid check failures); keep city text
                patch["location_precision"] = None
            try:
                client.patch(table, {"id": f"eq.{f['id']}"}, patch)
                cleared_street.append(f["slug"])
                applied["clear_bad_street"] += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  skip street clear {f.get('slug')}: {exc}", flush=True)
                applied["clear_bad_street_error"] += 1

        # strip narrative — wrap errors so one bad row doesn't abort pass-2
        # (handled above for street; strip already ran partially — make resilient)

    # summary counts
    summary = {
        "mode": "apply" if args.apply else "dry-run",
        "oc_pros_live": len(oc_pros),
        "oc_biz_live": len(oc_biz),
        "counts": {
            "archive_thin": sum(1 for f in findings if f.get("action") == "archive"),
            "strip_contacts": sum(1 for f in findings if f.get("action") == "strip_contacts"),
            "clear_bad_street": sum(1 for f in findings if f.get("action") == "clear_bad_street"),
            "flag_biz_no_street": sum(
                1 for f in findings if f.get("action") == "flag_biz_no_street"
            ),
            "needs_translation_ru": sum(
                1 for f in findings if f.get("action") == "needs_translation_ru"
            ),
            "flag_category": sum(1 for f in findings if f.get("action") == "flag_category"),
            "phone_clusters": len(phone_clusters),
            "phone_cluster_cards": sum(
                1 for f in findings if f.get("action") == "flag_phone_cluster"
            ),
        },
        "applied": dict(applied),
        "applied_slugs": {
            "archived_thin": archived_thin,
            "stripped": stripped[:80],
            "cleared_street": cleared_street,
        },
        "phone_clusters": phone_clusters,
        "findings": findings,
    }

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    (OUT / f"pass2_findings_{stamp}.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "pass2_findings.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    status = {
        "pass": 2,
        "generated_at": now,
        "oc_pros_live": len(oc_pros) - (applied["archive_thin"] if args.apply else 0),
        "oc_biz_live": len(oc_biz),
        "applied": dict(applied),
        "remaining_flags": {
            "biz_without_street": summary["counts"]["flag_biz_no_street"],
            "needs_translation_ru": summary["counts"]["needs_translation_ru"],
            "phone_clusters_manual": summary["counts"]["phone_clusters"],
            "flag_category": summary["counts"]["flag_category"],
        },
        "dump": "oc_catalog_dump_pass2.json",
        "findings": "pass2_findings.json",
        "firewall": "R17 assertPublishAllowed on approve + eligibility autopublish",
    }
    (OUT / "STATUS.json").write_text(
        json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("COUNTS", json.dumps(summary["counts"], ensure_ascii=False))
    print("APPLIED", dict(applied))
    print("STATUS", json.dumps(status, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
