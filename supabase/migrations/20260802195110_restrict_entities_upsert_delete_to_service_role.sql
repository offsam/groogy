-- entities_delete_by_source / entities_upsert had zero internal auth checks and were
-- executable by PUBLIC (including anon), letting any unauthenticated caller delete or
-- forge rows in the entities registry via RPC. Only legitimate caller is the Python
-- entity-model pipeline using SUPABASE_SERVICE_ROLE_KEY (verified: no app/ or lib/
-- TypeScript code references these RPCs). Restrict to service_role, matching the
-- convention already used for sibling service_* pipeline functions.

revoke execute on function public.entities_delete_by_source(entity_type, uuid) from public, anon, authenticated;
grant execute on function public.entities_delete_by_source(entity_type, uuid) to service_role;

revoke execute on function public.entities_upsert(entity_type, uuid, entity_registry_status) from public, anon, authenticated;
grant execute on function public.entities_upsert(entity_type, uuid, entity_registry_status) to service_role;
