-- Add Лечу + Переводы as first-class import-review collections.

alter type public.import_review_target_collection add value if not exists 'lechu';
alter type public.import_review_target_collection add value if not exists 'transfers';

alter type public.import_review_entity_type add value if not exists 'lechu_listing';
alter type public.import_review_entity_type add value if not exists 'transfer_listing';
