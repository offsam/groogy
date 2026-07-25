-- External Yelp business profile URL.
alter table public.businesses
  add column if not exists yelp_url text;

comment on column public.businesses.yelp_url is
  'Public Yelp business page URL shown in profile contacts.';
