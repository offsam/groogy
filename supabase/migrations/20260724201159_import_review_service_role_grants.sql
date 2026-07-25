-- Service role needs explicit table privileges (revoke all from public removed default grants).

grant select, insert, update, delete on table public.import_review_items to service_role;
grant select, insert, update, delete on table public.import_review_audit to service_role;
grant usage on type public.import_review_status to service_role, authenticated;
grant usage on type public.import_review_target_collection to service_role, authenticated;
grant usage on type public.import_review_entity_type to service_role, authenticated;
