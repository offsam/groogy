-- Allow admins to mark enrich runs as reverted (undo last enrich).

grant update on public.entity_enrich_runs to authenticated;

drop policy if exists "admins update entity_enrich_runs" on public.entity_enrich_runs;
create policy "admins update entity_enrich_runs"
  on public.entity_enrich_runs for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
