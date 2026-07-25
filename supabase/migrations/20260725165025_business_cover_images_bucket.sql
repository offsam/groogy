-- Public bucket for business cover photos (stable public URLs in businesses.image_url).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-images',
  'business-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.business_cover_storage_object_owned(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    (storage.foldername(p_name))[1] = 'covers'
    and public.owns_business(nullif((storage.foldername(p_name))[2], '')::uuid);
$$;

revoke all on function public.business_cover_storage_object_owned(text) from public, anon;
grant execute on function public.business_cover_storage_object_owned(text) to authenticated;

drop policy if exists "business covers public read" on storage.objects;
create policy "business covers public read"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'business-images'
    and (storage.foldername(name))[1] = 'covers'
  );

drop policy if exists "business covers owner insert" on storage.objects;
create policy "business covers owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'business-images'
    and public.business_cover_storage_object_owned(name)
    and name not like '%..%'
  );

drop policy if exists "business covers owner update" on storage.objects;
create policy "business covers owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'business-images'
    and public.business_cover_storage_object_owned(name)
  )
  with check (
    bucket_id = 'business-images'
    and public.business_cover_storage_object_owned(name)
    and name not like '%..%'
  );

drop policy if exists "business covers owner delete" on storage.objects;
create policy "business covers owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'business-images'
    and public.business_cover_storage_object_owned(name)
  );
