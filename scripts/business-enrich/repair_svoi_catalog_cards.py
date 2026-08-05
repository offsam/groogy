#!/usr/bin/env python3
"""Repair live catalog cards imported from Svoi.us.

Fixes:
  1) SEO og:description («по приемлемым ценам» + Телефон) → real body text
  2) Bare house-number addresses («2951») → cleared (city-only)

Does NOT touch queue enrich / non-Svoi cards.

Usage:
  python3 scripts/business-enrich/repair_svoi_catalog_cards.py --dry-run --limit 20
  python3 scripts/business-enrich/repair_svoi_catalog_cards.py --apply --kind professionals --limit 50
  python3 scripts/business-enrich/repair_svoi_catalog_cards.py --apply --kind all
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from enrich_svoi_directory import parse_maps_search_address  # noqa: E402
from svoi_parse import (  # noqa: E402
    extract_svoi_body_description,
    is_svoi_seo_blurb,
    streetish,
    strip_inline_phone_labels,
)

OUT = Path(__file__).resolve().parent / "data" / "svoi_repair"
OUT.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
BATCH = "svoi_repair_desc_addr_v1"


def fetch_html(url: str, *, timeout: int = 45) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


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


def bare_house(addr: str | None) -> bool:
    a = (addr or "").strip()
    return bool(re.fullmatch(r"\d{1,6}[A-Za-z]?", a))


def is_svoi_chrome_dump(text: str | None) -> bool:
    """Sidebar scrape: «Сообщить о Проблеме Телефон: … Похожие компании»."""
    t = (text or "").strip()
    if not t:
        return False
    if re.match(r"Сообщить\s+о\s+Проблеме", t, re.I):
        return True
    if "Похожие компании" in t and re.search(r"Телефон\s*[:：]", t, re.I):
        return True
    return False


def narrative_is_bad(text: str | None) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if is_svoi_seo_blurb(t) or is_svoi_chrome_dump(t):
        return True
    if re.search(r"Телефон\s*[:：]", t, re.I) or "Телефон —" in t:
        return True
    return False


def short_from_body(body: str) -> str:
    # First sentence-ish, no phone
    clean = strip_inline_phone_labels(body)
    parts = re.split(r"(?<=[.!?…])\s+", clean)
    short = (parts[0] if parts else clean).strip()
    if len(short) < 40 and len(parts) > 1:
        short = f"{short} {parts[1]}".strip()
    return short[:240]


def repair_row(
    row: dict[str, Any],
    *,
    kind: str,
    html: str | None,
    fetch_error: str | None,
) -> dict[str, Any]:
    """Return patch dict (may be empty)."""
    patch: dict[str, Any] = {}
    addr_key = "private_address_line" if kind == "professionals" else "address_line"
    addr = row.get(addr_key)

    if bare_house(addr):
        patch[addr_key] = None
        if kind == "professionals":
            if (row.get("location_precision") or "") == "street":
                patch["location_precision"] = "city"
        else:
            if (row.get("location_precision") or "") == "street":
                patch["location_precision"] = "city"

    body = extract_svoi_body_description(html) if html else None
    maps = parse_maps_search_address(html) if html else {}
    # Only fill street from maps when current line is missing or was a bare house#.
    if maps.get("address_line") and streetish(maps["address_line"]):
        if bare_house(addr) or not (addr or "").strip() or addr_key in patch:
            patch[addr_key] = maps["address_line"]
            if maps.get("city") and not row.get("city"):
                patch["city"] = maps["city"]
            if maps.get("postal_code") and not row.get("postal_code"):
                patch["postal_code"] = maps["postal_code"]

    short = row.get("short_description")
    desc = row.get("description")
    headline = row.get("headline") if kind == "professionals" else None

    needs_desc = (
        narrative_is_bad(short)
        or narrative_is_bad(desc)
        or narrative_is_bad(headline)
        or (body and (not (desc or "").strip() or is_svoi_seo_blurb(desc)))
    )

    if body and needs_desc:
        patch["description"] = body
        patch["short_description"] = short_from_body(body)
        if kind == "professionals":
            # Drop SEO headline if present
            if narrative_is_bad(headline) or is_svoi_seo_blurb(headline):
                patch["headline"] = short_from_body(body)[:160]
    elif needs_desc and not body:
        # No body on source — at least strip phone/SEO from stored copy
        if narrative_is_bad(desc) or is_svoi_seo_blurb(desc):
            cleaned = strip_inline_phone_labels(desc or "")
            if is_svoi_seo_blurb(cleaned) or len(cleaned) < 40:
                patch["description"] = None
                patch["short_description"] = None
            else:
                patch["description"] = cleaned[:4000]
                patch["short_description"] = short_from_body(cleaned)
        if kind == "professionals" and narrative_is_bad(headline):
            patch["headline"] = None

    if fetch_error:
        patch["_fetch_error"] = fetch_error
    return {k: v for k, v in patch.items() if not k.startswith("_")} | (
        {"_fetch_error": fetch_error} if fetch_error else {}
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--kind", choices=("all", "professionals", "businesses"), default="all")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="0 = all")
    ap.add_argument("--sleep", type=float, default=0.35)
    ap.add_argument("--slug", type=str, default=None)
    args = ap.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    kinds: list[str] = []
    if args.kind in ("all", "professionals"):
        kinds.append("professionals")
    if args.kind in ("all", "businesses"):
        kinds.append("businesses")

    report: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc).isoformat()
    patched = 0
    skipped = 0
    errors = 0

    for kind in kinds:
        if kind == "professionals":
            select = (
                "id,slug,display_name,status,source_url,short_description,description,"
                "headline,private_address_line,city,postal_code,location_precision"
            )
            name_key = "display_name"
            addr_key = "private_address_line"
        else:
            select = (
                "id,slug,name,status,source_url,short_description,description,"
                "address_line,city,postal_code,location_precision"
            )
            name_key = "name"
            addr_key = "address_line"

        filt: dict[str, str] = {
            "or": "(source_url.ilike.*svoi.us*,slug.ilike.svoi-*)",
            "status": "eq.approved",
            "order": "slug.asc",
        }
        if args.slug:
            filt = {"slug": f"eq.{args.slug}", "status": "eq.approved"}

        rows = fetch_all(client, kind, select, filt)
        if args.limit:
            rows = rows[: args.limit]
        print(f"{kind}: {len(rows)} cards", flush=True)

        for i, row in enumerate(rows, 1):
            src = (row.get("source_url") or "").strip()
            html = None
            ferr = None
            if src and "svoi.us" in src:
                try:
                    html = fetch_html(src)
                except Exception as exc:  # noqa: BLE001
                    ferr = str(exc)[:160]
                    errors += 1
            else:
                ferr = "no_svoi_source_url"

            raw_patch = repair_row(row, kind=kind, html=html, fetch_error=ferr)
            fetch_error = raw_patch.pop("_fetch_error", None)
            patch = raw_patch

            # Always clear bare addr even without HTML
            if bare_house(row.get(addr_key)) and addr_key not in patch:
                patch[addr_key] = None

            if not patch:
                skipped += 1
                if i % 50 == 0:
                    print(f"  [{i}/{len(rows)}] skip…", flush=True)
                if args.sleep and html is not None:
                    time.sleep(args.sleep)
                continue

            entry = {
                "kind": kind,
                "id": row["id"],
                "slug": row.get("slug"),
                "name": row.get(name_key),
                "patch_keys": sorted(patch.keys()),
                "fetch_error": fetch_error,
                "before_short": (row.get("short_description") or "")[:120],
                "after_short": (patch.get("short_description") or "")[:120]
                if "short_description" in patch
                else None,
                "before_addr": row.get(addr_key),
                "after_addr": patch.get(addr_key) if addr_key in patch else None,
            }
            report.append(entry)

            if args.apply:
                body = {**patch, "updated_at": now}
                if kind == "professionals":
                    body["import_batch_id"] = BATCH
                try:
                    client.patch(kind, {"id": f"eq.{row['id']}"}, body)
                    patched += 1
                except Exception as exc:  # noqa: BLE001
                    entry["apply_error"] = str(exc)[:200]
                    errors += 1
            else:
                patched += 1

            print(
                f"  [{i}/{len(rows)}] {row.get('slug')} → {sorted(patch.keys())}",
                flush=True,
            )
            if args.sleep and html is not None:
                time.sleep(args.sleep)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = OUT / f"{'apply' if args.apply else 'dry'}_{stamp}.json"
    latest = OUT / "latest.json"
    payload = {
        "mode": "apply" if args.apply else "dry-run",
        "batch": BATCH,
        "patched": patched,
        "skipped": skipped,
        "errors": errors,
        "report": report,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    latest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"done patched={patched} skipped={skipped} errors={errors} → {out_path}")
    return 0 if errors < patched or patched == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
