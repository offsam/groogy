-- Transfers + Лечу listing domains (enums already added in prior statement).

-- ============ DETAIL TABLES ============
create table if not exists public.transfer_listing_details (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  category_id uuid references public.listing_categories(id) on delete set null,
  from_country text not null,
  to_country text not null,
  transfer_method text not null default 'bank'
    check (transfer_method in ('bank', 'crypto', 'cash', 'other')),
  fee_percent numeric(6,2),
  fee_fixed_usd numeric(12,2),
  min_amount_usd numeric(12,2),
  max_amount_usd numeric(12,2),
  processing_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transfer_listing_details_category_idx
  on public.transfer_listing_details (category_id);
create index if not exists transfer_listing_details_route_idx
  on public.transfer_listing_details (from_country, to_country);

drop trigger if exists transfer_listing_details_set_updated_at on public.transfer_listing_details;
create trigger transfer_listing_details_set_updated_at
  before update on public.transfer_listing_details
  for each row execute function public.set_updated_at();

create table if not exists public.lechu_listing_details (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  category_id uuid references public.listing_categories(id) on delete set null,
  departure_country text not null,
  destination_country text not null,
  departure_date date,
  carry_types text[] not null default array['documents']::text[],
  max_weight_kg numeric(8,2),
  size_limit text,
  reward_type text not null default 'negotiable'
    check (reward_type in ('free', 'paid', 'negotiable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lechu_listing_details_category_idx
  on public.lechu_listing_details (category_id);
create index if not exists lechu_listing_details_route_idx
  on public.lechu_listing_details (departure_country, destination_country);

drop trigger if exists lechu_listing_details_set_updated_at on public.lechu_listing_details;
create trigger lechu_listing_details_set_updated_at
  before update on public.lechu_listing_details
  for each row execute function public.set_updated_at();

-- ============ RLS ============
alter table public.transfer_listing_details enable row level security;
alter table public.transfer_listing_details force row level security;
revoke all on table public.transfer_listing_details from anon, authenticated;
grant select on public.transfer_listing_details to anon, authenticated;
grant insert, update on public.transfer_listing_details to authenticated;

drop policy if exists "transfer details readable with listing" on public.transfer_listing_details;
create policy "transfer details readable with listing"
  on public.transfer_listing_details for select to anon, authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (
          (l.status::text = 'active' and l.visibility in ('public', 'unlisted'))
          or (l.status::text = 'completed' and l.visibility = 'public')
          or l.owner_id = (select auth.uid())
          or public.is_admin()
        )
    )
  );

drop policy if exists "owners write transfer details" on public.transfer_listing_details;
create policy "owners write transfer details"
  on public.transfer_listing_details for insert to authenticated
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owners update transfer details" on public.transfer_listing_details;
create policy "owners update transfer details"
  on public.transfer_listing_details for update to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

alter table public.lechu_listing_details enable row level security;
alter table public.lechu_listing_details force row level security;
revoke all on table public.lechu_listing_details from anon, authenticated;
grant select on public.lechu_listing_details to anon, authenticated;
grant insert, update on public.lechu_listing_details to authenticated;

drop policy if exists "lechu details readable with listing" on public.lechu_listing_details;
create policy "lechu details readable with listing"
  on public.lechu_listing_details for select to anon, authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (
          (l.status::text = 'active' and l.visibility in ('public', 'unlisted'))
          or (l.status::text = 'completed' and l.visibility = 'public')
          or l.owner_id = (select auth.uid())
          or public.is_admin()
        )
    )
  );

drop policy if exists "owners write lechu details" on public.lechu_listing_details;
create policy "owners write lechu details"
  on public.lechu_listing_details for insert to authenticated
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owners update lechu details" on public.lechu_listing_details;
create policy "owners update lechu details"
  on public.lechu_listing_details for update to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

-- ============ CATALOG VIEWS ============
drop view if exists public.transfers_catalog cascade;
create view public.transfers_catalog
with (security_invoker = true) as
select
  l.id,
  l.title,
  l.description,
  l.price_amount,
  l.price_currency,
  l.city,
  l.state,
  l.author_visibility,
  l.published_at,
  l.updated_at,
  l.favorites_count,
  l.publisher_type,
  d.from_country,
  d.to_country,
  d.transfer_method,
  d.fee_percent,
  d.fee_fixed_usd,
  d.min_amount_usd,
  d.max_amount_usd,
  d.processing_days,
  c.slug as category_slug,
  c.name_ru as category_name_ru,
  public.resolve_listing_publisher(
    l.publisher_type,
    l.publisher_business_id,
    l.owner_id,
    l.author_visibility
  ) as publisher
