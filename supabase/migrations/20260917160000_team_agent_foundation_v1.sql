-- Team Agent Foundation V1 — internal developer coordination (NOT product messaging).
-- Additive only. Do not apply to remote from this change set without explicit approval.
-- Client roles (anon / authenticated) get ZERO privileges; access is service_role only.

-- ============ members ============
create table if not exists public.team_agent_members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  telegram_user_id bigint,
  telegram_username text,
  github_username text,
  role_title text,
  responsibilities jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  working_preferences text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_agent_members_display_name_len_chk
    check (char_length(display_name) between 1 and 120),
  constraint team_agent_members_telegram_username_len_chk
    check (telegram_username is null or char_length(telegram_username) <= 64),
  constraint team_agent_members_github_username_len_chk
    check (github_username is null or char_length(github_username) <= 64),
  constraint team_agent_members_responsibilities_is_array_chk
    check (jsonb_typeof(responsibilities) = 'array'),
  constraint team_agent_members_skills_is_array_chk
    check (jsonb_typeof(skills) = 'array')
);

create unique index if not exists team_agent_members_telegram_user_id_uidx
  on public.team_agent_members (telegram_user_id)
  where telegram_user_id is not null;

create unique index if not exists team_agent_members_github_username_uidx
  on public.team_agent_members (lower(github_username))
  where github_username is not null;

create index if not exists team_agent_members_active_idx
  on public.team_agent_members (is_active)
  where is_active = true;

comment on table public.team_agent_members is
  'Internal Team Agent: permanent developer team profiles (not product users).';

-- ============ conversations ============
create table if not exists public.team_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  source_type text not null
    check (source_type in ('telegram', 'manual', 'test')),
  external_conversation_id text,
  title text not null default 'Team chat',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_agent_conversations_title_len_chk
    check (char_length(title) between 1 and 200),
  constraint team_agent_conversations_external_id_len_chk
    check (
      external_conversation_id is null
      or char_length(external_conversation_id) <= 128
    )
);

create unique index if not exists team_agent_conversations_source_external_uidx
  on public.team_agent_conversations (source_type, external_conversation_id)
  where external_conversation_id is not null;

comment on table public.team_agent_conversations is
  'Internal Team Agent: source-abstracted conversation/channel (telegram | manual | test).';

-- ============ messages ============
create table if not exists public.team_agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.team_agent_conversations (id) on delete cascade,
  member_id uuid
    references public.team_agent_members (id) on delete set null,
  external_message_id text,
  reply_to_message_id uuid
    references public.team_agent_messages (id) on delete set null,
  message_type text not null default 'text'
    check (message_type in ('text', 'system', 'bot', 'edited')),
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint team_agent_messages_body_len_chk
    check (char_length(body) <= 16000),
  constraint team_agent_messages_external_id_len_chk
    check (external_message_id is null or char_length(external_message_id) <= 128),
  constraint team_agent_messages_metadata_is_object_chk
    check (jsonb_typeof(metadata) = 'object')
);

-- Idempotency for future Telegram webhook retries (per conversation).
create unique index if not exists team_agent_messages_conversation_external_uidx
  on public.team_agent_messages (conversation_id, external_message_id)
  where external_message_id is not null;

create index if not exists team_agent_messages_conversation_occurred_idx
  on public.team_agent_messages (conversation_id, occurred_at desc);

create index if not exists team_agent_messages_member_idx
  on public.team_agent_messages (member_id)
  where member_id is not null;

comment on table public.team_agent_messages is
  'Internal Team Agent: ingested team messages (separate from product messaging).';

-- ============ decisions ============
create table if not exists public.team_agent_decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'rejected', 'superseded', 'cancelled')),
  source_message_id uuid
    references public.team_agent_messages (id) on delete set null,
  decided_by uuid
    references public.team_agent_members (id) on delete set null,
  supersedes_decision_id uuid
    references public.team_agent_decisions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_agent_decisions_title_len_chk
    check (char_length(title) between 1 and 240),
  constraint team_agent_decisions_description_len_chk
    check (char_length(description) <= 8000)
);

create index if not exists team_agent_decisions_status_idx
  on public.team_agent_decisions (status);

create index if not exists team_agent_decisions_supersedes_idx
  on public.team_agent_decisions (supersedes_decision_id)
  where supersedes_decision_id is not null;

comment on table public.team_agent_decisions is
  'Internal Team Agent: structured decisions. Only status=confirmed is authoritative.';

-- ============ tasks ============
create table if not exists public.team_agent_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status text not null default 'proposed'
    check (status in (
      'proposed',
      'approved',
      'in_progress',
      'blocked',
      'review',
      'completed',
      'cancelled'
    )),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_member_id uuid
    references public.team_agent_members (id) on delete set null,
  created_by_member_id uuid
    references public.team_agent_members (id) on delete set null,
  source_message_id uuid
    references public.team_agent_messages (id) on delete set null,
  branch_name text,
  scope_paths text[] not null default '{}',
  protected_paths text[] not null default '{}',
  excluded_paths text[] not null default '{}',
  acceptance_criteria jsonb not null default '[]'::jsonb,
  dependency_task_ids uuid[] not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_agent_tasks_title_len_chk
    check (char_length(title) between 1 and 240),
  constraint team_agent_tasks_description_len_chk
    check (char_length(description) <= 16000),
  constraint team_agent_tasks_branch_name_len_chk
    check (branch_name is null or char_length(branch_name) <= 200),
  constraint team_agent_tasks_acceptance_is_array_chk
    check (jsonb_typeof(acceptance_criteria) = 'array')
);

