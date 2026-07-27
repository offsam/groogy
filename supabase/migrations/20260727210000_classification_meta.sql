-- Classification provenance for the NULL entity_type backlog pass.
-- Additive only, nullable — no impact on existing rows or code paths.
alter table public.import_review_items
  add column if not exists classification_confidence text;
alter table public.import_review_items
  add column if not exists classification_reason text;
