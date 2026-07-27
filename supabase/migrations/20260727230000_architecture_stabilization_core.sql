-- ARCHITECTURE_STABILIZATION_V1 core migration.
-- Single source of truth for publish gates, domain-event outbox (extension
-- point for notifications / indexing / background workers), enum drift repair,
-- shared "is publicly listed" helper, and a scheduler-ready maintenance entry.
-- Findings closed: V-5 (gates only in TS), V-15 (merge unaudited),
-- V-16 (listing_type enum drift), plus extension points from §13 of
-- PLATFORM_LIFECYCLE_V1. No product behavior added.

-- ============ 1. Enum drift repair (V-16) ============
-- transfer / transport_carry exist in the live DB but were added outside the
-- tracked migration files; make fresh environments buildable.
alter type public.listing_type add value if not exists 'transfer';
alter type public.listing_type add value if not exists 'transport_carry';

-- ============ 2. Domain events outbox ============
-- Append-only. Consumers (future notifications, search indexing, AI workers)
-- poll rows where processed_at is null and stamp them when handled.
create table if not exists public.domain_events (
  id            bigint generated always as identity primary key,
  event_type    text not null,
  entity_type   text,
  entity_id     uuid,
  actor_id      uuid,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);

create index if not exists domain_events_unprocessed_idx
  on public.domain_events (created_at)
  where processed_at is null;
create index if not exists domain_events_entity_idx
  on public.domain_events (entity_type, entity_id);
create index if not exists domain_events_type_idx
  on public.domain_events (event_type, created_at desc);

alter table public.domain_events enable row level security;
revoke all on public.domain_events from public, anon, authenticated;

drop policy if exists "domain events admin read" on public.domain_events;
create policy "domain events admin read"
  on public.domain_events for select
  to authenticated
  using (public.is_admin());
grant select on public.domain_events to authenticated;

