-- ============================================================================
-- DRAFT — DO NOT APPLY / DO NOT db push without explicit approval.
-- Additive entity registry + unified categories + professionals.
-- ALIGNED TO ARCHITECTURE_FREEZE_V1 (owner_profile_id, Jobs Base fields, RE Base).
-- DRAFT ONLY — DO NOT APPLY / db push until implementation task.
-- Location: docs/architecture/entity-model-v1/ (outside supabase/migrations)
-- Preserves: businesses, listings, categories, listing_categories, anti-scrape.
--
-- PRE-PUSH NOTES (ARCHITECTURE_FINAL_AUDIT_V1):
-- * jobs.business_id uses ON DELETE SET NULL (not CASCADE) — preserve job rows.
-- * Status vocab: professional_status.approved ≡ registry published;
--   jobs/RE use text status with published; map in app layer.
-- * Stub tables vehicles/events: no entities sync triggers yet — populate via
--   explicit entities_upsert or add triggers before writing inventory.
-- * businesses Base columns (source_type, owner_profile_id) are a LATER additive
--   ALTER; legacy owner via business_owners / listings.owner_id.
-- * entity_type enum value marketplace_item ≡ product "marketplace".
-- * Apply 002_seed ONLY after hubs match TAXONOMY freeze (Специалисты, not Услуги).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.entity_type as enum (
    'business',
    'professional',
    'marketplace_item',
    'job',
    'vehicle',
    'real_estate',
    'event',
    'lechu',
    'transfer'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.offer_kind as enum (
    'sell',
    'rent',
    'hire',
    'seek',
    'service',
    'giveaway',
    'exchange'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.platform_category_status as enum (
    'active',
    'hidden',
    'deprecated'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.entity_category_role as enum (
    'primary',
    'secondary'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.entity_registry_status as enum (
    'draft',
    'pending',
    'published',
    'hidden',
    'archived',
    'rejected'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.professional_status as enum (
    'draft',
    'pending',
    'approved',
    'rejected',
    'archived',
    'deferred'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. entities (thin registry — NO contacts, NO private addresses)
-- ---------------------------------------------------------------------------

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  entity_type public.entity_type not null,
  source_id uuid not null,
  status public.entity_registry_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entities_type_source_uidx unique (entity_type, source_id)
);

create index if not exists entities_status_type_idx
  on public.entities (status, entity_type);

create index if not exists entities_source_id_idx
  on public.entities (source_id);

comment on table public.entities is
  'Thin cross-domain registry for categories/search. Never store contacts or private addresses.';

-- ---------------------------------------------------------------------------
-- 3. professionals — first-class public page at /professional/[slug]
-- NOT a user profile, NOT a Business, NOT a service listing.
-- Public location = city/centroid; private home address never in public views.
-- ---------------------------------------------------------------------------

create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  -- Base: Ownership (NULL = unclaimed import). Canonical name owner_profile_id (Freeze V1).
  owner_profile_id uuid references public.profiles(id) on delete set null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  -- Base: Source (immutable after insert — enforce in trigger later)
  source_type text not null default 'USER',
  source_record_id text,
  source_url text,
  imported_at timestamptz,
  imported_by_profile_id uuid references public.profiles(id) on delete set null,
  import_batch_id text,
  display_name text not null,
  slug text not null unique,
  headline text,
  short_description text,
  description text,
  image_url text,
  -- professional_status: approved maps to Base published for catalog
  status public.professional_status not null default 'draft',
  visibility text not null default 'public'
    check (visibility in ('public', 'unlisted', 'private')),
  experience_years integer check (experience_years is null or (experience_years >= 0 and experience_years <= 80)),
  languages text[] not null default array['ru']::text[],
  availability_text text,
  opening_hours jsonb,
  rating_avg numeric(3,2) not null default 0
    check (rating_avg >= 0 and rating_avg <= 5),
  reviews_count integer not null default 0 check (reviews_count >= 0),
  city text,
  region text,
  state_code text references public.platform_subdivisions(code) on delete set null,
  city_geoid text references public.platform_cities(geoid) on delete set null,
  county_geoid text,
  latitude double precision,
  longitude double precision,
  location_precision text check (
    location_precision is null
    or location_precision in ('street', 'city', 'county', 'approx')
  ),
  public_exact_address boolean not null default false,
  service_area_text text,
  service_radius_m integer check (service_radius_m is null or service_radius_m > 0),
  private_address_line text,
  phone text,
  email text,
  website text,
  instagram_url text,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professionals_lat_chk check (
    latitude is null or (latitude >= -90 and latitude <= 90)
  ),
  constraint professionals_lng_chk check (
    longitude is null or (longitude >= -180 and longitude <= 180)
  ),
  constraint professionals_source_type_chk check (
    source_type in ('USER', 'TELEGRAM', 'FACEBOOK', 'GOOGLE_BUSINESS', 'YELP', 'IMPORT', 'ADMIN', 'OTHER')
  )
);

create unique index if not exists professionals_one_per_owner_uidx
  on public.professionals (owner_profile_id)
  where owner_profile_id is not null;

create index if not exists professionals_status_idx
  on public.professionals (status);

create index if not exists professionals_slug_idx
  on public.professionals (slug);

create index if not exists professionals_city_geoid_idx
  on public.professionals (city_geoid)
  where city_geoid is not null;

comment on table public.professionals is
  'Independent Professional page (/professional/[slug]). Owned by profiles via owner_profile_id (nullable until Claim). Not nested in Business; no required Business link in v1.';
comment on column public.professionals.owner_profile_id is
  'Platform owner (profiles.id). NULL = unclaimed import. At most one claimed Professional per profile in v1.';
comment on column public.professionals.private_address_line is
  'Home/private address — never include in public views or search payloads.';
comment on column public.professionals.headline is
  'Professional title shown on /professional/[slug], e.g. сантехник.';

-- NOTE (v1): No professional_business_links.
-- Professional ↔ Business employment/contractor links are a future module, not required architecture.

-- Portfolio media (public when professional approved)
create table if not exists public.professional_portfolio_media (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  storage_path text not null,
  public_url text,
  caption text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists professional_portfolio_media_pro_idx
  on public.professional_portfolio_media (professional_id, sort_order);

-- Services / prices on the professional page (not marketplace listings)
create table if not exists public.professional_services (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  title text not null,
  description text,
  offer_kind public.offer_kind not null default 'service',
  price_mode text not null default 'contact'
    check (price_mode in ('fixed', 'from', 'range', 'free', 'contact')),
  price_amount numeric(12,2),
  price_min numeric(12,2),
  price_max numeric(12,2),
  currency text not null default 'USD',
  price_unit text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_services_offer_kind_chk check (offer_kind in ('service', 'hire'))
);

create index if not exists professional_services_pro_idx
  on public.professional_services (professional_id, sort_order)
  where is_active;

-- Certificates / verifications (public badges when approved)
create table if not exists public.professional_credentials (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  kind text not null check (kind in ('certificate', 'license', 'verification', 'other')),
  title text not null,
  issuer text,
  issued_on date,
  expires_on date,
  evidence_url text,
  is_verified boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists professional_credentials_pro_idx
  on public.professional_credentials (professional_id, sort_order);

-- Ownership helper for RLS
create or replace function public.owns_professional(p_professional_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.professionals p
    where p.id = p_professional_id
      and p.owner_profile_id is not null
      and p.owner_profile_id = (select auth.uid())
  )
  or public.is_admin();
$$;

revoke all on function public.owns_professional(uuid) from public;
grant execute on function public.owns_professional(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. Publish eligibility (Guest / Light registration / Publish-eligible)
-- ---------------------------------------------------------------------------
-- Existing profile fields used:
--   profiles.display_name, profiles.postal_code (ZIP)
-- Contact verification (no profiles.email_verified / phone_verified today):
--   auth.users.email_confirmed_at
--   auth.users.phone_confirmed_at (when phone auth is used)
-- GAP: profiles has no account_status / ban flag — additive column below.
-- profile_completed is COMPUTED (not a user-writable flag).

alter table public.profiles
  add column if not exists account_status text not null default 'active';

do $$ begin
  alter table public.profiles
    drop constraint if exists profiles_account_status_chk;
  alter table public.profiles
    add constraint profiles_account_status_chk
    check (account_status in ('active', 'suspended', 'banned'));
exception
  when others then null;
end $$;

comment on column public.profiles.account_status is
  'Publish eligibility: active | suspended | banned. Additive for Entity Model v1; default active.';

create or replace function public.is_profile_completed(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and nullif(btrim(p.display_name), '') is not null
      and nullif(btrim(p.postal_code), '') is not null
  );
$$;

create or replace function public.has_verified_contact(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = p_profile_id
      and (
        u.email_confirmed_at is not null
        or u.phone_confirmed_at is not null
      )
  );
$$;

-- can_publish(profile_id) — centralized; prefer can_publish() for current user.
create or replace function public.can_publish(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_profile_id is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = p_profile_id
        and p.account_status = 'active'
    )
    and public.is_profile_completed(p_profile_id)
    and public.has_verified_contact(p_profile_id);
$$;

create or replace function public.can_publish()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_publish((select auth.uid()));
$$;

revoke all on function public.is_profile_completed(uuid) from public;
revoke all on function public.has_verified_contact(uuid) from public;
revoke all on function public.can_publish(uuid) from public;
revoke all on function public.can_publish() from public;
grant execute on function public.is_profile_completed(uuid) to authenticated;
grant execute on function public.has_verified_contact(uuid) to authenticated;
grant execute on function public.can_publish(uuid) to authenticated;
grant execute on function public.can_publish() to authenticated;

comment on function public.can_publish() is
  'Base publish eligibility: active account + completed profile (display_name, postal_code) + verified email OR phone. Entity-specific checks (owns_business, ownership) are additional.';

-- ---------------------------------------------------------------------------
-- 4. Stub domain tables for Vehicle / RealEstate / Job / Event (empty inventory)
-- ---------------------------------------------------------------------------

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete set null,
  provider_business_id uuid references public.businesses(id) on delete set null,
  provider_professional_id uuid references public.professionals(id) on delete set null,
  title text not null,
  slug text not null unique,
  description text,
  status text not null default 'draft',
  offer_kind public.offer_kind not null default 'sell',
  price_amount numeric(12,2),
  price_currency text not null default 'USD',
  year int,
  make text,
  model text,
  trim text,
  mileage int,
  vin text,
  condition text,
  city text,
  state_code text,
  latitude double precision,
  longitude double precision,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_offer_kind_chk check (offer_kind in ('sell', 'rent', 'exchange', 'giveaway'))
);

create table if not exists public.real_estate_listings (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete set null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  provider_business_id uuid references public.businesses(id) on delete set null,
  provider_professional_id uuid references public.professionals(id) on delete set null,
  source_type text not null default 'USER',
  source_record_id text,
  source_url text,
  imported_at timestamptz,
  imported_by_profile_id uuid references public.profiles(id) on delete set null,
  import_batch_id text,
  title text not null,
  slug text not null unique,
  description text,
  status text not null default 'draft',
  visibility text not null default 'public'
    check (visibility in ('public', 'unlisted', 'private')),
  offer_kind public.offer_kind not null default 'sell',
  price_amount numeric(12,2),
  price_currency text not null default 'USD',
  property_type text,
  bedrooms numeric(4,1),
  bathrooms numeric(4,1),
  sqft int,
  public_address_line text,
  private_address_line text,
  public_exact_address boolean not null default false,
  city text,
  state_code text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  attributes jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_offer_kind_chk check (offer_kind in ('sell', 'rent')),
  constraint real_estate_source_type_chk check (
    source_type in ('USER', 'TELEGRAM', 'FACEBOOK', 'GOOGLE_BUSINESS', 'YELP', 'IMPORT', 'ADMIN', 'OTHER')
  )
);

-- Jobs: one entity type `job`; public author = Business if business_id set, else Profile.
-- created_by_profile_id = human creator when present; NULL for system import (Freeze V1).
-- No author_type / provider_type / owner_type columns — attribution is derived from business_id.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  -- Base Ownership / Creator (Freeze: creator NULL allowed for system import)
  owner_profile_id uuid references public.profiles(id) on delete set null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  source_type text not null default 'USER',
  source_record_id text,
  source_url text,
  imported_at timestamptz,
  imported_by_profile_id uuid references public.profiles(id) on delete set null,
  import_batch_id text,
  title text not null,
  slug text not null unique,
  description text,
  employment_type text,
  work_mode text,
  city text,
  state_code text,
  postal_code text,
  compensation_min numeric(12,2),
  compensation_max numeric(12,2),
  compensation_type text,
  status text not null default 'draft',
  visibility text not null default 'public'
    check (visibility in ('public', 'unlisted', 'private')),
  offer_kind public.offer_kind not null default 'hire',
  published_at timestamptz,
  expires_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_offer_kind_chk check (offer_kind in ('hire', 'seek')),
  constraint jobs_status_chk check (
    status in ('draft', 'pending', 'published', 'archived', 'rejected', 'expired')
  ),
  constraint jobs_compensation_range_chk check (
    compensation_min is null
    or compensation_max is null
    or compensation_min <= compensation_max
  ),
  constraint jobs_source_type_chk check (
    source_type in ('USER', 'TELEGRAM', 'FACEBOOK', 'GOOGLE_BUSINESS', 'YELP', 'IMPORT', 'ADMIN', 'OTHER')
  )
);

create index if not exists jobs_business_id_idx
  on public.jobs (business_id)
  where business_id is not null;

create index if not exists jobs_created_by_idx
  on public.jobs (created_by_profile_id);

create index if not exists jobs_status_published_idx
  on public.jobs (status, published_at desc)
  where status = 'published';

comment on column public.jobs.created_by_profile_id is
  'Human creator inside the platform. NULL for pure system/import inserts (Architecture Freeze V1). Not the public author when business_id is set.';
comment on column public.jobs.owner_profile_id is
  'Platform owner for personal jobs; NULL until Claim. Business-attributed jobs use owns_business for manage.';
comment on column public.jobs.business_id is
  'NULL = personal Profile job; NOT NULL = published as Business (public attribution).';
comment on table public.jobs is
  'Single Job record for Business page, Jobs hub, search, filters, feed — no copies.';

-- Integrity: created_by_profile_id immutable (except admin); published_at stamp
create or replace function public.jobs_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.created_by_profile_id is distinct from old.created_by_profile_id
       and not public.is_admin() then
      raise exception 'jobs.created_by_profile_id is immutable'
        using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := coalesce(new.published_at, now());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists jobs_enforce_row on public.jobs;
create trigger jobs_enforce_row
  before insert or update on public.jobs
  for each row execute function public.jobs_enforce_row();

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete set null,
  provider_business_id uuid references public.businesses(id) on delete set null,
  title text not null,
  slug text not null unique,
  description text,
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  city text,
  state_code text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. platform_categories (unified tree, depth ≤ 2)
-- ---------------------------------------------------------------------------

create table if not exists public.platform_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.platform_categories(id) on delete restrict,
  slug text not null unique,
  name_ru text not null,
  name_en text,
  status public.platform_category_status not null default 'active',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_categories_not_self_parent check (parent_id is distinct from id)
);

create index if not exists platform_categories_parent_idx
  on public.platform_categories (parent_id, sort_order);

create index if not exists platform_categories_status_idx
  on public.platform_categories (status, sort_order);

-- Depth ≤ 2: parent must be a root (parent.parent_id is null)
create or replace function public.platform_categories_enforce_depth()
returns trigger
language plpgsql
as $$
declare
  parent_parent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  select c.parent_id into parent_parent
  from public.platform_categories c
  where c.id = new.parent_id;
  if parent_parent is not null then
    raise exception 'platform_categories depth > 2: parent must be a hub root';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_platform_categories_depth on public.platform_categories;
create trigger trg_platform_categories_depth
  before insert or update of parent_id
  on public.platform_categories
  for each row execute function public.platform_categories_enforce_depth();

-- ---------------------------------------------------------------------------
-- 6. category_entity_types (junction — preferred over array)
-- ---------------------------------------------------------------------------

create table if not exists public.category_entity_types (
  category_id uuid not null references public.platform_categories(id) on delete cascade,
  entity_type public.entity_type not null,
  primary key (category_id, entity_type)
);

create index if not exists category_entity_types_type_idx
  on public.category_entity_types (entity_type);

-- ---------------------------------------------------------------------------
-- 7. category_cross_links (explicit cross-hub allow-list)
-- ---------------------------------------------------------------------------

create table if not exists public.category_cross_links (
  primary_hub_id uuid not null references public.platform_categories(id) on delete cascade,
  secondary_category_id uuid not null references public.platform_categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (primary_hub_id, secondary_category_id)
);

create or replace function public.category_cross_links_enforce_hub()
returns trigger
language plpgsql
as $$
declare
  hub_parent uuid;
begin
  select parent_id into hub_parent
  from public.platform_categories
  where id = new.primary_hub_id;
  if hub_parent is not null then
    raise exception 'category_cross_links.primary_hub_id must be a root hub';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_category_cross_links_hub on public.category_cross_links;
create trigger trg_category_cross_links_hub
  before insert or update
  on public.category_cross_links
  for each row execute function public.category_cross_links_enforce_hub();

-- ---------------------------------------------------------------------------
-- 8. entity_categories
-- ---------------------------------------------------------------------------

create table if not exists public.entity_categories (
  entity_id uuid not null references public.entities(id) on delete cascade,
  category_id uuid not null references public.platform_categories(id) on delete restrict,
  role public.entity_category_role not null,
  created_at timestamptz not null default now(),
  primary key (entity_id, category_id)
);

create unique index if not exists entity_categories_one_primary_uidx
  on public.entity_categories (entity_id)
  where role = 'primary';

create index if not exists entity_categories_category_idx
  on public.entity_categories (category_id, role);

create or replace function public.entity_categories_enforce_rules()
returns trigger
language plpgsql
as $$
declare
  et public.entity_type;
  cat_parent uuid;
  primary_hub uuid;
  secondary_hub uuid;
  secondary_count int;
  allowed int;
  cross_ok boolean;
begin
  select e.entity_type into et
  from public.entities e
  where e.id = new.entity_id;
  if et is null then
    raise exception 'entity_categories: entity % not found', new.entity_id;
  end if;

  select count(*) into allowed
  from public.category_entity_types cet
  where cet.category_id = new.category_id
    and cet.entity_type = et;
  if allowed = 0 then
    raise exception 'entity_categories: category does not allow entity_type %', et;
  end if;

  if new.role = 'secondary' then
    select count(*) into secondary_count
    from public.entity_categories ec
    where ec.entity_id = new.entity_id
      and ec.role = 'secondary'
      and ec.category_id is distinct from new.category_id;
    if secondary_count >= 3 then
      raise exception 'entity_categories: max 3 secondary categories';
    end if;

    -- Resolve hubs (root = parent_id null; leaf hub = its parent_id)
    select
      case when c.parent_id is null then c.id else c.parent_id end
    into secondary_hub
    from public.platform_categories c
    where c.id = new.category_id;

    select
      case when c.parent_id is null then c.id else c.parent_id end
    into primary_hub
    from public.entity_categories ec
    join public.platform_categories c on c.id = ec.category_id
    where ec.entity_id = new.entity_id
      and ec.role = 'primary';

    if primary_hub is not null and secondary_hub is distinct from primary_hub then
      select exists (
        select 1
        from public.category_cross_links x
        where x.primary_hub_id = primary_hub
          and x.secondary_category_id = new.category_id
      ) into cross_ok;
      if not cross_ok then
        raise exception 'entity_categories: cross-hub secondary requires category_cross_links';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_entity_categories_rules on public.entity_categories;
create trigger trg_entity_categories_rules
  before insert or update
  on public.entity_categories
  for each row execute function public.entity_categories_enforce_rules();

-- ---------------------------------------------------------------------------
-- 9. entity_offer_kinds allow-list
-- ---------------------------------------------------------------------------

create table if not exists public.entity_offer_kinds (
  entity_type public.entity_type not null,
  offer_kind public.offer_kind not null,
  primary key (entity_type, offer_kind)
);

insert into public.entity_offer_kinds (entity_type, offer_kind) values
  ('marketplace_item', 'sell'),
  ('marketplace_item', 'seek'),
  ('marketplace_item', 'giveaway'),
  ('marketplace_item', 'exchange'),
  ('marketplace_item', 'rent'),
  ('professional', 'service'),
  ('professional', 'hire'),
  ('business', 'service'),
  ('job', 'hire'),
  ('job', 'seek'),
  ('vehicle', 'sell'),
  ('vehicle', 'rent'),
  ('vehicle', 'exchange'),
  ('vehicle', 'giveaway'),
  ('real_estate', 'sell'),
  ('real_estate', 'rent'),
  ('lechu', 'service'),
  ('transfer', 'service'),
  ('event', 'service')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 10. Legacy mapping tables (backfill support; keep old FKs intact)
-- ---------------------------------------------------------------------------

create table if not exists public.platform_category_legacy_map (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check (source_table in ('categories', 'listing_categories')),
  source_id uuid not null,
  source_slug text not null,
  platform_category_id uuid not null references public.platform_categories(id) on delete cascade,
  notes text,
  unique (source_table, source_id)
);

create index if not exists platform_category_legacy_map_slug_idx
  on public.platform_category_legacy_map (source_table, source_slug);

-- ---------------------------------------------------------------------------
-- 11. Registry sync helpers (orphan prevention)
-- ---------------------------------------------------------------------------

create or replace function public.entities_upsert(
  p_entity_type public.entity_type,
  p_source_id uuid,
  p_status public.entity_registry_status
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  insert into public.entities (entity_type, source_id, status)
  values (p_entity_type, p_source_id, p_status)
  on conflict (entity_type, source_id) do update
    set status = excluded.status,
        updated_at = now()
  returning id into rid;
  return rid;
end;
$$;

create or replace function public.entities_delete_by_source(
  p_entity_type public.entity_type,
  p_source_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.entities
  where entity_type = p_entity_type
    and source_id = p_source_id;
end;
$$;

-- Businesses → entities
create or replace function public.trg_sync_entity_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.entities_delete_by_source('business', old.id);
    return old;
  end if;
  perform public.entities_upsert(
    'business',
    new.id,
    case new.status
      when 'approved' then 'published'::public.entity_registry_status
      when 'pending' then 'pending'::public.entity_registry_status
      when 'draft' then 'draft'::public.entity_registry_status
      when 'rejected' then 'rejected'::public.entity_registry_status
      when 'archived' then 'archived'::public.entity_registry_status
      when 'deferred' then 'hidden'::public.entity_registry_status
      else 'draft'::public.entity_registry_status
    end
  );
  return new;
end;
$$;

drop trigger if exists trg_sync_entity_business on public.businesses;
create trigger trg_sync_entity_business
  after insert or update of status or delete
  on public.businesses
  for each row execute function public.trg_sync_entity_business();

-- Professionals → entities
create or replace function public.trg_sync_entity_professional()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.entities_delete_by_source('professional', old.id);
    return old;
  end if;
  perform public.entities_upsert(
    'professional',
    new.id,
    case new.status
      when 'approved' then 'published'::public.entity_registry_status
      when 'pending' then 'pending'::public.entity_registry_status
      when 'draft' then 'draft'::public.entity_registry_status
      when 'rejected' then 'rejected'::public.entity_registry_status
      when 'archived' then 'archived'::public.entity_registry_status
      when 'deferred' then 'hidden'::public.entity_registry_status
      else 'draft'::public.entity_registry_status
    end
  );
  return new;
end;
$$;

drop trigger if exists trg_sync_entity_professional on public.professionals;
create trigger trg_sync_entity_professional
  after insert or update of status or delete
  on public.professionals
  for each row execute function public.trg_sync_entity_professional();

-- Listings → entities (by listing_type)
-- NOTE: listing_type='job' is NOT registered here. Canonical Job entity is public.jobs
-- (single entity_type=job). Legacy listing jobs — migrate later; do not dual-register.
create or replace function public.trg_sync_entity_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  et public.entity_type;
  st public.entity_registry_status;
begin
  if tg_op = 'DELETE' then
    et := case old.listing_type
      when 'marketplace_item' then 'marketplace_item'::public.entity_type
      when 'service' then null  -- service listings are NOT auto Professional; handled separately
      when 'transfer' then 'transfer'::public.entity_type
      when 'transport_carry' then 'lechu'::public.entity_type
      when 'vehicle' then 'vehicle'::public.entity_type
      else null
    end;
    if et is not null then
      perform public.entities_delete_by_source(et, old.id);
    end if;
    return old;
  end if;

  et := case new.listing_type
    when 'marketplace_item' then 'marketplace_item'::public.entity_type
    when 'transfer' then 'transfer'::public.entity_type
    when 'transport_carry' then 'lechu'::public.entity_type
    when 'vehicle' then 'vehicle'::public.entity_type
    else null
  end;
  if et is null then
    return new;
  end if;

  st := case
    when new.status = 'active' and new.visibility in ('public', 'unlisted')
      then 'published'::public.entity_registry_status
    when new.status = 'draft' then 'draft'::public.entity_registry_status
    when new.status in ('archived', 'removed', 'expired') then 'archived'::public.entity_registry_status
    when new.status = 'rejected' then 'rejected'::public.entity_registry_status
    else 'hidden'::public.entity_registry_status
  end;

  perform public.entities_upsert(et, new.id, st);
  return new;
end;
$$;

drop trigger if exists trg_sync_entity_listing on public.listings;
create trigger trg_sync_entity_listing
  after insert or update of status, visibility, listing_type or delete
  on public.listings
  for each row execute function public.trg_sync_entity_listing();

-- Jobs → entities (one type: job; author context lives on jobs row, not entity_type)
create or replace function public.trg_sync_entity_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.entities_delete_by_source('job', old.id);
    return old;
  end if;
  perform public.entities_upsert(
    'job',
    new.id,
    case new.status
      when 'published' then 'published'::public.entity_registry_status
      when 'pending' then 'pending'::public.entity_registry_status
      when 'draft' then 'draft'::public.entity_registry_status
      when 'rejected' then 'rejected'::public.entity_registry_status
      when 'archived' then 'archived'::public.entity_registry_status
      when 'expired' then 'archived'::public.entity_registry_status
      else 'draft'::public.entity_registry_status
    end
  );
  return new;
end;
$$;

drop trigger if exists trg_sync_entity_job on public.jobs;
create trigger trg_sync_entity_job
  after insert or update of status or delete
  on public.jobs
  for each row execute function public.trg_sync_entity_job();

-- ---------------------------------------------------------------------------
-- 12. Public safe view for professionals (NO contacts, NO private address)
-- ---------------------------------------------------------------------------

create or replace view public.professionals_public
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
  p.created_at,
  p.updated_at,
  (p.phone is not null and length(btrim(p.phone)) > 0) as has_phone,
  (p.email is not null and length(btrim(p.email)) > 0) as has_email,
  (p.website is not null and length(btrim(p.website)) > 0) as has_website,
  (p.instagram_url is not null and length(btrim(p.instagram_url)) > 0) as has_instagram
from public.professionals p
where p.status = 'approved';

comment on view public.professionals_public is
  'Approved professionals for /professional/[slug] SSR list/detail — no contacts, no private_address_line.';

-- Search-facing registry view (no contacts)
create or replace view public.entities_public
with (security_invoker = false)
as
select
  e.id,
  e.entity_type,
  e.source_id,
  e.status,
  e.created_at,
  e.updated_at
from public.entities e
where e.status = 'published';

-- ---------------------------------------------------------------------------
-- 13. RLS
-- ---------------------------------------------------------------------------

alter table public.entities enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_portfolio_media enable row level security;
alter table public.professional_services enable row level security;
alter table public.professional_credentials enable row level security;
alter table public.platform_categories enable row level security;
alter table public.category_entity_types enable row level security;
alter table public.entity_categories enable row level security;
alter table public.category_cross_links enable row level security;
alter table public.entity_offer_kinds enable row level security;
alter table public.platform_category_legacy_map enable row level security;
alter table public.vehicles enable row level security;
alter table public.real_estate_listings enable row level security;
alter table public.jobs enable row level security;
alter table public.events enable row level security;

-- Revoke broad access; grant selectively
revoke all on public.entities from anon, authenticated;
revoke all on public.professionals from anon, authenticated;
revoke all on public.professional_portfolio_media from anon, authenticated;
revoke all on public.professional_services from anon, authenticated;
revoke all on public.professional_credentials from anon, authenticated;
revoke all on public.platform_categories from anon, authenticated;
revoke all on public.category_entity_types from anon, authenticated;
revoke all on public.entity_categories from anon, authenticated;
revoke all on public.category_cross_links from anon, authenticated;
revoke all on public.entity_offer_kinds from anon, authenticated;
revoke all on public.platform_category_legacy_map from anon, authenticated;
revoke all on public.vehicles from anon, authenticated;
revoke all on public.real_estate_listings from anon, authenticated;
revoke all on public.jobs from anon, authenticated;
revoke all on public.events from anon, authenticated;

grant select on public.entities_public to anon, authenticated;
grant select on public.professionals_public to anon, authenticated;

grant select on public.platform_categories to anon, authenticated;
grant select on public.category_entity_types to anon, authenticated;
grant select on public.entity_categories to anon, authenticated;
grant select on public.category_cross_links to anon, authenticated;
grant select on public.entity_offer_kinds to anon, authenticated;
grant select on public.entities to authenticated; -- filtered by policy

-- Categories: public read active
drop policy if exists "platform_categories public read" on public.platform_categories;
create policy "platform_categories public read"
  on public.platform_categories for select
  to anon, authenticated
  using (status = 'active');

drop policy if exists "category_entity_types public read" on public.category_entity_types;
create policy "category_entity_types public read"
  on public.category_entity_types for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.platform_categories c
      where c.id = category_id and c.status = 'active'
    )
  );

drop policy if exists "entity_offer_kinds public read" on public.entity_offer_kinds;
create policy "entity_offer_kinds public read"
  on public.entity_offer_kinds for select
  to anon, authenticated
  using (true);

drop policy if exists "category_cross_links public read" on public.category_cross_links;
create policy "category_cross_links public read"
  on public.category_cross_links for select
  to anon, authenticated
  using (true);

drop policy if exists "entity_categories public read published" on public.entity_categories;
create policy "entity_categories public read published"
  on public.entity_categories for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.entities e
      where e.id = entity_id and e.status = 'published'
    )
  );

drop policy if exists "entities authenticated read published" on public.entities;
create policy "entities authenticated read published"
  on public.entities for select
  to authenticated
  using (status = 'published' or public.is_admin());

-- Professionals: NO anon select on base table (use professionals_public)
drop policy if exists "professionals owner read" on public.professionals;
create policy "professionals owner read"
  on public.professionals for select
  to authenticated
  using (public.owns_professional(id));

drop policy if exists "professionals owner insert" on public.professionals;
create policy "professionals owner insert"
  on public.professionals for insert
  to authenticated
  with check (
    (
      owner_profile_id = (select auth.uid())
      and public.can_publish()
    )
    or public.is_admin()
  );

drop policy if exists "professionals owner update" on public.professionals;
create policy "professionals owner update"
  on public.professionals for update
  to authenticated
  using (public.owns_professional(id))
  with check (public.owns_professional(id));

drop policy if exists "professionals owner delete" on public.professionals;
create policy "professionals owner delete"
  on public.professionals for delete
  to authenticated
  using (public.owns_professional(id));

-- Child tables: owner of professional
drop policy if exists "pro portfolio owner all" on public.professional_portfolio_media;
create policy "pro portfolio owner all"
  on public.professional_portfolio_media for all
  to authenticated
  using (public.owns_professional(professional_id))
  with check (public.owns_professional(professional_id));

drop policy if exists "pro portfolio public read" on public.professional_portfolio_media;
create policy "pro portfolio public read"
  on public.professional_portfolio_media for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.professionals p
      where p.id = professional_id and p.status = 'approved'
    )
  );

