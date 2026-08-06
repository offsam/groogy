-- Claude-fix workflow reports back (via /api/webhooks/claude-fix) what it
-- did: a short summary, the resulting PR link, and whether the report can
-- be considered resolved (PR opened, ready for review) or still needs a
-- human because Claude judged it unsafe to guess.

alter table public.platform_error_reports
  add column if not exists autofix_summary text,
  add column if not exists autofix_pr_url text;

alter table public.platform_error_reports
  drop constraint if exists platform_error_reports_autofix_summary_len_chk;
alter table public.platform_error_reports
  add constraint platform_error_reports_autofix_summary_len_chk
  check (autofix_summary is null or char_length(autofix_summary) <= 2000);

alter table public.platform_error_reports
  drop constraint if exists platform_error_reports_autofix_pr_url_len_chk;
alter table public.platform_error_reports
  add constraint platform_error_reports_autofix_pr_url_len_chk
  check (autofix_pr_url is null or char_length(autofix_pr_url) <= 500);

alter table public.platform_error_reports
  drop constraint if exists platform_error_reports_status_check;
alter table public.platform_error_reports
  add constraint platform_error_reports_status_check
  check (status in ('open', 'reviewed', 'resolved', 'dismissed', 'needs_attention'));

notify pgrst, 'reload schema';
