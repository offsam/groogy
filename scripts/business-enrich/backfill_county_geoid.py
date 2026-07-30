#!/usr/bin/env python3
"""Backfill county_geoid on approved businesses / professionals (USA Location Canon).

Dry-run by default. Pass --apply to write.

Examples:
  python3 scripts/business-enrich/backfill_county_geoid.py
  python3 scripts/business-enrich/backfill_county_geoid.py --apply --limit 200
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402
from group_location import merge_city_with_group  # noqa: E402
from source_location_groups import location_from_group  # noqa: E402

OUT_DIR = ROOT / "docs" / "audits" / "data"


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def rows(client: SupabaseRest, path: str, select: str, status_eq: str) -> list[dict]:
    out: list[dict] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                path,
                params={
                    "select": select,
                    "status": f"eq.{status_eq}",
                    "order": "id.asc",
                    "limit": "1000",
                    "offset": str(offset),
                },
            )
            or []
        )
        out.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return out


def resolve_row(row: dict, *, kind: str) -> dict | None:
    """Return patch fields or None if already set / unresolved."""
    if row.get("county_geoid"):
        return None

    city = row.get("city")
    region = row.get("region")
    state = row.get("state_code") or row.get("state")
    postal = row.get("postal_code")
    source = row.get("source_url") or row.get("source_kind") or row.get("source_type")
    # Best-effort group from URL / source fields
    from_group = location_from_group(
        str(source) if source else None,
        row.get("source_channel"),
    )
    merged = merge_city_with_group(
        city=city,
        state=state,
        source_group=None,
        source=str(source) if source else None,
        text=" ".join(
            filter(
                None,
                [
                    row.get("description"),
                    row.get("short_description"),
                    row.get("display_name") if kind == "pro" else row.get("name"),
                ],
            )
        ),
        postal_code=postal,
    )
    county = merged.get("county_geoid") or (from_group or {}).get("county_geoid")
    if not county:
        return None

    patch = {
        "county_geoid": county,
        "location_source": merged.get("location_source") or "source_group",
        "location_confidence": "inferred",
    }
    # Fix county-as-city
    if city and "county" in str(city).lower():
        patch["city"] = None
        if not region:
            patch["region"] = city
    elif not city and merged.get("city"):
        patch["city"] = merged["city"]
    if not region and merged.get("region"):
        patch["region"] = merged["region"]
    return patch


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    biz = rows(
        client,
        "/businesses",
        "id,name,slug,city,region,state_code,postal_code,county_geoid,source_url,source_kind,description,short_description",
        "approved",
    )
    pro = rows(
        client,
        "/professionals",
        "id,display_name,slug,city,region,state_code,postal_code,county_geoid,source_url,source_type,description,short_description",
        "approved",
    )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "apply": args.apply,
        "businesses": {"scanned": len(biz), "patched": 0, "unresolved": []},
        "professionals": {"scanned": len(pro), "patched": 0, "unresolved": []},
    }

    for kind, table, list_rows, name_key in (
        ("biz", "businesses", biz, "name"),
        ("pro", "professionals", pro, "display_name"),
    ):
        bucket = report["businesses" if kind == "biz" else "professionals"]
        n = 0
        for row in list_rows:
            if args.limit and n >= args.limit:
                break
            if row.get("county_geoid"):
                continue
            n += 1
            patch = resolve_row(row, kind=kind)
            if not patch:
                bucket["unresolved"].append(
                    {
                        "id": row["id"],
                        "slug": row.get("slug"),
                        "name": row.get(name_key),
                        "city": row.get("city"),
                        "region": row.get("region"),
                    }
                )
                continue
            if args.apply:
                client._request(
                    "PATCH",
                    f"/{table}",
                    params={"id": f"eq.{row['id']}"},
                    json_body=patch,
                )
            bucket["patched"] += 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = _stamp()
    path = OUT_DIR / f"county_geoid_backfill_{stamp}.json"
    latest = OUT_DIR / "county_geoid_backfill_latest.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    latest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"businesses patched={report['businesses']['patched']} "
        f"unresolved={len(report['businesses']['unresolved'])}"
    )
    print(
        f"professionals patched={report['professionals']['patched']} "
        f"unresolved={len(report['professionals']['unresolved'])}"
    )
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
