-- Track original Facebook post time/body so event years and UI can stay honest.

alter table public.events
  add column if not exists source_posted_at timestamptz;

alter table public.events
  add column if not exists source_body text;

comment on column public.events.source_posted_at is
  'When the source FB/Telegram post was published (not the event start).';
comment on column public.events.source_body is
  'Full-ish original post text for post-like event detail page.';
