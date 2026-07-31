-- Queue + public reads for description_original (EN behind «Показать оригинал»).

alter table public.import_review_items
  add column if not exists description_original text;

alter table public.import_review_items
  add column if not exists source_language text;

comment on column public.import_review_items.description_original is
  'Source-language description before EN→RU; admin/public toggle: Показать оригинал.';
comment on column public.import_review_items.source_language is
  'Detected source language of description (en|ru|mixed|unknown).';

grant select (description_original) on public.businesses to anon, authenticated;
grant select (description_original) on public.professionals to anon, authenticated;
grant select (description_original) on public.jobs to anon, authenticated;
grant select (description_original) on public.listings to anon, authenticated;
grant select (description_original, source_language)
  on public.import_review_items to authenticated;

-- Recreate professionals_public with description_original (last full def + column).
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
  'Public professional cards; includes description_original for «Показать оригинал».';

grant select on public.professionals_public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
