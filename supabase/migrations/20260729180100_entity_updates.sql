-- Profile updates (новости) for business / professional cards.
-- Separate from services (price list) and promotions (акции).

create table if not exists public.entity_updates (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null
    check (owner_type in ('business', 'professional')),
  owner_id uuid not null,
  title text not null,
  body text,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  source text not null default 'import'
    check (source in ('import', 'enrich', 'owner', 'admin')),
  source_url text,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entity_updates_title_len_chk check (
    char_length(btrim(title)) between 2 and 160
  ),
  constraint entity_updates_body_len_chk check (
    body is null or char_length(btrim(body)) <= 4000
  )
);

create index if not exists entity_updates_owner_idx
  on public.entity_updates (owner_type, owner_id, status, published_at desc);

create index if not exists entity_updates_public_idx
  on public.entity_updates (status, published_at desc)
  where status = 'active';

comment on table public.entity_updates is
  'Profile news/updates (переезд, открытие и т.п.). Not services and not promotions.';

-- Follows: who wants to see updates from a card.
create table if not exists public.entity_follows (
  user_id uuid not null references public.profiles(id) on delete cascade,
  owner_type text not null
    check (owner_type in ('business', 'professional')),
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, owner_type, owner_id)
);

create index if not exists entity_follows_owner_idx
  on public.entity_follows (owner_type, owner_id);

create index if not exists entity_follows_user_idx
  on public.entity_follows (user_id, created_at desc);

comment on table public.entity_follows is
  'User subscriptions to business / professional updates. No push in v1.';

-- Queue: structured updates extracted during enrich (before publish).
alter table public.import_review_items
  add column if not exists updates jsonb not null default '[]'::jsonb;

alter table public.import_review_items
  drop constraint if exists import_review_items_updates_array_chk;
alter table public.import_review_items
  add constraint import_review_items_updates_array_chk
  check (jsonb_typeof(updates) = 'array');

-- RLS
alter table public.entity_updates enable row level security;
alter table public.entity_follows enable row level security;

drop policy if exists "entity_updates public read active" on public.entity_updates;
create policy "entity_updates public read active"
  on public.entity_updates for select
  to anon, authenticated
  using (status = 'active');

drop policy if exists "entity_updates admin all" on public.entity_updates;
create policy "entity_updates admin all"
  on public.entity_updates for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "entity_follows own select" on public.entity_follows;
create policy "entity_follows own select"
  on public.entity_follows for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "entity_follows own insert" on public.entity_follows;
create policy "entity_follows own insert"
  on public.entity_follows for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "entity_follows own delete" on public.entity_follows;
create policy "entity_follows own delete"
  on public.entity_follows for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "entity_follows admin all" on public.entity_follows;
create policy "entity_follows admin all"
  on public.entity_follows for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.entity_updates to anon, authenticated;
grant insert, update, delete on public.entity_updates to authenticated;
grant all on public.entity_updates to service_role;

grant select, insert, delete on public.entity_follows to authenticated;
grant all on public.entity_follows to service_role;
