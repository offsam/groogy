-- Security advisor: 21 functions had no fixed search_path (theoretical hijack vector
-- if a caller's own search_path resolves an unqualified name to a hostile object).
-- All 21 are SECURITY INVOKER (not DEFINER) — lower severity, but pinning is free and
-- matches the convention already used elsewhere in this schema. Pure hygiene, no
-- behavior change for correctly-written functions.

alter function public.business_community_mentions_set_updated_at() set search_path = 'public', 'pg_catalog';
alter function public.business_locations_set_updated_at() set search_path = 'public', 'pg_catalog';
alter function public.churches_set_updated_at() set search_path = 'public', 'pg_catalog';
alter function public.events_set_updated_at() set search_path = 'public', 'pg_catalog';
alter function public.import_comment_recommendations_set_updated_at() set search_path = 'public', 'pg_catalog';
alter function public.import_review_build_compact_payload(jsonb) set search_path = 'public', 'pg_catalog';
alter function public.import_review_compact_payload_on_settle() set search_path = 'public', 'pg_catalog';
alter function public.import_review_completeness_score(text, text, text, text, numeric, integer, integer) set search_path = 'public', 'pg_catalog';
alter function public.import_review_contact_priority_score(text[], text[], text, text[], text[], text[], text, text) set search_path = 'public', 'pg_catalog';
alter function public.is_placeholder_image_url(text) set search_path = 'public', 'pg_catalog';
alter function public.is_publicly_listed(text, text) set search_path = 'public', 'pg_catalog';
alter function public.is_weak_entity_name(text) set search_path = 'public', 'pg_catalog';
alter function public.listing_registry_kind(listing_type) set search_path = 'public', 'pg_catalog';
alter function public.listing_registry_status(listing_status) set search_path = 'public', 'pg_catalog';
alter function public.professional_community_mentions_set_updated_at() set search_path = 'public', 'pg_catalog';
alter function public.protect_import_review_raw_payload() set search_path = 'public', 'pg_catalog';
alter function public.review_level_weight(review_verification_level) set search_path = 'public', 'pg_catalog';
alter function public.set_updated_at() set search_path = 'public', 'pg_catalog';
alter function public.touch_import_review_updated_at() set search_path = 'public', 'pg_catalog';
alter function public.verification_answer_is_substantive(text) set search_path = 'public', 'pg_catalog';
alter function public.verification_looks_contradictory(text, text[]) set search_path = 'public', 'pg_catalog';
