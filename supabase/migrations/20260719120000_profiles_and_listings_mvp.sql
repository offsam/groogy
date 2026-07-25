-- Migration: profiles_and_listings_mvp
-- Profiles privacy + universal listings + Marketplace MVP.
-- НЕ применять без отдельного подтверждения.
-- Depends on: reviews migrations already applied.

-- ============ ENUMS ============
create type profile_visibility as enum ('public', 'private');
create type author_visibility as enum ('public', 'initials', 'anonymous');

create type listing_type as enum (
  'marketplace_item',
  'service',
  'job',
  'resume',
  'vehicle'
);

create type listing_status as enum (
  'draft',
  'active',
  'reserved',
  'completed',
  'expired',
  'archived',
  'removed',
  'rejected'
);

create type listing_visibility as enum ('public', 'unlisted', 'private');

create type listing_condition as enum (
  'new',
  'like_new',
  'good',
  'fair',
  'poor'
);

create type listing_transaction_type as enum (
  'sell',
  'free',
  'exchange',
  'wanted'
);

create type listing_report_reason as enum (
  'spam',
  'fraud',
  'prohibited_item',
  'wrong_category',
  'duplicate',
  'offensive',
  'other'
);

create type listing_report_status as enum (
  'pending',
  'reviewed',
  'dismissed',
  'action_taken'
);

create type listing_contact_preference as enum (
  'platform_message',
  'phone',
  'email',
  'any'
);

-- ============ PRIVATE TRUSTED WRITE (listings) ============
create table if not exists private.listing_trusted_tx (
  txid bigint primary key,
  created_at timestamptz not null default now()
);

revoke all on table private.listing_trusted_tx from public, anon, authenticated;

create or replace function private.enable_trusted_listing_write()
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  delete from private.listing_trusted_tx where created_at < now() - interval '1 day';
  insert into private.listing_trusted_tx (txid)
  values (txid_current())
  on conflict (txid) do nothing;
end;
$$;

create or replace function private.disable_trusted_listing_write()
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  delete from private.listing_trusted_tx where txid = txid_current();
end;
$$;

create or replace function private.has_trusted_listing_write()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select exists (
    select 1 from private.listing_trusted_tx t where t.txid = txid_current()
  );
$$;

revoke all on function private.enable_trusted_listing_write() from public, anon, authenticated;
revoke all on function private.disable_trusted_listing_write() from public, anon, authenticated;
revoke all on function private.has_trusted_listing_write() from public, anon, authenticated;

-- ============ PROFILES EXTENSION ============
alter table public.profiles
  add column if not exists username text,
  add column if not exists bio text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists profile_visibility profile_visibility not null default 'public',
  add column if not exists default_author_visibility author_visibility not null default 'public',
  add column if not exists public_activity_enabled boolean not null default true,
  add column if not exists show_reviews_in_profile boolean not null default true,
  add column if not exists show_listings_in_profile boolean not null default true;

alter table public.profiles
  drop constraint if exists profiles_username_format_chk;
alter table public.profiles
  add constraint profiles_username_format_chk check (
    username is null
    or (
      username = lower(username)
      and username ~ '^[a-z0-9_]{3,30}$'
    )
  );

alter table public.profiles
  drop constraint if exists profiles_display_name_len_chk;
alter table public.profiles
  add constraint profiles_display_name_len_chk check (
    display_name is null
    or char_length(btrim(display_name)) between 1 and 80
  );

alter table public.profiles
  drop constraint if exists profiles_bio_len_chk;
alter table public.profiles
  add constraint profiles_bio_len_chk check (
    bio is null or char_length(bio) <= 1000
  );

alter table public.profiles
  drop constraint if exists profiles_city_len_chk;
alter table public.profiles
  add constraint profiles_city_len_chk check (
    city is null or char_length(btrim(city)) between 1 and 80
  );

alter table public.profiles
  drop constraint if exists profiles_state_len_chk;
alter table public.profiles
  add constraint profiles_state_len_chk check (
    state is null or char_length(btrim(state)) between 1 and 40
  );

create unique index if not exists profiles_username_unique_idx
  on public.profiles (username)
  where username is not null;

