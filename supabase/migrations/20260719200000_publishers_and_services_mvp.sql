-- Migration: publishers_and_services_mvp (PLATFORM FOUNDATION PACK 2)
-- Publisher model on listings + marketplace goods-only + Services MVP.
-- НЕ применять без отдельного подтверждения.
-- Depends on: 20260719120000_profiles_and_listings_mvp (+ follow-up listing fixes).
--
-- Companion RLS test skeleton (create later as scripts/services-and-publishers-rls-checks.sql):
--   * begin; … rollback; elevated seed of owner/other/admin + approved/pending business
--   * publisher_type=business requires owns_business + status=approved; stranger hijack denied
--   * publisher lock after first publish (published_at / leave draft)
--   * marketplace publish rejects service-looking title/description; requires domain=marketplace
--   * service: draft→active|archived; active→paused|completed|archived; no reserved
--   * anti-spam: 10/25 active caps, duplicate title+category+publisher, 20 creates/hour
--   * services_catalog / resolve_listing_publisher never leak owner_id
--   * service_listing_details RLS mirrors marketplace_listing_details
--   * admin_set_listing_status works for service + paused restore paths
--
-- ENUM PITFALLS (Postgres / Supabase):
--   * ALTER TYPE … ADD VALUE IF NOT EXISTS is safe to re-run.
--   * New enum labels cannot be used as typed literals in the SAME transaction that
--     adds them. This migration compares via ::text / assigns via client UPDATE after
--     commit. Do not seed rows with 'paused' in this file.
--   * Prefer AFTER <existing> for readable enum order; do not reorder existing labels.

-- ============ ENUMS ============
do $$ begin
  create type listing_publisher_type as enum ('profile', 'business');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type listing_domain as enum ('marketplace', 'services');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type service_pricing_type as enum (
    'fixed',
    'from',
    'hourly',
    'daily',
    'negotiable',
    'free_estimate',
    'contact_for_price'
  );
exception
  when duplicate_object then null;
end $$;

-- paused sits with live user-facing statuses (after active)
alter type listing_status add value if not exists 'paused' after 'active';

-- Marketplace / services report reasons (IF NOT EXISTS; safe if partially applied)
alter type listing_report_reason add value if not exists 'service_in_marketplace';
alter type listing_report_reason add value if not exists 'scam';
alter type listing_report_reason add value if not exists 'prohibited_service';
alter type listing_report_reason add value if not exists 'misleading_information';
alter type listing_report_reason add value if not exists 'unlicensed_claim';
alter type listing_report_reason add value if not exists 'inappropriate_content';

-- ============ LISTING CATEGORIES: domain ============
alter table public.listing_categories
  add column if not exists domain listing_domain;

update public.listing_categories
set domain = 'marketplace'
where domain is null
  and listing_type = 'marketplace_item';

update public.listing_categories
set domain = 'services'
where domain is null
  and listing_type = 'service';

update public.listing_categories
set domain = coalesce(domain, 'marketplace')
where domain is null;

alter table public.listing_categories
  alter column domain set default 'marketplace';

alter table public.listing_categories
  alter column domain set not null;

alter table public.listing_categories
  drop constraint if exists listing_categories_domain_type_chk;

alter table public.listing_categories
  add constraint listing_categories_domain_type_chk check (
    (domain = 'marketplace' and listing_type = 'marketplace_item')
    or (domain = 'services' and listing_type = 'service')
    or listing_type not in ('marketplace_item', 'service')
  );

create index if not exists listing_categories_domain_active_idx
  on public.listing_categories (domain, listing_type, is_active, sort_order);

-- ============ LISTINGS: publisher + timestamps ============
alter table public.listings
  add column if not exists publisher_type listing_publisher_type not null default 'profile',
  add column if not exists publisher_business_id uuid references public.businesses(id) on delete restrict,
  add column if not exists paused_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.listings
  drop constraint if exists listings_publisher_consistency_chk;

alter table public.listings
  add constraint listings_publisher_consistency_chk check (
    (publisher_type = 'profile' and publisher_business_id is null)
    or (publisher_type = 'business' and publisher_business_id is not null)
  );

create index if not exists listings_publisher_business_idx
  on public.listings (publisher_business_id)
  where publisher_business_id is not null;

create index if not exists listings_publisher_type_status_idx
  on public.listings (publisher_type, listing_type, status);

-- Active service duplicate title+category+publisher enforced in listings_enforce_row
-- (category lives on service_listing_details; not expressible as a single partial unique index).

