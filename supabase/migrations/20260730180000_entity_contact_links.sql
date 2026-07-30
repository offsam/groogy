-- Extra contact channels (Facebook, TikTok, WhatsApp, VK, LinkedIn, …) without
-- a column per network. Legacy columns stay canonical for their own channels:
-- phone, email, website, instagram_url, telegram_url, yelp_url,
-- google_maps_url, booking_url.
--
-- Shape: [{"channel": "facebook", "value": "https://facebook.com/…", "label": null}]
-- `label` is used only by the "custom" channel (own link with its own title).

alter table public.businesses
  add column if not exists contact_links jsonb not null default '[]'::jsonb;

alter table public.professionals
  add column if not exists contact_links jsonb not null default '[]'::jsonb;

alter table public.businesses
  drop constraint if exists businesses_contact_links_is_array;
alter table public.businesses
  add constraint businesses_contact_links_is_array
  check (jsonb_typeof(contact_links) = 'array');

alter table public.professionals
  drop constraint if exists professionals_contact_links_is_array;
alter table public.professionals
  add constraint professionals_contact_links_is_array
  check (jsonb_typeof(contact_links) = 'array');

comment on column public.businesses.contact_links is
  'Extra contact channels beyond the dedicated columns: [{"channel","value","label"}]. Channel ids come from lib/contacts/channels.ts.';

comment on column public.professionals.contact_links is
  'Extra contact channels beyond the dedicated columns: [{"channel","value","label"}]. Channel ids come from lib/contacts/channels.ts.';