create or replace function public.profiles_normalize_username(p_username text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  u text;
begin
  if p_username is null then
    return null;
  end if;
  u := lower(btrim(p_username));
  if u = '' then
    return null;
  end if;
  if u in (
    'admin', 'profile', 'marketplace', 'business', 'auth', 'api',
    'login', 'signup', 'settings', 'support', 'root', 'system',
    'moderator', 'register', 'u', 'search', 'null', 'undefined'
  ) then
    raise exception 'reserved username' using errcode = 'P0001';
  end if;
  return u;
end;
$$;

revoke all on function public.profiles_normalize_username(text) from public, anon, authenticated;

create or replace function public.profiles_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.username := public.profiles_normalize_username(new.username);
    if new.display_name is not null then
      new.display_name := nullif(btrim(new.display_name), '');
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.role := old.role;
    new.created_at := old.created_at;

    new.username := public.profiles_normalize_username(new.username);

    if new.display_name is not null then
      new.display_name := btrim(new.display_name);
      if new.display_name = '' then
        new.display_name := null;
      end if;
    end if;

    if new.bio is not null then
      new.bio := btrim(new.bio);
      if new.bio = '' then
        new.bio := null;
      end if;
    end if;

    if new.city is not null then
      new.city := btrim(new.city);
      if new.city = '' then
        new.city := null;
      end if;
    end if;

    if new.state is not null then
      new.state := btrim(new.state);
      if new.state = '' then
        new.state := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_row on public.profiles;
create trigger profiles_enforce_row
  before insert or update on public.profiles
  for each row execute function public.profiles_enforce_row();

revoke all on function public.profiles_enforce_row() from public, anon, authenticated;

-- Expand profile update grants (role still locked)
revoke update on public.profiles from anon, authenticated;
grant update (
  display_name,
  username,
  avatar_url,
  bio,
  city,
  state,
  profile_visibility,
  default_author_visibility,
  public_activity_enabled,
  show_reviews_in_profile,
  show_listings_in_profile
) on public.profiles to authenticated;

-- Admin can read all profiles
drop policy if exists "admins can read all profiles" on public.profiles;
create policy "admins can read all profiles"
  on public.profiles for select to authenticated
  using (public.is_admin());

-- ============ AUTHOR DISPLAY HELPERS ============
create or replace function public.stable_user_number(p_user_id uuid)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  select (abs(('x' || substr(md5(p_user_id::text), 1, 8))::bit(32)::int) % 90000) + 10000;
$$;

create or replace function public.author_initials(p_display_name text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  parts text[];
  first_name text;
  last_initial text;
begin
  if p_display_name is null or btrim(p_display_name) = '' then
    return 'Пользователь';
  end if;
  parts := regexp_split_to_array(btrim(p_display_name), '\s+');
  first_name := parts[1];
  if array_length(parts, 1) >= 2 then
    last_initial := upper(substr(parts[array_length(parts, 1)], 1, 1));
    return first_name || ' ' || last_initial || '.';
  end if;
  return first_name;
end;
$$;

create or replace function public.resolve_author_display(
  p_user_id uuid,
  p_author_visibility author_visibility default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  p public.profiles%rowtype;
  vis author_visibility;
  label text;
  avatar text;
  username text;
  profile_public boolean;
begin
  select * into p from public.profiles where id = p_user_id;
  if not found then
    return jsonb_build_object(
      'mode', 'anonymous',
      'label', 'Пользователь #' || public.stable_user_number(p_user_id)::text,
      'avatar_url', null,
      'username', null,
      'profile_path', null
    );
  end if;

  profile_public := (p.profile_visibility = 'public');
  -- Private profiles never leak real identity to strangers via this RPC,
  -- even if caller passes author_visibility = public.
  if not profile_public and (select auth.uid()) is distinct from p.id then
    vis := 'anonymous';
  else
    vis := coalesce(p_author_visibility, p.default_author_visibility, 'public');
  end if;

  if vis = 'anonymous' then
    label := 'Пользователь #' || public.stable_user_number(p_user_id)::text;
    avatar := null;
    username := null;
  elsif vis = 'initials' then
    label := public.author_initials(p.display_name);
    avatar := null;
    username := case when profile_public then p.username else null end;
  else
    label := coalesce(nullif(btrim(p.display_name), ''), 'Пользователь');
    avatar := case when profile_public then p.avatar_url else null end;
    username := case when profile_public then p.username else null end;
  end if;

  return jsonb_build_object(
    'mode', vis,
    'label', label,
    'avatar_url', avatar,
    'username', username,
    'profile_path', case
      when profile_public and username is not null then '/u/' || username
      else null
    end
  );
end;
$$;

revoke all on function public.stable_user_number(uuid) from public, anon, authenticated;
revoke all on function public.author_initials(text) from public, anon, authenticated;
revoke all on function public.resolve_author_display(uuid, author_visibility) from public;
grant execute on function public.resolve_author_display(uuid, author_visibility) to anon, authenticated;

-- Public profile card (sanitized)
create or replace function public.get_public_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  p public.profiles%rowtype;
  uid uuid := (select auth.uid());
  is_self boolean;
  reviews_published int;
  reviews_ai int;
  listings_active int;
  listings_completed int;
  uname text := lower(btrim(coalesce(p_username, '')));
begin
  if uname = '' then
    return null;
  end if;

  select * into p from public.profiles where username = uname;
  if not found then
    return null;
  end if;

  is_self := (uid is not null and uid = p.id);

  select
    count(*) filter (where r.moderation_status = 'published'),
    count(*) filter (
      where r.moderation_status = 'published'
        and r.verification_level in ('ai_verified', 'transaction_verified')
    )
  into reviews_published, reviews_ai
  from public.reviews r
  where r.user_id = p.id;

  select
    count(*) filter (where l.status = 'active' and l.visibility = 'public'),
    count(*) filter (where l.status = 'completed')
  into listings_active, listings_completed
  from public.listings l
  where l.owner_id = p.id;

  if p.profile_visibility = 'private' and not is_self then
    return jsonb_build_object(
      'mode', 'private',
      'is_self', false,
      'label', 'Пользователь #' || public.stable_user_number(p.id)::text,
      'username', null,
      'display_name', null,
      'avatar_url', null,
      'bio', null,
      'city', null,
      'state', null,
      'member_since', p.created_at,
      'reviews_published_count', coalesce(reviews_published, 0),
      'reviews_ai_verified_count', coalesce(reviews_ai, 0),
      'listings_active_count', coalesce(listings_active, 0),
      'listings_completed_count', coalesce(listings_completed, 0),
      'show_reviews', false,
      'show_listings', false
    );
  end if;

  return jsonb_build_object(
    'mode', case when p.profile_visibility = 'public' then 'public' else 'private_preview' end,
    'is_self', is_self,
    -- Never expose UUID to strangers; self preview may include owner_id.
    'owner_id', case when is_self then p.id else null end,
    'label', coalesce(nullif(btrim(p.display_name), ''), p.username, 'Пользователь'),
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'city', p.city,
    'state', p.state,
    'member_since', p.created_at,
    'profile_visibility', p.profile_visibility,
    'reviews_published_count', coalesce(reviews_published, 0),
    'reviews_ai_verified_count', coalesce(reviews_ai, 0),
    'listings_active_count', coalesce(listings_active, 0),
    'listings_completed_count', coalesce(listings_completed, 0),
    'show_reviews', p.show_reviews_in_profile and p.public_activity_enabled and p.profile_visibility = 'public',
    'show_listings', p.show_listings_in_profile and p.public_activity_enabled and p.profile_visibility = 'public'
  );
end;
$$;

revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon, authenticated;

-- ============ LISTING CATEGORIES ============
create table public.listing_categories (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name_ru      text not null,
  name_en      text,
  parent_id    uuid references public.listing_categories(id) on delete set null,
  listing_type listing_type not null default 'marketplace_item',
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index listing_categories_type_active_idx
  on public.listing_categories (listing_type, is_active, sort_order);

create trigger listing_categories_set_updated_at
  before update on public.listing_categories
  for each row execute function public.set_updated_at();

-- ============ LISTINGS ============
create table public.listings (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles(id) on delete cascade,
  listing_type        listing_type not null default 'marketplace_item',
  status              listing_status not null default 'draft',
  visibility          listing_visibility not null default 'public',
  author_visibility   author_visibility not null default 'public',
  title               text not null,
  description         text not null,
  price_amount        numeric(12,2),
  price_currency      text not null default 'USD',
  is_negotiable       boolean not null default false,
  city                text,
  state               text,
  latitude            double precision,
  longitude           double precision,
  contact_preference  listing_contact_preference not null default 'platform_message',
  published_at        timestamptz,
  reserved_at         timestamptz,
  completed_at        timestamptz,
  expires_at          timestamptz,
  moderation_reason   text,
  favorites_count     integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint listings_title_len_chk check (
    char_length(btrim(title)) between 3 and 120
  ),
  constraint listings_description_len_chk check (
    char_length(btrim(description)) between 10 and 8000
  ),
  constraint listings_price_chk check (
    price_amount is null or price_amount >= 0
  ),
  constraint listings_currency_chk check (price_currency = 'USD'),
  constraint listings_city_len_chk check (
    city is null or char_length(btrim(city)) between 1 and 80
  ),
  constraint listings_state_len_chk check (
    state is null or char_length(btrim(state)) between 1 and 40
  ),
  constraint listings_moderation_reason_len_chk check (
    moderation_reason is null or char_length(moderation_reason) <= 1000
  )
);

create index listings_owner_idx on public.listings (owner_id);
create index listings_status_visibility_idx on public.listings (status, visibility, published_at desc);
create index listings_type_status_idx on public.listings (listing_type, status);
create index listings_city_idx on public.listings (city);

create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

-- ============ MARKETPLACE DETAILS ============
create table public.marketplace_listing_details (
  listing_id         uuid primary key references public.listings(id) on delete cascade,
  category_id        uuid references public.listing_categories(id) on delete set null,
  condition          listing_condition,
  transaction_type   listing_transaction_type not null default 'sell',
  delivery_available boolean not null default false,
  pickup_available   boolean not null default true,
  quantity           integer,
  constraint marketplace_quantity_chk check (quantity is null or quantity >= 1)
);

create index marketplace_details_category_idx
  on public.marketplace_listing_details (category_id);

-- ============ MEDIA ============
create table public.listing_media (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  storage_path text not null,
  media_type   text not null default 'image',
  sort_order   integer not null default 0,
  width        integer,
  height       integer,
  created_at   timestamptz not null default now(),
  constraint listing_media_type_chk check (media_type in ('image')),
  constraint listing_media_sort_unique unique (listing_id, sort_order),
  constraint listing_media_path_chk check (
    char_length(storage_path) between 3 and 500
    and storage_path not like '%..%'
  )
);

create index listing_media_listing_idx on public.listing_media (listing_id, sort_order);

-- ============ FAVORITES ============
create table public.listing_favorites (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index listing_favorites_listing_idx on public.listing_favorites (listing_id);

-- ============ REPORTS ============
create table public.listing_reports (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  reason       listing_report_reason not null,
  details      text,
  status       listing_report_status not null default 'pending',
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint listing_reports_details_len_chk check (
    details is null or char_length(details) <= 1000
  )
);

create unique index listing_reports_one_pending_idx
  on public.listing_reports (listing_id, reporter_id)
  where status = 'pending';

create index listing_reports_status_idx on public.listing_reports (status, created_at desc);

-- Abuse events for listing reports rate limit
alter table public.review_abuse_events
  drop constraint if exists review_abuse_events_kind_check;

alter table public.review_abuse_events
  add constraint review_abuse_events_kind_check
  check (kind in ('review_write', 'review_report', 'listing_report'));

-- ============ LISTINGS ENFORCE + STATE MACHINE ============
create or replace function public.listings_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  trusted boolean := private.has_trusted_listing_write();
  uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if uid is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;
    new.owner_id := uid;
    new.favorites_count := 0;
    new.moderation_reason := null;
    new.published_at := null;
    new.reserved_at := null;
    new.completed_at := null;
    if not trusted then
      new.status := 'draft';
    end if;
    new.title := btrim(new.title);
    new.description := btrim(new.description);
    if new.city is not null then new.city := btrim(new.city); end if;
    if new.state is not null then new.state := btrim(new.state); end if;
    return new;
  end if;

  -- UPDATE
  new.owner_id := old.owner_id;
  new.listing_type := old.listing_type;
  new.created_at := old.created_at;
  new.favorites_count := old.favorites_count;
  new.title := btrim(new.title);
  new.description := btrim(new.description);
  if new.city is not null then new.city := btrim(new.city); end if;
  if new.state is not null then new.state := btrim(new.state); end if;

  if not trusted then
    -- Lock admin/system fields
    new.moderation_reason := old.moderation_reason;
    new.published_at := old.published_at;
    new.reserved_at := old.reserved_at;
    new.completed_at := old.completed_at;
    new.expires_at := old.expires_at;

    -- Block admin statuses for users
    if new.status in ('removed', 'rejected', 'expired') then
      raise exception 'status transition not allowed' using errcode = 'P0001';
    end if;
    if old.status in ('removed', 'rejected') then
      raise exception 'cannot modify moderated listing' using errcode = 'P0001';
    end if;

    -- Allowed user transitions
    if new.status is distinct from old.status then
      if not (
        (old.status = 'draft' and new.status in ('active', 'archived'))
        or (old.status = 'active' and new.status in ('reserved', 'completed', 'archived'))
        or (old.status = 'reserved' and new.status in ('active', 'completed', 'archived'))
        or (old.status = 'completed' and new.status = 'archived')
        or (old.status = 'archived' and new.status = 'draft')
      ) then
        raise exception 'invalid status transition from % to %', old.status, new.status
          using errcode = 'P0001';
      end if;

      if new.status = 'active' and old.status = 'draft' then
        new.published_at := coalesce(old.published_at, now());
      end if;
      if new.status = 'reserved' then
        new.reserved_at := now();
      end if;
      if new.status = 'completed' then
        new.completed_at := now();
      end if;
      if new.status = 'active' and old.status = 'reserved' then
        new.reserved_at := null;
      end if;
    end if;
  else
    -- Trusted/admin path: set timestamps consistently
    if new.status = 'active' and old.status is distinct from 'active' then
      new.published_at := coalesce(new.published_at, old.published_at, now());
    end if;
    if new.status = 'reserved' and old.status is distinct from 'reserved' then
      new.reserved_at := coalesce(new.reserved_at, now());
    end if;
    if new.status = 'completed' and old.status is distinct from 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  end if;

  return new;
end;
$$;

create trigger listings_enforce_row
  before insert or update on public.listings
  for each row execute function public.listings_enforce_row();

revoke all on function public.listings_enforce_row() from public, anon, authenticated;

-- Publish requirements for marketplace
create or replace function public.listings_validate_publish()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  d public.marketplace_listing_details%rowtype;
begin
  if tg_op = 'UPDATE'
     and new.status = 'active'
     and old.status is distinct from 'active'
     and new.listing_type = 'marketplace_item' then
    if new.city is null or new.state is null then
      raise exception 'city and state required to publish' using errcode = 'P0001';
    end if;
    select * into d from public.marketplace_listing_details where listing_id = new.id;
    if not found then
      raise exception 'marketplace details required' using errcode = 'P0001';
    end if;
    if d.category_id is null then
      raise exception 'category required to publish' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.listing_categories c
      where c.id = d.category_id
        and c.is_active = true
        and c.listing_type = 'marketplace_item'
    ) then
      raise exception 'inactive or invalid category' using errcode = 'P0001';
    end if;
    if d.transaction_type = 'sell' and (new.price_amount is null or new.price_amount < 0) then
      raise exception 'price required for sell listings' using errcode = 'P0001';
    end if;
    if d.transaction_type = 'free' then
      new.price_amount := 0;
    end if;
  end if;
  return new;
end;
$$;

create trigger listings_validate_publish
  before update on public.listings
  for each row execute function public.listings_validate_publish();

revoke all on function public.listings_validate_publish() from public, anon, authenticated;

-- Media max 10 + ownership on insert via trigger
create or replace function public.listing_media_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  n int;
  owner uuid;
  lst_status listing_status;
  uid uuid := (select auth.uid());
  expected_prefix text;
begin
  if tg_op = 'DELETE' then
    select owner_id into owner from public.listings where id = old.listing_id;
    if not public.is_admin() and (uid is null or owner is distinct from uid) then
      raise exception 'not listing owner' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    new.listing_id := old.listing_id;
  end if;

  select owner_id, status into owner, lst_status
  from public.listings where id = new.listing_id;
  if owner is null then
    raise exception 'listing not found' using errcode = 'P0001';
  end if;
  if not public.is_admin() and (uid is null or owner is distinct from uid)
     and not private.has_trusted_listing_write() then
    raise exception 'not listing owner' using errcode = '42501';
  end if;
  if not public.is_admin() and lst_status in ('removed', 'rejected') then
    raise exception 'cannot modify media on moderated listing' using errcode = 'P0001';
  end if;

  -- Strict path: listings/{owner_id}/{listing_id}/{filename}
  expected_prefix := 'listings/' || owner::text || '/' || new.listing_id::text || '/';
  if new.storage_path is null
     or position('..' in new.storage_path) > 0
     or new.storage_path not like (expected_prefix || '%')
     or char_length(new.storage_path) <= char_length(expected_prefix)
  then
    raise exception 'invalid storage path' using errcode = 'P0001';
  end if;

  select count(*) into n from public.listing_media where listing_id = new.listing_id;
  if tg_op = 'INSERT' and n >= 10 then
    raise exception 'maximum 10 images per listing' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger listing_media_enforce
  before insert or update or delete on public.listing_media
  for each row execute function public.listing_media_enforce();

revoke all on function public.listing_media_enforce() from public, anon, authenticated;

-- Marketplace details ownership
create or replace function public.marketplace_details_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  owner uuid;
  ltype listing_type;
  uid uuid := (select auth.uid());
begin
  select owner_id, listing_type into owner, ltype
  from public.listings where id = new.listing_id;
  if owner is null then
    raise exception 'listing not found' using errcode = 'P0001';
  end if;
  if ltype is distinct from 'marketplace_item' then
    raise exception 'not a marketplace listing' using errcode = 'P0001';
  end if;
  if not public.is_admin() and (uid is null or owner is distinct from uid) then
    raise exception 'not listing owner' using errcode = '42501';
  end if;
  if new.transaction_type = 'wanted' and new.condition is null then
    null; -- allowed
  end if;
  return new;
end;
$$;

create trigger marketplace_details_enforce
  before insert or update on public.marketplace_listing_details
  for each row execute function public.marketplace_details_enforce();

revoke all on function public.marketplace_details_enforce() from public, anon, authenticated;

-- Favorites count trigger
create or replace function public.listing_favorites_adjust_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.enable_trusted_listing_write();
  if tg_op = 'INSERT' then
    update public.listings
    set favorites_count = favorites_count + 1
    where id = new.listing_id;
    perform private.disable_trusted_listing_write();
    return new;
  elsif tg_op = 'DELETE' then
    update public.listings
    set favorites_count = greatest(favorites_count - 1, 0)
    where id = old.listing_id;
    perform private.disable_trusted_listing_write();
    return old;
  end if;
  perform private.disable_trusted_listing_write();
  return null;
exception
  when others then
    perform private.disable_trusted_listing_write();
    raise;
end;
$$;

create trigger listing_favorites_adjust_count
  after insert or delete on public.listing_favorites
  for each row execute function public.listing_favorites_adjust_count();

revoke all on function public.listing_favorites_adjust_count() from public, anon, authenticated;

-- Reports enforce
create or replace function public.listing_reports_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  owner uuid;
  n int;
  uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if uid is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;
    new.reporter_id := uid;
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;

    select owner_id into owner from public.listings where id = new.listing_id;
    if owner is null then
      raise exception 'listing not found' using errcode = 'P0001';
    end if;
    if owner = uid then
      raise exception 'cannot report own listing' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.listings l
      where l.id = new.listing_id
        and (
          (l.status = 'active' and l.visibility in ('public', 'unlisted'))
          or (l.status = 'completed' and l.visibility = 'public')
        )
    ) then
      raise exception 'listing not reportable' using errcode = 'P0001';
    end if;

    select count(*) into n
    from public.review_abuse_events e
    where e.user_id = uid
      and e.kind = 'listing_report'
      and e.created_at > now() - interval '24 hours';
    if n >= 10 then
      raise exception 'listing report rate limit exceeded' using errcode = 'P0001';
    end if;

    return new;
  end if;

  -- UPDATE: only admin via trusted path / is_admin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  new.listing_id := old.listing_id;
  new.reporter_id := old.reporter_id;
  new.reason := old.reason;
  return new;
end;
$$;

create trigger listing_reports_enforce
  before insert or update on public.listing_reports
  for each row execute function public.listing_reports_enforce();

create or replace function public.listing_reports_log_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.review_abuse_events (user_id, kind)
  values (new.reporter_id, 'listing_report');
  return new;
end;
$$;

create trigger listing_reports_log_event
  after insert on public.listing_reports
  for each row execute function public.listing_reports_log_event();

revoke all on function public.listing_reports_enforce() from public, anon, authenticated;
revoke all on function public.listing_reports_log_event() from public, anon, authenticated;

-- Admin listing moderation RPC
create table if not exists public.listing_admin_audit (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null,
  admin_id     uuid not null references public.profiles(id) on delete restrict,
  action       text not null,
  from_status  listing_status,
  to_status    listing_status,
  reason       text,
  created_at   timestamptz not null default now()
);

alter table public.listing_admin_audit enable row level security;
alter table public.listing_admin_audit force row level security;
revoke all on table public.listing_admin_audit from anon, authenticated;
grant select on public.listing_admin_audit to authenticated;

create policy "admins read listing audit"
  on public.listing_admin_audit for select to authenticated
  using (public.is_admin());

create or replace function public.admin_set_listing_status(
  p_listing_id uuid,
  p_status listing_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  old_status listing_status;
  uid uuid := (select auth.uid());
begin
  if uid is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_status not in ('active', 'removed', 'rejected', 'archived') then
    raise exception 'unsupported admin status' using errcode = 'P0001';
  end if;

  select status into old_status from public.listings where id = p_listing_id;
  if not found then
    raise exception 'listing not found' using errcode = 'P0001';
  end if;

  -- Restore only from moderated states into active
  if p_status = 'active' and old_status not in ('removed', 'rejected', 'archived', 'active') then
    raise exception 'invalid admin restore transition' using errcode = 'P0001';
  end if;

  perform private.enable_trusted_listing_write();
  update public.listings
  set
    status = p_status,
    moderation_reason = case
      when p_status in ('removed', 'rejected') then nullif(btrim(coalesce(p_reason, '')), '')
      when p_status = 'active' then null
      else moderation_reason
    end,
    updated_at = now()
  where id = p_listing_id;
  perform private.disable_trusted_listing_write();

  insert into public.listing_admin_audit (listing_id, admin_id, action, from_status, to_status, reason)
  values (p_listing_id, uid, 'set_status', old_status, p_status, nullif(btrim(coalesce(p_reason, '')), ''));
exception
  when others then
    perform private.disable_trusted_listing_write();
    raise;
end;
$$;

create or replace function public.admin_set_listing_report_status(
  p_report_id uuid,
  p_status listing_report_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_status not in ('reviewed', 'dismissed', 'action_taken') then
    raise exception 'unsupported report status' using errcode = 'P0001';
  end if;
  update public.listing_reports
  set
    status = p_status,
    reviewed_by = (select auth.uid()),
    reviewed_at = now()
  where id = p_report_id;
  if not found then
    raise exception 'report not found' using errcode = 'P0001';
  end if;

  insert into public.listing_admin_audit (listing_id, admin_id, action, reason)
  select listing_id, (select auth.uid()), 'report_' || p_status::text, null
  from public.listing_reports where id = p_report_id;
end;
$$;

revoke all on function public.admin_set_listing_status(uuid, listing_status, text) from public, anon;
revoke all on function public.admin_set_listing_report_status(uuid, listing_report_status) from public, anon;
grant execute on function public.admin_set_listing_status(uuid, listing_status, text) to authenticated;
grant execute on function public.admin_set_listing_report_status(uuid, listing_report_status) to authenticated;

-- ============ RLS ============
alter table public.listing_categories enable row level security;
alter table public.listing_categories force row level security;
alter table public.listings enable row level security;
alter table public.listings force row level security;
alter table public.marketplace_listing_details enable row level security;
alter table public.marketplace_listing_details force row level security;
alter table public.listing_media enable row level security;
alter table public.listing_media force row level security;
alter table public.listing_favorites enable row level security;
alter table public.listing_favorites force row level security;
alter table public.listing_reports enable row level security;
alter table public.listing_reports force row level security;

-- Categories: public read active; no client writes
revoke all on table public.listing_categories from anon, authenticated;
grant select on public.listing_categories to anon, authenticated;

create policy "active listing categories are public"
  on public.listing_categories for select to anon, authenticated
  using (is_active = true);

create policy "admins read all listing categories"
  on public.listing_categories for select to authenticated
  using (public.is_admin());

-- Listings grants
revoke all on table public.listings from anon, authenticated;
grant select on public.listings to anon, authenticated;
grant insert (
  listing_type, status, visibility, author_visibility,
  title, description, price_amount, price_currency, is_negotiable,
  city, state, latitude, longitude, contact_preference
) on public.listings to authenticated;
grant update (
  status, visibility, author_visibility,
  title, description, price_amount, price_currency, is_negotiable,
  city, state, latitude, longitude, contact_preference
) on public.listings to authenticated;
grant delete on public.listings to authenticated;

create policy "public listings readable"
  on public.listings for select to anon, authenticated
  using (
    (status = 'active' and visibility in ('public', 'unlisted'))
    or (status = 'completed' and visibility = 'public')
  );

create policy "owners read own listings"
  on public.listings for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "admins read all listings"
  on public.listings for select to authenticated
  using (public.is_admin());

create policy "users create own listings"
  on public.listings for insert to authenticated
  with check (owner_id = (select auth.uid()) or owner_id is null);

create policy "owners update own listings"
  on public.listings for update to authenticated
  using (owner_id = (select auth.uid()) and status not in ('removed', 'rejected'))
  with check (owner_id = (select auth.uid()));

create policy "owners delete own draft listings"
  on public.listings for delete to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft');

create policy "admins update listings"
  on public.listings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Marketplace details
revoke all on table public.marketplace_listing_details from anon, authenticated;
grant select on public.marketplace_listing_details to anon, authenticated;
grant insert, update on public.marketplace_listing_details to authenticated;

create policy "marketplace details readable with listing"
  on public.marketplace_listing_details for select to anon, authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (
          (l.status = 'active' and l.visibility in ('public', 'unlisted'))
          or (l.status = 'completed' and l.visibility = 'public')
          or l.owner_id = (select auth.uid())
          or public.is_admin()
        )
    )
  );

create policy "owners write marketplace details"
  on public.marketplace_listing_details for insert to authenticated
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

create policy "owners update marketplace details"
  on public.marketplace_listing_details for update to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

-- Media
revoke all on table public.listing_media from anon, authenticated;
grant select on public.listing_media to anon, authenticated;
grant insert (listing_id, storage_path, media_type, sort_order, width, height)
  on public.listing_media to authenticated;
grant update (storage_path, media_type, sort_order, width, height)
  on public.listing_media to authenticated;
grant delete on public.listing_media to authenticated;

create policy "listing media readable with listing"
  on public.listing_media for select to anon, authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (
          (l.status = 'active' and l.visibility in ('public', 'unlisted'))
          or (l.status = 'completed' and l.visibility = 'public')
          or l.owner_id = (select auth.uid())
          or public.is_admin()
        )
    )
  );

create policy "owners insert listing media"
  on public.listing_media for insert to authenticated
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

create policy "owners update listing media"
  on public.listing_media for update to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

create policy "owners delete listing media"
  on public.listing_media for delete to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

create policy "admins manage listing media"
  on public.listing_media for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Favorites
revoke all on table public.listing_favorites from anon, authenticated;
grant select on public.listing_favorites to authenticated;
grant insert (listing_id) on public.listing_favorites to authenticated;
grant delete on public.listing_favorites to authenticated;

create or replace function public.listing_favorites_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  st listing_status;
  vis listing_visibility;
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;
    new.user_id := (select auth.uid());

    select status, visibility into st, vis
    from public.listings where id = new.listing_id;
    if not found then
      raise exception 'listing not found' using errcode = 'P0001';
    end if;
    -- Only favoritable marketplace-visible listings
    if not (
      (st = 'active' and vis in ('public', 'unlisted'))
      or (st = 'completed' and vis = 'public')
    ) then
      raise exception 'listing not favoritable' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger listing_favorites_enforce
  before insert on public.listing_favorites
  for each row execute function public.listing_favorites_enforce();

revoke all on function public.listing_favorites_enforce() from public, anon, authenticated;

create policy "users read own favorites"
  on public.listing_favorites for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy "users add own favorites"
  on public.listing_favorites for insert to authenticated
  with check (user_id = (select auth.uid()) or user_id is null);

create policy "users remove own favorites"
  on public.listing_favorites for delete to authenticated
  using (user_id = (select auth.uid()));

-- Reports
revoke all on table public.listing_reports from anon, authenticated;
grant select on public.listing_reports to authenticated;
grant insert (listing_id, reason, details) on public.listing_reports to authenticated;

create policy "users read own listing reports"
  on public.listing_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_admin());