-- ============ SERVICE DETAILS ============
create table if not exists public.service_listing_details (
  listing_id               uuid primary key references public.listings(id) on delete cascade,
  service_category_id      uuid references public.listing_categories(id) on delete set null,
  pricing_type             service_pricing_type not null default 'contact_for_price',
  price_from               numeric(12,2),
  price_to                 numeric(12,2),
  price_unit               text,
  service_modes            text[] not null default array['in_person']::text[],
  service_area             text,
  experience_years         integer,
  languages                text[] not null default array['ru']::text[],
  license_info             text,
  insurance_status         text,
  availability_text        text,
  offers_free_estimate     boolean not null default false,
  offers_emergency_service boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint service_price_from_chk check (price_from is null or price_from >= 0),
  constraint service_price_to_chk check (price_to is null or price_to >= 0),
  constraint service_price_range_chk check (
    price_from is null or price_to is null or price_to >= price_from
  ),
  constraint service_price_unit_len_chk check (
    price_unit is null or char_length(btrim(price_unit)) between 1 and 40
  ),
  constraint service_area_len_chk check (
    service_area is null or char_length(btrim(service_area)) between 1 and 200
  ),
  constraint service_experience_chk check (
    experience_years is null or experience_years between 0 and 80
  ),
  constraint service_license_len_chk check (
    license_info is null or char_length(license_info) <= 500
  ),
  constraint service_insurance_len_chk check (
    insurance_status is null or char_length(insurance_status) <= 200
  ),
  constraint service_availability_len_chk check (
    availability_text is null or char_length(availability_text) <= 500
  ),
  constraint service_modes_nonempty_chk check (cardinality(service_modes) >= 1),
  constraint service_modes_allowed_chk check (
    service_modes <@ array['in_person', 'remote', 'mobile', 'hybrid']::text[]
  ),
  constraint service_languages_nonempty_chk check (cardinality(languages) >= 1)
);

create index if not exists service_details_category_idx
  on public.service_listing_details (service_category_id);

drop trigger if exists service_listing_details_set_updated_at on public.service_listing_details;
create trigger service_listing_details_set_updated_at
  before update on public.service_listing_details
  for each row execute function public.set_updated_at();

-- ============ ABUSE: listing create rate limit ============
alter table public.review_abuse_events
  drop constraint if exists review_abuse_events_kind_check;

alter table public.review_abuse_events
  add constraint review_abuse_events_kind_check
  check (kind in (
    'review_write',
    'review_report',
    'listing_report',
    'listing_create'
  ));

-- Harden: no client policies; FORCE so table-owner bypass cannot open a future grant hole
alter table public.review_abuse_events enable row level security;
alter table public.review_abuse_events force row level security;
revoke all on table public.review_abuse_events from anon, authenticated;

