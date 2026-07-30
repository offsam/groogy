-- Workplace affiliation: professional may work at a company they do not own.
-- Free-text name covers employers not in the catalog; optional FK links to /business/[slug].

alter table public.professionals
  add column if not exists employer_name text,
  add column if not exists employer_role text,
  add column if not exists employer_business_id uuid
    references public.businesses(id) on delete set null;

create index if not exists professionals_employer_business_idx
  on public.professionals (employer_business_id)
  where employer_business_id is not null;

comment on column public.professionals.employer_name is
  'Company the professional works at (display). May differ from a linked businesses row.';
comment on column public.professionals.employer_role is
  'Role / title at the employer (e.g. маркетолог), not ownership.';
comment on column public.professionals.employer_business_id is
  'Optional link to a catalog business the professional works for (not necessarily owns).';

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
left join public.businesses eb
  on eb.id = p.employer_business_id
 and eb.status = 'approved'
where p.status = 'approved'
  and p.visibility = 'public';

grant select on public.professionals_public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
