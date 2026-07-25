#!/usr/bin/env python3
"""
Import U.S. Census Bureau 2024 Gazetteer counties + places into Master Data tables.

Source: scripts/master-data/SOURCE.md
Requires: schema migration 20260720120000_master_data_foundation applied.
Uses: scripts/sb_sql.py (Supabase Management API).

Usage:
  python3 scripts/master-data/import-us-geography.py
  python3 scripts/master-data/import-us-geography.py --validate-only
  python3 scripts/master-data/import-us-geography.py --batch-size 400
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent / "data"
sys.path.insert(0, str(ROOT / "scripts"))

spec = importlib.util.spec_from_file_location("sb_sql", ROOT / "scripts" / "sb_sql.py")
sb = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(sb)


def sql_escape(value: str | None) -> str:
    if value is None:
        return "null"
    return "'" + value.replace("'", "''") + "'"


def normalize_name(name: str) -> str:
    n = name.strip().lower()
    n = n.replace("’", "'").replace("`", "'")
    n = re.sub(r"\s+", " ", n)
    # strip trailing CDP / city / town / village designations for search
    n = re.sub(
        r"\s+(cdp|city|town|village|borough|municipality|city and borough|"
        r"census designated place)$",
        "",
        n,
        flags=re.I,
    )
    return n.strip()


def slugify(name: str, geoid: str) -> str:
    base = normalize_name(name)
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    if not base:
        base = "place"
    # keep reasonably short; append geoid for uniqueness within state
    return f"{base[:60]}-{geoid}"


def load_states_map() -> dict[str, str]:
    """abbr -> platform_subdivisions.code (US-XX)."""
    rows = sb.sql(
        "select abbreviation, code from platform_subdivisions where country_iso2 = 'US'"
    )
    return {r["abbreviation"]: r["code"] for r in rows}


def import_counties(state_map: dict[str, str], batch_size: int) -> int:
    path = DATA / "2024_Gaz_counties_national.txt"
    rows: list[str] = []
    total = 0
    with open(path, encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            usps = (row.get("USPS") or "").strip()
            geoid = (row.get("GEOID") or "").strip()
            name = (row.get("NAME") or "").strip()
            if not usps or not geoid or not name:
                continue
            state_code = state_map.get(usps)
            if not state_code:
                continue
            lat = (row.get("INTPTLAT") or "").strip() or None
            lng = (row.get("INTPTLONG") or row.get("INTPTLONG\n") or "").strip() or None
            # strip weird trailing spaces from gazetteer long field name
            for k, v in list(row.items()):
                if k.startswith("INTPTLONG") and v and not lng:
                    lng = v.strip()
            slug = slugify(name, geoid)
            norm = normalize_name(name)
            lat_sql = lat if lat else "null"
            lng_sql = lng if lng else "null"
            rows.append(
                f"({sql_escape(geoid)},{sql_escape(state_code)},{sql_escape(geoid)},"
                f"{sql_escape(name)},{sql_escape(norm)},{sql_escape(slug)},true,"
                f"{lat_sql},{lng_sql})"
            )
            if len(rows) >= batch_size:
                total += flush_counties(rows)
                rows = []
    if rows:
        total += flush_counties(rows)
    return total


def flush_counties(values: list[str]) -> int:
    values_sql = ",\n".join(values)
    q = f"""
insert into public.platform_counties (
  geoid, state_code, fips_code, name, name_normalized, slug, is_active, latitude, longitude
) values
{values_sql}
on conflict (geoid) do update set
  name = excluded.name,
  name_normalized = excluded.name_normalized,
  slug = excluded.slug,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  updated_at = now();
"""
    sb.sql(q)
    return len(values)


def import_cities(state_map: dict[str, str], batch_size: int) -> int:
    path = DATA / "2024_Gaz_place_national.txt"
    rows: list[str] = []
    total = 0
    with open(path, encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        # Fix possible trailing spaces in fieldnames
        if reader.fieldnames:
            reader.fieldnames = [h.strip() for h in reader.fieldnames]
        for row in reader:
            usps = (row.get("USPS") or "").strip()
            geoid = (row.get("GEOID") or "").strip()
            name = (row.get("NAME") or "").strip()
            if not usps or not geoid or not name:
                continue
            state_code = state_map.get(usps)
            if not state_code:
                continue
            ansicode = (row.get("ANSICODE") or "").strip() or None
            lsad = (row.get("LSAD") or "").strip() or None
            lat = (row.get("INTPTLAT") or "").strip() or None
            lng = (row.get("INTPTLONG") or "").strip() or None
            land = (row.get("ALAND_SQMI") or "").strip() or None
            slug = slugify(name, geoid)
            norm = normalize_name(name)
            rows.append(
                "("
                + ",".join(
                    [
                        sql_escape(geoid),
                        sql_escape(state_code),
                        "null",
                        sql_escape(ansicode) if ansicode else "null",
                        sql_escape(name),
                        sql_escape(norm),
                        sql_escape(slug),
                        sql_escape(lsad) if lsad else "null",
                        lat if lat else "null",
                        lng if lng else "null",
                        land if land else "null",
                        "true",
                    ]
                )
                + ")"
            )
            if len(rows) >= batch_size:
                total += flush_cities(rows)
                rows = []
                if total % 4000 == 0:
                    print(f"  cities imported ~{total}", flush=True)
    if rows:
        total += flush_cities(rows)
    return total


def flush_cities(values: list[str]) -> int:
    values_sql = ",\n".join(values)
    q = f"""
insert into public.platform_cities (
  geoid, state_code, primary_county_geoid, ansicode, name, name_normalized, slug,
  lsad, latitude, longitude, land_sq_mi, is_active
) values
{values_sql}
on conflict (geoid) do update set
  name = excluded.name,
  name_normalized = excluded.name_normalized,
  slug = excluded.slug,
  lsad = excluded.lsad,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  land_sq_mi = excluded.land_sq_mi,
  updated_at = now();
"""
    sb.sql(q)
    return len(values)


def validate() -> dict:
    rows = sb.sql(
        """
select
  (select count(*) from platform_countries where iso2='US') as us,
  (select count(*) from platform_subdivisions where country_iso2='US' and is_selectable) as states_selectable,
  (select count(*) from platform_subdivisions where country_iso2='US') as states_all,
  (select count(*) from platform_counties) as counties,
  (select count(*) from platform_cities) as cities,
  (select count(*) from platform_languages where is_active) as languages,
  (select count(*) from platform_currencies where is_active) as currencies,
  (select count(*) from platform_units where is_active) as units,
  (select count(*) from platform_features where is_active) as features
"""
    )
    return rows[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--batch-size", type=int, default=300)
    parser.add_argument("--skip-counties", action="store_true")
    parser.add_argument("--skip-cities", action="store_true")
    args = parser.parse_args()

    if args.validate_only:
        print(json.dumps(validate(), indent=2))
        return

    print("Loading state map from remote…")
    state_map = load_states_map()
    print(f"  {len(state_map)} subdivisions")
    if len(state_map) < 50:
        raise SystemExit("Expected >= 50 US subdivisions — apply schema migration first")

    if not args.skip_counties:
        print("Importing counties…")
        n = import_counties(state_map, args.batch_size)
        print(f"  counties upserted: {n}")

    if not args.skip_cities:
        print("Importing places/cities…")
        n = import_cities(state_map, args.batch_size)
        print(f"  cities upserted: {n}")

    print("Validation:")
    print(json.dumps(validate(), indent=2))


if __name__ == "__main__":
    main()
