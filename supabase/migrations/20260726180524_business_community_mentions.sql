-- Community recommendations / comment mentions on business profiles.
-- Lighter than reviews: no stars, no user_id, does not affect rating_avg.

create table if not exists public.business_community_mentions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null default 'comment_recommendation'
    check (kind in (
      'comment_recommendation',
      'third_party_recommendation',
      'community_mention'
    )),
  source_channel text not null default 'facebook'
    check (source_channel in (
      'facebook', 'telegram', 'import', 'admin', 'other'
    )),
  source_label text,
  source_url text,
  source_record_id text,
  snippet text not null,
  author_label text,
  status text not null default 'published'
    check (status in ('draft', 'published', 'hidden', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_community_mentions_snippet_len_chk
    check (char_length(trim(snippet)) between 3 and 2000)
);

create unique index if not exists business_community_mentions_dedupe_idx
  on public.business_community_mentions (business_id, source_record_id)
  where source_record_id is not null;

create index if not exists business_community_mentions_business_published_idx
  on public.business_community_mentions (business_id, published_at desc)
  where status = 'published';

comment on table public.business_community_mentions is
  'Community recommendations and comment mentions for a business (not formal reviews).';

alter table public.business_community_mentions enable row level security;

create policy business_community_mentions_public_read
  on public.business_community_mentions
  for select
  to anon, authenticated
  using (status = 'published');

grant select on public.business_community_mentions to anon, authenticated;
grant all on public.business_community_mentions to service_role;

create or replace function public.business_community_mentions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.status = 'published' and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists business_community_mentions_updated_at
  on public.business_community_mentions;

create trigger business_community_mentions_updated_at
  before insert or update on public.business_community_mentions
  for each row
  execute function public.business_community_mentions_set_updated_at();
