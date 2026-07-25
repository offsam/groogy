# US Geography Source

- Provider: U.S. Census Bureau
- Dataset: 2024 Gazetteer Files (national)
  - Counties: 2024_Gaz_counties_national.txt
  - Places (incorporated + CDPs): 2024_Gaz_place_national.txt
- States: Census ANSI state codes (state.txt)
- Retrieved: 2026-07-19
- URL base: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/
- Import: scripts/master-data/import-us-geography.py (deterministic, idempotent)
- App has no runtime dependency on Census APIs.
