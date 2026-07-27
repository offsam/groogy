-- Public provenance flags: platform (КРУГИ) counts as has_source;
-- professionals_public exposes safe source_kind without source_url.

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
  'Approved businesses without phone/email/URLs — safe for anon catalog scrape surface.';

grant select on public.businesses_public to anon, authenticated;

-- Professionals: expose has_source + derived source_kind (no URL).
drop view if exists public.professionals_public;

create view public.professionals_public
with (security_invoker = false)
as
select
  p.id,
  p.slug,
  p.display_name,
  p.headline,
  p.short_description,
  p.description,
  p.image_url,
  p.status,
  p.experience_years,
  p.languages,
  p.availability_text,
  p.opening_hours,
  p.rating_avg,
  p.reviews_count,
  p.city,
  p.region,
  p.state_code,
  p.city_geoid,
  p.county_geoid,
  p.latitude,
  p.longitude,
  p.location_precision,
  p.service_area_text,
  p.service_radius_m,
  p.category_id,
  c.slug as category_slug,
  c.name as category_name,
  p.third_party_mention_count,
  p.self_ad_mention_count,
  p.created_at,
  p.updated_at,
  p.published_at,
  (p.phone is not null and length(btrim(p.phone)) > 0) as has_phone,
  (p.email is not null and length(btrim(p.email)) > 0) as has_email,
  (p.website is not null and length(btrim(p.website)) > 0) as has_website,
  (p.instagram_url is not null and length(btrim(p.instagram_url)) > 0) as has_instagram,
  case
    when upper(coalesce(p.source_type, '')) in ('USER', 'ADMIN') then 'platform'
    when upper(coalesce(p.source_type, '')) = 'TELEGRAM' then 'telegram'
    when upper(coalesce(p.source_type, '')) = 'FACEBOOK' then 'facebook'
    when p.source_url is not null and length(btrim(p.source_url)) > 0
      and p.source_url ~* 'facebook\.com|fb\.com' then 'facebook'
    when p.source_url is not null and length(btrim(p.source_url)) > 0
      and p.source_url ~* 't\.me/|telegram\.me' then 'telegram'
    else null
  end as source_kind,
  (
    upper(coalesce(p.source_type, '')) in ('USER', 'ADMIN')
    or (
      p.source_url is not null
      and length(btrim(p.source_url)) > 0
    )
  ) as has_source
from public.professionals p
left join public.categories c on c.id = p.category_id
where p.status = 'approved'
  and p.visibility = 'public';

grant select on public.professionals_public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
