-- Team Agent control center. Additive only.
-- Do not apply to the remote database without a separate owner approval.
-- Client roles get no access. service_role only.

create table if not exists public.team_agent_sync_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github', 'vercel', 'supabase', 'cursor', 'reconcile')),
  delivery_id text not null,
  event_name text not null,
  repository text,
  ref text,
  commit_sha text,
  summary text not null default '',
  received_at timestamptz not null default now(),
  constraint team_agent_sync_events_delivery_len_chk
    check (char_length(delivery_id) between 1 and 200),
  constraint team_agent_sync_events_summary_len_chk
    check (char_length(summary) <= 2000)
);

create unique index if not exists team_agent_sync_events_provider_delivery_uidx
  on public.team_agent_sync_events (provider, delivery_id);

comment on table public.team_agent_sync_events is
  'Idempotency log for integration events. Payload bodies and secrets are not stored.';

create table if not exists public.team_agent_local_reports (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_agent_members (id) on delete cascade,
  task_id uuid references public.team_agent_tasks (id) on delete set null,
  branch_name text not null,
  base_sha text,
  head_sha text,
  dirty boolean not null default false,
  changed_paths jsonb not null default '[]'::jsonb,
  reported_at timestamptz not null default now(),
  constraint team_agent_local_reports_branch_len_chk
    check (char_length(branch_name) between 1 and 200),
  constraint team_agent_local_reports_paths_is_array_chk
    check (jsonb_typeof(changed_paths) = 'array')
);

create index if not exists team_agent_local_reports_member_reported_idx
  on public.team_agent_local_reports (member_id, reported_at desc);

comment on table public.team_agent_local_reports is
  'Paths and SHAs reported from a developer machine. File contents are not stored.';

create table if not exists public.team_agent_project_issues (
  id uuid primary key default gen_random_uuid(),
  issue_key text not null,
  severity text not null check (severity in ('info', 'warning', 'blocking')),
  source text not null,
  component text not null,
  evidence text not null,
  next_action text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint team_agent_project_issues_key_len_chk
    check (char_length(issue_key) between 1 and 240),
  constraint team_agent_project_issues_evidence_len_chk
    check (char_length(evidence) <= 2000)
);

create unique index if not exists team_agent_project_issues_key_uidx
  on public.team_agent_project_issues (issue_key);

comment on table public.team_agent_project_issues is
  'Evidence-backed project warnings. Absence of data must not be stored as a healthy status.';

create table if not exists public.team_agent_snapshots (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb,
  constraint team_agent_snapshots_summary_is_object_chk
    check (jsonb_typeof(summary) = 'object')
);

comment on table public.team_agent_snapshots is
  'Short project snapshot. Tokens and raw logs are excluded.';

alter table public.team_agent_sync_events enable row level security;
alter table public.team_agent_sync_events force row level security;
alter table public.team_agent_local_reports enable row level security;
alter table public.team_agent_local_reports force row level security;
alter table public.team_agent_project_issues enable row level security;
alter table public.team_agent_project_issues force row level security;
alter table public.team_agent_snapshots enable row level security;
alter table public.team_agent_snapshots force row level security;

revoke all on table public.team_agent_sync_events from anon, authenticated;
revoke all on table public.team_agent_local_reports from anon, authenticated;
revoke all on table public.team_agent_project_issues from anon, authenticated;
revoke all on table public.team_agent_snapshots from anon, authenticated;

grant select, insert, update, delete on table public.team_agent_sync_events to service_role;
grant select, insert, update, delete on table public.team_agent_local_reports to service_role;
grant select, insert, update, delete on table public.team_agent_project_issues to service_role;
grant select, insert, update, delete on table public.team_agent_snapshots to service_role;

notify pgrst, 'reload schema';
