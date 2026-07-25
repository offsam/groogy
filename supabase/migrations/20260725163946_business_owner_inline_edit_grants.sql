-- Allow owners (and admins via owns_business) to patch profile fields used by inline edit.
drop policy if exists "owners can update own businesses" on public.businesses;
create policy "owners can update own businesses"
  on public.businesses
  for update
  to authenticated
  using (public.owns_business(id))
  with check (public.owns_business(id));

drop policy if exists "owners can read own businesses" on public.businesses;
create policy "owners can read own businesses"
  on public.businesses
  for select
  to authenticated
  using (public.owns_business(id));

revoke update on public.businesses from anon, authenticated;
grant update (
  name,
  short_description,
  description,
  phone,
  email,
  website,
  image_url,
  address_line,
  city,
  region,
  latitude,
  longitude,
  category_id,
  instagram_url,
  yelp_url,
  google_maps_url,
  opening_hours
) on public.businesses to authenticated;
