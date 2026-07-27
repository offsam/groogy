-- Split mention totals into third-party recommendations vs self-ads.

alter table public.import_comment_recommendations
  add column if not exists third_party_mention_count integer not null default 0
    check (third_party_mention_count >= 0);

alter table public.import_comment_recommendations
  add column if not exists self_ad_mention_count integer not null default 0
    check (self_ad_mention_count >= 0);

comment on column public.import_comment_recommendations.third_party_mention_count is
  'How many times others recommended this contact (comments / «советую»).';

comment on column public.import_comment_recommendations.self_ad_mention_count is
  'How many times the contact advertised themselves (direct specialist/business ads).';

create index if not exists import_comment_recommendations_origin_counts_idx
  on public.import_comment_recommendations (
    third_party_mention_count desc,
    self_ad_mention_count desc
  );
