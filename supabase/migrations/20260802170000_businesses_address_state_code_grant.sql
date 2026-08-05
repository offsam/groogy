-- Address inline edit always patches state_code. A later revoke+regrant
-- list omitted it, so saves fail with "permission denied for table businesses".
-- Admins can edit any card in the UI but only owners had UPDATE RLS.

grant update (state_code) on public.businesses to authenticated;

drop policy if exists "admins can update all businesses" on public.businesses;
create policy "admins can update all businesses"
  on public.businesses
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
