-- Event affiche fields: venue address, price label, organizer contacts.

alter table public.events
  add column if not exists address_line text;

alter table public.events
  add column if not exists price_label text;

alter table public.events
  add column if not exists phone text;

alter table public.events
  add column if not exists telegram_url text;

comment on column public.events.address_line is
  'Venue street / place name for the event affiche.';
comment on column public.events.price_label is
  'Free-form price display, e.g. Бесплатно, $25, от $10.';
comment on column public.events.phone is
  'Organizer phone (optional).';
comment on column public.events.telegram_url is
  'Organizer Telegram URL (optional).';

notify pgrst, 'reload schema';
