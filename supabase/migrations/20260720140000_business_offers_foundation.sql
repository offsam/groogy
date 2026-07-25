-- PACK 2.7: Standardized business offers (not marketplace listings).

create type public.business_offer_type as enum (
  'service',
  'product',
  'vehicle',
  'property',
  'rental',
  'menu_item',
  'other'
);

create type public.business_offer_status as enum (
  'draft',
  'active',
  'archived'
);

create type public.business_offer_visibility as enum (
  'public',
  'unlisted'
);

create type public.business_offer_price_mode as enum (
  'fixed',
  'from',
  'range',
  'on_request',
  'free',
  'contact'
);

create table public.business_offers (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  offer_type        public.business_offer_type not null,
  title             text not null,
  slug              text not null,
  short_description text,
  description       text,
  category_id       uuid references public.categories(id) on delete set null,
  subcategory_id    uuid,
  status            public.business_offer_status not null default 'draft',
  visibility        public.business_offer_visibility not null default 'public',
  price_mode        public.business_offer_price_mode not null default 'contact',
  price_amount      numeric(12,2),
  price_min         numeric(12,2),
  price_max         numeric(12,2),
  currency          text not null default 'USD' references public.platform_currencies(code) on delete restrict,
  price_unit        text,
  primary_image_url text,
  sort_order        integer not null default 0,
  is_featured       boolean not null default false,
  is_available      boolean not null default true,
  attributes        jsonb not null default '{}'::jsonb,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, slug),
  constraint business_offers_title_len_chk check (
    char_length(btrim(title)) between 2 and 160
  ),
  constraint business_offers_short_len_chk check (
    short_description is null or char_length(btrim(short_description)) <= 300
  ),
  constraint business_offers_description_len_chk check (
    description is null or char_length(btrim(description)) <= 8000
  ),
  constraint business_offers_price_amount_chk check (
    price_amount is null or price_amount >= 0
  ),
  constraint business_offers_price_min_chk check (
    price_min is null or price_min >= 0
  ),
  constraint business_offers_price_max_chk check (
    price_max is null or price_max >= 0
  ),
  constraint business_offers_price_range_chk check (
    price_min is null or price_max is null or price_max >= price_min
  ),
  constraint business_offers_currency_chk check (currency = 'USD'),
  constraint business_offers_attributes_object_chk check (
    jsonb_typeof(attributes) = 'object'
  )
);

create index business_offers_business_status_idx
  on public.business_offers (business_id, status, sort_order);

create index business_offers_public_idx
  on public.business_offers (business_id, offer_type, sort_order)
  where status = 'active' and visibility = 'public' and is_available;

create index business_offers_search_idx
  on public.business_offers using gin (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(short_description, '') || ' ' || coalesce(description, ''))
  );

create trigger business_offers_set_updated_at
  before update on public.business_offers
  for each row execute function public.set_updated_at();

-- Media gallery (listing_media pattern)
create table public.business_offer_media (
  id           uuid primary key default gen_random_uuid(),
  offer_id     uuid not null references public.business_offers(id) on delete cascade,
  storage_path text not null,
  media_type   text not null default 'image',
  sort_order   integer not null default 0,
  alt_text     text,
  width        integer,
  height       integer,
  created_at   timestamptz not null default now(),
  constraint business_offer_media_type_chk check (media_type in ('image')),
  constraint business_offer_media_path_chk check (
    char_length(storage_path) between 3 and 500
    and storage_path not like '%..%'
  )
);

create unique index business_offer_media_sort_unique
  on public.business_offer_media (offer_id, sort_order);

create index business_offer_media_offer_idx
  on public.business_offer_media (offer_id, sort_order);

-- Helpers
create or replace function public.business_offer_is_public(p_offer public.business_offers)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    p_offer.status = 'active'
    and p_offer.visibility = 'public'
    and p_offer.is_available
    and exists (
      select 1 from public.businesses b
      where b.id = p_offer.business_id
        and b.status = 'approved'
    );
$$;

revoke all on function public.business_offer_is_public(public.business_offers) from public;
grant execute on function public.business_offer_is_public(public.business_offers) to anon, authenticated;

-- Attribute validation by offer_type
create or replace function public.business_offers_validate_attributes(
  p_type public.business_offer_type,
  p_attrs jsonb
)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  k text;
  allowed text[];