-- ============ HELPERS ============
create or replace function public.marketplace_looks_like_service(
  p_title text,
  p_description text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  t text := lower(coalesce(p_title, ''));
  d text := lower(coalesce(p_description, ''));
  blob text := t || ' ' || d;
begin
  -- Allow common marketplace phrasing that mentions repair/service as product attributes
  if blob ~ '(delivery available|free delivery|local delivery)' then
    null; -- not alone a service signal; continue
  end if;
  if blob ~ '(service history|fully (serviced|repaired)|professionally repaired|repaired (item|phone|laptop|device))' then
    return false;
  end if;
  if blob ~ '(installation manual|install(ation)? instructions|user manual)' then
    return false;
  end if;

  -- Strong service-offer signals (EN + RU)
  if blob ~ '(call for (a )?estimate|free estimate|get a quote|request a quote)' then
    return true;
  end if;
  if blob ~ '(hourly rate|\$ ?/ ?(hour|hr)|per hour|\/час|в час)' then
    return true;
  end if;
  if blob ~ '(i (offer|provide|do) (services?|repairs?)|offering (my )?services?|hire me)' then
    return true;
  end if;
  if blob ~ '(установка|монтаж|ремонт под ключ|вызов (мастера|специалиста)|консультаци[яи]|смет[аы]|прайс за (час|выезд))' then
    -- Exclude product titles like "Установочный комплект" via word boundaries where possible
    if blob !~ '(установочн|installation kit|mount(ing)? kit|кронштейн)' then
      return true;
    end if;
  end if;
  if t ~ '^(repair|fixing|handyman|plumbing|electrical|cleaning|tutoring|massage)\b' then
    return true;
  end if;
  if t ~ '^(ремонт|установка|сантехник|электрик|уборк|репетитор|маникюр|парикмахер)\b' then
    return true;
  end if;
  if blob ~ '\b(book (an? )?(appointment|session)|schedule a visit|выезд на дом|работаю по записи)\b' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.marketplace_looks_like_service(text, text) from public;
grant execute on function public.marketplace_looks_like_service(text, text) to anon, authenticated;

create or replace function public.resolve_listing_publisher(
  p_publisher_type listing_publisher_type,
  p_publisher_business_id uuid,
  p_owner_id uuid,
  p_author_visibility author_visibility default 'public'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  b record;
  author jsonb;
begin
  if p_publisher_type = 'business' and p_publisher_business_id is not null then
    select id, slug, name, image_url, status
      into b
    from public.businesses
    where id = p_publisher_business_id;

    if found and b.status = 'approved' then
      return jsonb_build_object(
        'publisher_type', 'business',
        'business_id', b.id,
        'slug', b.slug,
        'name', b.name,
        'logo_url', b.image_url
      );
    end if;

    -- Non-approved or missing: do not leak business identity
    return jsonb_build_object(
      'publisher_type', 'business',
      'business_id', null,
      'slug', null,
      'name', null,
      'logo_url', null
    );
  end if;

  author := public.resolve_author_display(p_owner_id, coalesce(p_author_visibility, 'public'));
  return jsonb_build_object(
    'publisher_type', 'profile',
    'business_id', null,
    'slug', null,
    'name', author ->> 'label',
    'logo_url', author ->> 'avatar_url',
    'author', author
  );
end;
$$;

revoke all on function public.resolve_listing_publisher(listing_publisher_type, uuid, uuid, author_visibility) from public;
grant execute on function public.resolve_listing_publisher(listing_publisher_type, uuid, uuid, author_visibility) to anon, authenticated;

-- ============ LISTINGS ENFORCE (replace) ============
create or replace function public.listings_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  trusted boolean := private.has_trusted_listing_write();
  uid uuid := (select auth.uid());
  biz_status content_status;
  n_active int;
  n_creates int;
  svc_cat uuid;
  published_locked boolean;
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
    new.paused_at := null;
    new.archived_at := null;

    if new.publisher_type is null then
      new.publisher_type := 'profile';
    end if;
    if new.publisher_type = 'profile' then
      new.publisher_business_id := null;
    end if;

    if not trusted then
      new.status := 'draft';

      -- Rate limit: max 20 listing creates / hour
      select count(*) into n_creates
      from public.review_abuse_events e
      where e.user_id = uid
        and e.kind = 'listing_create'
        and e.created_at > now() - interval '1 hour';
      if n_creates >= 20 then
        raise exception 'listing create rate limit exceeded' using errcode = 'P0001';
      end if;
    end if;

    -- Business publisher checks
    if new.publisher_type = 'business' then
      if new.publisher_business_id is null then
        raise exception 'publisher_business_id required for business publisher' using errcode = 'P0001';
      end if;
      if not trusted then
        if not public.owns_business(new.publisher_business_id) then
          raise exception 'not business owner' using errcode = '42501';
        end if;
      end if;
      select status into biz_status
      from public.businesses where id = new.publisher_business_id;
      if not found then
        raise exception 'business not found' using errcode = 'P0001';
      end if;
      if biz_status is distinct from 'approved' then
        raise exception 'business must be approved to publish as business' using errcode = 'P0001';
      end if;
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

  -- Lock publisher after first publish (published_at set or left draft)
  published_locked := (
    old.published_at is not null
    or old.status::text is distinct from 'draft'
  );
  if published_locked then
    new.publisher_type := old.publisher_type;
    new.publisher_business_id := old.publisher_business_id;
  else
    if new.publisher_type is null then
      new.publisher_type := old.publisher_type;
    end if;
    if new.publisher_type = 'profile' then
      new.publisher_business_id := null;
    end if;
    if new.publisher_type = 'business' then
      if new.publisher_business_id is null then
        raise exception 'publisher_business_id required for business publisher' using errcode = 'P0001';
      end if;
      if not trusted then
        if not public.owns_business(new.publisher_business_id) then
          raise exception 'not business owner' using errcode = '42501';
        end if;
      end if;
      select status into biz_status
      from public.businesses where id = new.publisher_business_id;
      if not found then
        raise exception 'business not found' using errcode = 'P0001';
      end if;
      if biz_status is distinct from 'approved' then
        raise exception 'business must be approved to publish as business' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if not trusted then
    -- Lock admin/system fields (timestamps set only via this trigger)
    new.moderation_reason := old.moderation_reason;
    new.published_at := old.published_at;
    new.reserved_at := old.reserved_at;
    new.completed_at := old.completed_at;
    new.paused_at := old.paused_at;
    new.archived_at := old.archived_at;
    new.expires_at := old.expires_at;

    -- Block admin statuses for users
    if new.status::text in ('removed', 'rejected', 'expired') then
      raise exception 'status transition not allowed' using errcode = 'P0001';
    end if;
    if old.status::text in ('removed', 'rejected') then
      raise exception 'cannot modify moderated listing' using errcode = 'P0001';
    end if;

    -- Allowed user transitions (type-aware; use ::text for paused same-tx safety)
    if new.status is distinct from old.status then
      if old.listing_type = 'service' then
        if new.status::text = 'reserved' then
          raise exception 'reserved is not allowed for service listings' using errcode = 'P0001';
        end if;
        if not (
          (old.status::text = 'draft' and new.status::text in ('active', 'archived'))
          or (old.status::text = 'active' and new.status::text in ('paused', 'completed', 'archived'))
          or (old.status::text = 'paused' and new.status::text in ('active', 'archived'))
          or (old.status::text = 'completed' and new.status::text in ('active', 'archived'))
          or (old.status::text = 'archived' and new.status::text = 'draft')
        ) then
          raise exception 'invalid status transition from % to %', old.status, new.status
            using errcode = 'P0001';
        end if;
      else
        -- marketplace_item and other types: existing matrix + paused not for marketplace by default
        if new.status::text = 'paused' and old.listing_type is distinct from 'service' then
          raise exception 'paused is only allowed for service listings' using errcode = 'P0001';
        end if;
        if not (
          (old.status::text = 'draft' and new.status::text in ('active', 'archived'))
          or (old.status::text = 'active' and new.status::text in ('reserved', 'completed', 'archived'))
          or (old.status::text = 'reserved' and new.status::text in ('active', 'completed', 'archived'))
          or (old.status::text = 'completed' and new.status::text = 'archived')
          or (old.status::text = 'archived' and new.status::text = 'draft')
        ) then
          raise exception 'invalid status transition from % to %', old.status, new.status
            using errcode = 'P0001';
        end if;
      end if;

      if new.status::text = 'active' and old.status::text = 'draft' then
        new.published_at := coalesce(old.published_at, now());
      end if;
      if new.status::text = 'active' and old.status::text in ('paused', 'completed', 'reserved') then
        new.published_at := coalesce(old.published_at, now());
      end if;
      if new.status::text = 'reserved' then
        new.reserved_at := now();
      end if;
      if new.status::text = 'completed' then
        new.completed_at := now();
      end if;
      if new.status::text = 'paused' then
        new.paused_at := now();
      end if;
      if new.status::text = 'archived' then
        new.archived_at := now();
      end if;
      if new.status::text = 'active' and old.status::text = 'reserved' then
        new.reserved_at := null;
      end if;
      if new.status::text = 'active' and old.status::text = 'paused' then
        new.paused_at := null;
      end if;
      if new.status::text = 'draft' and old.status::text = 'archived' then
        new.archived_at := null;
      end if;
    end if;
  else
    -- Trusted/admin path: set timestamps consistently
    if new.status::text = 'active' and old.status::text is distinct from 'active' then
      new.published_at := coalesce(new.published_at, old.published_at, now());
      if old.status::text = 'paused' then
        new.paused_at := null;
      end if;
      if old.status::text = 'reserved' then
        new.reserved_at := null;
      end if;
    end if;
    if new.status::text = 'reserved' and old.status::text is distinct from 'reserved' then
      new.reserved_at := coalesce(new.reserved_at, now());
    end if;
    if new.status::text = 'completed' and old.status::text is distinct from 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
    if new.status::text = 'paused' and old.status::text is distinct from 'paused' then
      new.paused_at := coalesce(new.paused_at, now());
    end if;
    if new.status::text = 'archived' and old.status::text is distinct from 'archived' then
      new.archived_at := coalesce(new.archived_at, now());
    end if;
  end if;

  -- Anti-spam for services when becoming active or changing title while active
  if new.listing_type = 'service'
     and new.status::text = 'active'
     and (
       old.status::text is distinct from 'active'
       or new.title is distinct from old.title
       or new.publisher_type is distinct from old.publisher_type
       or new.publisher_business_id is distinct from old.publisher_business_id
     )
  then
    select d.service_category_id into svc_cat
    from public.service_listing_details d
    where d.listing_id = new.id;

    if new.publisher_type = 'profile' then
      select count(*) into n_active
      from public.listings l
      where l.owner_id = new.owner_id
        and l.publisher_type = 'profile'
        and l.listing_type = 'service'
        and l.status::text = 'active'
        and l.id is distinct from new.id;
      if n_active >= 10 then
        raise exception 'maximum 10 active service listings per profile' using errcode = 'P0001';
      end if;
    elsif new.publisher_type = 'business' then
      select count(*) into n_active
      from public.listings l
      where l.publisher_business_id = new.publisher_business_id
        and l.publisher_type = 'business'
        and l.listing_type = 'service'
        and l.status::text = 'active'
        and l.id is distinct from new.id;
      if n_active >= 25 then
        raise exception 'maximum 25 active service listings per business' using errcode = 'P0001';
      end if;
    end if;

    -- Duplicate active: same title + category + publisher
    if exists (
      select 1
      from public.listings l
      left join public.service_listing_details d on d.listing_id = l.id
      where l.listing_type = 'service'
        and l.status::text = 'active'
        and l.id is distinct from new.id
        and lower(btrim(l.title)) = lower(btrim(new.title))
        and d.service_category_id is not distinct from svc_cat
        and (
          (new.publisher_type = 'profile'
            and l.publisher_type = 'profile'
            and l.owner_id = new.owner_id)
          or (new.publisher_type = 'business'
            and l.publisher_type = 'business'
            and l.publisher_business_id = new.publisher_business_id)
        )
    ) then
      raise exception 'duplicate active service listing for title and category' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.listings_enforce_row() from public, anon, authenticated;

-- Log listing creates for rate limit (after insert)
create or replace function public.listings_log_create_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.review_abuse_events (user_id, kind)
  values (new.owner_id, 'listing_create');
  return new;
end;
$$;

drop trigger if exists listings_log_create_event on public.listings;
create trigger listings_log_create_event
  after insert on public.listings
  for each row execute function public.listings_log_create_event();

revoke all on function public.listings_log_create_event() from public, anon, authenticated;

-- ============ PUBLISH VALIDATION (marketplace + services) ============
create or replace function public.listings_validate_publish()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  d public.marketplace_listing_details%rowtype;
  s public.service_listing_details%rowtype;
  cat_domain listing_domain;
  cat_type listing_type;
  cat_active boolean;
begin
  if tg_op <> 'UPDATE'
     or new.status::text <> 'active'
     or old.status::text = 'active' then
    return new;
  end if;

  -- ---- Marketplace goods ----
  if new.listing_type = 'marketplace_item' then
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
    select c.domain, c.listing_type, c.is_active
      into cat_domain, cat_type, cat_active
    from public.listing_categories c
    where c.id = d.category_id;
    if not found
       or cat_active is not true
       or cat_type is distinct from 'marketplace_item'
       or cat_domain is distinct from 'marketplace' then
      raise exception 'inactive or invalid marketplace category' using errcode = 'P0001';
    end if;
    if d.transaction_type = 'sell' and (new.price_amount is null or new.price_amount < 0) then
      raise exception 'price required for sell listings' using errcode = 'P0001';
    end if;
    if d.transaction_type = 'free' then
      new.price_amount := 0;
    end if;
    if public.marketplace_looks_like_service(new.title, new.description) then
      raise exception 'this looks like a service — please post it in the Services section'
        using errcode = 'P0001';
    end if;
  end if;

  -- ---- Services ----
  if new.listing_type = 'service' then
    if new.city is null or new.state is null then
      raise exception 'city and state required to publish' using errcode = 'P0001';
    end if;
    select * into s from public.service_listing_details where listing_id = new.id;
    if not found then
      raise exception 'service details required' using errcode = 'P0001';
    end if;
    if s.service_category_id is null then
      raise exception 'service category required to publish' using errcode = 'P0001';
    end if;
    select c.domain, c.listing_type, c.is_active
      into cat_domain, cat_type, cat_active
    from public.listing_categories c
    where c.id = s.service_category_id;
    if not found
       or cat_active is not true
       or cat_type is distinct from 'service'
       or cat_domain is distinct from 'services' then
      raise exception 'inactive or invalid service category' using errcode = 'P0001';
    end if;
    if s.pricing_type in ('fixed', 'from', 'hourly', 'daily')
       and s.price_from is null then
      raise exception 'price_from required for pricing_type %', s.pricing_type
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.listings_validate_publish() from public, anon, authenticated;

-- ============ SERVICE DETAILS ENFORCE ============
create or replace function public.service_details_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  owner uuid;
  ltype listing_type;
  lst_status text;
  pub_type listing_publisher_type;
  pub_biz uuid;
  title text;
  uid uuid := (select auth.uid());
begin
  select l.owner_id, l.listing_type, l.status::text, l.publisher_type,
         l.publisher_business_id, l.title
    into owner, ltype, lst_status, pub_type, pub_biz, title
  from public.listings l where l.id = new.listing_id;
  if owner is null then
    raise exception 'listing not found' using errcode = 'P0001';
  end if;
  if ltype is distinct from 'service' then
    raise exception 'not a service listing' using errcode = 'P0001';
  end if;
  if not public.is_admin() and (uid is null or owner is distinct from uid) then
    raise exception 'not listing owner' using errcode = '42501';
  end if;

  if new.price_unit is not null then
    new.price_unit := nullif(btrim(new.price_unit), '');
  end if;
  if new.service_area is not null then
    new.service_area := nullif(btrim(new.service_area), '');
  end if;
  if new.license_info is not null then
    new.license_info := nullif(btrim(new.license_info), '');
  end if;
  if new.insurance_status is not null then
    new.insurance_status := nullif(btrim(new.insurance_status), '');
  end if;
  if new.availability_text is not null then
    new.availability_text := nullif(btrim(new.availability_text), '');
  end if;

  -- Duplicate active check when category changes on an already-active listing
  if lst_status = 'active'
     and (
       tg_op = 'INSERT'
       or new.service_category_id is distinct from old.service_category_id
     )
     and exists (
       select 1
       from public.listings l
       left join public.service_listing_details d on d.listing_id = l.id
       where l.listing_type = 'service'
         and l.status::text = 'active'
         and l.id is distinct from new.listing_id
         and lower(btrim(l.title)) = lower(btrim(title))
         and d.service_category_id is not distinct from new.service_category_id
         and (
           (pub_type = 'profile'
             and l.publisher_type = 'profile'
             and l.owner_id = owner)
           or (pub_type = 'business'
             and l.publisher_type = 'business'
             and l.publisher_business_id = pub_biz)
         )
     )
  then
    raise exception 'duplicate active service listing for title and category' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists service_details_enforce on public.service_listing_details;
create trigger service_details_enforce
  before insert or update on public.service_listing_details
  for each row execute function public.service_details_enforce();

revoke all on function public.service_details_enforce() from public, anon, authenticated;

-- ============ TRANSITION RPC (type-aware conflict messaging) ============
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
  ltype listing_type;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select listing_type into ltype
  from public.listings
  where id = p_listing_id and owner_id = uid;

  if not found then
    raise exception 'status transition conflict or not allowed' using errcode = 'P0001';
  end if;

  if ltype = 'service' and p_to::text = 'reserved' then
    raise exception 'reserved is not allowed for service listings' using errcode = 'P0001';
  end if;
  if ltype is distinct from 'service' and p_to::text = 'paused' then
    raise exception 'paused is only allowed for service listings' using errcode = 'P0001';
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

-- ============ ADMIN: allow paused for services via trusted path ============
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
  ltype listing_type;
  uid uuid := (select auth.uid());
begin
  if uid is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  -- paused compared via text so this function body is safe if re-applied mid-tx
  if p_status::text not in ('active', 'removed', 'rejected', 'archived', 'paused') then
    raise exception 'unsupported admin status' using errcode = 'P0001';
  end if;

  select status, listing_type into old_status, ltype
  from public.listings where id = p_listing_id;
  if not found then
    raise exception 'listing not found' using errcode = 'P0001';
  end if;

  if p_status::text = 'paused' and ltype is distinct from 'service' then
    raise exception 'paused is only allowed for service listings' using errcode = 'P0001';
  end if;

  if p_status::text = 'active'
     and old_status::text not in ('removed', 'rejected', 'archived', 'active', 'paused') then
    raise exception 'invalid admin restore transition' using errcode = 'P0001';
  end if;

  perform private.enable_trusted_listing_write();
  update public.listings
  set
    status = p_status,
    moderation_reason = case
      when p_status::text in ('removed', 'rejected') then nullif(btrim(coalesce(p_reason, '')), '')
      when p_status::text = 'active' then null
      else moderation_reason
    end,
    updated_at = now()
  where id = p_listing_id;
  perform private.disable_trusted_listing_write();

  insert into public.listing_admin_audit (listing_id, admin_id, action, from_status, to_status, reason)
  values (
    p_listing_id,
    uid,
    'set_status',
    old_status,
    p_status,
    nullif(btrim(coalesce(p_reason, '')), '')
  );
exception
  when others then
    perform private.disable_trusted_listing_write();
    raise;
end;
$$;

revoke all on function public.admin_set_listing_status(uuid, listing_status, text) from public, anon;
grant execute on function public.admin_set_listing_status(uuid, listing_status, text) to authenticated;

-- ============ RLS: service_listing_details ============
alter table public.service_listing_details enable row level security;
alter table public.service_listing_details force row level security;

revoke all on table public.service_listing_details from anon, authenticated;
grant select on public.service_listing_details to anon, authenticated;
grant insert, update on public.service_listing_details to authenticated;

drop policy if exists "service details readable with listing" on public.service_listing_details;
create policy "service details readable with listing"
  on public.service_listing_details for select to anon, authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (
          (l.status::text = 'active' and l.visibility in ('public', 'unlisted'))
          or (l.status::text = 'completed' and l.visibility = 'public')
          or l.owner_id = (select auth.uid())
          or public.is_admin()
        )
    )
  );

