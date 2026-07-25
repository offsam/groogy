-- Hotfix: listing_media / details RLS must not require caller SELECT on listings.
-- Column-level listings grants (no owner_id for anon) broke EXISTS(... FROM listings)
-- inside invoker policies. Use SECURITY DEFINER visibility helpers instead.

create or replace function public.listing_row_visible(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.listings l
    where l.id = p_listing_id
      and (
        (l.status = 'active' and l.visibility in ('public', 'unlisted'))
        or (l.status = 'completed' and l.visibility = 'public')
        or l.owner_id = (select auth.uid())
        or public.is_admin()
      )
  );
$$;

revoke all on function public.listing_row_visible(uuid) from public;
grant execute on function public.listing_row_visible(uuid) to anon, authenticated;

create or replace function public.listing_owned_by_me(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.listings l
    where l.id = p_listing_id
      and l.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.listing_owned_by_me(uuid) from public;
grant execute on function public.listing_owned_by_me(uuid) to authenticated;

drop policy if exists "listing media readable with listing" on public.listing_media;
create policy "listing media readable with listing"
  on public.listing_media for select to anon, authenticated
  using (public.listing_row_visible(listing_id));

drop policy if exists "owners insert listing media" on public.listing_media;
create policy "owners insert listing media"
  on public.listing_media for insert to authenticated
  with check (public.listing_owned_by_me(listing_id));

drop policy if exists "owners update listing media" on public.listing_media;
create policy "owners update listing media"
  on public.listing_media for update to authenticated
  using (public.listing_owned_by_me(listing_id))
  with check (public.listing_owned_by_me(listing_id));

drop policy if exists "owners delete listing media" on public.listing_media;
create policy "owners delete listing media"
  on public.listing_media for delete to authenticated
  using (
    public.listing_owned_by_me(listing_id)
    or public.listing_storage_object_owned(storage_path)
  );

drop policy if exists "marketplace details readable with listing" on public.marketplace_listing_details;
create policy "marketplace details readable with listing"
  on public.marketplace_listing_details for select to anon, authenticated
  using (public.listing_row_visible(listing_id));

drop policy if exists "owners write marketplace details" on public.marketplace_listing_details;
create policy "owners write marketplace details"
  on public.marketplace_listing_details for insert to authenticated
  with check (public.listing_owned_by_me(listing_id));

drop policy if exists "owners update marketplace details" on public.marketplace_listing_details;
create policy "owners update marketplace details"
  on public.marketplace_listing_details for update to authenticated
  using (public.listing_owned_by_me(listing_id))
  with check (public.listing_owned_by_me(listing_id));

drop policy if exists "service details readable with listing" on public.service_listing_details;
create policy "service details readable with listing"
  on public.service_listing_details for select to anon, authenticated
  using (public.listing_row_visible(listing_id));

drop policy if exists "owners write service details" on public.service_listing_details;
create policy "owners write service details"
  on public.service_listing_details for insert to authenticated
  with check (public.listing_owned_by_me(listing_id));

drop policy if exists "owners update service details" on public.service_listing_details;
create policy "owners update service details"
  on public.service_listing_details for update to authenticated
  using (public.listing_owned_by_me(listing_id))
  with check (public.listing_owned_by_me(listing_id));
