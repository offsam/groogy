-- Hotfix: rename service_details_enforce local var title → listing_title (ambiguous with column).

CREATE OR REPLACE FUNCTION public.service_details_enforce()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  owner uuid;
  ltype listing_type;
  lst_status text;
  pub_type listing_publisher_type;
  pub_biz uuid;
  listing_title text;
  uid uuid := (select auth.uid());
begin
  select l.owner_id, l.listing_type, l.status::text, l.publisher_type,
         l.publisher_business_id, l.title
    into owner, ltype, lst_status, pub_type, pub_biz, listing_title
  from public.listings l where l.id = new.listing_id;
  if owner is null then
    raise exception 'listing not found' using errcode = 'P0001';
  end if;
  if ltype is distinct from 'service' then
    raise exception 'not a service listing' using errcode = 'P0001';
  end if;
  if not public.is_admin() and (uid is null or owner is distinct from uid) then
    raise exception 'not listing owner' using errcode = '42501';
  end if;

  if new.price_unit is not null then
    new.price_unit := nullif(btrim(new.price_unit), '');
  end if;
  if new.service_area is not null then
    new.service_area := nullif(btrim(new.service_area), '');
  end if;
  if new.license_info is not null then
    new.license_info := nullif(btrim(new.license_info), '');
  end if;
  if new.insurance_status is not null then
    new.insurance_status := nullif(btrim(new.insurance_status), '');
  end if;
  if new.availability_text is not null then
    new.availability_text := nullif(btrim(new.availability_text), '');
  end if;

  -- Duplicate active check when category changes on an already-active listing
  if lst_status = 'active'
     and (
       tg_op = 'INSERT'
       or new.service_category_id is distinct from old.service_category_id
     )
     and exists (
       select 1
       from public.listings l
       left join public.service_listing_details d on d.listing_id = l.id
       where l.listing_type = 'service'
         and l.status::text = 'active'
         and l.id is distinct from new.listing_id
         and lower(btrim(l.title)) = lower(btrim(listing_title))
         and d.service_category_id is not distinct from new.service_category_id
         and (
           (pub_type = 'profile'
             and l.publisher_type = 'profile'
             and l.owner_id = owner)
           or (pub_type = 'business'
             and l.publisher_type = 'business'
             and l.publisher_business_id = pub_biz)
         )
     )
  then
    raise exception 'duplicate active service listing for title and category' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

revoke all on function public.service_details_enforce() from public, anon, authenticated;