drop policy if exists "owners write service details" on public.service_listing_details;
create policy "owners write service details"
  on public.service_listing_details for insert to authenticated
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owners update service details" on public.service_listing_details;
create policy "owners update service details"
  on public.service_listing_details for update to authenticated
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

-- ============ LISTINGS column grants (publisher fields) ============
-- anon: no owner_id / publisher_business_id / moderation_reason (UUID + mod leaks).
-- authenticated: full row for owner dashboards; public rows still expose owner_id
-- to logged-in clients via table SELECT — prefer catalog views for public UI.
revoke all on table public.listings from anon, authenticated;
grant select (
  id, listing_type, status, visibility, author_visibility,
  title, description, price_amount, price_currency, is_negotiable,
  city, state, latitude, longitude, contact_preference,
  published_at, reserved_at, completed_at, paused_at, archived_at, expires_at,
  favorites_count, created_at, updated_at, publisher_type
) on public.listings to anon;
grant select (
  id, owner_id, listing_type, status, visibility, author_visibility,
  title, description, price_amount, price_currency, is_negotiable,
  city, state, latitude, longitude, contact_preference,
  published_at, reserved_at, completed_at, paused_at, archived_at, expires_at,
  favorites_count, created_at, updated_at,
  publisher_type, publisher_business_id, moderation_reason
) on public.listings to authenticated;
grant insert (
  listing_type, status, visibility, author_visibility,
  title, description, price_amount, price_currency, is_negotiable,
  city, state, latitude, longitude, contact_preference,
  publisher_type, publisher_business_id
) on public.listings to authenticated;
grant update (
  status, visibility, author_visibility,
  title, description, price_amount, price_currency, is_negotiable,
  city, state, latitude, longitude, contact_preference,
  publisher_type, publisher_business_id
) on public.listings to authenticated;
grant delete on public.listings to authenticated;

