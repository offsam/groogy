-- Future admin section grants. Not enforced on routes yet.

create table if not exists public.admin_capability_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  capabilities text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.admin_capability_grants enable row level security;

drop policy if exists "admins read capability grants" on public.admin_capability_grants;
create policy "admins read capability grants"
  on public.admin_capability_grants
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins write capability grants" on public.admin_capability_grants;
create policy "admins write capability grants"
  on public.admin_capability_grants
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.admin_capability_grants to authenticated;
