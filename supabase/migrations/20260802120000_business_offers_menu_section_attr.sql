-- Allow menu board section on menu_item offers (Breakfast, Salads, …).

create or replace function public.business_offers_validate_attributes(
  p_type public.business_offer_type,
  p_attrs jsonb
)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  k text;
  allowed text[];
begin
  if p_attrs is null or jsonb_typeof(p_attrs) <> 'object' then
    raise exception 'attributes must be object' using errcode = 'P0001';
  end if;

  allowed := case p_type
    when 'service' then array['duration','service_area','booking_required','mobile_service','warranty']
    when 'product' then array['sku','condition','inventory_status','quantity','brand','model']
    when 'vehicle' then array['year','make','model','trim','mileage','vin','condition','body_type','fuel_type','transmission','exterior_color']
    when 'property' then array['listing_type','property_type','address','city','state','zip','bedrooms','bathrooms','sqft','lot_size','year_built','mls_number']
    when 'rental' then array['rental_period','deposit_amount','minimum_duration','availability_note','capacity']
    when 'menu_item' then array['ingredients','dietary_tags','portion','spice_level','menu_section']
    else array[]::text[]
  end;

  for k in select jsonb_object_keys(p_attrs)
  loop
    if k = any(allowed) then
      continue;
    end if;
    raise exception 'invalid attribute % for offer type %', k, p_type using errcode = 'P0001';
  end loop;
end;
$$;

revoke all on function public.business_offers_validate_attributes(public.business_offer_type, jsonb) from public;
