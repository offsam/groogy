-- Entity section routing: pair consistency on publish gate + move ledger.
-- SoT: docs/architecture/pipeline/ENTITY_SECTION_ROUTING_V1.md

-- 1) Harden G3: reject inconsistent entity_type / target_collection pairs.
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
  -- G2 backstop: an untyped card is never publishable (CARD_PROCESSING F4/F6).
  if v.target_collection is null or v.entity_type is null then
    return array['entity_type/target_collection не заданы — карточка не классифицирована'];
  end if;

  -- Atomic pair must match ENTITY_TYPE_MAPPING_V1.
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

  -- Real estate is frozen until the Phase 3 entity build (PHASE_PLAN_V1 §3.3).
  if v.entity_type::text = 'real_estate' or v.target_collection::text = 'real_estate' then
    return array['real_estate заморожен: RE table not ready. Wait for Phase 3.'];
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

-- 2) Move ledger — audit + redirect source for live cards.
create table if not exists public.entity_moves (
  id uuid primary key default gen_random_uuid(),
  from_type text not null,
  from_id uuid not null,
  from_slug text,
  from_path text not null,
  to_type text not null,
  to_id uuid not null,
  to_slug text,
  to_path text not null,
  moved_by uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists entity_moves_from_path_idx
  on public.entity_moves (from_path);

create index if not exists entity_moves_from_entity_idx
  on public.entity_moves (from_type, from_id);

create index if not exists entity_moves_to_entity_idx
  on public.entity_moves (to_type, to_id);

alter table public.entity_moves enable row level security;

drop policy if exists entity_moves_admin_select on public.entity_moves;
create policy entity_moves_admin_select
  on public.entity_moves
  for select
  to authenticated
  using (public.is_admin());

-- Anon can resolve redirects (path lookup only via service / middleware).
grant select on public.entity_moves to anon, authenticated, service_role;
grant insert on public.entity_moves to service_role;

comment on table public.entity_moves is
  'Ledger of live-card section moves; from_path → to_path drives 308 redirects.';

notify pgrst, 'reload schema';
