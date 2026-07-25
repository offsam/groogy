-- Allow service-role autopublish to resolve category_id from categories.

grant select on table public.categories to service_role;
