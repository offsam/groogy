-- Keep the author's source-language description behind «Показать оригинал»
-- when the public `description` was translated to Russian.

alter table public.businesses
  add column if not exists description_original text;

alter table public.professionals
  add column if not exists description_original text;

alter table public.jobs
  add column if not exists description_original text;

alter table public.listings
  add column if not exists description_original text;

comment on column public.businesses.description_original is
  'Source-language about text; public description may be RU translation. Toggle: Показать оригинал.';

comment on column public.professionals.description_original is
  'Source-language about text; public description may be RU translation. Toggle: Показать оригинал.';

comment on column public.jobs.description_original is
  'Source-language job text; public description may be RU translation. Toggle: Показать оригинал.';

comment on column public.listings.description_original is
  'Source-language listing text; public description may be RU translation. Toggle: Показать оригинал.';
