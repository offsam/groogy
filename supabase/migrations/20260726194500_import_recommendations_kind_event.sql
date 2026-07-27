-- Distinguish profi recommendation cards vs event promos from the same FB dumps.

alter table public.import_comment_recommendations
  add column if not exists kind text not null default 'profi'
    check (kind in ('profi', 'event'));

alter table public.import_comment_recommendations
  add column if not exists event_at text;

create index if not exists import_comment_recommendations_kind_mentions_idx
  on public.import_comment_recommendations (kind, mention_count desc);

comment on column public.import_comment_recommendations.kind is
  'profi = specialist/contact mini-card; event = webinar/meetup/conference promo';
