-- Allow trusted/service autopublish to write marketplace_listing_details.

create or replace function public.marketplace_details_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  owner uuid;
  ltype listing_type;
  uid uuid := (select auth.uid());
begin
  select owner_id, listing_type into owner, ltype
  from public.listings where id = new.listing_id;
  if owner is null then
    raise exception 'listing not found' using errcode = 'P0001';
  end if;
  if ltype is distinct from 'marketplace_item' then
    raise exception 'not a marketplace listing' using errcode = 'P0001';
  end if;
  if not public.is_admin()
     and not private.has_trusted_listing_write()
     and (uid is null or owner is distinct from uid) then
    raise exception 'not listing owner' using errcode = '42501';
  end if;
  if new.transaction_type = 'wanted' and new.condition is null then
    null; -- allowed
  end if;
  return new;
end;
$$;
