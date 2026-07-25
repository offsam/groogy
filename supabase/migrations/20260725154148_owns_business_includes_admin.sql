-- Admins act as owners of every business for RLS / owns_business checks.
create or replace function public.owns_business(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.business_owners bo
      where bo.business_id = p_business_id
        and bo.user_id = (select auth.uid())
    );
$$;

revoke all on function public.owns_business(uuid) from public;
grant execute on function public.owns_business(uuid) to authenticated;