begin
  if p_attrs is null or jsonb_typeof(p_attrs) <> 'object' then
    raise exception 'attributes must be object' using errcode = 'P0001';
  end if;

  allowed := case p_type
    when 'service' then array['duration','service_area','booking_required','mobile_service','warranty']
    when 'product' then array['sku','condition','inventory_status','quantity','brand','model']
    when 'vehicle' then array['year','make','model','trim','mileage','vin','condition','body_type','fuel_type','transmission','exterior_color']
    when 'property' then array['listing_type','property_type','address','city','state','zip','bedrooms','bathrooms','sqft','lot_size','year_built','mls_number']
    when 'rental' then array['rental_period','deposit_amount','minimum_duration','availability_note','capacity']
    when 'menu_item' then array['ingredients','dietary_tags','portion','spice_level']
    else array[]::text[]
  end;

  for k in select jsonb_object_keys(p_attrs)
  loop
    if k = any(allowed) then
      continue;
    end if;
    raise exception 'invalid attribute % for offer type %', k, p_type using errcode = 'P0001';
  end loop;
end;
$$;

revoke all on function public.business_offers_validate_attributes(public.business_offer_type, jsonb) from public;

create or replace function public.business_offers_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  biz_status content_status;
  uid uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    new.business_id := old.business_id;
    new.created_at := old.created_at;
  end if;

  if uid is not null
     and not public.is_admin()
     and not public.owns_business(new.business_id) then
    raise exception 'not business owner' using errcode = '42501';
  end if;

  select status into biz_status from public.businesses where id = new.business_id;
  if biz_status is null then
    raise exception 'business not found' using errcode = 'P0001';
  end if;

  perform public.business_offers_validate_attributes(new.offer_type, new.attributes);

  if new.price_mode = 'fixed' and new.price_amount is null and new.price_mode <> 'free' then
    null;
  end if;

  if new.status = 'active' and new.published_at is null then
    new.published_at := now();
  end if;

  if new.status <> 'active' and tg_op = 'INSERT' then
    new.published_at := null;
  end if;

  if new.primary_image_url is not null
     and char_length(btrim(new.primary_image_url)) > 500 then
    raise exception 'primary_image_url too long' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger business_offers_enforce_row
  before insert or update on public.business_offers
  for each row execute function public.business_offers_enforce_row();

revoke all on function public.business_offers_enforce_row() from public, anon, authenticated;

-- Media enforce: business-offers/{business_id}/{offer_id}/{filename}
create or replace function public.business_offer_media_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  n int;
  bid uuid;
  expected_prefix text;
begin
  if tg_op = 'DELETE' then
    if (select auth.uid()) is not null
       and not public.is_admin()
       and not public.owns_business(
         (select business_id from public.business_offers where id = old.offer_id)
       ) then
      raise exception 'not business owner' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    new.offer_id := old.offer_id;
  end if;

  select business_id into bid from public.business_offers where id = new.offer_id;
  if bid is null then
    raise exception 'offer not found' using errcode = 'P0001';
  end if;

  if (select auth.uid()) is not null
     and not public.is_admin()
     and not public.owns_business(bid) then
    raise exception 'not business owner' using errcode = '42501';
  end if;

  expected_prefix := 'business-offers/' || bid::text || '/' || new.offer_id::text || '/';
  if new.storage_path is null
     or position('..' in new.storage_path) > 0
     or new.storage_path not like (expected_prefix || '%')
     or char_length(new.storage_path) <= char_length(expected_prefix)
  then
    raise exception 'invalid storage path' using errcode = 'P0001';
  end if;

  select count(*) into n from public.business_offer_media where offer_id = new.offer_id;
  if tg_op = 'INSERT' and n >= 10 then
    raise exception 'maximum 10 images per offer' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger business_offer_media_enforce
  before insert or update or delete on public.business_offer_media
  for each row execute function public.business_offer_media_enforce();

revoke all on function public.business_offer_media_enforce() from public, anon, authenticated;

-- Storage readability for business-offers prefix
create or replace function public.business_offer_storage_object_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.business_offers o
    join public.businesses b on b.id = o.business_id
    where (storage.foldername(p_name))[1] = 'business-offers'
      and (storage.foldername(p_name))[2]::uuid = b.id
      and (storage.foldername(p_name))[3]::uuid = o.id
      and public.business_offer_is_public(o)
  );
$$;

create or replace function public.business_offer_storage_object_owned(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.business_offers o
    where (storage.foldername(p_name))[1] = 'business-offers'
      and (storage.foldername(p_name))[2]::uuid = o.business_id
      and (storage.foldername(p_name))[3]::uuid = o.id
      and public.owns_business(o.business_id)
  );
$$;

revoke all on function public.business_offer_storage_object_readable(text) from public;
revoke all on function public.business_offer_storage_object_owned(text) from public;
grant execute on function public.business_offer_storage_object_readable(text) to anon, authenticated;
grant execute on function public.business_offer_storage_object_owned(text) to authenticated;

