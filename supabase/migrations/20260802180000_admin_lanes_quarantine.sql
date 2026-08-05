-- Soft quarantine lane («помойка»): dig / reclaim / destroy.
-- Not compacted by settled retention — keep until explicit destroy.

alter type public.import_review_status add value if not exists 'quarantine';

alter table public.import_comment_recommendations
  drop constraint if exists import_comment_recommendations_status_check;

alter table public.import_comment_recommendations
  add constraint import_comment_recommendations_status_check
  check (
    status in (
      'pending',
      'approved',
      'rejected',
      'merged',
      'suspected_duplicate',
      'quarantine'
    )
  );

-- Destroy from quarantine (admin only).
drop policy if exists "admins can delete import_review_items" on public.import_review_items;
create policy "admins can delete import_review_items"
  on public.import_review_items
  for delete
  to authenticated
  using (public.is_admin());

grant delete on table public.import_review_items to authenticated;

-- Allow admin status RPC to set quarantine / reclaim to pending.
create or replace function public.admin_import_review_set_status(
  p_item_id uuid,
  p_status public.import_review_status,
  p_notes text default null,
  p_reject_reason text default null,
  p_duplicate_of_item_id uuid default null,
  p_duplicate_of_entity_type text default null,
  p_duplicate_of_entity_id uuid default null
)
returns public.import_review_items
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.import_review_items;
  v_prev public.import_review_status;
  v_action text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select * into v_row from public.import_review_items where id = p_item_id for update;
  if not found then
    raise exception 'import review item not found' using errcode = 'P0001';
  end if;

  if v_row.review_status = 'approved' and p_status is distinct from 'approved' then
    raise exception 'cannot change status of approved item' using errcode = 'P0001';
  end if;

  if p_status = 'rejected' and (p_reject_reason is null or btrim(p_reject_reason) = '') then
    raise exception 'reject_reason required' using errcode = 'P0001';
  end if;

  if p_status = 'needs_more_info' and (p_notes is null or btrim(p_notes) = '') then
    raise exception 'notes required for needs_more_info' using errcode = 'P0001';
  end if;

  if p_status = 'duplicate' and p_duplicate_of_item_id is null and p_duplicate_of_entity_id is null then
    raise exception 'duplicate target required' using errcode = 'P0001';
  end if;

  v_prev := v_row.review_status;

  update public.import_review_items set
    review_status = p_status,
    review_notes = coalesce(nullif(btrim(p_notes), ''), review_notes),
    reject_reason = case
      when p_status = 'rejected' then nullif(btrim(p_reject_reason), '')
      when p_status = 'quarantine' then coalesce(nullif(btrim(p_reject_reason), ''), 'quarantine')
      when p_status = 'pending' then null
      else reject_reason
    end,
    duplicate_of_item_id = case when p_status = 'duplicate' then p_duplicate_of_item_id else duplicate_of_item_id end,
    duplicate_of_entity_type = case when p_status = 'duplicate' then p_duplicate_of_entity_type else duplicate_of_entity_type end,
    duplicate_of_entity_id = case when p_status = 'duplicate' then p_duplicate_of_entity_id else duplicate_of_entity_id end,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_item_id
  returning * into v_row;

  v_action := case p_status
    when 'in_review' then 'status_changed'
    when 'rejected' then 'rejected'
    when 'quarantine' then 'quarantined'
    when 'duplicate' then 'marked_duplicate'
    when 'needs_more_info' then 'needs_more_info'
    else 'status_changed'
  end;

  perform public.admin_import_review_write_audit(
    p_item_id, v_action, v_prev, p_status,
    jsonb_build_object('notes', p_notes, 'reject_reason', p_reject_reason),
    null, null, p_notes
  );

  return v_row;
end;
$$;
