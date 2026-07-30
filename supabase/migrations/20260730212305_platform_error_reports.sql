-- User-facing error reports from the floating «Ошибка» button.

create table if not exists public.platform_error_reports (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  page_path text not null,
  page_url text,
  user_id uuid references auth.users (id) on delete set null,
  user_agent text,
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  admin_note text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint platform_error_reports_message_len_chk check (
    char_length(message) between 1 and 4000
  ),
  constraint platform_error_reports_page_path_len_chk check (
    char_length(page_path) between 1 and 2000
  ),
  constraint platform_error_reports_page_url_len_chk check (
    page_url is null or char_length(page_url) <= 4000
  ),
  constraint platform_error_reports_user_agent_len_chk check (
    user_agent is null or char_length(user_agent) <= 1000
  ),
  constraint platform_error_reports_admin_note_len_chk check (
    admin_note is null or char_length(admin_note) <= 2000
  )
);

create index if not exists platform_error_reports_status_created_idx
  on public.platform_error_reports (status, created_at desc);

create index if not exists platform_error_reports_created_idx
  on public.platform_error_reports (created_at desc);

alter table public.platform_error_reports enable row level security;
alter table public.platform_error_reports force row level security;

drop policy if exists "anyone can insert error reports" on public.platform_error_reports;
create policy "anyone can insert error reports"
  on public.platform_error_reports for insert
  to anon, authenticated
  with check (
    (user_id is null or user_id = auth.uid())
    and status = 'open'
    and reviewed_by is null
    and reviewed_at is null
    and admin_note is null
  );

drop policy if exists "admins can select error reports" on public.platform_error_reports;
create policy "admins can select error reports"
  on public.platform_error_reports for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins can update error reports" on public.platform_error_reports;
create policy "admins can update error reports"
  on public.platform_error_reports for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.platform_error_reports from anon, authenticated;
grant insert (
  message,
  page_path,
  page_url,
  user_id,
  user_agent
) on public.platform_error_reports to anon, authenticated;
grant select, update on public.platform_error_reports to authenticated;
