-- Professionals MVP (additive). Ship path for /professional/[slug].
-- Scoped: enums + entities registry + professionals (+ children) + publish helpers + RLS.
-- Deferred: jobs, RE, vehicles, events, platform_categories seed (later migrations).

-- ---------------------------------------------------------------------------
-- Enums
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
  create type public.entity_registry_status as enum (
    'draft',
    'pending',
    'published',
    'rejected',
    'archived',
    'hidden'
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
-- entities registry (thin)
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
-- professionals
-- ---------------------------------------------------------------------------

create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete set null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
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
  status public.professional_status not null default 'draft',
  visibility text not null default 'public'
    check (visibility in ('public', 'unlisted', 'private')),
  experience_years integer check (
    experience_years is null or (experience_years >= 0 and experience_years <= 80)
  ),
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
    source_type in (
      'USER', 'TELEGRAM', 'FACEBOOK', 'GOOGLE_BUSINESS', 'YELP', 'IMPORT', 'ADMIN', 'OTHER'
    )
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
  'Independent Professional page (/professional/[slug]). owner_profile_id nullable until Claim.';

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

-- ---------------------------------------------------------------------------
-- Ownership + publish eligibility
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Registry helpers + sync trigger
-- ---------------------------------------------------------------------------

create or replace function public.entities_upsert(
  p_entity_type public.entity_type,
  p_source_id uuid,
  p_status public.entity_registry_status default 'draft'
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

-- Stamp published_at when becoming approved
create or replace function public.trg_professionals_published_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    new.published_at := coalesce(new.published_at, now());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_professionals_published_at on public.professionals;
create trigger trg_professionals_published_at
  before insert or update of status
  on public.professionals
  for each row execute function public.trg_professionals_published_at();

-- ---------------------------------------------------------------------------
-- Public views (no contacts / private address)
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
  p.published_at,
  (p.phone is not null and length(btrim(p.phone)) > 0) as has_phone,
  (p.email is not null and length(btrim(p.email)) > 0) as has_email,
  (p.website is not null and length(btrim(p.website)) > 0) as has_website,
  (p.instagram_url is not null and length(btrim(p.instagram_url)) > 0) as has_instagram
from public.professionals p
where p.status = 'approved'
  and p.visibility = 'public';

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
-- RLS
-- ---------------------------------------------------------------------------

alter table public.entities enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_portfolio_media enable row level security;
alter table public.professional_services enable row level security;
alter table public.professional_credentials enable row level security;

revoke all on public.entities from anon, authenticated;
revoke all on public.professionals from anon, authenticated;
revoke all on public.professional_portfolio_media from anon, authenticated;
revoke all on public.professional_services from anon, authenticated;
revoke all on public.professional_credentials from anon, authenticated;

grant select on public.entities_public to anon, authenticated;
grant select on public.professionals_public to anon, authenticated;
grant select on public.entities to authenticated;
grant select, insert, update, delete on public.professionals to authenticated;
grant select, insert, update, delete on public.professional_portfolio_media to authenticated;
grant select, insert, update, delete on public.professional_services to authenticated;
grant select, insert, update, delete on public.professional_credentials to authenticated;
grant select on public.professional_portfolio_media to anon;
grant select on public.professional_services to anon;
grant select on public.professional_credentials to anon;

drop policy if exists "entities authenticated read published" on public.entities;
create policy "entities authenticated read published"
  on public.entities for select
  to authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists "professionals owner read" on public.professionals;
create policy "professionals owner read"
  on public.professionals for select
  to authenticated
  using (public.owns_professional(id) or status = 'approved');

drop policy if exists "professionals owner insert" on public.professionals;
create policy "professionals owner insert"
  on public.professionals for insert
  to authenticated
  with check (
    (
      owner_profile_id = (select auth.uid())
      and created_by_profile_id = (select auth.uid())
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

-- Owner contacts via security definer RPC (anti-scrape; no anon grant on base contacts)
create or replace function public.get_professional_contacts(p_slug text)
returns table (
  phone text,
  email text,
  website text,
  instagram_url text
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
  select p.phone, p.email, p.website, p.instagram_url
  from public.professionals p
  where p.slug = p_slug
    and p.status = 'approved'
    and p.visibility = 'public'
  limit 1;
end;
$$;

revoke all on function public.get_professional_contacts(text) from public;
grant execute on function public.get_professional_contacts(text) to authenticated;