create policy "users create listing reports"
  on public.listing_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) or reporter_id is null);

create policy "admins update listing reports"
  on public.listing_reports for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============ STORAGE BUCKET (PRIVATE + signed URL reads) ============
-- Private bucket: objects are not world-readable by URL alone.
-- SELECT allowed only when linked listing is publicly readable, or owner/admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-images',
  'listing-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.listing_storage_object_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.listings l
    where l.id::text = nullif((storage.foldername(p_name))[3], '')
      and (
        (l.status = 'active' and l.visibility in ('public', 'unlisted'))
        or (l.status = 'completed' and l.visibility = 'public')
        or l.owner_id = (select auth.uid())
        or public.is_admin()
      )
  );
$$;

create or replace function public.listing_storage_object_owned(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    (storage.foldername(p_name))[1] = 'listings'
    and (storage.foldername(p_name))[2] = (select auth.uid())::text
    and exists (
      select 1
      from public.listings l
      where l.id::text = nullif((storage.foldername(p_name))[3], '')
        and l.owner_id = (select auth.uid())
        and l.status not in ('removed', 'rejected')
    );
$$;

revoke all on function public.listing_storage_object_readable(text) from public;
revoke all on function public.listing_storage_object_owned(text) from public;
grant execute on function public.listing_storage_object_readable(text) to anon, authenticated;
grant execute on function public.listing_storage_object_owned(text) to authenticated;

drop policy if exists "listing images public read" on storage.objects;
drop policy if exists "listing images readable by policy" on storage.objects;
drop policy if exists "users upload own listing images" on storage.objects;
drop policy if exists "users update own listing images" on storage.objects;
drop policy if exists "users delete own listing images" on storage.objects;

create policy "listing images readable by policy"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'listing-images'
    and public.listing_storage_object_readable(name)
  );

