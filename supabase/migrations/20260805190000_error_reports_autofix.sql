-- Track the GitHub issue opened when an admin clicks "Почини" on an error
-- report, so the panel can show "already requested" instead of re-filing.

alter table public.platform_error_reports
  add column if not exists github_issue_url text,
  add column if not exists autofix_requested_by uuid references auth.users (id) on delete set null,
  add column if not exists autofix_requested_at timestamptz;

alter table public.platform_error_reports
  add constraint platform_error_reports_github_issue_url_len_chk
  check (github_issue_url is null or char_length(github_issue_url) <= 500);

notify pgrst, 'reload schema';
