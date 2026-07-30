-- Affiche «Чем заняться» Phase 1: external dedup, language, categories, venue.
-- Pending queue remains import_comment_recommendations (kind=event).

-- ── events (published catalog) ──────────────────────────────────────────────

alter table public.events
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists category text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists source_language text
    check (source_language is null or source_language in ('en', 'ru', 'mixed', 'unknown')),
  add column if not exists title_original text,
  add column if not exists description_original text,
  add column if not exists venue_name text,
  add column if not exists audience_label text;

create unique index if not exists events_external_source_id_uid
  on public.events (external_source, external_id)
  where external_source is not null and external_id is not null;

create index if not exists events_category_idx
  on public.events (category)
  where category is not null;

create index if not exists events_tags_gin_idx
  on public.events using gin (tags);

comment on column public.events.external_source is
  'Inbound platform key for dedup: eventbrite, facebook, telegram, luma, meetup, …';
comment on column public.events.external_id is
  'Stable id on the external platform (e.g. Eventbrite event id).';
comment on column public.events.category is
  'Things-to-do category: festival, outdoors, family, food, culture, sport, music, networking, other.';
comment on column public.events.source_language is
  'Language of the original source text before RU translation.';
comment on column public.events.title_original is
  'Original title (usually EN) kept after translating title to Russian.';
comment on column public.events.description_original is
  'Original description kept after translating description to Russian.';
comment on column public.events.venue_name is
  'Venue / place name separate from street address_line.';

-- ── pending event candidates (import_comment_recommendations) ───────────────

alter table public.import_comment_recommendations
  drop constraint if exists import_comment_recommendations_source_channel_check;

alter table public.import_comment_recommendations
  add constraint import_comment_recommendations_source_channel_check
  check (source_channel in ('facebook', 'telegram', 'eventbrite', 'other'));

alter table public.import_comment_recommendations
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists source_language text
    check (source_language is null or source_language in ('en', 'ru', 'mixed', 'unknown')),
  add column if not exists title_original text,
  add column if not exists description_original text,
  add column if not exists venue_name text,
  add column if not exists address_line text,
  add column if not exists price_label text,
  add column if not exists payment_methods text[] not null default '{}',
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists state_code text,
  add column if not exists category text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists audience_label text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists registration_url text;

create unique index if not exists import_comment_recommendations_external_uid
  on public.import_comment_recommendations (external_source, external_id)
  where external_source is not null
    and external_id is not null
    and kind = 'event';

create index if not exists import_comment_recommendations_event_pending_idx
  on public.import_comment_recommendations (status, kind, starts_at nulls last)
  where kind = 'event';

comment on column public.import_comment_recommendations.external_source is
  'Inbound platform for event candidates (eventbrite, …). Dedup with external_id.';
comment on column public.import_comment_recommendations.registration_url is
  'Primary ticket / registration URL for event candidates (Eventbrite, Partiful, …).';
