-- Source Telegram post / channel link for business contacts (gated reveal).
alter table public.businesses
  add column if not exists telegram_url text;

comment on column public.businesses.telegram_url is
  'Public t.me link (channel, username, or source post). Shown only after contact reveal.';
