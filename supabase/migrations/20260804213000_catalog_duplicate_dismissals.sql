-- Admin: mark catalog duplicate pairs as «не двойник» so scans skip them.

create table if not exists public.catalog_duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  -- Canonical order: (left_kind, left_id) < (right_kind, right_id) lexicographically.
  left_kind text not null
    check (left_kind in ('business', 'professional', 'event', 'job', 'service', 'transfer', 'marketplace', 'lechu')),
  left_id uuid not null,
  right_kind text not null
    check (right_kind in ('business', 'professional', 'event', 'job', 'service', 'transfer', 'marketplace', 'lechu')),
  right_id uuid not null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint catalog_duplicate_dismissals_ordered_chk check (
    (left_kind < right_kind)
    or (left_kind = right_kind and left_id < right_id)
  ),
  constraint catalog_duplicate_dismissals_pair_uidx unique (left_kind, left_id, right_kind, right_id)
);

create index if not exists catalog_duplicate_dismissals_left_idx
  on public.catalog_duplicate_dismissals (left_kind, left_id);

create index if not exists catalog_duplicate_dismissals_right_idx
  on public.catalog_duplicate_dismissals (right_kind, right_id);

comment on table public.catalog_duplicate_dismissals is
  'Admin-dismissed catalog duplicate pairs («не двойник»). Find-all / per-card scans skip these.';

alter table public.catalog_duplicate_dismissals enable row level security;

drop policy if exists "admins read catalog_duplicate_dismissals"
  on public.catalog_duplicate_dismissals;
create policy "admins read catalog_duplicate_dismissals"
  on public.catalog_duplicate_dismissals
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins insert catalog_duplicate_dismissals"
  on public.catalog_duplicate_dismissals;
create policy "admins insert catalog_duplicate_dismissals"
  on public.catalog_duplicate_dismissals
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admins delete catalog_duplicate_dismissals"
  on public.catalog_duplicate_dismissals;
create policy "admins delete catalog_duplicate_dismissals"
  on public.catalog_duplicate_dismissals
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "admins update catalog_duplicate_dismissals"
  on public.catalog_duplicate_dismissals;
create policy "admins update catalog_duplicate_dismissals"
  on public.catalog_duplicate_dismissals
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on table public.catalog_duplicate_dismissals
  to authenticated, service_role;
