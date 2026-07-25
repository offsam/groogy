-- Add ready_to_publish status for accepted cards waiting for (auto)publish.

alter type public.import_review_status add value if not exists 'ready_to_publish';

-- Allow service_role to insert audit rows for system autopublish (admin_id may be null).
grant insert on table public.import_review_audit to service_role;

-- System autopublish marker helper (idempotent mark approved after entity created by script).
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
begin
  -- Invoked with service_role only (no auth.uid required).
  select * into v_row from public.import_review_items where id = p_item_id for update;
  if not found then
    raise exception 'import review item not found' using errcode = 'P0001';
  end if;

  if v_row.review_status = 'approved' and v_row.published_entity_id is not null then
    return v_row;
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

  return v_row;
end;
$$;

revoke all on function public.service_import_review_mark_autopublished(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_import_review_mark_autopublished(uuid, text, uuid, text)
  to service_role;
