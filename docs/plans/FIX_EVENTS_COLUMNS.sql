alter table public.events
  add column if not exists address_line text;

alter table public.events
  add column if not exists price_label text;

alter table public.events
  add column if not exists phone text;

alter table public.events
  add column if not exists telegram_url text;

alter table public.events
  add column if not exists venue_name text;

drop policy if exists "events owner select" on public.events;
create policy "events owner select"
  on public.events for select
  to authenticated
  using (owner_profile_id = (select auth.uid()));

notify pgrst, 'reload schema';