from public.listings l
join public.transfer_listing_details d on d.listing_id = l.id
left join public.listing_categories c on c.id = d.category_id
where l.listing_type::text = 'transfer'
  and l.status::text = 'active'
  and l.visibility = 'public';

drop view if exists public.lechu_catalog cascade;
create view public.lechu_catalog
with (security_invoker = true) as
select
  l.id,
  l.title,
  l.description,
  l.price_amount,
  l.price_currency,
  l.city,
  l.state,
  l.author_visibility,
  l.published_at,
  l.updated_at,
  l.favorites_count,
  l.publisher_type,
  d.departure_country,
  d.destination_country,
  d.departure_date,
  d.carry_types,
  d.max_weight_kg,
  d.size_limit,
  d.reward_type,
  c.slug as category_slug,
  c.name_ru as category_name_ru,
  public.resolve_listing_publisher(
    l.publisher_type,
    l.publisher_business_id,
    l.owner_id,
    l.author_visibility
  ) as publisher
from public.listings l
join public.lechu_listing_details d on d.listing_id = l.id
left join public.listing_categories c on c.id = d.category_id
where l.listing_type::text = 'transport_carry'
  and l.status::text = 'active'
  and l.visibility = 'public';

revoke all on public.transfers_catalog from public;
grant select on public.transfers_catalog to anon, authenticated;
revoke all on public.lechu_catalog from public;
grant select on public.lechu_catalog to anon, authenticated;

-- ============ SEED CATEGORIES ============
insert into public.listing_categories (
  slug, name_ru, name_en, listing_type, domain, sort_order, is_active
)
values
  ('transfer-us-ru', 'США → Россия', 'US → Russia', 'transfer', 'transfers', 10, true),
  ('transfer-ru-us', 'Россия → США', 'Russia → US', 'transfer', 'transfers', 20, true),
  ('transfer-us-ua', 'США → Украина', 'US → Ukraine', 'transfer', 'transfers', 30, true),
  ('transfer-us-kz', 'США → Казахстан', 'US → Kazakhstan', 'transfer', 'transfers', 40, true),
  ('transfer-other', 'Другие маршруты', 'Other routes', 'transfer', 'transfers', 100, true),
  ('lechu-us-ru', 'США → Россия', 'US → Russia', 'transport_carry', 'lechu', 10, true),
  ('lechu-ru-us', 'Россия → США', 'Russia → US', 'transport_carry', 'lechu', 20, true),
  ('lechu-us-ua', 'США → Украина', 'US → Ukraine', 'transport_carry', 'lechu', 30, true),
  ('lechu-us-eu', 'США → Европа', 'US → Europe', 'transport_carry', 'lechu', 40, true),
  ('lechu-other', 'Другие маршруты', 'Other routes', 'transport_carry', 'lechu', 100, true)
on conflict (slug) do update set
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  listing_type = excluded.listing_type,
  domain = excluded.domain,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

-- ============ PUBLISH VALIDATION ============
create or replace function public.listings_validate_publish()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  d public.marketplace_listing_details%rowtype;
  s public.service_listing_details%rowtype;
  t public.transfer_listing_details%rowtype;
  lc public.lechu_listing_details%rowtype;
  cat_domain listing_domain;
  cat_type listing_type;
  cat_active boolean;
