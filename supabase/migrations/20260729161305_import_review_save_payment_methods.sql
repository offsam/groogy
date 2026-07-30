-- Allow admin queue edits and enrich patches to persist payment_methods.

create or replace function public.admin_import_review_save_fields(
  p_item_id uuid,
  p_fields jsonb
)
returns public.import_review_items
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.import_review_items;
  v_prev public.import_review_status;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select * into v_row from public.import_review_items where id = p_item_id for update;
  if not found then
    raise exception 'import review item not found' using errcode = 'P0001';
  end if;
  if v_row.review_status = 'approved' then
    raise exception 'cannot edit approved item' using errcode = 'P0001';
  end if;

  v_prev := v_row.review_status;

  update public.import_review_items set
    entity_type = case when p_fields ? 'entity_type'
      then nullif(p_fields->>'entity_type', '')::public.import_review_entity_type
      else entity_type end,
    target_collection = case when p_fields ? 'target_collection'
      then nullif(p_fields->>'target_collection', '')::public.import_review_target_collection
      else target_collection end,
    category = case when p_fields ? 'category' then nullif(p_fields->>'category', '') else category end,
    subcategory = case when p_fields ? 'subcategory' then nullif(p_fields->>'subcategory', '') else subcategory end,
    title = case when p_fields ? 'title' then nullif(p_fields->>'title', '') else title end,
    business_name = case when p_fields ? 'business_name' then nullif(p_fields->>'business_name', '') else business_name end,
    person_name = case when p_fields ? 'person_name' then nullif(p_fields->>'person_name', '') else person_name end,
    description = case when p_fields ? 'description' then nullif(p_fields->>'description', '') else description end,
    services = case when p_fields ? 'services'
      then coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'services') as t(x)), '{}')
      else services end,
    payment_methods = case when p_fields ? 'payment_methods'
      then coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'payment_methods') as t(x)), '{}')
      else payment_methods end,
    price = case when p_fields ? 'price'
      then nullif(p_fields->>'price', '')::numeric
      else price end,
    currency = case when p_fields ? 'currency' then nullif(p_fields->>'currency', '') else currency end,
    city = case when p_fields ? 'city' then nullif(p_fields->>'city', '') else city end,
    state = case when p_fields ? 'state' then nullif(p_fields->>'state', '') else state end,
    phone = case when p_fields ? 'phone'
      then coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'phone') as t(x)), '{}')
      else phone end,
    whatsapp = case when p_fields ? 'whatsapp'
      then coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'whatsapp') as t(x)), '{}')
      else whatsapp end,
    telegram_username = case when p_fields ? 'telegram_username' then nullif(p_fields->>'telegram_username', '') else telegram_username end,
    telegram_user_id = case when p_fields ? 'telegram_user_id' then nullif(p_fields->>'telegram_user_id', '') else telegram_user_id end,
    instagram = case when p_fields ? 'instagram'
      then coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'instagram') as t(x)), '{}')
      else instagram end,
    website = case when p_fields ? 'website'
      then coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'website') as t(x)), '{}')
      else website end,
    email = case when p_fields ? 'email'
      then coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'email') as t(x)), '{}')
      else email end,
    review_notes = case when p_fields ? 'review_notes' then nullif(p_fields->>'review_notes', '') else review_notes end,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_item_id
  returning * into v_row;

  perform public.admin_import_review_write_audit(
    p_item_id, 'edited', v_prev, v_row.review_status, p_fields, null, null, null
  );

  return v_row;
end;
$$;

notify pgrst, 'reload schema';
