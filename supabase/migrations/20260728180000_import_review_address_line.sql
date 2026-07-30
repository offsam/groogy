-- Street address from website enrich (shared workplace OK — fill-empty only).
alter table public.import_review_items
  add column if not exists address_line text;

alter table public.import_review_items
  add column if not exists postal_code text;

comment on column public.import_review_items.address_line is
  'Street / suite from website or post (may be a shared workplace). Fill-empty via enrich.';

comment on column public.import_review_items.postal_code is
  'US ZIP when known from website address parse.';
