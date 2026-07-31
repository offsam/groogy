-- Public check: does this business already have a confirmed owner?
-- Needed because business_owners SELECT is owner-only under RLS.

create or replace function public.business_is_claimed(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.business_owners bo
    where bo.business_id = p_business_id
  );
$$;

revoke all on function public.business_is_claimed(uuid) from public;
grant execute on function public.business_is_claimed(uuid) to anon, authenticated, service_role;

comment on function public.business_is_claimed(uuid) is
  'True when business_owners has at least one row. Nested offers/services cannot be claimed separately.';
