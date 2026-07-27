-- Professionals: public city + ZIP for listing cards (street stays private).

alter table public.professionals
  add column if not exists postal_code text;

comment on column public.professionals.postal_code is
  'US ZIP (5 digits). Safe for public listing cards with city; street stays in private_address_line.';

-- Move bare ZIP dumped into region historically.
update public.professionals
set
  postal_code = coalesce(postal_code, substring(region from '(\d{5})')),
  region = nullif(btrim(regexp_replace(region, '\y\d{5}(?:-\d{4})?\y', '', 'g')), '')
where region ~ '\y\d{5}(?:-\d{4})?\y'
  and (postal_code is null or postal_code = '');

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
  p.postal_code,
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
  (p.telegram_url is not null and length(btrim(p.telegram_url)) > 0) as has_telegram,
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

-- New sphere for recurring IT / websites / automation specialists.
insert into public.categories (
  id, slug, name, name_en, icon, sort_order, is_active, domain
) values (
  'b1000001-0000-4000-8000-000000000009',
  'digital',
  'IT и сайты',
  'IT & websites',
  'digital',
  275,
  true,
  'professional'
)
on conflict (slug) do update set
  name = excluded.name,
  name_en = excluded.name_en,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  is_active = true,
  domain = 'professional';

notify pgrst, 'reload schema';
