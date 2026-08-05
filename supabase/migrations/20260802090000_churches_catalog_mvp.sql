-- Churches catalog MVP: standalone admin-curated entities (/churches).
-- Contacts + source_url gated (public view flags + RPCs); address/map public.

create table if not exists public.churches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  description_original text,
  image_url text,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'archived')),
  address_line text,
  city text,
  state_code text,
  postal_code text,
  region text,
  county_geoid text,
  latitude double precision,
  longitude double precision,
  location_precision text
    check (
      location_precision is null
      or location_precision in ('street', 'city', 'county', 'approx')
    ),
  phone text,
  email text,
  website text,
  instagram_url text,
  telegram_url text,
  google_maps_url text,
  contact_links jsonb not null default '[]'::jsonb,
  source_url text,
  source_kind text
    check (
      source_kind is null
      or source_kind in ('telegram', 'facebook', 'directory', 'platform')
    ),
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint churches_lat_chk check (
    latitude is null or (latitude >= -90 and latitude <= 90)
  ),
  constraint churches_lng_chk check (
    longitude is null or (longitude >= -180 and longitude <= 180)
  )
);

create index if not exists churches_status_idx
  on public.churches (status);

create index if not exists churches_slug_idx
  on public.churches (slug);

create index if not exists churches_city_idx
  on public.churches (city)
  where city is not null;

create index if not exists churches_county_geoid_idx
  on public.churches (county_geoid)
  where county_geoid is not null;

comment on table public.churches is
  'Church / religious org cards (/churches/[slug]). Admin-curated; contacts gated.';

create or replace function public.churches_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    new.published_at := coalesce(new.published_at, now());
  end if;
  if new.status = 'archived'
     and (tg_op = 'INSERT' or old.status is distinct from 'archived') then
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists churches_updated_at on public.churches;
create trigger churches_updated_at
  before insert or update on public.churches
  for each row
  execute function public.churches_set_updated_at();

-- Public view: no raw contacts / source_url
drop view if exists public.churches_public;
create view public.churches_public
with (security_invoker = false)
as
select
  c.id,
  c.slug,
  c.name,
  c.description,
  c.description_original,
  c.image_url,
  c.status,
  c.address_line,
  c.city,
  c.state_code,
  c.postal_code,
  c.region,
  c.county_geoid,
  c.latitude,
  c.longitude,
  c.location_precision,
  c.google_maps_url,
  c.source_kind,
  c.published_at,
  c.created_at,
  c.updated_at,
  (c.phone is not null and length(btrim(c.phone)) > 0) as has_phone,
  (c.email is not null and length(btrim(c.email)) > 0) as has_email,
  (c.website is not null and length(btrim(c.website)) > 0) as has_website,
  (c.instagram_url is not null and length(btrim(c.instagram_url)) > 0) as has_instagram,
  (c.telegram_url is not null and length(btrim(c.telegram_url)) > 0) as has_telegram,
  (
    (c.source_url is not null and length(btrim(c.source_url)) > 0)
    or c.source_kind = 'platform'
  ) as has_source
from public.churches c
where c.status = 'approved';

comment on view public.churches_public is
  'Public church cards — presence flags only; contacts via get_church_contacts.';

grant select on public.churches_public to anon, authenticated, service_role;

-- Contacts reveal (auth required)
create or replace function public.get_church_contacts(p_slug text)
returns table (
  phone text,
  email text,
  website text,
  instagram_url text,
  telegram_url text,
  google_maps_url text,
  contact_links jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;
  return query
  select
    c.phone,
    c.email,
    c.website,
    c.instagram_url,
    c.telegram_url,
    c.google_maps_url,
    c.contact_links
  from public.churches c
  where c.slug = p_slug
    and c.status = 'approved'
  limit 1;
end;
$$;

revoke all on function public.get_church_contacts(text) from public;
grant execute on function public.get_church_contacts(text) to authenticated;

-- Source reveal (auth required)
create or replace function public.get_church_source(p_slug text)
returns table (
  source_url text,
  source_kind text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;
  return query
  select
    c.source_url,
    c.source_kind
  from public.churches c
  where c.slug = p_slug
    and c.status = 'approved'
  limit 1;
end;
$$;

revoke all on function public.get_church_source(text) from public;
grant execute on function public.get_church_source(text) to authenticated;

-- RLS
alter table public.churches enable row level security;
alter table public.churches force row level security;

revoke all on table public.churches from anon, authenticated;
grant select, insert, update, delete on table public.churches to authenticated;
grant all on table public.churches to service_role;

drop policy if exists "churches admin all" on public.churches;
create policy "churches admin all"
  on public.churches for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
