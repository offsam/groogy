-- Link professionals to the same spheres (`categories`) used by businesses.
-- Target IA: one activity-domain taxonomy across catalog entities.

alter table public.professionals
  add column if not exists category_id uuid
    references public.categories(id) on delete set null;

create index if not exists professionals_category_id_idx
  on public.professionals (category_id)
  where category_id is not null;

comment on column public.professionals.category_id is
  'Primary activity sphere — same public.categories tree as businesses.';

-- CREATE OR REPLACE cannot insert columns before created_at; drop + recreate.
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
