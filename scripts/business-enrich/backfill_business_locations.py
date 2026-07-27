#!/usr/bin/env python3
"""Backfill multi-location street addresses for franchise businesses.

Seeds 5 Star Appliance Repair from public /contact-us/ page:
  street + city + ZIP per office. Phones stay on businesses / contacts only.

Usage:
  python3 scripts/business-enrich/backfill_business_locations.py --dry-run
  python3 scripts/business-enrich/backfill_business_locations.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import load_env  # noqa: E402

UA = "Mozilla/5.0 (compatible; KrugiLocations/1.0; +https://krugi.app)"
SOURCE = "website_contact_us"
CONTACT_URL = "https://5starappliancerepair.pro/contact-us/"

# Parsed from https://5starappliancerepair.pro/contact-us/
FIVE_STAR_LOCATIONS = [
    {
        "label": "Brea",
        "city": "Brea",
        "state_code": "US-CA",
        "region": "CA",
        "postal_code": "92821",
        "address_line": "1800 E Lambert Rd",
        "kind": "street",
        "is_primary": True,
        "sort_order": 10,
    },
    {
        "label": "San Jose",
        "city": "San Jose",
        "state_code": "US-CA",
        "region": "CA",
        "postal_code": "95125",
        "address_line": "1043 Ramona Ave",
        "kind": "street",
        "is_primary": False,
        "sort_order": 20,
    },
    {
        "label": "Chicago",
        "city": "Chicago",
        "state_code": "US-IL",
        "region": "IL",
        "postal_code": "60612",
        "address_line": "300 N Oakley Blvd",
        "kind": "street",
        "is_primary": False,
        "sort_order": 30,
    },
    {
        "label": "Mercer Island",
        "city": "Mercer Island",
        "state_code": "US-WA",
        "region": "WA",
        "postal_code": "98040",
        "address_line": "7549 SE 29th St",
        "kind": "street",
        "is_primary": False,
        "sort_order": 40,
    },
    {
        "label": "Bellevue",
        "city": "Bellevue",
        "state_code": "US-WA",
        "region": "WA",
        "postal_code": "98004",
        "address_line": "145 105th Ave SE",
        "kind": "street",
        "is_primary": False,
        "sort_order": 50,
    },
    {
        "label": "Washington, DC",
        "city": "Washington",
        "state_code": "US-DC",
        "region": "DC",
        "postal_code": "20008",
        "address_line": "2804 29th St NW",
        "kind": "street",
        "is_primary": False,
        "sort_order": 60,
    },
]


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
    req = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None


def geocode(street: str, city: str, state: str, postal: str) -> tuple[float, float] | None:
    for q in (
        f"{street}, {city}, {state} {postal}, USA",
        f"{street}, {city}, {state}, USA",
    ):
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": q, "format": "json", "limit": "1"}
        )
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
        if rows:
            return float(rows[0]["lat"]), float(rows[0]["lon"])
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    biz_rows = rest(
        url,
        key,
        "/rest/v1/businesses?select=id,slug,name,city,address_line"
        "&slug=eq.batch2-5-star-appliance-repair&limit=1",
    )
    if not biz_rows:
        print("5 Star business not found")
        return 1
    biz = biz_rows[0]
    print(json.dumps({"business": biz["slug"], "id": biz["id"]}, ensure_ascii=False))

    planned: list[dict[str, Any]] = []
    for loc in FIVE_STAR_LOCATIONS:
        state_short = loc["state_code"].replace("US-", "")
        coords = geocode(
            loc["address_line"], loc["city"], state_short, loc["postal_code"]
        )
        time.sleep(1.1)
        full = (
            f"{loc['address_line']}, {loc['city']}, {state_short} {loc['postal_code']}"
        )
        maps = (
            "https://www.google.com/maps/search/?api=1&query="
            + urllib.parse.quote(full)
        )
        planned.append(
            {
                "business_id": biz["id"],
                "label": loc["label"],
                "kind": loc["kind"],
                "address_line": loc["address_line"],
                "city": loc["city"],
                "region": loc["region"],
                "state_code": loc["state_code"],
                "postal_code": loc["postal_code"],
                "latitude": coords[0] if coords else None,
                "longitude": coords[1] if coords else None,
                "location_precision": "street" if coords else "city",
                "google_maps_url": maps,
                "is_primary": loc["is_primary"],
                "sort_order": loc["sort_order"],
                "source": SOURCE,
                "source_url": CONTACT_URL,
                "status": "published",
            }
        )
        print("-", loc["label"], full, "geo=" + ("yes" if coords else "no"), flush=True)

    if args.dry_run:
        print(json.dumps({"mode": "dry-run", "planned": len(planned)}, indent=2))
        return 0

    existing = (
        rest(
            url,
            key,
            f"/rest/v1/business_locations?select=id&business_id=eq.{biz['id']}"
            f"&or=(source.eq.website_locations_menu,source.eq.{SOURCE})",
        )
        or []
    )
    for ex in existing:
        rest(
            url,
            key,
            f"/rest/v1/business_locations?id=eq.{ex['id']}",
            method="PATCH",
            body={"status": "archived"},
            prefer="return=minimal",
        )

    created = 0
    failures: list[str] = []
    for row in planned:
        try:
            rest(
                url,
                key,
                "/rest/v1/business_locations",
                method="POST",
                body=row,
                prefer="return=minimal",
            )
            created += 1
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{row['label']}: {exc}")

    primary = next(p for p in planned if p["is_primary"])
    biz_patch = {
        "address_line": primary["address_line"],
        "city": primary["city"],
        "region": primary["region"],
        "state_code": primary["state_code"],
        "google_maps_url": primary["google_maps_url"],
        "location_precision": "street",
    }
    if primary.get("latitude") is not None:
        biz_patch["latitude"] = primary["latitude"]
        biz_patch["longitude"] = primary["longitude"]
    rest(
        url,
        key,
        f"/rest/v1/businesses?id=eq.{biz['id']}",
        method="PATCH",
        body=biz_patch,
        prefer="return=minimal",
    )

    print(
        json.dumps(
            {
                "mode": "apply",
                "created": created,
                "failures": failures,
                "business_patch": biz_patch,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
