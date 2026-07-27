-- Bucket for pre-publish classification of recommendation cards.
-- Anchored cards → professional | business | service | other
-- No source/contact/entity match → leave unclassified (do not auto-transfer).

alter table public.import_comment_recommendations
  add column if not exists target_bucket text not null default 'unclassified';

alter table public.import_comment_recommendations
  drop constraint if exists import_comment_recommendations_target_bucket_check;

alter table public.import_comment_recommendations
  add constraint import_comment_recommendations_target_bucket_check
  check (
    target_bucket in (
      'professional',
      'business',
      'service',
      'other',
      'unclassified'
    )
  );

create index if not exists import_comment_recommendations_status_bucket_mentions_idx
  on public.import_comment_recommendations (status, target_bucket, mention_count desc);

comment on column public.import_comment_recommendations.target_bucket is
  'Pre-publish destination: professional | business | service | other | unclassified (no anchor)';
