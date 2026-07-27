-- Platform dislikes for businesses and professionals (mutual with likes in app layer).

alter table public.businesses
  add column if not exists dislikes_count integer not null default 0
    check (dislikes_count >= 0);

alter table public.professionals
  add column if not exists dislikes_count integer not null default 0
    check (dislikes_count >= 0);

comment on column public.businesses.dislikes_count is
  'Platform dislikes count (denormalized from business_dislikes).';
comment on column public.professionals.dislikes_count is
  'Platform dislikes count (denormalized from professional_dislikes).';

create table if not exists public.business_dislikes (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, business_id)
);

create index if not exists business_dislikes_business_idx
  on public.business_dislikes (business_id);

create table if not exists public.professional_dislikes (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, professional_id)
);

create index if not exists professional_dislikes_professional_idx
  on public.professional_dislikes (professional_id);

create or replace function public.business_dislikes_adjust_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    update public.businesses
    set dislikes_count = dislikes_count + 1
    where id = new.business_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.businesses
    set dislikes_count = greatest(dislikes_count - 1, 0)
    where id = old.business_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists business_dislikes_adjust_count on public.business_dislikes;
create trigger business_dislikes_adjust_count
  after insert or delete on public.business_dislikes
  for each row execute function public.business_dislikes_adjust_count();

revoke all on function public.business_dislikes_adjust_count() from public, anon, authenticated;

create or replace function public.professional_dislikes_adjust_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    update public.professionals
    set dislikes_count = dislikes_count + 1
    where id = new.professional_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.professionals
    set dislikes_count = greatest(dislikes_count - 1, 0)
    where id = old.professional_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists professional_dislikes_adjust_count on public.professional_dislikes;
create trigger professional_dislikes_adjust_count
  after insert or delete on public.professional_dislikes
  for each row execute function public.professional_dislikes_adjust_count();

revoke all on function public.professional_dislikes_adjust_count() from public, anon, authenticated;

-- Reuse existing engagement enforce triggers (approved targets only).
drop trigger if exists business_dislikes_enforce on public.business_dislikes;
create trigger business_dislikes_enforce
  before insert on public.business_dislikes
  for each row execute function public.business_engagement_enforce();

drop trigger if exists professional_dislikes_enforce on public.professional_dislikes;
create trigger professional_dislikes_enforce
  before insert on public.professional_dislikes
  for each row execute function public.professional_engagement_enforce();

alter table public.business_dislikes enable row level security;
alter table public.business_dislikes force row level security;
alter table public.professional_dislikes enable row level security;
alter table public.professional_dislikes force row level security;

revoke all on table public.business_dislikes from anon, authenticated;
grant select on table public.business_dislikes to authenticated;
grant insert (business_id) on table public.business_dislikes to authenticated;
grant delete on table public.business_dislikes to authenticated;

revoke all on table public.professional_dislikes from anon, authenticated;
grant select on table public.professional_dislikes to authenticated;
grant insert (professional_id) on table public.professional_dislikes to authenticated;
grant delete on table public.professional_dislikes to authenticated;

drop policy if exists "users read own business dislikes" on public.business_dislikes;
create policy "users read own business dislikes"
  on public.business_dislikes for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "users add own business dislikes" on public.business_dislikes;
create policy "users add own business dislikes"
  on public.business_dislikes for insert to authenticated
  with check (user_id = (select auth.uid()) or user_id is null);

drop policy if exists "users remove own business dislikes" on public.business_dislikes;
create policy "users remove own business dislikes"
  on public.business_dislikes for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users read own professional dislikes" on public.professional_dislikes;
create policy "users read own professional dislikes"
  on public.professional_dislikes for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "users add own professional dislikes" on public.professional_dislikes;
create policy "users add own professional dislikes"
  on public.professional_dislikes for insert to authenticated
  with check (user_id = (select auth.uid()) or user_id is null);

drop policy if exists "users remove own professional dislikes" on public.professional_dislikes;
create policy "users remove own professional dislikes"
  on public.professional_dislikes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Refresh public views with dislikes_count.
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
  b.likes_count,
  b.dislikes_count,
  b.followers_count,
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
  'Approved businesses without phone/email/URLs — safe for anon catalog. Includes likes/dislikes/followers counts.';

grant select on public.businesses_public to anon, authenticated;

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
  p.likes_count,
  p.dislikes_count,
  p.followers_count,
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

notify pgrst, 'reload schema';
