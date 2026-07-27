-- ============================================================================
-- DRAFT — DO NOT APPLY without approval.
-- Seeds platform_categories + category_entity_types + legacy map.
-- Run AFTER 001_additive_schema.sql
-- Idempotent via slug upserts.
--
-- PRE-PUSH (ARCHITECTURE_FINAL_AUDIT_V1):
-- This seed still mirrors LIVE home hubs (services/lechu/transfers) for legacy
-- category copy. Before apply, rewrite hubs to TAXONOMY freeze:
--   hub-businesses, hub-professionals, hub-marketplace (Купи-продай),
--   hub-jobs, hub-real-estate (+ later events/vehicles/lechu/transfers as hidden).
-- Do NOT treat hub-services as canonical Professional hub.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Hubs (roots)
-- ---------------------------------------------------------------------------

insert into public.platform_categories (id, parent_id, slug, name_ru, name_en, status, sort_order)
values
  ('c1000001-0000-4000-8000-000000000001', null, 'hub-businesses', 'Бизнесы', 'Businesses', 'active', 10),
  ('c1000001-0000-4000-8000-000000000002', null, 'hub-marketplace', 'Marketplace', 'Marketplace', 'active', 20),
  ('c1000001-0000-4000-8000-000000000003', null, 'hub-services', 'Услуги', 'Services', 'active', 30),
  ('c1000001-0000-4000-8000-000000000004', null, 'hub-transfers', 'Переводы', 'Transfers', 'active', 40),
  ('c1000001-0000-4000-8000-000000000005', null, 'hub-lechu', 'Лечу', 'Lechu', 'active', 50),
  ('c1000001-0000-4000-8000-000000000006', null, 'hub-jobs', 'Работа', 'Jobs', 'active', 60),
  ('c1000001-0000-4000-8000-000000000007', null, 'hub-vehicles', 'Автомобили', 'Vehicles', 'active', 70),
  ('c1000001-0000-4000-8000-000000000008', null, 'hub-real-estate', 'Недвижимость', 'Real estate', 'active', 80),
  ('c1000001-0000-4000-8000-000000000009', null, 'hub-events', 'События', 'Events', 'active', 90)
on conflict (slug) do update set
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Hub allowed entity types
insert into public.category_entity_types (category_id, entity_type)
select c.id, t.entity_type
from public.platform_categories c
cross join lateral (
  values
    ('hub-businesses'::text, 'business'::public.entity_type),
    ('hub-businesses', 'professional'),
    ('hub-marketplace', 'marketplace_item'),
    ('hub-services', 'professional'),
    ('hub-services', 'business'),
    ('hub-transfers', 'transfer'),
    ('hub-lechu', 'lechu'),
    ('hub-jobs', 'job'),
    ('hub-vehicles', 'vehicle'),
    ('hub-real-estate', 'real_estate'),
    ('hub-events', 'event')
) as t(hub_slug, entity_type)
where c.slug = t.hub_slug
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Business leaves (under hub-businesses) — preserve legacy slugs where unique
-- ---------------------------------------------------------------------------

insert into public.platform_categories (id, parent_id, slug, name_ru, name_en, status, sort_order)
select
  ('c2000001-0000-4000-8000-' || lpad(to_hex(row_number() over (order by b.sort_order, b.slug)), 12, '0'))::uuid,
  (select id from public.platform_categories where slug = 'hub-businesses'),
  b.slug,
  b.name,
  coalesce(b.name_en, b.name),
  case when b.is_active then 'active'::public.platform_category_status else 'hidden'::public.platform_category_status end,
  b.sort_order
from public.categories b
where b.domain is null or b.domain = 'business'
on conflict (slug) do update set
  parent_id = excluded.parent_id,
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Note: fixed UUIDs above via hex may collide on re-run with on conflict slug —
-- prefer deterministic UUIDs from legacy map script. Safer approach below uses
-- gen and relies on slug uniqueness; re-seed via Python backfill for ids.

-- Allow business + professional on each business leaf
insert into public.category_entity_types (category_id, entity_type)
select c.id, x.et
from public.platform_categories c
cross join (values
  ('business'::public.entity_type),
  ('professional'::public.entity_type)
) as x(et)
where c.parent_id = (select id from public.platform_categories where slug = 'hub-businesses')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Marketplace leaves — keep listing slugs (no collision with business)
-- ---------------------------------------------------------------------------

insert into public.platform_categories (slug, parent_id, name_ru, name_en, status, sort_order)
select
  lc.slug,
  (select id from public.platform_categories where slug = 'hub-marketplace'),
  lc.name_ru,
  lc.name_en,
  case when lc.is_active then 'active'::public.platform_category_status else 'hidden'::public.platform_category_status end,
  lc.sort_order
