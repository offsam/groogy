-- Offline Facebook comment → recommendation clusters for admin review.

create table if not exists public.import_comment_recommendations (
  id uuid primary key default gen_random_uuid(),
  cluster_key text not null,
  display_name text,
  phones text[] not null default '{}',
  instagram text[] not null default '{}',
  websites text[] not null default '{}',
  mention_count integer not null default 1
    check (mention_count >= 1),
  comment_texts text[] not null default '{}',
  request_snippets text[] not null default '{}',
  source_post_urls text[] not null default '{}',
  source_groups text[] not null default '{}',
  category_guess text,
  recommender_names text[] not null default '{}',
  last_posted_at timestamptz,
  source_channel text not null default 'facebook'
    check (source_channel in ('facebook', 'telegram', 'other')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'merged')),
  notes text,
  published_entity_type text,
  published_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_comment_recommendations_cluster_channel_uid
    unique (source_channel, cluster_key)
);

create index if not exists import_comment_recommendations_status_mentions_idx
  on public.import_comment_recommendations (status, mention_count desc);

comment on table public.import_comment_recommendations is
  'Deduped specialist recommendations scraped from FB post comments (offline raw dumps).';

alter table public.import_comment_recommendations enable row level security;

drop policy if exists import_comment_recommendations_admin_all
  on public.import_comment_recommendations;
create policy import_comment_recommendations_admin_all
  on public.import_comment_recommendations
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.import_comment_recommendations
  to authenticated;
grant all on public.import_comment_recommendations to service_role;

create or replace function public.import_comment_recommendations_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists import_comment_recommendations_updated_at
  on public.import_comment_recommendations;
create trigger import_comment_recommendations_updated_at
  before insert or update on public.import_comment_recommendations
  for each row
  execute function public.import_comment_recommendations_set_updated_at();
