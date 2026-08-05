#!/usr/bin/env python3
"""Peel City/ST/ZIP out of street fields and fix conflicting city/ZIP.

When enrich/import pasted "123 Main St, Sherman Oaks, CA 91403" into
private_address_line / address_line while city stayed "Los Angeles", the card
showed the wrong city and a duplicated address. Street-tail wins.

Usage:
  python3 scripts/business-enrich/repair_street_city_zip_dumps.py --dry-run
  python3 scripts/business-enrich/repair_street_city_zip_dumps.py --apply
  python3 scripts/business-enrich/repair_street_city_zip_dumps.py --apply --geocode
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from address_geo import (  # noqa: E402
    _CITY_STATE_ZIP_TAIL_RE,
    _CITY_ZIP_TAIL_RE,
    peel_street_city_state_zip,
    resolve_address_geo,
)
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "repair_street_city_zip"
OUT.mkdir(parents=True, exist_ok=True)

HAS_DUMP_RE = re.compile(
    r",\s*[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .'-]{1,40}\s*,\s*"
    r"(?:[A-Z]{2}|California|New York|Florida|Texas)\s+\d{5}",
    re.I,
)


def fetch_all(
    client: SupabaseRest,
    table: str,
    select: str,
    address_col: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                f"/{table}",
                params={
                    "select": select,
                    "status": "eq.approved",
                    address_col: "not.is.null",
                    "limit": "1000",
                    "offset": str(offset),
                    "order": "id.asc",
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def needs_repair(row: dict[str, Any], address_col: str) -> bool:
    line = (row.get(address_col) or "").strip()
    if not line:
        return False
    if _CITY_STATE_ZIP_TAIL_RE.search(line) or _CITY_ZIP_TAIL_RE.search(line):
        return True
    if HAS_DUMP_RE.search(line):
        return True
    return False


def build_patch(
    row: dict[str, Any],
    address_col: str,
    *,
    geocode: bool,
) -> dict[str, Any] | None:
    line = (row.get(address_col) or "").strip()
    peeled = peel_street_city_state_zip(
        line,
        row.get("city"),
        row.get("state_code"),
        row.get("postal_code"),
    )
    street = peeled.get("address_line")
    patch: dict[str, Any] = {}
    if street != line:
        patch[address_col] = street
    if peeled.get("city") and peeled["city"] != (row.get("city") or "").strip():
        patch["city"] = peeled["city"]
    if peeled.get("state_code") and peeled["state_code"] != (
        row.get("state_code") or ""
    ).strip():
        patch["state_code"] = peeled["state_code"]
    if peeled.get("postal_code") and peeled["postal_code"] != re.sub(
        r"\D", "", str(row.get("postal_code") or "")
    )[:5]:
        patch["postal_code"] = peeled["postal_code"]

    if not patch:
        return None

    # City/ZIP changed → old pin may be wrong; re-geocode or clear precision.
    location_changed = any(k in patch for k in ("city", "postal_code", address_col))
    if location_changed and street:
        if geocode:
            geo = resolve_address_geo(
                street,
                peeled.get("city") or row.get("city"),
                peeled.get("state_code") or row.get("state_code"),
                peeled.get("postal_code") or row.get("postal_code"),
                with_maps_url=(address_col == "address_line"),
            )
            for k, v in geo.patch.items():
                if address_col == "private_address_line" and k == "google_maps_url":
                    continue
                patch[k] = v
        else:
            # Force next geocode pass; drop lying street precision if ZIP moved.
            if "postal_code" in patch or "city" in patch:
                patch["latitude"] = None
                patch["longitude"] = None
                patch["location_precision"] = None
                if "county_geoid" in row:
                    patch["county_geoid"] = None

    return patch


def process(
    client: SupabaseRest,
    rows: list[dict[str, Any]],
    *,
    table: str,
    address_col: str,
    name_col: str,
    apply: bool,
    geocode: bool,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for i, row in enumerate(rows, 1):
        if not needs_repair(row, address_col):
            continue
        patch = build_patch(row, address_col, geocode=geocode)
        if not patch:
            continue
        item = {
            "table": table,
            "id": row["id"],
            "slug": row.get("slug"),
            "name": row.get(name_col),
            "before": {
                "street": row.get(address_col),
                "city": row.get("city"),
                "postal_code": row.get("postal_code"),
                "state_code": row.get("state_code"),
            },
            "patch": patch,
        }
        if apply:
            try:
                client.patch(table, {"id": f"eq.{row['id']}"}, patch)
            except Exception as exc:  # noqa: BLE001
                item["error"] = str(exc)[:240]
        print(
            f"[{table} {i}] {row.get('slug')} "
            f"{item['before']['city']}/{item['before']['postal_code']} → "
            f"{patch.get('city', item['before']['city'])}/"
            f"{patch.get('postal_code', item['before']['postal_code'])} "
            f"street={patch.get(address_col, 'unchanged')!r}",
            flush=True,
        )
        results.append(item)
    return results


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--geocode",
        action="store_true",
        help="Re-geocode after peel (Nominatim; slow).",
    )
    ap.add_argument(
        "--only",
        choices=("all", "businesses", "professionals"),
        default="all",
    )
    args = ap.parse_args()
    apply = bool(args.apply)

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    results: list[dict[str, Any]] = []
    if args.only in ("all", "professionals"):
        pros = fetch_all(
            client,
            "professionals",
            "id,slug,display_name,private_address_line,city,region,state_code,"
            "postal_code,latitude,longitude,location_precision,county_geoid",
            "private_address_line",
        )
        print(f"professionals scanned: {len(pros)}")
        results += process(
            client,
            pros,
            table="professionals",
            address_col="private_address_line",
            name_col="display_name",
            apply=apply,
            geocode=args.geocode,
        )
    if args.only in ("all", "businesses"):
        biz = fetch_all(
            client,
            "businesses",
            "id,slug,name,address_line,city,region,state_code,"
            "postal_code,latitude,longitude,location_precision,county_geoid",
            "address_line",
        )
        print(f"businesses scanned: {len(biz)}")
        results += process(
            client,
            biz,
            table="businesses",
            address_col="address_line",
            name_col="name",
            apply=apply,
            geocode=args.geocode,
        )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report = {
        "mode": "apply" if apply else "dry-run",
        "geocode": args.geocode,
        "repaired": len(results),
        "errors": sum(1 for r in results if r.get("error")),
        "results": results,
    }
    path = OUT / f"{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report={path} repaired={report['repaired']} errors={report['errors']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
