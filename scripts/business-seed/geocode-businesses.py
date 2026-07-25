#!/usr/bin/env python3
"""Geocode approved businesses.

Rules:
  - Real street address (number + street) → precise lat/lng, location_precision=street
  - County-only label (city/region/address = "Orange County", etc.) →
    platform_counties centroid, location_precision=county
  - City-only without street → leave without coordinates
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("sb_sql", ROOT / "scripts" / "sb_sql.py")
sb = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(sb)

UA = "RussianBusinessAI/1.0 (catalog geocoder; local admin)"


def sql_literal(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def looks_like_street_address(address: str | None) -> bool:
    if not address or not str(address).strip():
        return False
    return bool(re.search(r"(^|\b)\d{1,6}\s+[A-Za-zА-Яа-я]", str(address)))


def geocode(query: str) -> tuple[float, float] | None:
    q = urllib.parse.urlencode(
        {
            "q": query,
            "format": "json",
            "limit": 3,
            "countrycodes": "us",
            "addressdetails": 1,
        }
    )
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{q}",
        headers={"User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    if not data:
        return None
    for item in data:
        cls = (item.get("class") or "", item.get("type") or "")
        if cls[0] in {"place", "boundary"} and cls[1] in {
            "city",
            "town",
            "village",
            "county",
            "state",
            "country",
        }:
            continue
        return float(item["lat"]), float(item["lon"])
    return float(data[0]["lat"]), float(data[0]["lon"])


def clean_street(address: str) -> str:
    cleaned = re.sub(
        r"\b(suite|ste|unit|apt|#)\s*[A-Za-z0-9-]+\b",
        "",
        address,
        flags=re.I,
    )
    return re.sub(r"\s+", " ", cleaned).strip(" ,")


def geocode_structured(
    street: str,
    city: str | None,
    state: str | None,
) -> tuple[float, float] | None:
    params = {
        "street": street,
        "city": city or "",
        "state": state or "",
        "country": "USA",
        "format": "json",
        "limit": 3,
        "addressdetails": 1,
    }
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v})
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{q}",
        headers={"User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    if not data:
        return None

    city_norm = (city or "").lower().strip()
    for item in data:
        addr = item.get("address") or {}
        hit_city = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("municipality")
            or ""
        ).lower()
        if city_norm and hit_city and city_norm not in hit_city and hit_city not in city_norm:
            continue
        return float(item["lat"]), float(item["lon"])
    return float(data[0]["lat"]), float(data[0]["lon"])


def apply_county_centroids(dry_run: bool) -> int:
    """Attach county centroids for businesses labeled as a county (e.g. Orange County)."""
    sql = """
    update public.businesses b
    set
      latitude = c.latitude,
      longitude = c.longitude,
      location_precision = 'county',
      updated_at = now()
    from public.platform_counties c
    where c.is_active = true
      and c.latitude is not null
      and c.longitude is not null
      and (
        b.address_line is null
        or btrim(b.address_line) = ''
        or b.address_line !~ '(^|[[:space:]])[0-9]{1,6}[[:space:]]+[A-Za-zА-Яа-я]'
      )
      and (
        lower(regexp_replace(coalesce(b.city, ''), '\\s+', ' ', 'g')) = lower(c.name)
        or lower(regexp_replace(coalesce(b.region, ''), '\\s+', ' ', 'g')) = lower(c.name)
        or lower(regexp_replace(coalesce(b.address_line, ''), '\\s+', ' ', 'g')) = lower(c.name)
      )
    returning b.slug, b.city, c.name as county
    """
    if dry_run:
        preview = sb.sql(
            """
            select b.slug, b.city, c.name as county
            from public.businesses b
            join public.platform_counties c on c.is_active
              and (
                lower(regexp_replace(coalesce(b.city, ''), '\\s+', ' ', 'g')) = lower(c.name)
                or lower(regexp_replace(coalesce(b.region, ''), '\\s+', ' ', 'g')) = lower(c.name)
                or lower(regexp_replace(coalesce(b.address_line, ''), '\\s+', ' ', 'g')) = lower(c.name)
              )
            where (
              b.address_line is null
              or btrim(b.address_line) = ''
              or b.address_line !~ '(^|[[:space:]])[0-9]{1,6}[[:space:]]+[A-Za-zА-Яа-я]'
            )
            """
        )
        for row in preview:
            print(f"  DRY COUNTY {row['slug']}: {row['city']} → {row['county']}")
        return len(preview)

    rows = sb.sql(sql)
    for row in rows:
        print(f"  COUNTY {row['slug']}: {row['city']} → {row['county']}")
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=80)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-geocode even if latitude/longitude already set",
    )
    parser.add_argument(
        "--counties-only",
        action="store_true",
        help="Only apply county-centroid placement",
    )
    args = parser.parse_args()

    county_n = apply_county_centroids(args.dry_run)
    print(f"County placements: {county_n}")
    if args.counties_only:
        return

    force_clause = "true" if args.force else "(latitude is null or longitude is null)"
    rows = sb.sql(
        f"""
        select id, slug, name, city, address_line, state_code, latitude, longitude
        from public.businesses
        where status = 'approved'
          and {force_clause}
          and address_line is not null
          and btrim(address_line) <> ''
          and address_line ~ '[0-9]'
          and address_line ~ '(^|[[:space:]])[0-9]{{1,6}}[[:space:]]+[A-Za-zА-Яа-я]'
        order by name
        limit {int(args.limit)}
        """
    )
    if not rows:
        print("Nothing to street-geocode")
        return

    ok = 0
    for r in rows:
        if not looks_like_street_address(r.get("address_line")):
            print(f"  SKIP {r['slug']}: no street number")
            continue
        state_abbr = (r.get("state_code") or "").replace("US-", "").strip()
        street = clean_street(str(r["address_line"]))
        city = r.get("city")
        query = ", ".join(
            p for p in [street, city, state_abbr, "USA"] if p
        )
        if args.dry_run:
            print(f"  DRY STREET {r['slug']}: {query}")
            continue
        try:
            time.sleep(1.05)
            hit = geocode_structured(street, city, state_abbr) or geocode(query)
        except Exception as exc:
            print(f"  FAIL {r['slug']}: {exc}")
            continue
        if not hit:
            print(f"  MISS {r['slug']}: {query}")
            continue
        lat, lon = hit
        sb.sql(
            f"""
            update public.businesses
            set latitude = {lat},
                longitude = {lon},
                location_precision = 'street',
                updated_at = now()
            where id = {sql_literal(r['id'])}
            """
        )
        ok += 1
        print(f"  STREET {r['slug']} -> {lat:.5f},{lon:.5f}  ({query})")
    print(f"Street geocoded {ok}/{len(rows)}")


if __name__ == "__main__":
    main()
