-- Expose city ZIP on the anti-scrape public catalog view (listing cards).
-- Street address stays private; postal_code + state_code are safe for «Irvine, 92612».

drop view if exists public.businesses_public;

create view public.businesses_public
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
  b.yelp_rating,
  b.yelp_reviews_count,
  b.instagram_followers_count,
  b.image_url,
  b.city,
  b.region,
  b.state_code,
  b.postal_code,
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
    and b.website !~* 'instagram\.com|facebook\.com|fb\.com|yelp\.com|t\.me/|telegram\.me/'
  ) as has_website,
  (
    (b.instagram_url is not null and length(btrim(b.instagram_url)) > 0)
    or (b.website is not null and b.website ~* 'instagram\.com')
  ) as has_instagram,
  (
    b.telegram_url is not null
    and length(btrim(b.telegram_url)) > 0
  ) as has_telegram,
  (
    (b.yelp_url is not null and length(btrim(b.yelp_url)) > 0)
    or (b.website is not null and b.website ~* 'yelp\.com')
  ) as has_yelp,
  (b.website is not null and b.website ~* 'facebook\.com|fb\.com') as has_facebook,
  (
    (b.google_maps_url is not null and length(btrim(b.google_maps_url)) > 0)
    or (b.latitude is not null and b.longitude is not null)
  ) as has_google_maps,
  (
    coalesce(b.source_kind, '') = 'platform'
    or (
      b.source_url is not null
      and length(btrim(b.source_url)) > 0
      and coalesce(b.source_kind, '') <> 'platform'
    )
  ) as has_source
from public.businesses b
where b.status = 'approved';

comment on view public.businesses_public is
  'Approved businesses without phone/email/URLs — safe for anon catalog. Includes city/ZIP for listing cards.';

grant select on public.businesses_public to anon, authenticated;

notify pgrst, 'reload schema';
