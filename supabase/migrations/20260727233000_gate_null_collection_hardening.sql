-- A1 (ARCHITECTURE_ALIGNMENT_ROADMAP): G3 must not be silent on untyped rows.
-- Previously a NULL target_collection fell through every branch and returned {}.
-- Adds one G2-backstop branch at the top of the gate; everything else unchanged.
-- Applied to live DB as gate_null_collection_hardening (2026-07-27).
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
  -- G2 backstop: an untyped card is never publishable (CARD_PROCESSING F4/F6).
  if v.target_collection is null or v.entity_type is null then
    return array['entity_type/target_collection не заданы — карточка не классифицирована'];
  end if;

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
