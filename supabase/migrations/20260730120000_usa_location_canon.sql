-- USA Location Canon: county_geoid as membership key, publish requires location,
-- county search RPC. SoT: docs/architecture/runtime/USA_LOCATION_CANON_V1.md

-- ---------------------------------------------------------------------------
-- 1) Columns on catalog + queue
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column if not exists county_geoid text
    references public.platform_counties (geoid) on delete set null;
alter table public.businesses
  add column if not exists location_source text
    check (
      location_source is null
      or location_source in ('zip', 'city', 'coordinates', 'source_group', 'manual')
    );
alter table public.businesses
  add column if not exists location_confidence text
    check (
      location_confidence is null
      or location_confidence in ('exact', 'inferred')
    );

create index if not exists businesses_county_geoid_idx
  on public.businesses (county_geoid)
  where county_geoid is not null;

alter table public.business_locations
  add column if not exists county_geoid text
    references public.platform_counties (geoid) on delete set null;

create index if not exists business_locations_county_geoid_idx
  on public.business_locations (county_geoid)
  where county_geoid is not null;

-- professionals.county_geoid already exists (bare text) — add FK if missing.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'professionals_county_geoid_fkey'
  ) then
    alter table public.professionals
      add constraint professionals_county_geoid_fkey
      foreign key (county_geoid)
      references public.platform_counties (geoid)
      on delete set null;
  end if;
exception
  when others then
    -- Skip if orphaned values would violate FK; backfill fixes later.
    raise notice 'professionals county_geoid FK skipped: %', SQLERRM;
end $$;

alter table public.professionals
  add column if not exists location_source text
    check (
      location_source is null
      or location_source in ('zip', 'city', 'coordinates', 'source_group', 'manual')
    );
alter table public.professionals
  add column if not exists location_confidence text
    check (
      location_confidence is null
      or location_confidence in ('exact', 'inferred')
    );

create index if not exists professionals_county_geoid_idx
  on public.professionals (county_geoid)
  where county_geoid is not null;

alter table public.listings
  add column if not exists county_geoid text
    references public.platform_counties (geoid) on delete set null;
alter table public.listings
  add column if not exists postal_code text;
alter table public.listings
  add column if not exists location_source text
    check (
      location_source is null
      or location_source in ('zip', 'city', 'coordinates', 'source_group', 'manual')
    );
alter table public.listings
  add column if not exists location_confidence text
    check (
      location_confidence is null
      or location_confidence in ('exact', 'inferred')
    );

create index if not exists listings_county_geoid_idx
  on public.listings (county_geoid)
  where county_geoid is not null;

alter table public.jobs
  add column if not exists county_geoid text
    references public.platform_counties (geoid) on delete set null;
alter table public.jobs
  add column if not exists location_source text
    check (
      location_source is null
      or location_source in ('zip', 'city', 'coordinates', 'source_group', 'manual')
    );
alter table public.jobs
  add column if not exists location_confidence text
    check (
      location_confidence is null
      or location_confidence in ('exact', 'inferred')
    );

create index if not exists jobs_county_geoid_idx
  on public.jobs (county_geoid)
  where county_geoid is not null;

alter table public.events
  add column if not exists county_geoid text
    references public.platform_counties (geoid) on delete set null;
alter table public.events
  add column if not exists postal_code text;
alter table public.events
  add column if not exists location_source text
    check (
      location_source is null
      or location_source in ('zip', 'city', 'coordinates', 'source_group', 'manual')
    );
alter table public.events
  add column if not exists location_confidence text
    check (
      location_confidence is null
      or location_confidence in ('exact', 'inferred')
    );

create index if not exists events_county_geoid_idx
  on public.events (county_geoid)
  where county_geoid is not null;

alter table public.import_review_items
  add column if not exists county_geoid text
    references public.platform_counties (geoid) on delete set null;
alter table public.import_review_items
  add column if not exists postal_code text;
alter table public.import_review_items
  add column if not exists location_source text
    check (
      location_source is null
      or location_source in ('zip', 'city', 'coordinates', 'source_group', 'manual')
    );
alter table public.import_review_items
  add column if not exists location_confidence text
    check (
      location_confidence is null
      or location_confidence in ('exact', 'inferred')
    );

create index if not exists import_review_items_county_geoid_idx
  on public.import_review_items (county_geoid)
  where county_geoid is not null;

comment on column public.import_review_items.county_geoid is
  'Resolved US county FIPS (Census GEOID). Required for publish.';
comment on column public.import_review_items.location_source is
  'How county_geoid was resolved: zip | city | coordinates | source_group | manual';

-- Grants for new columns (anon/authenticated already have table select where applicable)
grant select (county_geoid, location_source, location_confidence)
  on public.businesses to anon, authenticated;
grant select (county_geoid)
  on public.business_locations to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) County search RPC (mirror of search_platform_cities)
-- ---------------------------------------------------------------------------

create or replace function public.search_platform_counties(
  p_query text,
  p_state_code text default null,
  p_limit integer default 20
)
returns table (
  geoid text,
  state_code text,
  name text,
  name_normalized text,
  slug text,
  latitude double precision,
  longitude double precision
)
language plpgsql
stable
set search_path = pg_catalog, public, extensions
as $$
declare
  q text := public.normalize_place_name(p_query);
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 20);
  prefix_count integer;
