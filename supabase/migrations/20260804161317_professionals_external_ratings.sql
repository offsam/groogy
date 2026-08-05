-- External review metrics on professionals (Google / Yelp / Trustpilot / Facebook),
-- same shape as businesses — specialists often have their own Maps/Yelp pages.

alter table public.professionals
  add column if not exists google_rating numeric(2,1),
  add column if not exists google_reviews_count integer not null default 0,
  add column if not exists yelp_rating numeric,
  add column if not exists yelp_reviews_count integer not null default 0,
  add column if not exists trustpilot_rating numeric,
  add column if not exists trustpilot_reviews_count integer not null default 0,
  add column if not exists facebook_recommend_pct numeric,
  add column if not exists facebook_reviews_count integer not null default 0;

alter table public.professionals
  drop constraint if exists professionals_google_rating_chk;
alter table public.professionals
  add constraint professionals_google_rating_chk
  check (
    google_rating is null
    or (google_rating >= 0 and google_rating <= 5)
  );

alter table public.professionals
  drop constraint if exists professionals_google_reviews_count_chk;
alter table public.professionals
  add constraint professionals_google_reviews_count_chk
  check (google_reviews_count >= 0);

alter table public.professionals
  drop constraint if exists professionals_yelp_rating_chk;
alter table public.professionals
  add constraint professionals_yelp_rating_chk
  check (
    yelp_rating is null
    or (yelp_rating >= 0 and yelp_rating <= 5)
  );

alter table public.professionals
  drop constraint if exists professionals_yelp_reviews_count_chk;
alter table public.professionals
  add constraint professionals_yelp_reviews_count_chk
  check (yelp_reviews_count >= 0);

alter table public.professionals
  drop constraint if exists professionals_trustpilot_rating_chk;
alter table public.professionals
  add constraint professionals_trustpilot_rating_chk
  check (
    trustpilot_rating is null
    or (trustpilot_rating >= 0 and trustpilot_rating <= 5)
  );

alter table public.professionals
  drop constraint if exists professionals_trustpilot_reviews_count_chk;
alter table public.professionals
  add constraint professionals_trustpilot_reviews_count_chk
  check (trustpilot_reviews_count >= 0);

alter table public.professionals
  drop constraint if exists professionals_facebook_recommend_pct_chk;
alter table public.professionals
  add constraint professionals_facebook_recommend_pct_chk
  check (
    facebook_recommend_pct is null
    or (facebook_recommend_pct >= 0 and facebook_recommend_pct <= 100)
  );

alter table public.professionals
  drop constraint if exists professionals_facebook_reviews_count_chk;
alter table public.professionals
  add constraint professionals_facebook_reviews_count_chk
  check (facebook_reviews_count >= 0);

comment on column public.professionals.google_rating is
  'Google Maps star rating (0–5) for this specialist’s own listing.';
comment on column public.professionals.google_reviews_count is
  'Google Maps review count accompanying google_rating.';
comment on column public.professionals.yelp_rating is
  'Yelp star rating (0–5) for this specialist’s own listing.';
comment on column public.professionals.yelp_reviews_count is
  'Yelp review count accompanying yelp_rating.';
comment on column public.professionals.trustpilot_rating is
  'Trustpilot TrustScore (0–5) for this specialist.';
comment on column public.professionals.trustpilot_reviews_count is
  'Trustpilot review count accompanying trustpilot_rating.';
comment on column public.professionals.facebook_recommend_pct is
  'Facebook «X% recommend» (0–100) for this specialist’s page.';
comment on column public.professionals.facebook_reviews_count is
  'Facebook recommendation / review count accompanying facebook_recommend_pct.';

-- Rebuild public catalog view with own ratings (employer Google kept as fallback source).
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
  p.description_original,
  p.card_summary,
  p.image_url,
  p.status,
  p.experience_years,
  p.languages,
  p.availability_text,
  p.opening_hours,
  p.rating_avg,
  p.reviews_count,
  p.google_rating,
  p.google_reviews_count,
  p.yelp_rating,
  p.yelp_reviews_count,
  p.trustpilot_rating,
  p.trustpilot_reviews_count,
  p.facebook_recommend_pct,
  p.facebook_reviews_count,
  p.city,
  p.region,
  p.state_code,
  p.postal_code,
  nullif(btrim(p.private_address_line), '') as address_line,
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
  p.employer_name,
  p.employer_role,
  p.employer_business_id,
  eb.slug as employer_business_slug,
  eb.name as employer_business_name,
  eb.image_url as employer_business_image_url,
  eb.city as employer_business_city,
  eb.postal_code as employer_business_postal_code,
  eb.state_code as employer_business_state_code,
  nullif(btrim(eb.address_line), '') as employer_business_address_line,
  eb.google_rating as employer_business_google_rating,
  eb.google_reviews_count as employer_business_google_reviews_count,
  p.third_party_mention_count,
  p.self_ad_mention_count,
  p.booking_url,
  p.created_at,
  p.updated_at,
  p.published_at,
  p.phone is not null and length(btrim(p.phone)) > 0 as has_phone,
  p.email is not null and length(btrim(p.email)) > 0 as has_email,
  p.website is not null and length(btrim(p.website)) > 0 as has_website,
  p.instagram_url is not null and length(btrim(p.instagram_url)) > 0 as has_instagram,
  p.telegram_url is not null and length(btrim(p.telegram_url)) > 0 as has_telegram,
  p.booking_url is not null and length(btrim(p.booking_url)) > 0 as has_booking,
  case
    when upper(coalesce(p.source_type, '')) = any (array['USER', 'ADMIN']) then 'platform'
    when p.source_url is not null and length(btrim(p.source_url)) > 0
      and p.source_url ~* 'svoi\.us|orange.?pages|yellow.?pages|to4ka|echoru|zerkalo' then 'directory'
    when upper(coalesce(p.source_type, '')) = 'IMPORT'
      and p.source_url is not null and length(btrim(p.source_url)) > 0
      and p.source_url !~* 't\.me/|telegram\.me|facebook\.com|fb\.com' then 'directory'
    when upper(coalesce(p.source_type, '')) = 'TELEGRAM' then 'telegram'
    when upper(coalesce(p.source_type, '')) = 'FACEBOOK' then 'facebook'
    when p.source_url is not null and length(btrim(p.source_url)) > 0
      and p.source_url ~* 'facebook\.com|fb\.com' then 'facebook'
    when p.source_url is not null and length(btrim(p.source_url)) > 0
      and p.source_url ~* 't\.me/|telegram\.me' then 'telegram'
    else null
  end as source_kind,
  upper(coalesce(p.source_type, '')) = any (array['USER', 'ADMIN'])
    or p.source_url is not null and length(btrim(p.source_url)) > 0 as has_source,
  p.payment_methods
from public.professionals p
left join public.categories c on c.id = p.category_id
left join public.businesses eb
  on eb.id = p.employer_business_id and eb.status = 'approved'
where p.status = 'approved' and p.visibility = 'public';

comment on view public.professionals_public is
  'Public professional cards; own Google/Yelp/Trustpilot/Facebook metrics + employer Google fallback fields.';

grant select on public.professionals_public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
