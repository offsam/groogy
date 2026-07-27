-- Yellow Pages external directory cards (e.g. Russian Orange Pages) in admin review.

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
      'unclassified',
      'yellow_pages'
    )
  );

comment on column public.import_comment_recommendations.target_bucket is
  'Pre-publish destination: professional | business | service | other | unclassified | yellow_pages';