create policy "users upload own listing images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-images'
    and public.listing_storage_object_owned(name)
    and name not like '%..%'
  );

create policy "users update own listing images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'listing-images'
    and public.listing_storage_object_owned(name)
  )
  with check (
    bucket_id = 'listing-images'
    and public.listing_storage_object_owned(name)
    and name not like '%..%'
  );

create policy "users delete own listing images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'listing-images'
    and public.listing_storage_object_owned(name)
  );

-- ============ SEED CATEGORIES ============
insert into public.listing_categories (slug, name_ru, name_en, listing_type, sort_order, is_active)
values
  ('electronics', 'Электроника', 'Electronics', 'marketplace_item', 10, true),
  ('furniture', 'Мебель', 'Furniture', 'marketplace_item', 20, true),
  ('home-garden', 'Дом и сад', 'Home & Garden', 'marketplace_item', 30, true),
  ('clothing', 'Одежда', 'Clothing', 'marketplace_item', 40, true),
  ('kids', 'Детские товары', 'Kids', 'marketplace_item', 50, true),
  ('sports', 'Спорт', 'Sports', 'marketplace_item', 60, true),
  ('tools', 'Инструменты', 'Tools', 'marketplace_item', 70, true),
  ('appliances', 'Бытовая техника', 'Appliances', 'marketplace_item', 80, true),
  ('free', 'Бесплатно', 'Free', 'marketplace_item', 90, true),
  ('other', 'Другое', 'Other', 'marketplace_item', 100, true)
