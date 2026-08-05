-- Allow catalog enrich-all markers for every published enrich kind.
alter table public.entity_enrich_runs
  drop constraint if exists entity_enrich_runs_entity_kind_check;

alter table public.entity_enrich_runs
  add constraint entity_enrich_runs_entity_kind_check
  check (entity_kind in (
    'business',
    'professional',
    'event',
    'service',
    'job',
    'transfer',
    'marketplace',
    'lechu',
    'church'
  ));
