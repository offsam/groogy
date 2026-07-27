-- Media Pipeline v1: provenance table + service-role attach paths.
-- Display still uses businesses.image_url and listing_media (existing UI).

create type public.media_entity_type as enum ('business', 'listing');

create type public.media_source_type as enum (
  'telegram_post',
  'instagram_profile',
  'website_og',
  'website_logo',
  'favicon',
  'category_default',
  'manual'
);

create type public.media_asset_status as enum ('pending', 'active', 'rejected');

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  entity_type public.media_entity_type not null,
  entity_id uuid not null,
  storage_bucket text,
  storage_path text,
  public_url text,
  source_type public.media_source_type not null,
  source_url text,
  mime_type text,
  width integer,
  height integer,
  file_size integer,
  sha256 text,
  is_primary boolean not null default false,
  status public.media_asset_status not null default 'pending',
  import_review_item_id uuid references public.import_review_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_assets_dims_chk check (
    (width is null or width > 0)
    and (height is null or height > 0)
  ),
  constraint media_assets_size_chk check (file_size is null or file_size >= 0)
);

create index media_assets_entity_idx
  on public.media_assets (entity_type, entity_id, is_primary desc, created_at desc);

create index media_assets_sha256_idx
  on public.media_assets (sha256)
  where sha256 is not null;

create unique index media_assets_primary_unique_idx
  on public.media_assets (entity_type, entity_id)
  where is_primary and status = 'active';

create unique index media_assets_entity_sha_unique_idx
  on public.media_assets (entity_type, entity_id, sha256)
  where sha256 is not null and status = 'active';

alter table public.media_assets enable row level security;
alter table public.media_assets force row level security;

create policy "media_assets public read active"
  on public.media_assets for select
  to anon, authenticated
  using (status = 'active');

create policy "media_assets admin all"
  on public.media_assets for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "media_assets service_role all"
  on public.media_assets for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.media_assets from anon, authenticated;
grant select on table public.media_assets to anon, authenticated;
grant select, insert, update, delete on table public.media_assets to authenticated;
grant all on table public.media_assets to service_role;

-- Service role needs table grants for listing media attach.
grant select, insert, update, delete on table public.listing_media to service_role;

create policy "service_role listing_media all"
  on public.listing_media for all
  to service_role
  using (true)
  with check (true);

-- Attach listing media under trusted write (path + ownership enforce still runs).
create or replace function public.service_attach_listing_media(
  p_listing_id uuid,
  p_storage_path text,
  p_sort_order integer default 0,
  p_width integer default null,
  p_height integer default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_id uuid;
begin
  if p_listing_id is null or p_storage_path is null or btrim(p_storage_path) = '' then
    raise exception 'listing_id and storage_path required' using errcode = 'P0001';
  end if;

  perform private.enable_trusted_listing_write();
  begin
    insert into public.listing_media (
      listing_id, storage_path, media_type, sort_order, width, height
    ) values (
      p_listing_id, p_storage_path, 'image', coalesce(p_sort_order, 0), p_width, p_height
    )
    returning id into v_id;
    perform private.disable_trusted_listing_write();
  exception
    when others then
      perform private.disable_trusted_listing_write();
      raise;
  end;

  return v_id;
end;
$$;

revoke all on function public.service_attach_listing_media(uuid, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.service_attach_listing_media(uuid, text, integer, integer, integer)
  to service_role;

-- Allow pipeline uploads under business/{id}/ in public business-images bucket.
drop policy if exists "business pipeline public read" on storage.objects;
create policy "business pipeline public read"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'business-images'
    and (storage.foldername(name))[1] = 'business'
  );

-- Mark auto-imported primary on businesses without clobbering manual covers.
create or replace function public.service_set_business_auto_image(
  p_business_id uuid,
  p_image_url text,
  p_only_if_empty boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated int;
begin
  if p_business_id is null or p_image_url is null or btrim(p_image_url) = '' then
    raise exception 'business_id and image_url required' using errcode = 'P0001';
  end if;

  update public.businesses
  set
    image_url = p_image_url,
    updated_at = now()
  where id = p_business_id
    and (
      not p_only_if_empty
      or image_url is null
      or btrim(image_url) = ''
      or image_url like '%/placeholder.svg'
      or image_url like '%/images/categories/%'
    );

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.service_set_business_auto_image(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.service_set_business_auto_image(uuid, text, boolean)
  to service_role;
