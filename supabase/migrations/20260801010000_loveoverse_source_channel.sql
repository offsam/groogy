-- Allow Loveoverse as an inbound event source channel (LA affiche aggregator).

alter table public.import_comment_recommendations
  drop constraint if exists import_comment_recommendations_source_channel_check;

alter table public.import_comment_recommendations
  add constraint import_comment_recommendations_source_channel_check
  check (source_channel in ('facebook', 'telegram', 'eventbrite', 'loveoverse', 'other'));

comment on column public.import_comment_recommendations.external_source is
  'Inbound platform for event candidates (eventbrite, loveoverse, …). Dedup with external_id.';
