# USA Location Canon V1

Source of Truth for how КРУГИ resolves and filters geography across the United States.

## Decisions

- Canonical membership key: **`county_geoid`** (Census county FIPS, 5 digits).
- Hub IDs (`orange-county`, `los-angeles`, …) are UX shortcuts over one or more counties.
- Without a resolved county: **do not publish** — card stays in import review.
- Region UI: search any US city/county + California hubs as quick picks.

## Trust ladder

First success wins. Conflicts are not silently overridden on publish — unresolved stays in review.

1. **ZIP** → Zippopotam + FCC (`resolveUsZipLocation`)
2. **City + state** → `platform_cities` → `primary_county_geoid`
3. **Coordinates** → FCC Census area API
4. **Source group** → [`data/geo/source_location_groups.json`](../../../data/geo/source_location_groups.json)
5. Else → `location_unresolved` (publish blocked)

County-scoped groups (e.g. Orange County) set `region` + `county_geoid` and **do not invent a city**.

## Code

| Piece | Path |
|---|---|
| Resolver (TS) | [`lib/geo/resolve-entity-location.ts`](../../../lib/geo/resolve-entity-location.ts) |
| Group catalog (TS) | [`lib/geo/source-location-groups.ts`](../../../lib/geo/source-location-groups.ts) |
| Place tokens (cookie/URL) | [`lib/geo/place-tokens.ts`](../../../lib/geo/place-tokens.ts) |
| Group merge helpers | [`lib/geo/source-group-location.ts`](../../../lib/geo/source-group-location.ts) |
| Python group catalog | [`scripts/import-review/source_location_groups.py`](../../../scripts/import-review/source_location_groups.py) |
| Python merge | [`scripts/import-review/resolve_entity_location.py`](../../../scripts/import-review/resolve_entity_location.py) |
| Publish gate | `import_review_publish_gate_errors` (migration `20260730120000_usa_location_canon.sql`) |
| Approve path | [`lib/import-review/actions.ts`](../../../lib/import-review/actions.ts) `resolveAndPersistImportLocation` |
| Place search API | [`app/api/geo/places/search/route.ts`](../../../app/api/geo/places/search/route.ts) |
| Backfill | [`scripts/business-enrich/backfill_county_geoid.py`](../../../scripts/business-enrich/backfill_county_geoid.py) |

## Stored fields

On catalog tables + `import_review_items`:

- `county_geoid` — required for new publishes
- `location_source` ∈ `zip | city | coordinates | source_group | manual`
- `location_confidence` ∈ `exact | inferred`

## Place tokens

Cookie / `?hub=` accepts:

- Bare hub id or `hub:<id>` (legacy + CA quick picks)
- `county:<geoid>`
- `city:<geoid>`

Filters prefer `county_geoid`. Legacy rows without it fall back to coordinates / city aliases.

## Address → geo step (pin contract)

`location_precision = 'street'` is a **pin claim** and may only be written together with `latitude` / `longitude`. A street-looking string is just an address waiting to be geocoded — writing `street` without coordinates left cards with an address and no map.

Every writer goes through one step instead of setting precision by hand:

| Piece | Path |
|---|---|
| Geo step (TS: enrich, publish) | [`lib/geo/geocode-street.ts`](../../../lib/geo/geocode-street.ts) |
| Geo step (Python: enrich scripts) | [`scripts/business-enrich/address_geo.py`](../../../scripts/business-enrich/address_geo.py) |
| Debt backfill (+ resets false `street`) | [`scripts/business-enrich/geocode_all_addresses.py`](../../../scripts/business-enrich/geocode_all_addresses.py) |
| City center for the fallback map | [`lib/geo/city-center.ts`](../../../lib/geo/city-center.ts) |

Steps after an address appears (import approve, admin «Обогатить», enrich scripts):

1. Address looks street-level (house number + street name)? Otherwise precision stays city/county.
2. Geocode via Nominatim; hits landing in another state are rejected. Retry ladder: full line → without unit number (`Ste 200`, `#5`) → without city name (imports carry neighbourhoods).
3. Hit → store `latitude`, `longitude`, `location_precision = 'street'`, `google_maps_url`, and the geocoder ZIP when the card had none.
4. Miss → clear `location_precision`, keep the address text. The profile then shows a city-center map (zoom 11, no marker) instead of a fake pin.

UI reads coordinates, not the flag: `BusinessProfileView` shows a marker only with real street coordinates, otherwise the city map.

## Publish rule

Location resolution does **not** auto-publish. It only fills `county_geoid` so Approve can succeed. Admin still must approve; other gate checks (contacts, category, …) still apply.

## Out of scope (v1)

- Offline ZCTA ZIP dump (live Zippopotam + FCC + cache)
- PostGIS
- Auto-unpublish of live cards missing county (backfill report only)
