-- Location precision: street address vs county-only (e.g. "Orange County").
alter table public.businesses
  add column if not exists location_precision text;

alter table public.businesses
  drop constraint if exists businesses_location_precision_chk;

alter table public.businesses
  add constraint businesses_location_precision_chk
  check (
    location_precision is null
    or location_precision in ('street', 'county')
  );

comment on column public.businesses.location_precision is
  'street = precise address pin; county = county-level only (e.g. city = Orange County).';

-- Mark existing street geocodes.
update public.businesses
set location_precision = 'street'
where location_precision is null
  and latitude is not null
  and longitude is not null
  and address_line is not null
  and address_line ~ '(^|[[:space:]])[0-9]{1,6}[[:space:]]+[A-Za-zА-Яа-я]';

-- County-only: explicit county label (must match platform_counties.name, e.g. "Orange County").
-- Do NOT treat bare city names like "Los Angeles" / "San Diego" as counties.
update public.businesses b
set
  latitude = c.latitude,
  longitude = c.longitude,
  location_precision = 'county',
  updated_at = now()
from public.platform_counties c
where c.is_active = true
  and c.latitude is not null
  and c.longitude is not null
  and (
    b.address_line is null
    or btrim(b.address_line) = ''
    or b.address_line !~ '(^|[[:space:]])[0-9]{1,6}[[:space:]]+[A-Za-zА-Яа-я]'
  )
  and (
    lower(regexp_replace(coalesce(b.city, ''), '\s+', ' ', 'g')) = lower(c.name)
    or lower(regexp_replace(coalesce(b.region, ''), '\s+', ' ', 'g')) = lower(c.name)
    or lower(regexp_replace(coalesce(b.address_line, ''), '\s+', ' ', 'g')) = lower(c.name)
  );
