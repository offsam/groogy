-- Admin enrich run history for published entities (diagnostic resource route).

create table if not exists public.entity_enrich_runs (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null
    check (entity_kind in (
      'business', 'professional', 'event', 'service', 'job', 'transfer'
    )),
  entity_id uuid not null,
  admin_id uuid references auth.users (id) on delete set null,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists entity_enrich_runs_entity_idx
  on public.entity_enrich_runs (entity_kind, entity_id, created_at desc);

alter table public.entity_enrich_runs enable row level security;
alter table public.entity_enrich_runs force row level security;

revoke all on public.entity_enrich_runs from anon, authenticated;
grant select, insert on public.entity_enrich_runs to authenticated;
grant all on public.entity_enrich_runs to service_role;

drop policy if exists "admins select entity_enrich_runs" on public.entity_enrich_runs;
create policy "admins select entity_enrich_runs"
  on public.entity_enrich_runs for select to authenticated
  using (public.is_admin());

drop policy if exists "admins insert entity_enrich_runs" on public.entity_enrich_runs;
create policy "admins insert entity_enrich_runs"
  on public.entity_enrich_runs for insert to authenticated
  with check (public.is_admin() and admin_id = auth.uid());
