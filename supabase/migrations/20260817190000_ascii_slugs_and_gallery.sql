-- Latin/English public slugs + photo gallery on catalog cards.
-- Old Cyrillic URLs stay reachable via slug_aliases.

alter table public.businesses
  add column if not exists slug_aliases text[] not null default '{}'::text[],
  add column if not exists gallery_urls text[] not null default '{}'::text[];

alter table public.professionals
  add column if not exists slug_aliases text[] not null default '{}'::text[],
  add column if not exists gallery_urls text[] not null default '{}'::text[];

alter table public.churches
  add column if not exists slug_aliases text[] not null default '{}'::text[],
  add column if not exists gallery_urls text[] not null default '{}'::text[];

alter table public.events
  add column if not exists slug_aliases text[] not null default '{}'::text[];

alter table public.jobs
  add column if not exists slug_aliases text[] not null default '{}'::text[];

create index if not exists businesses_slug_aliases_gin
  on public.businesses using gin (slug_aliases);
create index if not exists professionals_slug_aliases_gin
  on public.professionals using gin (slug_aliases);
create index if not exists churches_slug_aliases_gin
  on public.churches using gin (slug_aliases);
create index if not exists events_slug_aliases_gin
  on public.events using gin (slug_aliases);
create index if not exists jobs_slug_aliases_gin
  on public.jobs using gin (slug_aliases);

comment on column public.businesses.slug_aliases is
  'Previous public slugs (Cyrillic or renamed) — 301 via app lookup.';
comment on column public.businesses.gallery_urls is
  'Extra public photos (certificates, interior) besides image_url.';
comment on column public.professionals.gallery_urls is
  'Extra public photos (certificates, work samples) besides image_url.';
comment on column public.churches.gallery_urls is
  'Extra public photos (interior, certificates) besides image_url.';
