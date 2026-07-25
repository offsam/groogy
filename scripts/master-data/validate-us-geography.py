#!/usr/bin/env python3
"""Validate Master Data row counts and basic invariants on remote."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("sb_sql", ROOT / "scripts" / "sb_sql.py")
sb = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(sb)


def main() -> None:
    rows = sb.sql(
        """
select jsonb_build_object(
  'countries', (select count(*) from platform_countries),
  'us_states_selectable', (select count(*) from platform_subdivisions where country_iso2='US' and is_selectable),
  'us_subdivisions_all', (select count(*) from platform_subdivisions where country_iso2='US'),
  'counties', (select count(*) from platform_counties),
  'cities', (select count(*) from platform_cities),
  'languages_active', (select count(*) from platform_languages where is_active),
  'currencies_active', (select count(*) from platform_currencies where is_active),
  'units_active', (select count(*) from platform_units where is_active),
  'features_active', (select count(*) from platform_features where is_active),
  'listing_categories_marketplace', (select count(*) from listing_categories where domain='marketplace' and is_active),
  'listing_categories_services', (select count(*) from listing_categories where domain='services' and is_active),
  'business_categories', (select count(*) from categories where is_active),
  'irvine_search', (select count(*) from search_platform_cities('irvine', 'US-CA', 5))
) as report
"""
    )
    report = rows[0]["report"]
    print(json.dumps(report, indent=2, ensure_ascii=False))

    errors = []
    if report["countries"] < 1:
        errors.append("missing US country")
    if report["us_states_selectable"] < 51:
        errors.append(f"expected >=51 selectable states, got {report['us_states_selectable']}")
    if report["counties"] < 3000:
        errors.append(f"expected >=3000 counties, got {report['counties']}")
    if report["cities"] < 30000:
        errors.append(f"expected >=30000 cities, got {report['cities']}")
    if report["languages_active"] < 20:
        errors.append("too few languages")
    if report["irvine_search"] < 1:
        errors.append("Irvine CA search failed")

    if errors:
        print("VALIDATION FAILED:", *errors, sep="\n- ")
        sys.exit(1)
    print("VALIDATION OK")


if __name__ == "__main__":
    main()