-- ============ CATALOG VIEWS ============
-- DROP required: CREATE OR REPLACE cannot rename/reorder view columns.
drop view if exists public.marketplace_catalog cascade;
drop view if exists public.services_catalog cascade;

create view public.marketplace_catalog
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
  l.publisher_type,
  d.category_id,
  d.condition,
  d.transaction_type,
  c.slug as category_slug,
  c.name_ru as category_name_ru,
  public.resolve_listing_publisher(
    l.publisher_type,
    l.publisher_business_id,
    l.owner_id,
    l.author_visibility
  ) as publisher
from public.listings l
join public.marketplace_listing_details d on d.listing_id = l.id
left join public.listing_categories c on c.id = d.category_id
where l.listing_type = 'marketplace_item'
  and l.status::text = 'active'
  and l.visibility = 'public';

revoke all on public.marketplace_catalog from public;
grant select on public.marketplace_catalog to anon, authenticated;

create view public.services_catalog
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
  l.publisher_type,
  s.service_category_id,
  s.pricing_type,
  s.price_from,
  s.price_to,
  s.price_unit,
  s.service_modes,
  s.service_area,
  s.experience_years,
  s.languages,
  s.offers_free_estimate,
  s.offers_emergency_service,
  c.slug as category_slug,
  c.name_ru as category_name_ru,
  public.resolve_listing_publisher(
    l.publisher_type,
    l.publisher_business_id,
    l.owner_id,
    l.author_visibility
  ) as publisher