on conflict (slug) do nothing;


-- ============ SAFE PUBLIC CATALOG VIEW ============
create or replace view public.marketplace_catalog
with (security_invoker = true) as
select
  l.id,
  l.title,
  l.description,
  l.price_amount,
  l.price_currency,
  l.is_negotiable,
  l.city,
  l.state,
  l.author_visibility,
  l.published_at,
  l.updated_at,
  l.favorites_count,
  d.category_id,
  d.condition,
  d.transaction_type,
  c.slug as category_slug,
  c.name_ru as category_name_ru
from public.listings l
join public.marketplace_listing_details d on d.listing_id = l.id
left join public.listing_categories c on c.id = d.category_id
where l.listing_type = 'marketplace_item'
  and l.status = 'active'
  and l.visibility = 'public';

revoke all on public.marketplace_catalog from public;
grant select on public.marketplace_catalog to anon, authenticated;

-- Profile listings without exposing owner UUID to client
create or replace function public.get_public_profile_listings(p_username text)
returns setof public.listings
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  p public.profiles%rowtype;
  uname text := lower(btrim(coalesce(p_username, '')));
begin
  if uname = '' then
    return;
  end if;
  select * into p from public.profiles where username = uname;
  if not found then
    return;
  end if;
  if p.profile_visibility is distinct from 'public'
     or not p.show_listings_in_profile
     or not p.public_activity_enabled then
    return;
  end if;

  return query
  select l.*
  from public.listings l
  where l.owner_id = p.id
    and l.listing_type = 'marketplace_item'
    and l.visibility = 'public'
    and l.status in ('active', 'completed')
  order by l.published_at desc nulls last
  limit 24;
end;
$$;

revoke all on function public.get_public_profile_listings(text) from public;
grant execute on function public.get_public_profile_listings(text) to anon, authenticated;

-- Concurrent-safe user status transition helper (optional RPC)
create or replace function public.transition_listing_status(
  p_listing_id uuid,
  p_from listing_status,
  p_to listing_status
)
returns public.listings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  row public.listings%rowtype;
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  update public.listings l
  set status = p_to
  where l.id = p_listing_id
    and l.owner_id = uid
    and l.status = p_from
  returning * into row;

  if not found then
    raise exception 'status transition conflict or not allowed' using errcode = 'P0001';
  end if;
  return row;
end;
$$;

revoke all on function public.transition_listing_status(uuid, listing_status, listing_status) from public, anon;
grant execute on function public.transition_listing_status(uuid, listing_status, listing_status) to authenticated;