-- RLS
alter table public.business_offers enable row level security;
alter table public.business_offers force row level security;

alter table public.business_offer_media enable row level security;
alter table public.business_offer_media force row level security;

create policy "public business offers readable"
  on public.business_offers for select to anon, authenticated
  using (public.business_offer_is_public(business_offers));

create policy "owners read business offers"
  on public.business_offers for select to authenticated
  using (public.owns_business(business_id) or public.is_admin());

create policy "owners insert business offers"
  on public.business_offers for insert to authenticated
  with check (public.owns_business(business_id) or public.is_admin());

create policy "owners update business offers"
  on public.business_offers for update to authenticated
  using (public.owns_business(business_id) or public.is_admin())
  with check (public.owns_business(business_id) or public.is_admin());

create policy "owners delete business offers"
  on public.business_offers for delete to authenticated
  using (public.owns_business(business_id) or public.is_admin());

create policy "public offer media via readable offer"
  on public.business_offer_media for select to anon, authenticated
  using (
    exists (
      select 1 from public.business_offers o
      where o.id = offer_id and public.business_offer_is_public(o)
    )
  );

create policy "owners read offer media"
  on public.business_offer_media for select to authenticated
  using (
    exists (
      select 1 from public.business_offers o
      where o.id = offer_id
        and (public.owns_business(o.business_id) or public.is_admin())
    )
  );

create policy "owners write offer media"
  on public.business_offer_media for insert to authenticated
  with check (
    exists (
      select 1 from public.business_offers o
      where o.id = offer_id
        and (public.owns_business(o.business_id) or public.is_admin())
    )
  );

create policy "owners update offer media"
  on public.business_offer_media for update to authenticated
  using (
    exists (
      select 1 from public.business_offers o
      where o.id = offer_id
        and (public.owns_business(o.business_id) or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.business_offers o
      where o.id = offer_id
        and (public.owns_business(o.business_id) or public.is_admin())
    )
  );

create policy "owners delete offer media"
  on public.business_offer_media for delete to authenticated
  using (
    exists (
      select 1 from public.business_offers o
      where o.id = offer_id
        and (public.owns_business(o.business_id) or public.is_admin())
    )
  );

-- Column grants (owners via RLS; limit client writes)
revoke all on table public.business_offers from anon, authenticated;
grant select on public.business_offers to anon, authenticated;
grant insert (
  business_id, offer_type, title, slug, short_description, description,
  category_id, subcategory_id, status, visibility, price_mode,
  price_amount, price_min, price_max, currency, price_unit,
  primary_image_url, sort_order, is_featured, is_available, attributes
) on public.business_offers to authenticated;
grant update (
  offer_type, title, slug, short_description, description,
  category_id, subcategory_id, status, visibility, price_mode,
  price_amount, price_min, price_max, currency, price_unit,
  primary_image_url, sort_order, is_featured, is_available, attributes
) on public.business_offers to authenticated;
grant delete on public.business_offers to authenticated;

revoke all on table public.business_offer_media from anon, authenticated;
grant select on public.business_offer_media to anon, authenticated;
grant insert (offer_id, storage_path, media_type, sort_order, alt_text, width, height)
  on public.business_offer_media to authenticated;
grant update (storage_path, media_type, sort_order, alt_text, width, height)
  on public.business_offer_media to authenticated;
grant delete on public.business_offer_media to authenticated;

-- Storage policies (listing-images bucket)
create policy "business offer images public read"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = 'business-offers'
    and public.business_offer_storage_object_readable(name)
  );

create policy "business offer images owner insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = 'business-offers'
    and public.business_offer_storage_object_owned(name)
  );

create policy "business offer images owner update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = 'business-offers'
    and public.business_offer_storage_object_owned(name)
  )
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = 'business-offers'
    and public.business_offer_storage_object_owned(name)
  );

create policy "business offer images owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = 'business-offers'
    and public.business_offer_storage_object_owned(name)
  );

-- Public catalog view (minimal columns)
create or replace view public.business_offers_public
with (security_invoker = true) as
select
  o.id,
  o.business_id,
  b.slug as business_slug,
  b.name as business_name,
  o.offer_type,
  o.title,
  o.slug,
  o.short_description,
  o.price_mode,
  o.price_amount,
  o.price_min,
  o.price_max,
  o.currency,
  o.price_unit,
  o.primary_image_url,
  o.is_featured,
  o.is_available,
  o.sort_order,
  o.published_at,
  o.attributes
from public.business_offers o
join public.businesses b on b.id = o.business_id
where public.business_offer_is_public(o);

revoke all on public.business_offers_public from public;
grant select on public.business_offers_public to anon, authenticated;
