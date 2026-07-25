-- Import review queue for Telegram (and future) AI imports.
-- Holds needs_review items until an admin approves into working tables.
-- Does NOT write into businesses/listings until approve.

create type public.import_review_status as enum (
  'pending',
  'in_review',
  'approved',
  'rejected',
  'duplicate',
  'needs_more_info'
);

create type public.import_review_target_collection as enum (
  'businesses',
  'private_specialists',
  'services',
  'marketplace',
  'jobs',
  'events',
  'organizations',
  'real_estate'
);

create type public.import_review_entity_type as enum (
  'business',
  'private_specialist',
  'marketplace_listing',
  'organization',
  'event',
  'job',
  'real_estate'
);

create table public.import_review_items (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'telegram',
  source_group text,
  source_chat_id text,
  source_message_ids bigint[] not null default '{}',
  source_fingerprint text not null,
  source_author_id text,
  source_author_username text,
  source_author_display_name text,
  source_posted_at timestamptz,
  source_text text,
  source_url text,
  source_media jsonb not null default '[]'::jsonb,
  ai_decision text,
  ai_confidence numeric(4,3),
  ai_reason text,
  entity_type public.import_review_entity_type,
  target_collection public.import_review_target_collection,
  category text,
  subcategory text,
  title text,
  business_name text,
  person_name text,
  description text,
  services text[] not null default '{}',
  price numeric(12,2),
  currency text,
  city text,
  state text,
  phone text[] not null default '{}',
  whatsapp text[] not null default '{}',
  telegram_username text,
  telegram_user_id text,
  instagram text[] not null default '{}',
  website text[] not null default '{}',
  email text[] not null default '{}',
  photos_count integer not null default 0,
  duplicate_status text,
  recurring_cluster_id text,
  occurrence_count integer,
  first_seen timestamptz,
  last_seen timestamptz,
  raw_payload jsonb not null,
  review_status public.import_review_status not null default 'pending',
  review_notes text,
  reject_reason text,
  duplicate_of_item_id uuid references public.import_review_items(id) on delete set null,
  duplicate_of_entity_type text,
  duplicate_of_entity_id uuid,
  published_entity_type text,
  published_entity_id uuid,
  published_at timestamptz,
  last_renewed_at timestamptz,
  expires_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_review_items_source_fingerprint_unique unique (source_fingerprint),
  constraint import_review_items_photos_count_nonneg check (photos_count >= 0)
);

create index import_review_items_status_idx
  on public.import_review_items (review_status, created_at desc);
create index import_review_items_target_idx
  on public.import_review_items (target_collection, review_status);
create index import_review_items_entity_idx
  on public.import_review_items (entity_type, review_status);
create index import_review_items_posted_idx
  on public.import_review_items (source_posted_at desc nulls last);
create index import_review_items_city_idx
  on public.import_review_items (city);
create index import_review_items_tg_uid_idx
  on public.import_review_items (telegram_user_id);
create index import_review_items_recurring_idx
  on public.import_review_items (recurring_cluster_id);

create table public.import_review_audit (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.import_review_items(id) on delete cascade,
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null,
  previous_status public.import_review_status,
  new_status public.import_review_status,
  changed_fields jsonb not null default '{}'::jsonb,
  created_entity_type text,
  created_entity_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index import_review_audit_item_idx
  on public.import_review_audit (item_id, created_at desc);

alter table public.import_review_items enable row level security;
alter table public.import_review_items force row level security;
alter table public.import_review_audit enable row level security;
alter table public.import_review_audit force row level security;

-- Admins only: no public/anon access to queue or raw_payload.
create policy "admins can select import_review_items"
  on public.import_review_items for select to authenticated
  using (public.is_admin());

create policy "admins can update import_review_items"
  on public.import_review_items for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No direct insert/delete for authenticated — import uses service_role; deletes via RPC if needed.
create policy "admins can select import_review_audit"
  on public.import_review_audit for select to authenticated
  using (public.is_admin());

revoke all on table public.import_review_items from public, anon;
revoke all on table public.import_review_audit from public, anon;
grant select, update on table public.import_review_items to authenticated;
grant select on table public.import_review_audit to authenticated;
-- service_role bypasses RLS by default in Supabase

create or replace function public.touch_import_review_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger import_review_items_touch_updated_at
  before update on public.import_review_items
  for each row execute function public.touch_import_review_updated_at();

-- Protect raw_payload from being wiped/changed by admins via direct update.
create or replace function public.protect_import_review_raw_payload()
returns trigger
language plpgsql
as $$
begin
  if new.raw_payload is distinct from old.raw_payload then
    raise exception 'raw_payload is immutable' using errcode = 'P0001';
  end if;
  if new.source_fingerprint is distinct from old.source_fingerprint then
    raise exception 'source_fingerprint is immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger import_review_items_protect_raw
  before update on public.import_review_items
  for each row execute function public.protect_import_review_raw_payload();

create or replace function public.admin_import_review_write_audit(
  p_item_id uuid,
  p_action text,
  p_previous_status public.import_review_status,
  p_new_status public.import_review_status,
  p_changed_fields jsonb default '{}'::jsonb,
  p_created_entity_type text default null,
  p_created_entity_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  insert into public.import_review_audit (
    item_id, admin_id, action, previous_status, new_status,
    changed_fields, created_entity_type, created_entity_id, note
  ) values (
    p_item_id, auth.uid(), p_action, p_previous_status, p_new_status,
    coalesce(p_changed_fields, '{}'::jsonb),
    p_created_entity_type, p_created_entity_id, p_note
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_import_review_write_audit(
  uuid, text, public.import_review_status, public.import_review_status, jsonb, text, uuid, text
) from public, anon;
grant execute on function public.admin_import_review_write_audit(
  uuid, text, public.import_review_status, public.import_review_status, jsonb, text, uuid, text
) to authenticated;

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
    reject_reason = case when p_status = 'rejected' then nullif(btrim(p_reject_reason), '') else reject_reason end,
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

revoke all on function public.admin_import_review_set_status(
  uuid, public.import_review_status, text, text, uuid, text, uuid
) from public, anon;
grant execute on function public.admin_import_review_set_status(
  uuid, public.import_review_status, text, text, uuid, text, uuid
) to authenticated;

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

revoke all on function public.admin_import_review_save_fields(uuid, jsonb) from public, anon;
grant execute on function public.admin_import_review_save_fields(uuid, jsonb) to authenticated;

-- Mark approved after working-table insert (idempotent if already approved with same entity).
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

  return v_row;
end;
$$;

revoke all on function public.admin_import_review_mark_approved(uuid, text, uuid) from public, anon;
grant execute on function public.admin_import_review_mark_approved(uuid, text, uuid) to authenticated;

create or replace function public.admin_import_review_counts()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status jsonb;
  v_collection jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(review_status, cnt), '{}'::jsonb)
  into v_status
  from (
    select review_status::text, count(*)::int as cnt
    from public.import_review_items
    group by review_status
  ) s;

  select coalesce(jsonb_object_agg(coalesce(target_collection::text, 'null'), cnt), '{}'::jsonb)
  into v_collection
  from (
    select target_collection, count(*)::int as cnt
    from public.import_review_items
    group by target_collection
  ) c;

  return jsonb_build_object(
    'total', (select count(*)::int from public.import_review_items),
    'by_status', v_status,
    'by_collection', v_collection
  );
end;
$$;

revoke all on function public.admin_import_review_counts() from public, anon;
grant execute on function public.admin_import_review_counts() to authenticated;
