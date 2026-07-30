-- Shared promotions (акции) for every public entity type.
-- One card per promotion; profiles only show the section when at least one
-- active (non-expired) row exists.

create table if not exists public.entity_promotions (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null
    check (owner_type in (
      'business',
      'professional',
      'listing',
      'event',
      'job',
      'service',
      'transfer'
    )),
  owner_id uuid not null,
  title text not null,
  body text,
  discount_label text,
  discount_percent numeric(5,2),
  category_id uuid references public.categories(id) on delete set null,
  status text not null default 'active'
    check (status in ('draft', 'active', 'archived', 'expired')),
  valid_from date,
  valid_until date,
  sort_order integer not null default 0,
  source_import_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entity_promotions_title_len_chk check (
    char_length(btrim(title)) between 2 and 160
  ),
  constraint entity_promotions_body_len_chk check (
    body is null or char_length(btrim(body)) <= 4000
  ),
  constraint entity_promotions_dates_chk check (
    valid_from is null
    or valid_until is null
    or valid_until >= valid_from
  )
);

create index if not exists entity_promotions_owner_idx
  on public.entity_promotions (owner_type, owner_id, status, sort_order);

create index if not exists entity_promotions_public_idx
  on public.entity_promotions (status, valid_until, category_id)
  where status = 'active';

create index if not exists entity_promotions_category_idx
  on public.entity_promotions (category_id)
  where status = 'active' and category_id is not null;

comment on table public.entity_promotions is
  'Акции as separate cards owned by any public entity. Expired rows stay for history but are hidden from public lists.';

-- Queue: structured promotions extracted during enrich (before publish).
alter table public.import_review_items
  add column if not exists promotions jsonb not null default '[]'::jsonb;

alter table public.import_review_items
  drop constraint if exists import_review_items_promotions_array_chk;
alter table public.import_review_items
  add constraint import_review_items_promotions_array_chk
  check (jsonb_typeof(promotions) = 'array');

-- Public read of active, non-expired promotions.
alter table public.entity_promotions enable row level security;

drop policy if exists "entity_promotions public read active" on public.entity_promotions;
create policy "entity_promotions public read active"
  on public.entity_promotions for select
  to anon, authenticated
  using (
    status = 'active'
    and (valid_until is null or valid_until >= current_date)
  );

drop policy if exists "entity_promotions admin all" on public.entity_promotions;
create policy "entity_promotions admin all"
  on public.entity_promotions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.entity_promotions to anon, authenticated;
grant insert, update, delete on public.entity_promotions to authenticated;
grant all on public.entity_promotions to service_role;

-- Move <<<PROMOS>>> marker blocks out of business descriptions into cards.
-- Heuristic promo paragraphs (no markers) are left alone — moderators can
-- promote them later; only explicit markers are migrated automatically.
do $$
declare
  r record;
  promo_body text;
  about_rest text;
  title text;
begin
  for r in
    select id, description, category_id
    from public.businesses
    where description ~* '<<<PROMOS>>>'
  loop
    promo_body := null;
    about_rest := r.description;
    about_rest := regexp_replace(
      about_rest,
      '<<<PROMOS>>>\s*([\s\S]*?)\s*<<<END>>>',
      '',
      'gi'
    );
    select (regexp_matches(
      r.description,
      '<<<PROMOS>>>\s*([\s\S]*?)\s*<<<END>>>',
      'gi'
    ))[1]
    into promo_body;

    if promo_body is null or length(btrim(promo_body)) < 3 then
      continue;
    end if;

    title := left(
      btrim(regexp_replace(split_part(promo_body, E'\n', 1), '\s+', ' ', 'g')),
      160
    );
    if length(title) < 2 then
      title := 'Акция';
    end if;

    insert into public.entity_promotions (
      owner_type, owner_id, title, body, category_id, status, sort_order
    ) values (
      'business', r.id, title, btrim(promo_body), r.category_id, 'active', 0
    );

    update public.businesses
    set
      description = nullif(btrim(regexp_replace(about_rest, E'\n{3,}', E'\n\n', 'g')), ''),
      updated_at = now()
    where id = r.id;
  end loop;
end $$;
