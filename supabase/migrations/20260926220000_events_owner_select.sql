-- Owner can read own events (incl. draft/archived) for «Мои события».
drop policy if exists "events owner select" on public.events;
create policy "events owner select"
  on public.events for select
  to authenticated
  using (owner_profile_id = (select auth.uid()));