drop policy if exists "pro services owner all" on public.professional_services;
create policy "pro services owner all"
  on public.professional_services for all
  to authenticated
  using (public.owns_professional(professional_id))
  with check (public.owns_professional(professional_id));

drop policy if exists "pro services public read" on public.professional_services;
create policy "pro services public read"
  on public.professional_services for select
  to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.professionals p
      where p.id = professional_id and p.status = 'approved'
    )
  );

drop policy if exists "pro credentials owner all" on public.professional_credentials;
create policy "pro credentials owner all"
  on public.professional_credentials for all
  to authenticated
  using (public.owns_professional(professional_id))
  with check (public.owns_professional(professional_id));

drop policy if exists "pro credentials public read" on public.professional_credentials;
create policy "pro credentials public read"
  on public.professional_credentials for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.professionals p
      where p.id = professional_id and p.status = 'approved'
    )
  );

grant select on public.professional_portfolio_media to anon, authenticated;
grant select on public.professional_services to anon, authenticated;
grant select on public.professional_credentials to anon, authenticated;

-- Stub inventory tables: owner/admin only until public catalogs ship
drop policy if exists "vehicles owner read" on public.vehicles;
create policy "vehicles owner read"
  on public.vehicles for select to authenticated
  using (owner_profile_id = (select auth.uid()) or public.is_admin());

