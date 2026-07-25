-- Hotfix: anon SELECT must include listings.owner_id (and publisher_business_id)
-- so PostgREST/server components can hydrate public listing rows.
-- Catalogs still omit owner UUID; app redacts for strangers.
-- Without this, anonymous getListingById fails → blank titles + forced noindex.

grant select (
  id, owner_id, listing_type, status, visibility, author_visibility,
  title, description, price_amount, price_currency, is_negotiable,
  city, state, latitude, longitude, contact_preference,
  published_at, reserved_at, completed_at, paused_at, archived_at, expires_at,
  favorites_count, created_at, updated_at,
  publisher_type, publisher_business_id
) on public.listings to anon;
