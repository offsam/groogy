-- Allow 'directory' provenance on businesses / listings.
-- Directory imports (svoi.us, Orange Pages, To4ka, …) previously had to be
-- stored as 'platform' or null, which made imported cards claim КРУГИ as the
-- source. professionals_public already derives 'directory'; this brings the
-- base tables in line so the value can be stored instead of inferred.

alter table public.businesses
  drop constraint if exists businesses_source_kind_check;

alter table public.businesses
  add constraint businesses_source_kind_check
  check (
    source_kind is null
    or source_kind in ('telegram', 'facebook', 'directory', 'platform')
  );

alter table public.listings
  drop constraint if exists listings_source_kind_check;

alter table public.listings
  add constraint listings_source_kind_check
  check (
    source_kind is null
    or source_kind in ('telegram', 'facebook', 'directory', 'platform')
  );

comment on column public.businesses.source_kind is
  'telegram | facebook | directory | platform | null. platform means created on KRUGI and must not carry an external source_url.';
comment on column public.listings.source_kind is
  'telegram | facebook | directory | platform | null.';

notify pgrst, 'reload schema';
