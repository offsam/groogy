-- Allow authenticated users to create/manage their own events.

drop policy if exists "events owner insert" on public.events;
create policy "events owner insert"
  on public.events for insert
  to authenticated
  with check (
    owner_profile_id = (select auth.uid())
    or public.is_admin()
  );

drop policy if exists "events owner update" on public.events;
create policy "events owner update"
  on public.events for update
  to authenticated
  using (
    owner_profile_id = (select auth.uid())
    or public.is_admin()
  )
  with check (
    owner_profile_id = (select auth.uid())
    or public.is_admin()
  );

drop policy if exists "events owner delete" on public.events;
create policy "events owner delete"
  on public.events for delete
  to authenticated
  using (
    owner_profile_id = (select auth.uid())
    or public.is_admin()
  );