from public.listings l
join public.service_listing_details s on s.listing_id = l.id
left join public.listing_categories c on c.id = s.service_category_id
where l.listing_type = 'service'
  and l.status::text = 'active'
  and l.visibility = 'public';

revoke all on public.services_catalog from public;
grant select on public.services_catalog to anon, authenticated;

-- Profile marketplace listings + services RPC (no owner_id / mod / business UUID)
-- DROP required: Pack 1 used setof listings (leaked owner_id); return type change needs drop.
drop function if exists public.get_public_profile_listings(text);
drop function if exists public.get_public_profile_service_listings(text);

create or replace function public.get_public_profile_listings(p_username text)
returns table (
  id uuid,
  listing_type public.listing_type,
  status public.listing_status,
  visibility public.listing_visibility,
  author_visibility public.author_visibility,
  title text,
  description text,
  price_amount numeric,
  price_currency text,
  is_negotiable boolean,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  contact_preference public.listing_contact_preference,
  published_at timestamptz,
  reserved_at timestamptz,
  completed_at timestamptz,
  paused_at timestamptz,
  archived_at timestamptz,
  expires_at timestamptz,
  favorites_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  publisher_type public.listing_publisher_type
)
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
  select
    l.id,
    l.listing_type,
    l.status,
    l.visibility,
    l.author_visibility,
    l.title,
    l.description,
    l.price_amount,
    l.price_currency,
    l.is_negotiable,
    l.city,
    l.state,
    l.latitude,
    l.longitude,
    l.contact_preference,
    l.published_at,
    l.reserved_at,
    l.completed_at,
    l.paused_at,
    l.archived_at,
    l.expires_at,
    l.favorites_count,
    l.created_at,
    l.updated_at,
    l.publisher_type
  from public.listings l
  where l.owner_id = p.id
    and l.publisher_type = 'profile'
    and l.listing_type = 'marketplace_item'
    and l.visibility = 'public'
    and l.status::text in ('active', 'completed')
  order by l.published_at desc nulls last
  limit 24;
