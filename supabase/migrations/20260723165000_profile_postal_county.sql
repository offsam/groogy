-- Profile ZIP → county for localized КРУГИ branding.

alter table public.profiles
  add column if not exists postal_code text,
  add column if not exists county_geoid text references public.platform_counties(geoid) on delete set null;

create index if not exists profiles_postal_code_idx
  on public.profiles (postal_code)
  where postal_code is not null;

create index if not exists profiles_county_geoid_idx
  on public.profiles (county_geoid)
  where county_geoid is not null;

comment on column public.profiles.postal_code is 'US ZIP (5 digits); used to resolve county for КРУГИ в {county}';
comment on column public.profiles.county_geoid is 'Resolved county from ZIP/city for brand localization';
