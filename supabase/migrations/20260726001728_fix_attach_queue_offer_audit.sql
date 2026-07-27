-- Fix audit insert columns in service_attach_queue_item_as_business_offer
-- (import_review_audit uses admin_id / changed_fields, not actor_id / meta).

create or replace function public.service_attach_queue_item_as_business_offer(
  p_item_id uuid,
  p_business_id uuid,
  p_offer_type public.business_offer_type default 'other',
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
  v_title text;
  v_slug text;
  v_desc text;
  v_offer_id uuid;
  v_base text;
  v_n int := 0;
begin
  if p_item_id is null or p_business_id is null then
    raise exception 'item_id and business_id required' using errcode = 'P0001';
  end if;

  select * into v_item from public.import_review_items where id = p_item_id for update;
  if not found then
    raise exception 'queue item not found' using errcode = 'P0001';
  end if;

  if v_item.review_status = 'approved' and v_item.published_entity_id is not null then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'item_id', v_item.id,
      'business_id', p_business_id,
      'offer_id', v_item.published_entity_id
    );
  end if;

  if v_item.review_status not in (
    'pending', 'in_review', 'needs_more_info', 'ready_to_publish'
  ) then
    raise exception 'item not open for attach' using errcode = 'P0001';
  end if;

  select * into v_biz from public.businesses where id = p_business_id;
  if not found then
    raise exception 'business not found' using errcode = 'P0001';
  end if;
  if v_biz.status is distinct from 'approved'
     and v_biz.status::text not in ('pending', 'deferred') then
    raise exception 'business not attachable' using errcode = 'P0001';
  end if;

  v_title := nullif(btrim(coalesce(v_item.title, v_item.business_name, v_item.person_name, '')), '');
  if v_title is null or char_length(v_title) < 2 then
    v_title := 'Предложение';
  end if;
  v_title := left(v_title, 160);

  v_desc := nullif(btrim(coalesce(v_item.description, v_item.source_text, '')), '');
  if v_desc is not null then
    v_desc := left(v_desc, 8000);
  end if;

  v_base := lower(regexp_replace(
    translate(
      v_title,
      'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
      'abvgdeejzijklmnoprstufhccss y euaABVGDEEJZIJKLMNOPRSTUFHCCSS Y EUA'
    ),
    '[^a-z0-9]+', '-', 'g'
  ));
  v_base := trim(both '-' from v_base);
  if v_base is null or v_base = '' or v_base !~ '[a-z0-9]' then
    v_base := 'offer';
  end if;
  v_base := left(v_base, 50);

  loop
    v_slug := v_base || '-' || to_char(clock_timestamp(), 'HH24MISSMS');
    if v_n > 0 then
      v_slug := v_slug || '-' || v_n::text;
    end if;
    exit when not exists (
      select 1 from public.business_offers
      where business_id = p_business_id and slug = v_slug
    );
    v_n := v_n + 1;
    if v_n > 20 then
      raise exception 'could not allocate offer slug' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.business_offers (
    business_id,
    offer_type,
    title,
    slug,
    short_description,
    description,
    status,
    visibility,
    price_mode,
    currency,
    attributes,
    published_at,
    is_available,
    primary_image_url
  ) values (
    p_business_id,
    coalesce(p_offer_type, 'other'),
    v_title,
    v_slug,
    left(coalesce(v_desc, v_title), 300),
    v_desc,
    'active',
    'public',
    'contact',
    'USD',
    '{}'::jsonb,
    coalesce(v_item.source_posted_at, now()),
    true,
    nullif(btrim(coalesce(v_item.preview_image_url, '')), '')
  )
  returning id into v_offer_id;

  update public.import_review_items
  set
    review_status = 'approved',
    published_entity_type = 'business_offer',
    published_entity_id = v_offer_id,
    reviewed_at = now(),
    updated_at = now()
  where id = p_item_id;

  insert into public.import_review_audit (
    item_id, admin_id, action, previous_status, new_status,
    changed_fields, created_entity_type, created_entity_id, note
  ) values (
    p_item_id,
    null,
    'autopublish',
    v_item.review_status,
    'approved',
    jsonb_build_object(
      'attach_offer', true,
      'business_id', p_business_id,
      'offer_id', v_offer_id,
      'offer_type', coalesce(p_offer_type, 'other')
    ),
    'business_offer',
    v_offer_id,
    coalesce(p_note, 'Событие/предложение привязано к бизнесу')
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'item_id', p_item_id,
    'business_id', p_business_id,
    'offer_id', v_offer_id
  );
end;
$$;

revoke all on function public.service_attach_queue_item_as_business_offer(
  uuid, uuid, public.business_offer_type, text
) from public, anon, authenticated;
grant execute on function public.service_attach_queue_item_as_business_offer(
  uuid, uuid, public.business_offer_type, text
) to service_role;
