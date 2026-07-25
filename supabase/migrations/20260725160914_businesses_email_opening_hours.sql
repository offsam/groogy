-- Email + weekly opening hours on public business profiles.
alter table public.businesses
  add column if not exists email text,
  add column if not exists opening_hours jsonb;

comment on column public.businesses.email is
  'Public business email; revealed with other contacts on the profile.';

comment on column public.businesses.opening_hours is
  'Weekly schedule JSON: { "timezone"?: string, "weekly": [{ "day": 0-6 (Sun=0), "closed"?: bool, "open"?: "HH:MM", "close"?: "HH:MM" }] }';

create index if not exists businesses_email_lower_idx
  on public.businesses (lower(email))
  where email is not null;
