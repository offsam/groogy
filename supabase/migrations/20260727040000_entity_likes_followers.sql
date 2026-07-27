-- Platform likes + followers for businesses and professionals.
-- Counts are denormalized; clients cannot update count columns via grants.

-- ============ Columns ============
alter table public.businesses
  add column if not exists likes_count integer not null default 0
    check (likes_count >= 0),
  add column if not exists followers_count integer not null default 0
    check (followers_count >= 0);

alter table public.professionals
  add column if not exists likes_count integer not null default 0
    check (likes_count >= 0),
  add column if not exists followers_count integer not null default 0
    check (followers_count >= 0);

comment on column public.businesses.likes_count is
  'Platform likes count (denormalized from business_likes).';
comment on column public.businesses.followers_count is
  'Platform followers/subscribers count (denormalized from business_followers).';
comment on column public.professionals.likes_count is
  'Platform likes count (denormalized from professional_likes).';
comment on column public.professionals.followers_count is
  'Platform followers/subscribers count (denormalized from professional_followers).';

-- ============ Tables ============
create table if not exists public.business_likes (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, business_id)
);

create index if not exists business_likes_business_idx
  on public.business_likes (business_id);

create table if not exists public.business_followers (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, business_id)
);

create index if not exists business_followers_business_idx
  on public.business_followers (business_id);

create table if not exists public.professional_likes (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, professional_id)
);

create index if not exists professional_likes_professional_idx
  on public.professional_likes (professional_id);

create table if not exists public.professional_followers (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, professional_id)
);

create index if not exists professional_followers_professional_idx
  on public.professional_followers (professional_id);

-- ============ Count triggers ============
create or replace function public.business_likes_adjust_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    update public.businesses
    set likes_count = likes_count + 1
    where id = new.business_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.businesses
    set likes_count = greatest(likes_count - 1, 0)
    where id = old.business_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists business_likes_adjust_count on public.business_likes;
create trigger business_likes_adjust_count
  after insert or delete on public.business_likes
  for each row execute function public.business_likes_adjust_count();

revoke all on function public.business_likes_adjust_count() from public, anon, authenticated;

create or replace function public.business_followers_adjust_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    update public.businesses
    set followers_count = followers_count + 1
    where id = new.business_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.businesses
    set followers_count = greatest(followers_count - 1, 0)
    where id = old.business_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists business_followers_adjust_count on public.business_followers;
create trigger business_followers_adjust_count
  after insert or delete on public.business_followers
  for each row execute function public.business_followers_adjust_count();

revoke all on function public.business_followers_adjust_count() from public, anon, authenticated;

create or replace function public.professional_likes_adjust_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    update public.professionals
    set likes_count = likes_count + 1
    where id = new.professional_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.professionals
    set likes_count = greatest(likes_count - 1, 0)
    where id = old.professional_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists professional_likes_adjust_count on public.professional_likes;
create trigger professional_likes_adjust_count
  after insert or delete on public.professional_likes
  for each row execute function public.professional_likes_adjust_count();

revoke all on function public.professional_likes_adjust_count() from public, anon, authenticated;

create or replace function public.professional_followers_adjust_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    update public.professionals
    set followers_count = followers_count + 1
    where id = new.professional_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.professionals
    set followers_count = greatest(followers_count - 1, 0)
    where id = old.professional_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists professional_followers_adjust_count on public.professional_followers;
create trigger professional_followers_adjust_count
  after insert or delete on public.professional_followers
  for each row execute function public.professional_followers_adjust_count();

revoke all on function public.professional_followers_adjust_count() from public, anon, authenticated;

-- ============ Enforce: only approved targets, force auth.uid() ============
create or replace function public.business_engagement_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  st content_status;
  uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if uid is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;
    new.user_id := uid;

    select status into st from public.businesses where id = new.business_id;
    if not found then
      raise exception 'business not found' using errcode = 'P0001';
    end if;
    if st is distinct from 'approved' then
      raise exception 'business not engagable' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists business_likes_enforce on public.business_likes;
create trigger business_likes_enforce
  before insert on public.business_likes
  for each row execute function public.business_engagement_enforce();

