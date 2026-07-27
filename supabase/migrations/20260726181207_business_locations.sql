-- Multiple public locations / service cities per business.
-- businesses.address_line / city / lat/lng remain the primary pin for cards & map.
-- Extra rows live here (franchise cities, second shop, service areas).

create table if not exists public.business_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  label text,
  kind text not null default 'street'
    check (kind in ('street', 'city', 'service_area')),
  address_line text,
  city text,
  region text,
  state_code text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  location_precision text
    check (
      location_precision is null
      or location_precision in ('street', 'city', 'county', 'approx')
    ),
  google_maps_url text,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  source text,
  source_url text,
  status text not null default 'published'
    check (status in ('draft', 'published', 'hidden', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_locations_lat_chk check (
    latitude is null or (latitude >= -90 and latitude <= 90)
  ),
  constraint business_locations_lng_chk check (
    longitude is null or (longitude >= -180 and longitude <= 180)
  ),
  constraint business_locations_has_place_chk check (
    nullif(btrim(coalesce(address_line, '')), '') is not null
    or nullif(btrim(coalesce(city, '')), '') is not null
    or (latitude is not null and longitude is not null)
  )
);

create unique index if not exists business_locations_one_primary_uidx
  on public.business_locations (business_id)
  where is_primary and status = 'published';

create unique index if not exists business_locations_dedupe_uidx
  on public.business_locations (
    business_id,
    lower(coalesce(city, '')),
    lower(coalesce(state_code, '')),
    lower(coalesce(address_line, ''))
  )
  where status = 'published';

create index if not exists business_locations_business_published_idx
  on public.business_locations (business_id, sort_order, created_at)
  where status = 'published';

create index if not exists business_locations_city_idx
  on public.business_locations (lower(city))
  where status = 'published' and city is not null;

comment on table public.business_locations is
  'Extra / multi-city locations for a business. Primary pin also mirrored on businesses.* for list cards.';

alter table public.business_locations enable row level security;

create policy business_locations_public_read
  on public.business_locations
  for select
  to anon, authenticated
  using (status = 'published');

grant select on public.business_locations to anon, authenticated;
grant all on public.business_locations to service_role;

create or replace function public.business_locations_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists business_locations_updated_at on public.business_locations;
create trigger business_locations_updated_at
  before insert or update on public.business_locations
  for each row
  execute function public.business_locations_set_updated_at();