create or replace function public.emit_domain_event(
  p_event_type text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.domain_events (event_type, entity_type, entity_id, actor_id, payload)
  values (p_event_type, p_entity_type, p_entity_id, auth.uid(), coalesce(p_payload, '{}'::jsonb));
end;
$$;
-- Only server-side code paths (security-definer RPCs, service role) emit.
revoke all on function public.emit_domain_event(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.emit_domain_event(text, text, uuid, jsonb) to service_role;

-- ============ 3. Shared public-visibility helper ============
-- One canonical answer to "is this row live?" across the five status
-- vocabularies (ENTITY_BASE_MODEL §3). New code should use this instead of
-- per-table literals.
create or replace function public.is_publicly_listed(p_status text, p_visibility text default 'public')
returns boolean
language sql
immutable
as $$
  select p_status in ('approved', 'published', 'active')
     and coalesce(p_visibility, 'public') = 'public';
$$;
grant execute on function public.is_publicly_listed(text, text) to anon, authenticated, service_role;

-- ============ 4. Publish gate — single source of truth (V-5) ============
-- Mirrors QUALITY_CARD_RULES_V1. Every publish path (admin UI action, script
-- autopublish, service RPCs) must consult THIS function; the TS copy is removed.
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
begin
  -- Real estate is frozen until the Phase 3 entity build (PHASE_PLAN_V1 §3.3).
  if v.entity_type::text = 'real_estate' or v.target_collection::text = 'real_estate' then
    return array['real_estate заморожен: RE table not ready. Wait for Phase 3.'];
  end if;

  -- Contact path = phone / whatsapp / website / instagram / telegram —
  -- deliberately NOT email or source_url (see QUALITY_CARD_RULES_V1).
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
    -- Публикация из очереди всегда создаёт transaction_type='sell'.
    if v.price is null then
      errs := array_append(errs, 'price_amount (для ''free''/''wanted'' публикуйте вручную)');
    end if;
  elsif v.target_collection::text = 'transfers' then
    errs := array_append(errs, 'fee_percent или fee_fixed_usd (нет в данных поста)');
  elsif v.target_collection::text = 'lechu' then
    errs := array_append(errs, 'departure_date (нет в данных поста)');
  elsif v.target_collection::text = 'events' then
    -- starts_at/event_at_label не извлекаются пайплайном — дату подтверждает
    -- человек тегом [event_date_confirmed] в review_notes.
    if position('[event_date_confirmed]' in coalesce(v.review_notes, '')) = 0 then
      errs := array_append(errs, 'starts_at/event_at_label (добавьте [event_date_confirmed] в review_notes после проверки даты)');
    end if;
  end if;

  return errs;
end;
$$;

create or replace function public.import_review_publish_gate_check(p_item_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.import_review_items;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into v_row from public.import_review_items where id = p_item_id;
  if not found then
    raise exception 'import review item not found' using errcode = 'P0001';
  end if;
  return public.import_review_publish_gate_errors(v_row);
end;
$$;
revoke all on function public.import_review_publish_gate_check(uuid) from public, anon;
grant execute on function public.import_review_publish_gate_check(uuid) to authenticated, service_role;

-- ============ 5. mark_approved: gate backstop + domain event ============
create or replace function public.admin_import_review_mark_approved(
  p_item_id uuid,
  p_published_entity_type text,
  p_published_entity_id uuid
)
returns public.import_review_items
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.import_review_items;
  v_prev public.import_review_status;
  v_errs text[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select * into v_row from public.import_review_items where id = p_item_id for update;
  if not found then
    raise exception 'import review item not found' using errcode = 'P0001';
  end if;

  if v_row.review_status = 'approved'
     and v_row.published_entity_id is not null then
    -- Idempotent re-approve: return existing mapping, do not create another.
    return v_row;
  end if;

  -- Backstop: publish paths must pre-check via import_review_publish_gate_check
  -- BEFORE creating the entity; this raise catches any path that skipped it.
  v_errs := public.import_review_publish_gate_errors(v_row);
  if coalesce(array_length(v_errs, 1), 0) > 0 then
    raise exception 'publish gate failed: %', array_to_string(v_errs, '; ')
      using errcode = 'P0001';
  end if;

  v_prev := v_row.review_status;

  update public.import_review_items set
    review_status = 'approved',
    published_entity_type = p_published_entity_type,
    published_entity_id = p_published_entity_id,
    published_at = coalesce(published_at, now()),
    approved_at = coalesce(approved_at, now()),
    approved_by = coalesce(approved_by, auth.uid()),
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_item_id
  returning * into v_row;

  perform public.admin_import_review_write_audit(
    p_item_id, 'approved', v_prev, 'approved',
    '{}'::jsonb, p_published_entity_type, p_published_entity_id, null
  );

  perform public.emit_domain_event(
    'import_review.approved',
    p_published_entity_type,
    p_published_entity_id,
    jsonb_build_object('item_id', p_item_id, 'target_collection', v_row.target_collection)
  );

  return v_row;
end;
$$;

-- ============ 6. mark_autopublished: gate backstop + domain event ============
create or replace function public.service_import_review_mark_autopublished(
  p_item_id uuid,
  p_published_entity_type text,
  p_published_entity_id uuid,
  p_note text default 'Автоматическая публикация: accepted + прямой контакт'
)
returns public.import_review_items
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.import_review_items;
  v_prev public.import_review_status;
  v_errs text[];
begin
  -- Invoked with service_role only (no auth.uid required).
  select * into v_row from public.import_review_items where id = p_item_id for update;
  if not found then
    raise exception 'import review item not found' using errcode = 'P0001';
  end if;

  if v_row.review_status = 'approved' and v_row.published_entity_id is not null then
    return v_row;
  end if;

  -- Backstop: same single gate as the human path (V-5).
  v_errs := public.import_review_publish_gate_errors(v_row);
  if coalesce(array_length(v_errs, 1), 0) > 0 then
    raise exception 'publish gate failed: %', array_to_string(v_errs, '; ')
      using errcode = 'P0001';
  end if;

  v_prev := v_row.review_status;

  update public.import_review_items set
    review_status = 'approved',
    published_entity_type = p_published_entity_type,
    published_entity_id = p_published_entity_id,
    published_at = coalesce(published_at, now()),
    approved_at = coalesce(approved_at, now()),
    review_notes = coalesce(nullif(btrim(p_note), ''), review_notes),
    reviewed_at = now(),
    reviewed_by = null  -- system / service autopublish (no admin uid)
  where id = p_item_id
  returning * into v_row;

  insert into public.import_review_audit (
    item_id, admin_id, action, previous_status, new_status,
    changed_fields, created_entity_type, created_entity_id, note
  ) values (
    p_item_id, null, 'approved', v_prev, 'approved',
    jsonb_build_object('autopublish', true),
    p_published_entity_type, p_published_entity_id, p_note
  );

  perform public.emit_domain_event(
    'import_review.autopublished',
    p_published_entity_type,
    p_published_entity_id,
    jsonb_build_object('item_id', p_item_id, 'target_collection', v_row.target_collection)
  );

  return v_row;
end;
$$;

-- ============ 7. Claim review: domain events ============
create or replace function public.admin_review_business_claim(
  p_claim_id uuid,
  p_decision text,
  p_moderator_note text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_caller uuid := auth.uid();
  v_claim public.business_claims%rowtype;
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = 'P0001';
  end if;

  select * into v_claim
  from public.business_claims
  where id = p_claim_id
  for update;

  if not found then
    raise exception 'claim not found' using errcode = 'P0001';
  end if;

  if v_claim.status is distinct from 'pending' then
    raise exception 'claim is not pending' using errcode = 'P0001';
  end if;

  if p_decision = 'approved' then
    insert into public.business_owners (business_id, user_id, role)
    values (v_claim.business_id, v_claim.user_id, 'owner')
    on conflict (business_id, user_id) do nothing;

    -- Prefer owner role on profile when still a plain user.
    perform set_config('app.allow_role_change', '1', true);
    update public.profiles
    set role = 'business_owner', updated_at = now()
    where id = v_claim.user_id
      and role = 'user';
  end if;

  update public.business_claims
  set
    status = p_decision::public.business_claim_status,
    moderator_note = nullif(btrim(coalesce(p_moderator_note, '')), ''),
    reviewed_by = v_caller,
    reviewed_at = now(),
    updated_at = now()
  where id = p_claim_id;

  perform public.emit_domain_event(
    'business.claim_' || p_decision,
    'business',
    v_claim.business_id,
    jsonb_build_object('claim_id', p_claim_id, 'user_id', v_claim.user_id)
  );
end;
$$;

-- ============ 8. Merge: persist summary as domain event (V-15) ============
create or replace function public.admin_merge_businesses(
  p_keep_id uuid,
  p_drop_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  keep_row public.businesses%rowtype;
  drop_row public.businesses%rowtype;
  offers_moved int := 0;
  owners_moved int := 0;
  claims_moved int := 0;
  reviews_moved int := 0;
  listings_moved int := 0;
  replies_moved int := 0;
  conflict_slug text;
  v_summary jsonb;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_keep_id = p_drop_id then
    raise exception 'keep and drop must differ' using errcode = 'P0001';
  end if;

  select * into keep_row from public.businesses where id = p_keep_id for update;
  if not found then
    raise exception 'keep business not found' using errcode = 'P0001';
  end if;
  select * into drop_row from public.businesses where id = p_drop_id for update;
  if not found then
    raise exception 'drop business not found' using errcode = 'P0001';
  end if;

  -- Offers: rename slug on conflict, then re-parent.
  for conflict_slug in
    select o.slug
    from public.business_offers o
    where o.business_id = p_drop_id
      and exists (
        select 1 from public.business_offers k
        where k.business_id = p_keep_id and k.slug = o.slug
      )
  loop
    update public.business_offers
    set slug = left(conflict_slug || '-merged-' || substr(replace(p_drop_id::text, '-', ''), 1, 8), 80)
    where business_id = p_drop_id and slug = conflict_slug;
  end loop;

  update public.business_offers
  set business_id = p_keep_id, updated_at = now()
  where business_id = p_drop_id;
  get diagnostics offers_moved = row_count;

  -- Owners: skip users already owning keep.
  insert into public.business_owners (business_id, user_id, role, created_at)
  select p_keep_id, bo.user_id, bo.role, bo.created_at
  from public.business_owners bo
  where bo.business_id = p_drop_id
    and not exists (
      select 1 from public.business_owners k
      where k.business_id = p_keep_id and k.user_id = bo.user_id
    );
  get diagnostics owners_moved = row_count;
  delete from public.business_owners where business_id = p_drop_id;

  -- Claims: re-parent; drop pending that would collide.
  delete from public.business_claims dc
  where dc.business_id = p_drop_id
    and dc.status = 'pending'
    and exists (
      select 1 from public.business_claims kc
      where kc.business_id = p_keep_id
        and kc.user_id = dc.user_id
        and kc.status = 'pending'
    );

  update public.business_claims
  set business_id = p_keep_id
  where business_id = p_drop_id;
  get diagnostics claims_moved = row_count;

  -- Reviews: move only when keep has no review from same user.
  update public.reviews r
  set business_id = p_keep_id
  where r.business_id = p_drop_id
    and not exists (
      select 1 from public.reviews k
      where k.business_id = p_keep_id and k.user_id = r.user_id
    );
  get diagnostics reviews_moved = row_count;

  update public.review_replies
  set business_id = p_keep_id
  where business_id = p_drop_id;
  get diagnostics replies_moved = row_count;

  update public.listings
  set publisher_business_id = p_keep_id, updated_at = now()
  where publisher_business_id = p_drop_id;
  get diagnostics listings_moved = row_count;

  -- Fill empty keep fields from drop.
  update public.businesses k
  set
    phone = coalesce(nullif(btrim(k.phone), ''), drop_row.phone),
    website = coalesce(nullif(btrim(k.website), ''), drop_row.website),
    city = coalesce(nullif(btrim(k.city), ''), drop_row.city),
    region = coalesce(nullif(btrim(k.region), ''), drop_row.region),
    state_code = coalesce(nullif(btrim(k.state_code), ''), drop_row.state_code),
    address_line = coalesce(nullif(btrim(k.address_line), ''), drop_row.address_line),
    latitude = coalesce(k.latitude, drop_row.latitude),
    longitude = coalesce(k.longitude, drop_row.longitude),
    image_url = coalesce(nullif(btrim(k.image_url), ''), drop_row.image_url),
    category_id = coalesce(k.category_id, drop_row.category_id),
    short_description = case
      when nullif(btrim(k.short_description), '') is null then drop_row.short_description
      else k.short_description
    end,
    description = case
      when nullif(btrim(k.description), '') is null then drop_row.description
      else k.description
    end,
    updated_at = now()
  where k.id = p_keep_id;

  update public.businesses
  set status = 'archived', updated_at = now()
  where id = p_drop_id;

  v_summary := jsonb_build_object(
    'keep_id', p_keep_id,
    'drop_id', p_drop_id,
    'offers_moved', offers_moved,
    'owners_moved', owners_moved,
    'claims_moved', claims_moved,
    'reviews_moved', reviews_moved,
    'replies_moved', replies_moved,
    'listings_moved', listings_moved
  );

  -- Persist the merge summary as a domain event (closes V-15: merge had no audit).
  perform public.emit_domain_event(
    'business.merged', 'business', p_keep_id, v_summary
  );

  return v_summary;
end;
$$;

-- ============ 9. Scheduler-ready maintenance entry point ============
-- Single function any external cron can call; add future sweeps HERE, not as
-- new entry points. Currently: expire stale review-verification sessions (V-9).
create or replace function public.run_scheduled_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expired integer;
  v_result jsonb;
begin
  v_expired := public.expire_stale_verifications();
  v_result := jsonb_build_object('expired_verifications', v_expired);
  perform public.emit_domain_event('maintenance.completed', null, null, v_result);
  return v_result;
end;
$$;
revoke all on function public.run_scheduled_maintenance() from public, anon, authenticated;
grant execute on function public.run_scheduled_maintenance() to service_role;

-- ============ 10. expire_stale_verifications: allow server-side context ============
-- (auth.uid() is null — service_role / security-definer callers like
-- run_scheduled_maintenance). Anon has no execute grant, authenticated
-- non-admins are still rejected, so this only opens the scheduler path.
create or replace function public.expire_stale_verifications()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  n integer := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  perform private.enable_trusted_review_write();

  update public.review_verification_sessions s
  set status = 'expired', updated_at = now()
  where s.status in ('pending', 'in_progress')
    and s.expires_at <= now();

  get diagnostics n = row_count;

  update public.reviews r
  set moderation_status = 'expired', updated_at = now()
  from public.review_verification_sessions s
  where s.review_id = r.id
    and s.status = 'expired'
    and r.moderation_status in ('verification_pending', 'verification_in_progress');

  update public.review_verification_reminders rem
  set status = 'cancelled'
  from public.review_verification_sessions s
  where rem.session_id = s.id
    and s.status = 'expired'
    and rem.status = 'pending';

  perform private.disable_trusted_review_write();
  return n;
exception
  when others then
    perform private.disable_trusted_review_write();
    raise;
end;
$$;
grant execute on function public.expire_stale_verifications() to service_role;