begin
  if q is null or char_length(q) < 2 then
    return;
  end if;

  select count(*) into prefix_count
  from public.platform_counties c
  where c.is_active
    and (p_state_code is null or c.state_code = p_state_code)
    and (
      c.name_normalized like q || '%'
      or c.name_normalized like '% ' || q || '%'
    );

  if prefix_count > 0 then
    return query
    select
      c.geoid,
      c.state_code,
      c.name,
      c.name_normalized,
      c.slug,
      c.latitude,
      c.longitude
    from public.platform_counties c
    where c.is_active
      and (p_state_code is null or c.state_code = p_state_code)
      and (
        c.name_normalized like q || '%'
        or c.name_normalized like '% ' || q || '%'
      )
    order by
      case when c.name_normalized = q then 0
           when c.name_normalized like q || '%' then 1
           else 2 end,
      char_length(c.name_normalized),
      c.name_normalized
    limit lim;
    return;
  end if;

  if char_length(q) < 3 then
    return;
  end if;

  return query
  select
    c.geoid,
    c.state_code,
    c.name,
    c.name_normalized,
    c.slug,
    c.latitude,
    c.longitude
  from public.platform_counties c
  where c.is_active
    and (p_state_code is null or c.state_code = p_state_code)
    and c.name_normalized % q
  order by
    similarity(c.name_normalized, q) desc,
    char_length(c.name_normalized),
    c.name_normalized
  limit lim;
end;
$$;

revoke all on function public.search_platform_counties(text, text, integer) from public;
grant execute on function public.search_platform_counties(text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Publish gate: require county_geoid
-- ---------------------------------------------------------------------------

create or replace function public.import_review_publish_gate_errors(v public.import_review_items)
returns text[]
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  errs text[] := '{}';
  has_contact boolean;
  has_description boolean;
  has_image boolean;
  pair_ok boolean;
begin
  if v.target_collection is null or v.entity_type is null then
    return array['entity_type/target_collection не заданы — карточка не классифицирована'];
  end if;

  pair_ok := (v.entity_type::text, v.target_collection::text) in (
    ('business', 'businesses'),
    ('business', 'services'),
    ('business', 'organizations'),
    ('organization', 'organizations'),
    ('organization', 'businesses'),
    ('private_specialist', 'private_specialists'),
    ('marketplace_listing', 'marketplace'),
    ('job', 'jobs'),
    ('real_estate', 'real_estate'),
    ('event', 'events'),
    ('lechu_listing', 'lechu'),
    ('transfer_listing', 'transfers')
  );
  if not pair_ok then
    return array[
      format(
        'несогласованная пара entity_type=%s / target_collection=%s',
        v.entity_type::text,
        v.target_collection::text
      )
    ];
  end if;

  if v.entity_type::text = 'real_estate' or v.target_collection::text = 'real_estate' then
    return array['real_estate заморожен: RE table not ready. Wait for Phase 3.'];
  end if;

  -- USA Location Canon: no county → no publish.
  if nullif(btrim(coalesce(v.county_geoid, '')), '') is null then
    errs := array_append(
      errs,
      'location_unresolved: нужен ZIP, город+штат, адрес или известная группа'
    );
  end if;

  has_contact :=
       coalesce(array_length(v.phone, 1), 0) > 0
    or coalesce(array_length(v.whatsapp, 1), 0) > 0
    or coalesce(array_length(v.website, 1), 0) > 0
    or coalesce(array_length(v.instagram, 1), 0) > 0
    or nullif(btrim(coalesce(v.telegram_username, '')), '') is not null
    or nullif(btrim(coalesce(v.telegram_user_id, '')), '') is not null;
  has_description :=
       nullif(btrim(coalesce(v.description, '')), '') is not null
    or nullif(btrim(coalesce(v.source_text, '')), '') is not null;
  has_image :=
       nullif(btrim(coalesce(v.preview_image_url, '')), '') is not null
    or coalesce(v.photos_count, 0) > 0;

  if v.target_collection::text in ('businesses', 'services', 'organizations') then
    if nullif(btrim(coalesce(v.category, '')), '') is null then
      errs := array_append(errs, 'category');
    end if;
    if not has_contact then
      errs := array_append(errs, 'контакт (телефон/сайт/Instagram/Telegram)');
    end if;
    if not has_description then
      errs := array_append(errs, 'description');
    end if;
    if not has_image then
      errs := array_append(errs, 'image (preview_image_url или фото)');
    end if;
  elsif v.target_collection::text = 'private_specialists' then
    if not has_contact then
      errs := array_append(errs, 'контакт (телефон/сайт/Instagram/Telegram)');
    end if;
    if btrim(coalesce(v.category, '')) = 'other'
       and position('[human_confirmed]' in coalesce(v.review_notes, '')) = 0 then
      errs := array_append(errs, 'category = other без [human_confirmed] в review_notes');
    end if;
  elsif v.target_collection::text = 'marketplace' then
    if v.price is null then
      errs := array_append(errs, 'price_amount (для ''free''/''wanted'' публикуйте вручную)');
    end if;
  elsif v.target_collection::text = 'transfers' then
    errs := array_append(errs, 'fee_percent или fee_fixed_usd (нет в данных поста)');
  elsif v.target_collection::text = 'lechu' then
    errs := array_append(errs, 'departure_date (нет в данных поста)');
  elsif v.target_collection::text = 'events' then
    if position('[event_date_confirmed]' in coalesce(v.review_notes, '')) = 0 then
      errs := array_append(errs, 'starts_at/event_at_label (добавьте [event_date_confirmed] в review_notes после проверки даты)');
    end if;
  end if;

  return errs;
end;
$$;
