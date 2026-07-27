-- Community origin counters for professionals (third-party vs self-ads).
-- Null = unknown / not audited — UI skips the badges.

alter table public.professionals
  add column if not exists third_party_mention_count integer
    check (third_party_mention_count is null or third_party_mention_count >= 0);

alter table public.professionals
  add column if not exists self_ad_mention_count integer
    check (self_ad_mention_count is null or self_ad_mention_count >= 0);

comment on column public.professionals.third_party_mention_count is
  'How many times others recommended this specialist in community posts/comments. Null = not audited.';

comment on column public.professionals.self_ad_mention_count is
  'How many times this specialist advertised themselves in community posts. Null = not audited.';

-- Recreate public view to expose counters (safe for public read).
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
  (p.instagram_url is not null and length(btrim(p.instagram_url)) > 0) as has_instagram
from public.professionals p
left join public.categories c on c.id = p.category_id
where p.status = 'approved'
  and p.visibility = 'public';

grant select on public.professionals_public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
