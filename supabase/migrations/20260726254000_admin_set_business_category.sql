-- Admin: change business category (moves card between catalog filters).
create or replace function public.admin_set_business_category(
  p_business_id uuid,
  p_category_id uuid
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

  if p_category_id is not null then
    if not exists (
      select 1
      from public.categories c
      where c.id = p_category_id
        and c.is_active = true
        and c.domain = 'business'
    ) then
      raise exception 'category not found' using errcode = 'P0001';
    end if;
  end if;

  update public.businesses
  set
    category_id = p_category_id,
    updated_at = now()
  where id = p_business_id;

  if not found then
    raise exception 'business not found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_set_business_category(uuid, uuid)
  from public, anon;
grant execute on function public.admin_set_business_category(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
