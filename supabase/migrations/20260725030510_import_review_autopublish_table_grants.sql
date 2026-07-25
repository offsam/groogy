-- Allow service-role autopublish script to check duplicates and create entities.

grant select on table public.businesses to service_role;
grant insert, update on table public.businesses to service_role;

grant select, insert, update on table public.listings to service_role;
grant select, insert, update on table public.marketplace_listing_details to service_role;

grant select on table public.profiles to service_role;
