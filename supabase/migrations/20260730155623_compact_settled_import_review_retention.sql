-- Retention: shrink settled import_review_items.raw_payload without breaking
-- admin flows. Pending / in_review / needs_more_info / ready_to_publish stay intact.
--
-- Safety:
-- - Only statuses approved | rejected | duplicate
-- - Keeps a slim professional_cleanup stub (no analysis/snapshot)
-- - source_fingerprint stays immutable
-- - Does not delete storage objects (handled in app/scripts after URL promote)

create or replace function public.protect_import_review_raw_payload()
returns trigger
language plpgsql
as $$
begin
  if new.raw_payload is distinct from old.raw_payload then
    -- Allow controlled compaction on settled rows (or explicit session flag).
    if current_setting('krugi.compact_import_payload', true) = 'on'
       or (
         new.review_status in ('approved', 'rejected', 'duplicate')
         and coalesce(new.raw_payload->>'_compacted', '') = 'true'
         and coalesce(old.raw_payload->>'_compacted', '') is distinct from 'true'
       )
    then
      null;
    else
      raise exception 'raw_payload is immutable' using errcode = 'P0001';
    end if;
  end if;
  if new.source_fingerprint is distinct from old.source_fingerprint then
    raise exception 'source_fingerprint is immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.import_review_build_compact_payload(p_raw jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_before int;
  v_slim jsonb;
begin
  v_before := octet_length(coalesce(p_raw, '{}'::jsonb)::text);
  v_slim := jsonb_build_object(
    '_compacted', true,
    '_compacted_at', to_jsonb(now() at time zone 'utc'),
    '_bytes_before', v_before
  );

  if coalesce(p_raw->>'origin', '') = 'professional_cleanup_phase2'
     and nullif(btrim(coalesce(p_raw->>'existing_professional_id', '')), '') is not null
  then
    v_slim := v_slim || jsonb_strip_nulls(
      jsonb_build_object(
        'origin', p_raw->'origin',
        'existing_professional_id', p_raw->'existing_professional_id',
        'existing_professional_slug', p_raw->'existing_professional_slug',
        'cleanup_reason', p_raw->'cleanup_reason',
        'suggested_entity_type', p_raw->'suggested_entity_type',
        'suggested_target_collection', p_raw->'suggested_target_collection',
        'confidence', p_raw->'confidence',
        'problems', p_raw->'problems'
      )
    );
  end if;

  return v_slim;
end;
$$;

-- BEFORE UPDATE: when a row is (or becomes) settled and payload is not compacted, shrink it.
create or replace function public.import_review_compact_payload_on_settle()
returns trigger
language plpgsql
as $$
begin
  if new.review_status in ('approved', 'rejected', 'duplicate')
     and coalesce(new.raw_payload->>'_compacted', '') is distinct from 'true'
  then
    new.raw_payload := public.import_review_build_compact_payload(new.raw_payload);
    -- Telegram download metadata is recoverable from source; drop after settle.
    if new.source_media is distinct from '[]'::jsonb then
      new.source_media := '[]'::jsonb;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists import_review_items_compact_on_settle on public.import_review_items;
create trigger import_review_items_compact_on_settle
  before update on public.import_review_items
  for each row
  execute function public.import_review_compact_payload_on_settle();

-- One-shot / batch backfill for rows already settled before this migration.
create or replace function public.admin_compact_settled_import_review_batch(
  p_limit int default 500
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 500), 2000));
  v_ids uuid[];
  v_updated int := 0;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select array_agg(id) into v_ids
  from (
    select id
    from public.import_review_items
    where review_status in ('approved', 'rejected', 'duplicate')
      and coalesce(raw_payload->>'_compacted', '') is distinct from 'true'
    order by updated_at asc nulls first, created_at asc
    limit v_limit
  ) s;

  if v_ids is null or cardinality(v_ids) = 0 then
    return jsonb_build_object('updated', 0, 'remaining', 0);
  end if;

  perform set_config('krugi.compact_import_payload', 'on', true);

  update public.import_review_items i
  set
    raw_payload = public.import_review_build_compact_payload(i.raw_payload),
    source_media = '[]'::jsonb,
    updated_at = now()
  where i.id = any (v_ids)
    and coalesce(i.raw_payload->>'_compacted', '') is distinct from 'true';

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'updated', v_updated,
    'remaining', (
      select count(*)::int
      from public.import_review_items
      where review_status in ('approved', 'rejected', 'duplicate')
        and coalesce(raw_payload->>'_compacted', '') is distinct from 'true'
    )
  );
end;
$$;

revoke all on function public.admin_compact_settled_import_review_batch(int)
  from public, anon, authenticated;
grant execute on function public.admin_compact_settled_import_review_batch(int)
  to authenticated, service_role;

comment on function public.admin_compact_settled_import_review_batch(int) is
  'Shrink raw_payload/source_media on settled import_review_items. Admin/service only.';
