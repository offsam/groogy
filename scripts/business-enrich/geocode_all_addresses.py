#!/usr/bin/env python3
"""Close the geo debt: geocode every approved card that has an address but no pin.

Usage:
  python3 scripts/business-enrich/geocode_all_addresses.py --dry-run
  python3 scripts/business-enrich/geocode_all_addresses.py --apply
  python3 scripts/business-enrich/geocode_all_addresses.py --only professionals --apply
  python3 scripts/business-enrich/geocode_all_addresses.py --apply --limit 50

Geocoding rules live in `address_geo.resolve_address_geo` — same step the
enrichment pipelines run. On a miss the lying `location_precision = 'street'`
is cleared so the card falls back to a city map instead of showing nothing.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))
from address_geo import resolve_address_geo  # noqa: E402
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "geocode_all_addresses"
OUT.mkdir(parents=True, exist_ok=True)

BUSINESS_SELECT = (
    "id,slug,name,address_line,city,region,state_code,"
    "postal_code,latitude,longitude,location_precision,google_maps_url"
)
PROFESSIONAL_SELECT = (
    "id,slug,display_name,private_address_line,city,region,state_code,"
    "postal_code,latitude,longitude,location_precision"
)
# professionals has no google_maps_url column — strip it from the geo patch.


def fetch_rows(
    client: SupabaseRest, table: str, select: str, address_column: str, limit: int
) -> list[dict[str, Any]]:
    rows = (
        client._request(
            "GET",
            f"/{table}",
            params={
                "select": select,
                "status": "eq.approved",
                address_column: "not.is.null",
                "or": "(latitude.is.null,longitude.is.null)",
                "limit": str(limit),
            },
        )
        or []
    )
    return [r for r in rows if (r.get(address_column) or "").strip()]


def process(
    client: SupabaseRest,
    rows: list[dict[str, Any]],
    *,
    table: str,
    address_column: str,
    name_column: str,
    apply: bool,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    label = "biz" if table == "businesses" else "pro"
    for i, row in enumerate(rows, 1):
        address = (row.get(address_column) or "").strip()
        geo = resolve_address_geo(
            address,
            row.get("city"),
            row.get("state_code"),
            row.get("postal_code"),
        )
        patch = dict(geo.patch)
        if table == "professionals":
            patch.pop("google_maps_url", None)
        elif patch.get("google_maps_url") and row.get("google_maps_url"):
            patch.pop("google_maps_url")
        if not geo.ok and row.get("location_precision") != "street":
            # Nothing to correct — no coords and no false street claim.
            patch.pop("location_precision", None)

        item: dict[str, Any] = {
            "entity": table,
            "id": row["id"],
            "slug": row.get("slug"),
            "name": row.get(name_column),
            "address": address,
            "query": geo.query,
            "status": "ok" if geo.ok else geo.reason,
            "patch": patch,
        }
        if patch and apply:
            try:
                client.patch(table, {"id": f"eq.{row['id']}"}, patch)
            except Exception as exc:  # noqa: BLE001
                item["error"] = str(exc)[:240]
        print(
            f"[{label} {i}/{len(rows)}] {item['status']} {row.get(name_column)} "
            f"→ {patch or 'no-op'}",
            flush=True,
        )
        results.append(item)
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--only",
        choices=("all", "businesses", "professionals"),
        default="all",
        help="Limit the run to one entity type.",
    )
    parser.add_argument("--limit", type=int, default=2000)
    args = parser.parse_args()
    apply = bool(args.apply)
    only = args.only

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    businesses = (
        fetch_rows(client, "businesses", BUSINESS_SELECT, "address_line", args.limit)
        if only in ("all", "businesses")
        else []
    )
    professionals = (
        fetch_rows(
            client,
            "professionals",
            PROFESSIONAL_SELECT,
            "private_address_line",
            args.limit,
        )
        if only in ("all", "professionals")
        else []
    )

    print(f"businesses to geocode: {len(businesses)}")
    print(f"professionals to geocode: {len(professionals)}")

    results = process(
        client,
        businesses,
        table="businesses",
        address_column="address_line",
        name_column="name",
        apply=apply,
    )
    results += process(
        client,
        professionals,
        table="professionals",
        address_column="private_address_line",
        name_column="display_name",
        apply=apply,
    )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report = {
        "mode": "apply" if apply else "dry-run",
        "only": only,
        "businesses": len(businesses),
        "professionals": len(professionals),
        "ok": sum(1 for r in results if r.get("status") == "ok"),
        "geocode_miss": sum(1 for r in results if r.get("status") == "geocode_miss"),
        "not_street": sum(1 for r in results if r.get("status") == "not_street"),
        "precision_reset": sum(
            1
            for r in results
            if r.get("patch", {}).get("location_precision", "keep") is None
        ),
        "errors": sum(1 for r in results if r.get("error")),
        "results": results,
    }
    path = OUT / f"{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"report={path} ok={report['ok']} miss={report['geocode_miss']} "
        f"not_street={report['not_street']} reset={report['precision_reset']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
