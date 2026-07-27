-- Allow service-role import/migration scripts to create lechu & transfer listings.

grant select, insert, update, delete on table public.lechu_listing_details to service_role;
grant select, insert, update, delete on table public.transfer_listing_details to service_role;
grant select on table public.lechu_catalog to service_role;
grant select on table public.transfers_catalog to service_role;