drop trigger if exists business_followers_enforce on public.business_followers;
create trigger business_followers_enforce
  before insert on public.business_followers
  for each row execute function public.business_engagement_enforce();

revoke all on function public.business_engagement_enforce() from public, anon, authenticated;

create or replace function public.professional_engagement_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  st content_status;
  vis text;
  uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if uid is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;
    new.user_id := uid;

    select status, visibility::text into st, vis
    from public.professionals
    where id = new.professional_id;
    if not found then
      raise exception 'professional not found' using errcode = 'P0001';
    end if;
    if st is distinct from 'approved' or vis is distinct from 'public' then
      raise exception 'professional not engagable' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists professional_likes_enforce on public.professional_likes;
create trigger professional_likes_enforce
  before insert on public.professional_likes
  for each row execute function public.professional_engagement_enforce();

drop trigger if exists professional_followers_enforce on public.professional_followers;
create trigger professional_followers_enforce
  before insert on public.professional_followers
  for each row execute function public.professional_engagement_enforce();

revoke all on function public.professional_engagement_enforce() from public, anon, authenticated;

-- ============ RLS ============
alter table public.business_likes enable row level security;
alter table public.business_likes force row level security;
alter table public.business_followers enable row level security;
alter table public.business_followers force row level security;
alter table public.professional_likes enable row level security;
alter table public.professional_likes force row level security;
alter table public.professional_followers enable row level security;
alter table public.professional_followers force row level security;

revoke all on table public.business_likes from anon, authenticated;
grant select on table public.business_likes to authenticated;
grant insert (business_id) on table public.business_likes to authenticated;
grant delete on table public.business_likes to authenticated;

revoke all on table public.business_followers from anon, authenticated;
grant select on table public.business_followers to authenticated;
grant insert (business_id) on table public.business_followers to authenticated;
grant delete on table public.business_followers to authenticated;

revoke all on table public.professional_likes from anon, authenticated;
grant select on table public.professional_likes to authenticated;
grant insert (professional_id) on table public.professional_likes to authenticated;
grant delete on table public.professional_likes to authenticated;

revoke all on table public.professional_followers from anon, authenticated;
grant select on table public.professional_followers to authenticated;
grant insert (professional_id) on table public.professional_followers to authenticated;
grant delete on table public.professional_followers to authenticated;

drop policy if exists "users read own business likes" on public.business_likes;
create policy "users read own business likes"
  on public.business_likes for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "users add own business likes" on public.business_likes;
create policy "users add own business likes"
  on public.business_likes for insert to authenticated
  with check (user_id = (select auth.uid()) or user_id is null);

drop policy if exists "users remove own business likes" on public.business_likes;
create policy "users remove own business likes"
  on public.business_likes for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users read own business follows" on public.business_followers;
create policy "users read own business follows"
  on public.business_followers for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "users add own business follows" on public.business_followers;
create policy "users add own business follows"
  on public.business_followers for insert to authenticated
  with check (user_id = (select auth.uid()) or user_id is null);

drop policy if exists "users remove own business follows" on public.business_followers;
create policy "users remove own business follows"
  on public.business_followers for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users read own professional likes" on public.professional_likes;
create policy "users read own professional likes"
  on public.professional_likes for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "users add own professional likes" on public.professional_likes;
create policy "users add own professional likes"
  on public.professional_likes for insert to authenticated
  with check (user_id = (select auth.uid()) or user_id is null);

drop policy if exists "users remove own professional likes" on public.professional_likes;
create policy "users remove own professional likes"
  on public.professional_likes for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users read own professional follows" on public.professional_followers;
create policy "users read own professional follows"
  on public.professional_followers for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "users add own professional follows" on public.professional_followers;
create policy "users add own professional follows"
  on public.professional_followers for insert to authenticated
  with check (user_id = (select auth.uid()) or user_id is null);

drop policy if exists "users remove own professional follows" on public.professional_followers;
create policy "users remove own professional follows"
  on public.professional_followers for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============ Public views include counts ============
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
  'Approved businesses without phone/email/URLs — safe for anon catalog. Includes likes/followers counts.';

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
