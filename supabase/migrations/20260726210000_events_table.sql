-- Community events (meetups, webinars, streams) published to the platform.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete set null,
  provider_business_id uuid references public.businesses(id) on delete set null,
  title text not null,
  slug text not null unique,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  event_at_label text,
  city text,
  state_code text,
  latitude double precision,
  longitude double precision,
  cover_image_url text,
  registration_url text,
  source_url text,
  source_channel text,
  format text
    check (format is null or format in ('online', 'offline', 'hybrid', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_status_starts_idx
  on public.events (status, starts_at desc nulls last);

create index if not exists events_city_idx
  on public.events (city)
  where city is not null;

comment on table public.events is
  'Community events / webinars / meetups shown on /events.';

alter table public.events enable row level security;

drop policy if exists "events public read published" on public.events;
create policy "events public read published"
  on public.events for select
  to anon, authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists "events admin write" on public.events;
create policy "events admin write"
  on public.events for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;
grant all on public.events to service_role;

create or replace function public.events_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_updated_at on public.events;
create trigger events_updated_at
  before insert or update on public.events
  for each row
  execute function public.events_set_updated_at();

-- Preview cover on recommendation cards before / after publish.
alter table public.import_comment_recommendations
  add column if not exists cover_image_url text;

-- Public storage for event covers (service_role uploads from publish script).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-images',
  'event-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "event covers public read" on storage.objects;
create policy "event covers public read"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = 'covers'
  );

drop policy if exists "event covers admin insert" on storage.objects;
create policy "event covers admin insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'event-images'
    and public.is_admin()
    and (storage.foldername(name))[1] = 'covers'
    and name not like '%..%'
  );

drop policy if exists "event covers admin update" on storage.objects;
create policy "event covers admin update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'event-images'
    and public.is_admin()
  )
  with check (
    bucket_id = 'event-images'
    and public.is_admin()
    and (storage.foldername(name))[1] = 'covers'
    and name not like '%..%'
  );

drop policy if exists "event covers admin delete" on storage.objects;
create policy "event covers admin delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'event-images'
    and public.is_admin()
  );
