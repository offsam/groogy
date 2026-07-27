-- Enrich an existing published business from an import-review queue item,
-- then mark the queue item as handled (approved → existing entity).
-- service_role only.

create or replace function public.service_enrich_business_from_queue(
  p_item_id uuid,
  p_business_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item public.import_review_items%rowtype;
  v_biz public.businesses%rowtype;
  v_prev public.import_review_status;
  v_phone text;
  v_email text;
  v_website text;
  v_ig text;
  v_ig_url text;
  v_city text;
  v_state text;
  v_desc text;
  v_short text;
  v_image text;
  v_cat_id uuid;
  v_filled text[] := '{}';
  v_note text;
begin
  select * into v_item from public.import_review_items where id = p_item_id for update;
  if not found then
    raise exception 'import review item not found' using errcode = 'P0001';
  end if;

  if v_item.review_status = 'approved'
     and v_item.published_entity_id is not null
     and v_item.published_entity_id = p_business_id then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'business_id', p_business_id,
      'item_id', p_item_id,
      'filled', '[]'::jsonb
    );
  end if;

  if v_item.review_status in ('approved', 'rejected', 'duplicate')
     and v_item.published_entity_id is not null
     and v_item.published_entity_id is distinct from p_business_id then
    raise exception 'item already linked to another entity' using errcode = 'P0001';
  end if;

  select * into v_biz from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'business not found' using errcode = 'P0001';
  end if;
  if v_biz.status = 'archived' then
    raise exception 'business is archived' using errcode = 'P0001';
  end if;

  -- Prefer first usable contact values from the queue item.
  v_phone := nullif(btrim(coalesce(v_item.phone[1], '')), '');
  v_email := nullif(lower(btrim(coalesce(v_item.email[1], ''))), '');

  v_website := null;
  if v_item.website is not null then
    select nullif(btrim(w), '') into v_website
    from unnest(v_item.website) as w
    where nullif(btrim(w), '') is not null
      and w !~* 'instagram\.com|facebook\.com|fb\.com|t\.me|wa\.me'
    limit 1;
  end if;

  v_ig := null;
  if v_item.instagram is not null then
    select lower(regexp_replace(btrim(ig), '^@+', '')) into v_ig
    from unnest(v_item.instagram) as ig
    where nullif(btrim(ig), '') is not null
      and lower(btrim(ig)) !~* '^(gmail\.com|yahoo\.com|mail\.com|whatsapp)$'
    limit 1;
  end if;
  if v_ig is not null and v_ig ~ '^[a-z0-9._]{1,30}$' then
    v_ig_url := 'https://www.instagram.com/' || v_ig;
  else
    v_ig_url := null;
  end if;

  v_city := nullif(btrim(coalesce(v_item.city, '')), '');
  v_state := nullif(btrim(coalesce(v_item.state, '')), '');
  v_desc := nullif(btrim(coalesce(v_item.description, v_item.source_text, '')), '');
  v_short := case
    when v_desc is null then null
    else left(v_desc, 240)
  end;
  v_image := nullif(btrim(coalesce(v_item.preview_image_url, '')), '');

  if v_item.category is not null and nullif(btrim(v_item.category), '') is not null then
    select c.id into v_cat_id
    from public.categories c
    where c.is_active = true
      and (
        lower(c.slug) = lower(btrim(v_item.category))
        or lower(c.name) = lower(btrim(v_item.category))
      )
    limit 1;
  end if;

  -- Track which empty fields we fill (never overwrite non-empty).
  if nullif(btrim(coalesce(v_biz.phone, '')), '') is null and v_phone is not null then
    v_filled := array_append(v_filled, 'phone');
  end if;
  if nullif(btrim(coalesce(v_biz.email, '')), '') is null and v_email is not null then
    v_filled := array_append(v_filled, 'email');
  end if;
  if nullif(btrim(coalesce(v_biz.website, '')), '') is null and v_website is not null then
    v_filled := array_append(v_filled, 'website');
  end if;
  if nullif(btrim(coalesce(v_biz.instagram_url, '')), '') is null and v_ig_url is not null then
    v_filled := array_append(v_filled, 'instagram_url');
  end if;
  if nullif(btrim(coalesce(v_biz.city, '')), '') is null and v_city is not null then
    v_filled := array_append(v_filled, 'city');
  end if;
  if nullif(btrim(coalesce(v_biz.state_code, '')), '') is null and v_state is not null then
    v_filled := array_append(v_filled, 'state_code');
  end if;
  if nullif(btrim(coalesce(v_biz.short_description, '')), '') is null and v_short is not null then
    v_filled := array_append(v_filled, 'short_description');
  end if;
  if nullif(btrim(coalesce(v_biz.description, '')), '') is null and v_desc is not null then
    v_filled := array_append(v_filled, 'description');
  end if;
  if nullif(btrim(coalesce(v_biz.image_url, '')), '') is null and v_image is not null then
    v_filled := array_append(v_filled, 'image_url');
  end if;
  if v_biz.category_id is null and v_cat_id is not null then
    v_filled := array_append(v_filled, 'category_id');
  end if;

  update public.businesses b
  set
    phone = case
      when nullif(btrim(coalesce(b.phone, '')), '') is null then v_phone
      else b.phone
    end,
    email = case
      when nullif(btrim(coalesce(b.email, '')), '') is null then v_email
      else b.email
    end,
    website = case
      when nullif(btrim(coalesce(b.website, '')), '') is null then v_website
      else b.website
    end,
    instagram_url = case
      when nullif(btrim(coalesce(b.instagram_url, '')), '') is null then v_ig_url
      else b.instagram_url
    end,
    city = case
      when nullif(btrim(coalesce(b.city, '')), '') is null then v_city
      else b.city
    end,
    state_code = case
      when nullif(btrim(coalesce(b.state_code, '')), '') is null then v_state
      else b.state_code
    end,
    short_description = case
      when nullif(btrim(coalesce(b.short_description, '')), '') is null then v_short
      else b.short_description
    end,
    description = case
      when nullif(btrim(coalesce(b.description, '')), '') is null then v_desc
      else b.description
    end,
    image_url = case
      when nullif(btrim(coalesce(b.image_url, '')), '') is null then v_image
      else b.image_url
    end,
    category_id = coalesce(b.category_id, v_cat_id),
    updated_at = now()
  where b.id = p_business_id;

  v_prev := v_item.review_status;
  v_note := coalesce(
    nullif(btrim(coalesce(p_note, '')), ''),
    'Авто-merge в существующий бизнес'
      || case
           when cardinality(v_filled) > 0 then
             ': добавлено ' || array_to_string(v_filled, ', ')
           else
             ' (новых полей не было)'
         end
  );

  update public.import_review_items set
    review_status = 'approved',
    published_entity_type = 'business',
    published_entity_id = p_business_id,
    duplicate_of_entity_type = 'business',
    duplicate_of_entity_id = p_business_id,
    duplicate_status = 'existing_business',
    published_at = coalesce(published_at, now()),
    approved_at = coalesce(approved_at, now()),
    review_notes = left(
      coalesce(nullif(btrim(review_notes), '') || E'\n', '') || v_note,
      4000
    ),
    reviewed_at = now(),
    reviewed_by = null
  where id = p_item_id;

  insert into public.import_review_audit (
    item_id, admin_id, action, previous_status, new_status,
    changed_fields, created_entity_type, created_entity_id, note
  ) values (
    p_item_id, null, 'enriched_existing', v_prev, 'approved',
    jsonb_build_object(
      'enrich', true,
      'filled', to_jsonb(v_filled),
      'business_id', p_business_id
    ),
    'business', p_business_id, v_note
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'business_id', p_business_id,
    'item_id', p_item_id,
    'business_name', v_biz.name,
    'filled', to_jsonb(v_filled)
  );
end;
$$;

revoke all on function public.service_enrich_business_from_queue(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_enrich_business_from_queue(uuid, uuid, text)
  to service_role;