drop policy if exists "real_estate owner read" on public.real_estate_listings;
create policy "real_estate owner read"
  on public.real_estate_listings for select to authenticated
  using (owner_profile_id = (select auth.uid()) or public.is_admin());

-- ---------------------------------------------------------------------------
-- Jobs RLS
-- Public author: business_id IS NOT NULL → Business; else → Profile (created_by)
-- Manage business jobs: any owns_business admin, not only original creator
-- Soft archive preferred (status); DELETE allowed for managers (hard delete optional)
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.jobs j
      where j.id = p_job_id
        and (
          (
            j.business_id is null
            and (
              j.owner_profile_id = (select auth.uid())
              or j.created_by_profile_id = (select auth.uid())
            )
          )
          or (j.business_id is not null and public.owns_business(j.business_id))
        )
    );
$$;

revoke all on function public.can_manage_job(uuid) from public;
grant execute on function public.can_manage_job(uuid) to authenticated;

drop policy if exists "jobs owner read" on public.jobs;
drop policy if exists "jobs public read published" on public.jobs;
create policy "jobs public read published"
  on public.jobs for select
  to anon, authenticated
  using (
    status = 'published'
    or public.can_manage_job(id)
  );

drop policy if exists "jobs insert publish eligible" on public.jobs;
create policy "jobs insert publish eligible"
  on public.jobs for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and created_by_profile_id = (select auth.uid())
    and (
      public.is_admin()
      or (
        public.can_publish()
        and (
          business_id is null
          or public.owns_business(business_id)
        )
      )
    )
  );

drop policy if exists "jobs update managers" on public.jobs;
create policy "jobs update managers"
  on public.jobs for update
  to authenticated
  using (public.can_manage_job(id))
  with check (
    public.can_manage_job(id)
    and (
      public.is_admin()
      or business_id is null
      or public.owns_business(business_id)
    )
  );

drop policy if exists "jobs delete managers" on public.jobs;
create policy "jobs delete managers"
  on public.jobs for delete
  to authenticated
  using (public.can_manage_job(id));

grant select, insert, update, delete on public.jobs to authenticated;
grant select on public.jobs to anon;

drop policy if exists "events owner read" on public.events;
create policy "events owner read"
  on public.events for select to authenticated
  using (owner_profile_id = (select auth.uid()) or public.is_admin());

-- Service role retains full access via bypassing RLS.

grant select on public.professionals_public to anon, authenticated;
grant select on public.entities_public to anon, authenticated;

notify pgrst, 'reload schema';

commit;
