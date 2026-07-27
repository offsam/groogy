-- Anti-scrape: public catalog without contact plaintext.
-- Anon/authenticated list reads go through businesses_public (flags only).
-- Full businesses table: owners + admins only (no public approved SELECT).

create or replace view public.businesses_public
with (security_invoker = false)
as
select
  b.id,
  b.slug,
  b.category_id,
  b.name,
  b.short_description,
  b.description,
  b.status,
  b.rating_avg,
  b.reviews_count,
  b.ai_verified_reviews_count,
  b.transaction_verified_reviews_count,
  b.google_rating,
  b.google_reviews_count,
  b.image_url,
  b.city,
  b.region,
  b.latitude,
  b.longitude,
  b.location_precision,
  b.opening_hours,
  b.created_at,
  b.updated_at,
  (b.phone is not null and length(btrim(b.phone)) > 0) as has_phone,
  (b.email is not null and length(btrim(b.email)) > 0) as has_email,
  (
    b.website is not null
    and length(btrim(b.website)) > 0
    and b.website !~* 'instagram\.com|facebook\.com|fb\.com|yelp\.com'
  ) as has_website,
  (
    (b.instagram_url is not null and length(btrim(b.instagram_url)) > 0)
    or (b.website is not null and b.website ~* 'instagram\.com')
  ) as has_instagram,
  (
    (b.yelp_url is not null and length(btrim(b.yelp_url)) > 0)
    or (b.website is not null and b.website ~* 'yelp\.com')
  ) as has_yelp,
  (b.website is not null and b.website ~* 'facebook\.com|fb\.com') as has_facebook,
  (
    (b.google_maps_url is not null and length(btrim(b.google_maps_url)) > 0)
    or (b.latitude is not null and b.longitude is not null)
  ) as has_google_maps
from public.businesses b
where b.status = 'approved';

comment on view public.businesses_public is
  'Approved businesses without phone/email/URLs — safe for anon catalog scrape surface.';

grant select on public.businesses_public to anon, authenticated;

-- Stop bulk contact harvest via PostgREST on the base table.
drop policy if exists "approved businesses are publicly readable" on public.businesses;

revoke select on public.businesses from anon;
-- authenticated keeps SELECT for owner/admin RLS policies only

notify pgrst, 'reload schema';
