-- Vacancy worksite (street + pin), separate from the employing business office.
-- Staffing agencies keep HQ on businesses.*; job ads store Collins Ave etc. here.

alter table public.jobs
  add column if not exists address_line text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_precision text;

alter table public.jobs
  drop constraint if exists jobs_location_precision_chk;

alter table public.jobs
  add constraint jobs_location_precision_chk
  check (
    location_precision is null
    or location_precision in ('street', 'county', 'city', 'approx')
  );

comment on column public.jobs.address_line is
  'Worksite street for this vacancy; not the agency HQ (that lives on businesses).';
comment on column public.jobs.latitude is
  'Worksite latitude when location_precision is street.';
comment on column public.jobs.longitude is
  'Worksite longitude when location_precision is street.';
comment on column public.jobs.location_precision is
  'street | county | city | approx — same vocabulary as businesses.';

-- Anon/authenticated already have table-level SELECT; service role writes via admin.
