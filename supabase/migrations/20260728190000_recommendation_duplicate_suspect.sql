-- Recommendation duplicate suspicion + link to live keep entity.

alter table public.import_comment_recommendations
  drop constraint if exists import_comment_recommendations_status_check;

alter table public.import_comment_recommendations
  add constraint import_comment_recommendations_status_check
  check (
    status in (
      'pending',
      'approved',
      'rejected',
      'merged',
      'suspected_duplicate'
    )
  );

alter table public.import_comment_recommendations
  add column if not exists duplicate_of_entity_type text;

alter table public.import_comment_recommendations
  add column if not exists duplicate_of_entity_id uuid;

alter table public.import_comment_recommendations
  add column if not exists duplicate_confidence text
    check (
      duplicate_confidence is null
      or duplicate_confidence in ('suspected', 'confirmed')
    );

alter table public.import_comment_recommendations
  add column if not exists duplicate_reason text;

comment on column public.import_comment_recommendations.duplicate_of_entity_type is
  'Live keep target type when suspected/confirmed duplicate: professional | business | listing.';

comment on column public.import_comment_recommendations.duplicate_of_entity_id is
  'Live keep entity id for merge fill-empty.';

comment on column public.import_comment_recommendations.duplicate_confidence is
  'suspected = needs moderator; confirmed = merged after manual confirm.';

comment on column public.import_comment_recommendations.duplicate_reason is
  'Short matcher reason (website:, phone:, name:…).';

create index if not exists import_comment_recommendations_dup_entity_idx
  on public.import_comment_recommendations (duplicate_of_entity_type, duplicate_of_entity_id)
  where duplicate_of_entity_id is not null;