end;
$$;

revoke all on function public.get_public_profile_listings(text) from public;
grant execute on function public.get_public_profile_listings(text) to anon, authenticated;

create or replace function public.get_public_profile_service_listings(p_username text)
returns table (
  id uuid,
  listing_type public.listing_type,
  status public.listing_status,
  visibility public.listing_visibility,
  author_visibility public.author_visibility,
  title text,
  description text,
  price_amount numeric,
  price_currency text,
  is_negotiable boolean,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  contact_preference public.listing_contact_preference,
  published_at timestamptz,
  reserved_at timestamptz,
  completed_at timestamptz,
  paused_at timestamptz,
  archived_at timestamptz,
  expires_at timestamptz,
  favorites_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  publisher_type public.listing_publisher_type
)
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
  select
    l.id,
    l.listing_type,
    l.status,
    l.visibility,
    l.author_visibility,
    l.title,
    l.description,
    l.price_amount,
    l.price_currency,
    l.is_negotiable,
    l.city,
    l.state,
    l.latitude,
    l.longitude,
    l.contact_preference,
    l.published_at,
    l.reserved_at,
    l.completed_at,
    l.paused_at,
    l.archived_at,
    l.expires_at,
    l.favorites_count,
    l.created_at,
    l.updated_at,
    l.publisher_type
  from public.listings l
  where l.owner_id = p.id
    and l.publisher_type = 'profile'
    and l.listing_type = 'service'
    and l.visibility = 'public'
    and l.status::text in ('active', 'completed')
  order by l.published_at desc nulls last
  limit 24;