create index if not exists team_agent_tasks_status_idx
  on public.team_agent_tasks (status);

create index if not exists team_agent_tasks_assignee_idx
  on public.team_agent_tasks (assigned_member_id)
  where assigned_member_id is not null;

create index if not exists team_agent_tasks_scope_paths_gin
  on public.team_agent_tasks using gin (scope_paths);

comment on table public.team_agent_tasks is
  'Internal Team Agent: work coordination. scope_paths are normalized for conflict checks.';

-- ============ git activity ============
create table if not exists public.team_agent_git_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid
    references public.team_agent_tasks (id) on delete set null,
  member_id uuid
    references public.team_agent_members (id) on delete set null,
  repository text not null default 'local',
  branch_name text,
  commit_sha text,
  commit_message text,
  event_type text not null
    check (event_type in (
      'branch_created',
      'commit_pushed',
      'pr_opened',
      'pr_updated',
      'merged'
    )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint team_agent_git_activity_repository_len_chk
    check (char_length(repository) between 1 and 200),
  constraint team_agent_git_activity_branch_len_chk
    check (branch_name is null or char_length(branch_name) <= 200),
  constraint team_agent_git_activity_sha_len_chk
    check (commit_sha is null or char_length(commit_sha) <= 64),
  constraint team_agent_git_activity_metadata_is_object_chk
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists team_agent_git_activity_task_idx
  on public.team_agent_git_activity (task_id)
  where task_id is not null;

create index if not exists team_agent_git_activity_branch_idx
  on public.team_agent_git_activity (branch_name)
  where branch_name is not null;

comment on table public.team_agent_git_activity is
  'Internal Team Agent: future GitHub event log linked to tasks. No auto-merge.';

-- ============ memory ============
create table if not exists public.team_agent_memory (
  id uuid primary key default gen_random_uuid(),
  memory_type text not null
    check (memory_type in (
      'project_fact',
      'team_fact',
      'decision',
      'constraint',
      'preference',
      'summary'
    )),
  subject text not null,
  content text not null,
  source_message_id uuid
    references public.team_agent_messages (id) on delete set null,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  status text not null default 'active'
    check (status in ('active', 'superseded', 'invalid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_agent_memory_subject_len_chk
    check (char_length(subject) between 1 and 200),
  constraint team_agent_memory_content_len_chk
    check (char_length(content) between 1 and 8000)
);

create index if not exists team_agent_memory_type_status_idx
  on public.team_agent_memory (memory_type, status);

create index if not exists team_agent_memory_subject_idx
  on public.team_agent_memory (subject);

comment on table public.team_agent_memory is
  'Internal Team Agent: controlled long-term memory (CHAT != MEMORY != DECISION != TASK).';

-- ============ pending approvals (human gate for agent proposals) ============
create table if not exists public.team_agent_approvals (
  id uuid primary key default gen_random_uuid(),
  approval_type text not null
    check (approval_type in (
      'task_assignment',
      'task_batch',
      'decision_confirm',
      'memory_confirm'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  payload jsonb not null default '{}'::jsonb,
  proposed_by_member_id uuid
    references public.team_agent_members (id) on delete set null,
  decided_by_member_id uuid
    references public.team_agent_members (id) on delete set null,
  source_message_id uuid
    references public.team_agent_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint team_agent_approvals_payload_is_object_chk
    check (jsonb_typeof(payload) = 'object')
);

create index if not exists team_agent_approvals_status_idx
  on public.team_agent_approvals (status);

comment on table public.team_agent_approvals is
  'Internal Team Agent: human approval boundary for agent-proposed mutations.';

-- ============ RLS: deny clients completely ============
alter table public.team_agent_members enable row level security;
alter table public.team_agent_members force row level security;
alter table public.team_agent_conversations enable row level security;
alter table public.team_agent_conversations force row level security;
alter table public.team_agent_messages enable row level security;
alter table public.team_agent_messages force row level security;
alter table public.team_agent_decisions enable row level security;
alter table public.team_agent_decisions force row level security;
alter table public.team_agent_tasks enable row level security;
alter table public.team_agent_tasks force row level security;
alter table public.team_agent_git_activity enable row level security;
alter table public.team_agent_git_activity force row level security;
alter table public.team_agent_memory enable row level security;
alter table public.team_agent_memory force row level security;
alter table public.team_agent_approvals enable row level security;
alter table public.team_agent_approvals force row level security;

-- No policies for anon/authenticated → RLS denies all row access.
-- Table privileges also revoked so PostgREST cannot reach these tables.

revoke all on table public.team_agent_members from anon, authenticated;
revoke all on table public.team_agent_conversations from anon, authenticated;
revoke all on table public.team_agent_messages from anon, authenticated;
revoke all on table public.team_agent_decisions from anon, authenticated;
revoke all on table public.team_agent_tasks from anon, authenticated;
revoke all on table public.team_agent_git_activity from anon, authenticated;
revoke all on table public.team_agent_memory from anon, authenticated;
revoke all on table public.team_agent_approvals from anon, authenticated;

grant select, insert, update, delete on table public.team_agent_members to service_role;
grant select, insert, update, delete on table public.team_agent_conversations to service_role;
grant select, insert, update, delete on table public.team_agent_messages to service_role;
grant select, insert, update, delete on table public.team_agent_decisions to service_role;
grant select, insert, update, delete on table public.team_agent_tasks to service_role;
grant select, insert, update, delete on table public.team_agent_git_activity to service_role;
grant select, insert, update, delete on table public.team_agent_memory to service_role;
grant select, insert, update, delete on table public.team_agent_approvals to service_role;

notify pgrst, 'reload schema';