from public.listing_categories lc
where lc.domain = 'marketplace'
on conflict (slug) do update set
  parent_id = excluded.parent_id,
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.category_entity_types (category_id, entity_type)
select c.id, 'marketplace_item'::public.entity_type
from public.platform_categories c
where c.parent_id = (select id from public.platform_categories where slug = 'hub-marketplace')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Services leaves — PREFIX slug to avoid collision (beauty, legal)
-- ---------------------------------------------------------------------------

insert into public.platform_categories (slug, parent_id, name_ru, name_en, status, sort_order)
select
  'svc-' || lc.slug,
  (select id from public.platform_categories where slug = 'hub-services'),
  lc.name_ru,
  lc.name_en,
  case when lc.is_active then 'active'::public.platform_category_status else 'hidden'::public.platform_category_status end,
  lc.sort_order
from public.listing_categories lc
where lc.domain = 'services'
on conflict (slug) do update set
  parent_id = excluded.parent_id,
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.category_entity_types (category_id, entity_type)
select c.id, x.et
from public.platform_categories c
cross join (values
  ('professional'::public.entity_type),
  ('business'::public.entity_type)
) as x(et)
where c.parent_id = (select id from public.platform_categories where slug = 'hub-services')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Transfers / Lechu — prefix for clarity
-- ---------------------------------------------------------------------------

insert into public.platform_categories (slug, parent_id, name_ru, name_en, status, sort_order)
select
  lc.slug,
  (select id from public.platform_categories where slug = 'hub-transfers'),
  lc.name_ru,
  lc.name_en,
  case when lc.is_active then 'active'::public.platform_category_status else 'hidden'::public.platform_category_status end,
  lc.sort_order
from public.listing_categories lc
where lc.domain = 'transfers'
on conflict (slug) do update set
  parent_id = excluded.parent_id,
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.category_entity_types (category_id, entity_type)
select c.id, 'transfer'::public.entity_type
from public.platform_categories c
where c.parent_id = (select id from public.platform_categories where slug = 'hub-transfers')
on conflict do nothing;

insert into public.platform_categories (slug, parent_id, name_ru, name_en, status, sort_order)
select
  lc.slug,
  (select id from public.platform_categories where slug = 'hub-lechu'),
  lc.name_ru,
  lc.name_en,
  case when lc.is_active then 'active'::public.platform_category_status else 'hidden'::public.platform_category_status end,
  lc.sort_order
from public.listing_categories lc
where lc.domain = 'lechu'
on conflict (slug) do update set
  parent_id = excluded.parent_id,
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.category_entity_types (category_id, entity_type)
select c.id, 'lechu'::public.entity_type
from public.platform_categories c
where c.parent_id = (select id from public.platform_categories where slug = 'hub-lechu')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Legacy map rows
-- ---------------------------------------------------------------------------

insert into public.platform_category_legacy_map (source_table, source_id, source_slug, platform_category_id, notes)
select
  'categories',
  b.id,
  b.slug,
  pc.id,
  'business category → hub-businesses leaf'
from public.categories b
join public.platform_categories pc on pc.slug = b.slug
where b.domain is null or b.domain = 'business'
on conflict (source_table, source_id) do update set
  platform_category_id = excluded.platform_category_id,
  source_slug = excluded.source_slug,
  notes = excluded.notes;

insert into public.platform_category_legacy_map (source_table, source_id, source_slug, platform_category_id, notes)
select
  'listing_categories',
  lc.id,
  lc.slug,
  pc.id,
  'marketplace leaf'
from public.listing_categories lc
join public.platform_categories pc on pc.slug = lc.slug
where lc.domain = 'marketplace'
on conflict (source_table, source_id) do update set
  platform_category_id = excluded.platform_category_id,
  notes = excluded.notes;

insert into public.platform_category_legacy_map (source_table, source_id, source_slug, platform_category_id, notes)
select
  'listing_categories',
  lc.id,
  lc.slug,
  pc.id,
  'services leaf → svc- prefix'
from public.listing_categories lc
join public.platform_categories pc on pc.slug = 'svc-' || lc.slug
where lc.domain = 'services'
on conflict (source_table, source_id) do update set
  platform_category_id = excluded.platform_category_id,
  notes = excluded.notes;

insert into public.platform_category_legacy_map (source_table, source_id, source_slug, platform_category_id, notes)
select
  'listing_categories',
  lc.id,
  lc.slug,
  pc.id,
  'transfers leaf'
from public.listing_categories lc
join public.platform_categories pc on pc.slug = lc.slug
where lc.domain = 'transfers'
on conflict (source_table, source_id) do update set
  platform_category_id = excluded.platform_category_id,
  notes = excluded.notes;

insert into public.platform_category_legacy_map (source_table, source_id, source_slug, platform_category_id, notes)
select
  'listing_categories',
  lc.id,
  lc.slug,
  pc.id,
  'lechu leaf'
from public.listing_categories lc
join public.platform_categories pc on pc.slug = lc.slug
where lc.domain = 'lechu'
on conflict (source_table, source_id) do update set
  platform_category_id = excluded.platform_category_id,
  notes = excluded.notes;

commit;
