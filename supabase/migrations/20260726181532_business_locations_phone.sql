alter table public.business_locations
  add column if not exists phone text;

comment on column public.business_locations.phone is
  'Optional local phone for this location (franchise / multi-city).';
