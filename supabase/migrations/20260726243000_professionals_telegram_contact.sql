-- Professionals: telegram contact + public has_telegram; contacts RPC returns telegram.

alter table public.professionals
  add column if not exists telegram_url text;

comment on column public.professionals.telegram_url is
  'Telegram profile link (https://t.me/…) or @username — gated like other contacts.';

drop function if exists public.get_professional_contacts(text);

create or replace function public.get_professional_contacts(p_slug text)
returns table (
  phone text,
  email text,
  website text,
  instagram_url text,
  telegram_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;
  return query
  select
    p.phone,
    p.email,
    p.website,
    p.instagram_url,
    p.telegram_url
  from public.professionals p
  where p.slug = p_slug
    and p.status = 'approved'
    and p.visibility = 'public'
  limit 1;
end;
$$;

revoke all on function public.get_professional_contacts(text) from public;
grant execute on function public.get_professional_contacts(text) to authenticated;

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

notify pgrst, 'reload schema';