begin
  if tg_op <> 'UPDATE'
     or new.status::text <> 'active'
     or old.status::text = 'active' then
    return new;
  end if;

  if new.listing_type = 'marketplace_item' then
    if new.city is null or new.state is null then
      raise exception 'city and state required to publish' using errcode = 'P0001';
    end if;
    select * into d from public.marketplace_listing_details where listing_id = new.id;
    if not found then
      raise exception 'marketplace details required' using errcode = 'P0001';
    end if;
    if d.category_id is null then
      raise exception 'category required to publish' using errcode = 'P0001';
    end if;
    select c.domain, c.listing_type, c.is_active
      into cat_domain, cat_type, cat_active
    from public.listing_categories c
    where c.id = d.category_id;
    if not found
       or cat_active is not true
       or cat_type is distinct from 'marketplace_item'
       or cat_domain is distinct from 'marketplace' then
      raise exception 'inactive or invalid marketplace category' using errcode = 'P0001';
    end if;
    if d.transaction_type = 'sell' and (new.price_amount is null or new.price_amount < 0) then
      raise exception 'price required for sell listings' using errcode = 'P0001';
    end if;
    if d.transaction_type = 'free' then
      new.price_amount := 0;
    end if;
    if public.marketplace_looks_like_service(new.title, new.description) then
      raise exception 'this looks like a service — please post it in the Services section'
        using errcode = 'P0001';
    end if;
  end if;

  if new.listing_type = 'service' then
    if new.city is null or new.state is null then
      raise exception 'city and state required to publish' using errcode = 'P0001';
    end if;
    select * into s from public.service_listing_details where listing_id = new.id;
    if not found then
      raise exception 'service details required' using errcode = 'P0001';
    end if;
    if s.service_category_id is null then
      raise exception 'service category required to publish' using errcode = 'P0001';
    end if;
    select c.domain, c.listing_type, c.is_active
      into cat_domain, cat_type, cat_active
    from public.listing_categories c
    where c.id = s.service_category_id;
    if not found
       or cat_active is not true
       or cat_type is distinct from 'service'
       or cat_domain is distinct from 'services' then
      raise exception 'inactive or invalid service category' using errcode = 'P0001';
    end if;
    if s.pricing_type in ('fixed', 'from', 'hourly', 'daily')
       and s.price_from is null then
      raise exception 'price_from required for pricing_type %', s.pricing_type
        using errcode = 'P0001';
    end if;
  end if;

  if new.listing_type::text = 'transfer' then
    select * into t from public.transfer_listing_details where listing_id = new.id;
    if not found then
      raise exception 'transfer details required' using errcode = 'P0001';
    end if;
    if length(btrim(t.from_country)) < 2 or length(btrim(t.to_country)) < 2 then
      raise exception 'from_country and to_country required' using errcode = 'P0001';
    end if;
    if t.category_id is null then
      raise exception 'transfer category required to publish' using errcode = 'P0001';
    end if;
    select c.domain, c.listing_type, c.is_active
      into cat_domain, cat_type, cat_active
    from public.listing_categories c
    where c.id = t.category_id;
    if not found
       or cat_active is not true
       or cat_type::text is distinct from 'transfer'
       or cat_domain::text is distinct from 'transfers' then
      raise exception 'inactive or invalid transfer category' using errcode = 'P0001';
    end if;
  end if;

  if new.listing_type::text = 'transport_carry' then
    select * into lc from public.lechu_listing_details where listing_id = new.id;
    if not found then
      raise exception 'lechu details required' using errcode = 'P0001';
    end if;
    if length(btrim(lc.departure_country)) < 2
       or length(btrim(lc.destination_country)) < 2 then
      raise exception 'departure and destination countries required' using errcode = 'P0001';
    end if;
    if lc.category_id is null then
      raise exception 'lechu category required to publish' using errcode = 'P0001';
    end if;
    select c.domain, c.listing_type, c.is_active
      into cat_domain, cat_type, cat_active
    from public.listing_categories c
    where c.id = lc.category_id;
    if not found
       or cat_active is not true
       or cat_type::text is distinct from 'transport_carry'
       or cat_domain::text is distinct from 'lechu' then
      raise exception 'inactive or invalid lechu category' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.listings_validate_publish() from public, anon, authenticated;

-- Allow paused for transfer / lechu like services
create or replace function public.transition_listing_status(
  p_listing_id uuid,
  p_from listing_status,
  p_to listing_status
)
returns public.listings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  row public.listings%rowtype;
  uid uuid := (select auth.uid());
  ltype text;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select listing_type::text into ltype
  from public.listings
  where id = p_listing_id and owner_id = uid;

  if not found then
    raise exception 'status transition conflict or not allowed' using errcode = 'P0001';
  end if;

  if ltype in ('service', 'transfer', 'transport_carry') and p_to::text = 'reserved' then
    raise exception 'reserved is not allowed for this listing type' using errcode = 'P0001';
  end if;
  if ltype not in ('service', 'transfer', 'transport_carry') and p_to::text = 'paused' then
    raise exception 'paused is only allowed for service-like listings' using errcode = 'P0001';
  end if;

  update public.listings l
  set status = p_to
  where l.id = p_listing_id
    and l.owner_id = uid
    and l.status = p_from
  returning * into row;

  if not found then
    raise exception 'status transition conflict or not allowed' using errcode = 'P0001';
  end if;
  return row;
end;
$$;

revoke all on function public.transition_listing_status(uuid, listing_status, listing_status) from public, anon;
grant execute on function public.transition_listing_status(uuid, listing_status, listing_status) to authenticated;
