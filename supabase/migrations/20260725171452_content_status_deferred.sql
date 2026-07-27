-- Deferred moderation queue: postpone review without rejecting.
-- Public catalog still only exposes status = 'approved'.

alter type public.content_status add value if not exists 'deferred';

create or replace function public.admin_set_business_status(
  p_business_id uuid,
  p_status content_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'approved', 'rejected', 'archived', 'deferred') then
    raise exception 'unsupported admin status' using errcode = 'P0001';
  end if;

  update public.businesses
  set status = p_status, updated_at = now()
  where id = p_business_id;

  if not found then
    raise exception 'business not found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_set_business_status(uuid, content_status) from public, anon;
grant execute on function public.admin_set_business_status(uuid, content_status) to authenticated;
