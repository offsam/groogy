-- Completeness score columns for the enrichment infrastructure prep.
-- Additive, nullable-safe, zero-risk: integer default 0 on both tables.
-- Scoring itself is computed in Python (scripts/business-enrich/completeness_score.py)
-- and written back by an explicit backfill run — this migration only adds storage.

alter table public.businesses
  add column if not exists completeness_score integer not null default 0;

alter table public.professionals
  add column if not exists completeness_score integer not null default 0;

comment on column public.businesses.completeness_score is
  'Computed by scripts/business-enrich/completeness_score.py — 0-100ish, see docs/audits/ENRICHMENT_INFRASTRUCTURE_V1.md for the weight table. Not auto-maintained by a trigger; refreshed by an explicit script run.';
comment on column public.professionals.completeness_score is
  'Computed by scripts/business-enrich/completeness_score.py — 0-100, see docs/audits/ENRICHMENT_INFRASTRUCTURE_V1.md for the weight table. Not auto-maintained by a trigger; refreshed by an explicit script run.';
