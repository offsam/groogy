-- Team Agent topics / memory packets. Additive only.
-- Does not apply remotely until the owner approves.
-- Raw messages, tasks, decisions, and memory rows stay the source of truth.

create table if not exists public.team_agent_topics (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null,
  summary text not null default '',
  status text not null default 'active'
    check (status in ('active', 'dormant', 'archived')),
  last_activity_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_agent_topics_title_len_chk
    check (char_length(title) between 1 and 160),
  constraint team_agent_topics_slug_len_chk
    check (char_length(slug) between 1 and 160),
  constraint team_agent_topics_summary_len_chk
    check (char_length(summary) <= 4000),
  constraint team_agent_topics_metadata_is_object_chk
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists team_agent_topics_slug_uidx
  on public.team_agent_topics (slug);

create index if not exists team_agent_topics_status_idx
  on public.team_agent_topics (status);

comment on table public.team_agent_topics is
  'Internal Team Agent: dynamic topic / memory packet. Not an enum.';

create table if not exists public.team_agent_message_topics (
  message_id uuid not null
    references public.team_agent_messages (id) on delete cascade,
  topic_id uuid not null
    references public.team_agent_topics (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, topic_id)
);

create index if not exists team_agent_message_topics_topic_idx
  on public.team_agent_message_topics (topic_id);

create table if not exists public.team_agent_task_topics (
  task_id uuid not null
    references public.team_agent_tasks (id) on delete cascade,
  topic_id uuid not null
    references public.team_agent_topics (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, topic_id)
);

create index if not exists team_agent_task_topics_topic_idx
  on public.team_agent_task_topics (topic_id);

create table if not exists public.team_agent_decision_topics (
  decision_id uuid not null
    references public.team_agent_decisions (id) on delete cascade,
  topic_id uuid not null
    references public.team_agent_topics (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (decision_id, topic_id)
);

create index if not exists team_agent_decision_topics_topic_idx
  on public.team_agent_decision_topics (topic_id);

create table if not exists public.team_agent_memory_topics (
  memory_id uuid not null
    references public.team_agent_memory (id) on delete cascade,
  topic_id uuid not null
    references public.team_agent_topics (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (memory_id, topic_id)
);

create index if not exists team_agent_memory_topics_topic_idx
  on public.team_agent_memory_topics (topic_id);

alter table public.team_agent_memory
  add column if not exists category text;

alter table public.team_agent_memory
  drop constraint if exists team_agent_memory_category_chk;

alter table public.team_agent_memory
  add constraint team_agent_memory_category_chk
  check (
    category is null
    or category in (
      'idea',
      'fact',
      'decision',
      'task',
      'constraint',
      'question',
      'preference',
      'summary'
    )
  );

alter table public.team_agent_memory
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.team_agent_memory.category is
  'Knowledge label inside a topic. Authoritative tasks/decisions stay in their own tables.';

alter table public.team_agent_topics enable row level security;
alter table public.team_agent_topics force row level security;
alter table public.team_agent_message_topics enable row level security;
alter table public.team_agent_message_topics force row level security;
alter table public.team_agent_task_topics enable row level security;
alter table public.team_agent_task_topics force row level security;
alter table public.team_agent_decision_topics enable row level security;
alter table public.team_agent_decision_topics force row level security;
alter table public.team_agent_memory_topics enable row level security;
alter table public.team_agent_memory_topics force row level security;

revoke all on table public.team_agent_topics from anon, authenticated;
revoke all on table public.team_agent_message_topics from anon, authenticated;
revoke all on table public.team_agent_task_topics from anon, authenticated;
revoke all on table public.team_agent_decision_topics from anon, authenticated;
revoke all on table public.team_agent_memory_topics from anon, authenticated;

grant select, insert, update, delete on table public.team_agent_topics to service_role;
grant select, insert, update, delete on table public.team_agent_message_topics to service_role;
grant select, insert, update, delete on table public.team_agent_task_topics to service_role;
grant select, insert, update, delete on table public.team_agent_decision_topics to service_role;
grant select, insert, update, delete on table public.team_agent_memory_topics to service_role;

notify pgrst, 'reload schema';