end;
$$;

revoke all on function public.get_public_profile_service_listings(text) from public;
grant execute on function public.get_public_profile_service_listings(text) to anon, authenticated;

-- Storage helpers already key off listing visibility; no change required for services.
-- Re-assert grants (idempotent).
revoke all on function public.listing_storage_object_readable(text) from public;
revoke all on function public.listing_storage_object_owned(text) from public;
grant execute on function public.listing_storage_object_readable(text) to anon, authenticated;
grant execute on function public.listing_storage_object_owned(text) to authenticated;

-- ============ SEED SERVICE CATEGORIES ============
insert into public.listing_categories (
  slug, name_ru, name_en, listing_type, domain, sort_order, is_active
)
values
  ('home-repair', 'Ремонт дома', 'Home repair', 'service', 'services', 10, true),
  ('cleaning', 'Уборка', 'Cleaning', 'service', 'services', 20, true),
  ('moving', 'Переезды', 'Moving', 'service', 'services', 30, true),
  ('auto-service', 'Автосервис', 'Auto service', 'service', 'services', 40, true),
  ('beauty', 'Красота', 'Beauty', 'service', 'services', 50, true),
  ('tutoring', 'Репетиторство', 'Tutoring', 'service', 'services', 60, true),
  ('it-help', 'IT-помощь', 'IT help', 'service', 'services', 70, true),
  ('legal', 'Юридические услуги', 'Legal', 'service', 'services', 80, true),
  ('health', 'Здоровье', 'Health', 'service', 'services', 90, true),
  ('other-services', 'Другие услуги', 'Other services', 'service', 'services', 100, true)
on conflict (slug) do update
set
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  listing_type = excluded.listing_type,
  domain = excluded.domain,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;
