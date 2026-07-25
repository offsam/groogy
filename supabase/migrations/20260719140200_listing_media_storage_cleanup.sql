-- Hotfix: cleanup storage.objects when listing_media rows are deleted
-- (including ON DELETE CASCADE from listings). Keeps bucket private.

create or replace function public.listing_media_cleanup_storage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
begin
  delete from storage.objects
  where bucket_id = 'listing-images'
    and name = old.storage_path;
  return old;
exception
  when others then
    -- Do not block media row deletion if storage object already gone
    return old;
end;
$$;

drop trigger if exists listing_media_cleanup_storage on public.listing_media;
create trigger listing_media_cleanup_storage
  after delete on public.listing_media
  for each row execute function public.listing_media_cleanup_storage();

revoke all on function public.listing_media_cleanup_storage() from public, anon, authenticated;
