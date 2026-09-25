-- One shared Durak table. Hands live inside `state` and are never
-- granted to the browser: only the server service role reads this row
-- and returns a view with the viewer's own cards.

create table if not exists public.durak_tables (
  id integer primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.durak_tables enable row level security;
alter table public.durak_tables force row level security;

revoke all on table public.durak_tables from anon, authenticated;
grant all on table public.durak_tables to service_role;

comment on table public.durak_tables is
  'Online Durak tables. state holds seats and the current hand; public reads go through server actions.';
