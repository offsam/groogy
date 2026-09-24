-- User cabinet: skill frames, per-user search history, profile avatar storage.

-- ---------------------------------------------------------------------------
-- Profile avatars (public URLs on profiles.avatar_url)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.profile_avatar_storage_object_owned(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    (storage.foldername(p_name))[1] = 'avatars'
    and nullif((storage.foldername(p_name))[2], '')::uuid = auth.uid();
$$;

revoke all on function public.profile_avatar_storage_object_owned(text) from public, anon;
grant execute on function public.profile_avatar_storage_object_owned(text) to authenticated;

drop policy if exists "profile avatars public read" on storage.objects;
create policy "profile avatars public read"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = 'avatars'
  );

drop policy if exists "profile avatars owner insert" on storage.objects;
create policy "profile avatars owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and public.profile_avatar_storage_object_owned(name)
    and name not like '%..%'
  );

drop policy if exists "profile avatars owner update" on storage.objects;
create policy "profile avatars owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and public.profile_avatar_storage_object_owned(name)
  )
  with check (
    bucket_id = 'profile-avatars'
    and public.profile_avatar_storage_object_owned(name)
    and name not like '%..%'
  );

drop policy if exists "profile avatars owner delete" on storage.objects;
create policy "profile avatars owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and public.profile_avatar_storage_object_owned(name)
  );

-- ---------------------------------------------------------------------------
-- Skill / specialty frames on the personal cabinet
-- ---------------------------------------------------------------------------
create table if not exists public.profile_skill_frames (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  skills text not null default '',
  workplace text,
  specialty text,
  show_public boolean not null default false,
  is_active boolean not null default false,
  listing_id uuid references public.listings(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profile_skill_frames_user_sort_idx
  on public.profile_skill_frames (user_id, sort_order asc, created_at asc);

create index if not exists profile_skill_frames_public_idx
  on public.profile_skill_frames (user_id)
  where show_public = true;

alter table public.profile_skill_frames enable row level security;

drop policy if exists "skill frames owner all" on public.profile_skill_frames;
create policy "skill frames owner all"
  on public.profile_skill_frames
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "skill frames public read shown" on public.profile_skill_frames;
create policy "skill frames public read shown"
  on public.profile_skill_frames
  for select
  to anon, authenticated
  using (show_public = true);

grant select, insert, update, delete on public.profile_skill_frames to authenticated;
grant select on public.profile_skill_frames to anon;

-- ---------------------------------------------------------------------------
-- Per-user search history (cabinet right column)
-- ---------------------------------------------------------------------------
create table if not exists public.user_search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  query_normalized text not null,
  hit_count integer not null default 1,
  last_searched_at timestamptz not null default now(),
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_search_history_query_len check (
    char_length(trim(query)) between 2 and 80
  )
);

create unique index if not exists user_search_history_user_norm_uidx
  on public.user_search_history (user_id, query_normalized);

create index if not exists user_search_history_user_active_idx
  on public.user_search_history (user_id, last_searched_at desc)
  where dismissed_at is null;

alter table public.user_search_history enable row level security;

drop policy if exists "search history owner all" on public.user_search_history;
create policy "search history owner all"
  on public.user_search_history
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_search_history to authenticated;

create or replace function public.upsert_user_search_history(
  p_user_id uuid,
  p_query text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_q text := left(trim(coalesce(p_query, '')), 80);
  v_norm text;
begin
  if p_user_id is null then
    return;
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  if v_q ~* 'https?://' or v_q ~ '[0-9]{7,}' then
    return;
  end if;

  v_norm := lower(v_q);

  insert into public.user_search_history as h (
    user_id, query, query_normalized, hit_count, last_searched_at, dismissed_at
  )
  values (p_user_id, v_q, v_norm, 1, now(), null)
  on conflict (user_id, query_normalized) do update
  set
    query = excluded.query,
    hit_count = h.hit_count + 1,
    last_searched_at = now(),
    dismissed_at = null;
end;
$$;

revoke all on function public.upsert_user_search_history(uuid, text) from public;
grant execute on function public.upsert_user_search_history(uuid, text)
  to service_role, authenticated;

comment on table public.profile_skill_frames is
  'Personal cabinet skill/specialty frames; optional linked service listing.';
comment on table public.user_search_history is
  'Per-user search queries for cabinet feed frames.';
