# Business Catalog Seed

Real Facebook entity import for the directory catalog.

## Purpose

Idempotent import of entity rows into `public.businesses` from the Facebook
extraction dataset. Replaces demo/mock catalog data.

## Unique key

Upsert target: `businesses.slug`

Slug format: `fb-post-{source_post_number}-{name-slug}`

## Dataset

- File: `data/facebook_entities_posts_1_41.json` (master array)
- Per-entity files: `data/facebook-entities/post-{n}-{slug}.json` (+ `INDEX.json`)
- Enriched batch: `data/enriched_entities_batch_1.json`
- Consolidated 18: `data/facebook_entities_consolidated_18.json` + `data/consolidated-18/{id}.json`
- Batch 2 stubs: `data/facebook_entities_batch_2.json` (new cards + update notes)
- Rich batches 1–6: `data/facebook-batches-1-6/batch_{1..6}.json`
- Source: Facebook group entity extraction (posts 1–41)

## Commands

```bash
# import (deletes non-Facebook demo rows, then upserts)
python3 scripts/business-seed/import-facebook-entities.py

# import without deleting other rows
python3 scripts/business-seed/import-facebook-entities.py --keep-existing

# dry-run validation only
python3 scripts/business-seed/import-facebook-entities.py --dry-run

# PACK 2.8: approve contactable allowlist only
python3 scripts/business-seed/approve-facebook-businesses.py

# validate remote counts + allowlist publish rules
python3 scripts/business-seed/validate-facebook-entities.py

# batch 2 stubs + update notes on existing cards
python3 scripts/business-seed/import-batch2-entities.py

# rich batches 1–6 (enrich existing by phone/name, else create fbpack-*)
python3 scripts/business-seed/import-facebook-batches-1-6.py
```

## Upsert rules

- Insert missing slugs.
- On conflict(slug): update catalog content fields.
- Never overwrite `rating_avg`, `reviews_count`, verification counters.
- Status for imported rows: `pending` (Pending Review).
- Public catalog RLS only exposes `approved` rows until moderation.
- Full original Facebook record is preserved in `description` after
  the marker `---FACEBOOK_SOURCE---`.
- Re-run safe: no duplicate rows.

## Schema notes

Uses existing columns only. Does not add email, Instagram, subcategory,
hours, or multi-photo tables. Unmapped Facebook fields live in the
SOURCE block inside `description`.
