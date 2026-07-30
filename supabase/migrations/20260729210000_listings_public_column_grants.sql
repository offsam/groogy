-- Grants for listings columns added after the per-column grant pass in
-- `20260719200000_publishers_and_services_mvp` / `20260719210300`.
-- Without them every public listing query (marketplace / services / transfers /
-- lechu) failed with 42501, so catalogs looked empty instead of erroring.
-- source_url stays out of the anon grant: guests reveal provenance only through
-- /api/listing/[id]/source (auth + rate limit + reveal event).

grant select (payment_methods, source_kind) on public.listings to anon;

grant select (payment_methods, source_kind, source_url)
  on public.listings to authenticated;
