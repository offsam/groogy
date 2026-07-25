-- Hotfix: allow trusted listing writes to cascade-delete listing_media
-- (elevated cleanup / admin paths without auth.uid()).

create or replace function public.listing_media_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  n int;
  owner uuid;
  lst_status listing_status;
  uid uuid := (select auth.uid());
  expected_prefix text;
begin
  if tg_op = 'DELETE' then
    if public.is_admin() or private.has_trusted_listing_write() then
      return old;
    end if;
    if uid is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;
    if old.storage_path not like ('listings/' || uid::text || '/%') then
      raise exception 'not listing owner' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    new.listing_id := old.listing_id;
  end if;

  select owner_id, status into owner, lst_status
  from public.listings where id = new.listing_id;
  if owner is null then
    raise exception 'listing not found' using errcode = 'P0001';
  end if;
  if not public.is_admin() and (uid is null or owner is distinct from uid)
     and not private.has_trusted_listing_write() then
    raise exception 'not listing owner' using errcode = '42501';
  end if;
  if not public.is_admin() and lst_status in ('removed', 'rejected') then
    raise exception 'cannot modify media on moderated listing' using errcode = 'P0001';
  end if;

  expected_prefix := 'listings/' || owner::text || '/' || new.listing_id::text || '/';
  if new.storage_path is null
     or position('..' in new.storage_path) > 0
     or new.storage_path not like (expected_prefix || '%')
     or char_length(new.storage_path) <= char_length(expected_prefix)
  then
    raise exception 'invalid storage path' using errcode = 'P0001';
  end if;

  select count(*) into n from public.listing_media where listing_id = new.listing_id;
  if tg_op = 'INSERT' and n >= 10 then
    raise exception 'maximum 10 images per listing' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.listing_media_enforce() from public, anon, authenticated;
