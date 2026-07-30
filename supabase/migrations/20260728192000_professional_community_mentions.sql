-- Source links for community recommendations attached to professionals.
-- Public UI: count + clickable source URLs (no recommendation text).

create table if not exists public.professional_community_mentions (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  kind text not null default 'third_party_recommendation'
    check (kind in (
      'comment_recommendation',
      'third_party_recommendation',
      'community_mention',
      'self_ad'
    )),
  source_channel text not null default 'facebook'
    check (source_channel in (
      'facebook', 'telegram', 'import', 'admin', 'other'
    )),
  source_label text,
  source_url text,
  source_record_id text,
  status text not null default 'published'
    check (status in ('draft', 'published', 'hidden', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists professional_community_mentions_dedupe_idx
  on public.professional_community_mentions (professional_id, source_record_id)
  where source_record_id is not null;

create index if not exists professional_community_mentions_pro_published_idx
  on public.professional_community_mentions (professional_id, published_at desc)
  where status = 'published';

comment on table public.professional_community_mentions is
  'Community recommendation source links for professionals (counts + URLs; no public snippets).';

alter table public.professional_community_mentions enable row level security;

create policy professional_community_mentions_public_read
  on public.professional_community_mentions
  for select
  using (status = 'published');

grant select on public.professional_community_mentions to anon, authenticated;
grant all on public.professional_community_mentions to service_role;

create or replace function public.professional_community_mentions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists professional_community_mentions_updated_at
  on public.professional_community_mentions;

create trigger professional_community_mentions_updated_at
  before insert or update on public.professional_community_mentions
  for each row
  execute function public.professional_community_mentions_set_updated_at();

-- Optional counters on businesses for admin lens (public uses mentions length).
alter table public.businesses
  add column if not exists third_party_mention_count integer
    check (third_party_mention_count is null or third_party_mention_count >= 0);

alter table public.businesses
  add column if not exists self_ad_mention_count integer
    check (self_ad_mention_count is null or self_ad_mention_count >= 0);

comment on column public.businesses.third_party_mention_count is
  'How many times others recommended this business in community posts.';
comment on column public.businesses.self_ad_mention_count is
  'How many times the business advertised itself in community posts.';
