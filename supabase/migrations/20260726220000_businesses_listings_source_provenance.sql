-- Provenance: original post/source for imported cards (gated via contacts reveal).
-- platform / null + empty source_url = created on KRUGI.

alter table public.businesses
  add column if not exists source_url text,
  add column if not exists source_kind text;

alter table public.listings
  add column if not exists source_url text,
  add column if not exists source_kind text;

alter table public.businesses
  drop constraint if exists businesses_source_kind_check;

alter table public.businesses
  add constraint businesses_source_kind_check
  check (
    source_kind is null
    or source_kind in ('telegram', 'facebook', 'platform')
  );

alter table public.listings
  drop constraint if exists listings_source_kind_check;

alter table public.listings
  add constraint listings_source_kind_check
  check (
    source_kind is null
    or source_kind in ('telegram', 'facebook', 'platform')
  );

comment on column public.businesses.source_url is
  'Original post/source URL (Telegram/Facebook). Shown only after contact reveal.';
comment on column public.businesses.source_kind is
  'telegram | facebook | platform | null. platform/null without URL = created on KRUGI.';
comment on column public.listings.source_url is
  'Original post/source URL for imported listings. Gated like business contacts.';
comment on column public.listings.source_kind is
  'telegram | facebook | platform | null.';

-- Public catalog: expose has_source / has_telegram flags only (no URLs).
-- Must drop: CREATE OR REPLACE cannot insert columns mid-list.
drop view if exists public.businesses_public;

create view public.businesses_public
with (security_invoker = false)
as
select
  b.id,
  b.slug,
  b.category_id,
  b.name,
  b.short_description,
  b.description,
  b.status,
  b.rating_avg,
  b.reviews_count,
  b.ai_verified_reviews_count,
  b.transaction_verified_reviews_count,
  b.google_rating,
  b.google_reviews_count,
  b.image_url,
  b.city,
  b.region,
  b.latitude,
  b.longitude,
  b.location_precision,
  b.opening_hours,
  b.created_at,
  b.updated_at,
  (b.phone is not null and length(btrim(b.phone)) > 0) as has_phone,
  (b.email is not null and length(btrim(b.email)) > 0) as has_email,
  (
    b.website is not null
    and length(btrim(b.website)) > 0
    and b.website !~* 'instagram\.com|facebook\.com|fb\.com|yelp\.com|t\.me/|telegram\.me/'
  ) as has_website,
  (
    (b.instagram_url is not null and length(btrim(b.instagram_url)) > 0)
    or (b.website is not null and b.website ~* 'instagram\.com')
  ) as has_instagram,
  (
    b.telegram_url is not null
    and length(btrim(b.telegram_url)) > 0
  ) as has_telegram,
  (
    (b.yelp_url is not null and length(btrim(b.yelp_url)) > 0)
    or (b.website is not null and b.website ~* 'yelp\.com')
  ) as has_yelp,
  (b.website is not null and b.website ~* 'facebook\.com|fb\.com') as has_facebook,
  (
    (b.google_maps_url is not null and length(btrim(b.google_maps_url)) > 0)
    or (b.latitude is not null and b.longitude is not null)
  ) as has_google_maps,
  (
    b.source_url is not null
    and length(btrim(b.source_url)) > 0
    and coalesce(b.source_kind, '') <> 'platform'
  ) as has_source
from public.businesses b
where b.status = 'approved';

comment on view public.businesses_public is
  'Approved businesses without phone/email/URLs — safe for anon catalog scrape surface.';

grant select on public.businesses_public to anon, authenticated;

notify pgrst, 'reload schema';
