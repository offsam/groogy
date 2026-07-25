-- Allow service-role autopublish to insert listings despite FORCE RLS.
-- Existing insert policy requires auth.uid() = owner_id, which service_role lacks.

create policy "service_role insert listings"
  on public.listings
  for insert
  to service_role
  with check (true);

create policy "service_role update listings"
  on public.listings
  for update
  to service_role
  using (true)
  with check (true);

create policy "service_role select listings"
  on public.listings
  for select
  to service_role
  using (true);

create policy "service_role insert marketplace_listing_details"
  on public.marketplace_listing_details
  for insert
  to service_role
  with check (true);

create policy "service_role select marketplace_listing_details"
  on public.marketplace_listing_details
  for select
  to service_role
  using (true);
