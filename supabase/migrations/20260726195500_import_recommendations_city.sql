-- City label for recommendation / event mini-cards (from post text or FB group hub).

alter table public.import_comment_recommendations
  add column if not exists city text;

comment on column public.import_comment_recommendations.city is
  'City from post text when present, else hub of the Facebook group (Los Angeles / San Francisco / Sacramento).';
