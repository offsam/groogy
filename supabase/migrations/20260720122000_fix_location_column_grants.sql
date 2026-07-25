-- Hotfix: column-level grants for Master Data location refs.
-- Adding state_code / city_geoid via ALTER TABLE did not extend prior
-- column grants; PostgREST INSERT/UPDATE including those columns failed with 42501.

-- Listings: public read + owner write for normalized location
grant select (state_code, city_geoid) on public.listings to anon, authenticated;
grant insert (state_code, city_geoid) on public.listings to authenticated;
grant update (state_code, city_geoid) on public.listings to authenticated;

-- Profiles: owners may set normalized location alongside legacy city/state text
grant update (state_code, city_geoid) on public.profiles to authenticated;

-- Businesses: owners/admins may set normalized location (SELECT already covers new cols)
grant update (state_code, city_geoid) on public.businesses to authenticated;
