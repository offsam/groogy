-- Owner/admin inline edit writes columns added after the original
-- column-level UPDATE grant list. Missing grants surface Postgres
-- "permission denied for table businesses" on every contacts save
-- (contact_links is always included in the patch).

grant update (
  contact_links,
  postal_code,
  location_precision,
  telegram_url,
  booking_url
) on public.businesses to authenticated;
