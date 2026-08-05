-- Church profile blocks: schedule + ministries (no priced business offers).

alter table public.churches
  add column if not exists opening_hours jsonb,
  add column if not exists schedule_text text,
  add column if not exists ministries jsonb not null default '[]'::jsonb;

comment on column public.churches.opening_hours is
  'Weekly hours JSON (same shape as businesses.opening_hours), when known.';
comment on column public.churches.schedule_text is
  'Short worship / service schedule blurb (e.g. «Вс 11:00 · онлайн»).';
comment on column public.churches.ministries is
  'Non-priced programs: [{title, detail?, url?}]. Shown as «Служения».';

drop view if exists public.churches_public;
create view public.churches_public
with (security_invoker = false)
as
select
  c.id,
  c.slug,
  c.name,
  c.description,
  c.description_original,
  c.image_url,
  c.status,
  c.address_line,
  c.city,
  c.state_code,
  c.postal_code,
  c.region,
  c.county_geoid,
  c.latitude,
  c.longitude,
  c.location_precision,
  c.google_maps_url,
  c.opening_hours,
  c.schedule_text,
  c.ministries,
  c.source_kind,
  c.published_at,
  c.created_at,
  c.updated_at,
  (c.phone is not null and length(btrim(c.phone)) > 0) as has_phone,
  (c.email is not null and length(btrim(c.email)) > 0) as has_email,
  (c.website is not null and length(btrim(c.website)) > 0) as has_website,
  (c.instagram_url is not null and length(btrim(c.instagram_url)) > 0) as has_instagram,
  (c.telegram_url is not null and length(btrim(c.telegram_url)) > 0) as has_telegram,
  (
    (c.source_url is not null and length(btrim(c.source_url)) > 0)
    or c.source_kind = 'platform'
  ) as has_source
from public.churches c
where c.status = 'approved';

comment on view public.churches_public is
  'Public church cards — presence flags only; contacts via get_church_contacts.';

grant select on public.churches_public to anon, authenticated, service_role;
