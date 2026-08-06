-- "Купонинг" — a curated deals/coupons section. One (or a few, later)
-- specific people are the only ones who can publish directly; everyone
-- else can only view, comment, and *propose* a post for the curator to
-- approve or reject. Not tied to a region/hub — nationwide feed.
-- SoT for the feature discussion: chat with Sam, 2026-08-05.

alter table public.categories drop constraint if exists categories_domain_chk;
alter table public.categories add constraint categories_domain_chk
  check (domain = any (array['business'::text, 'marketplace'::text, 'services'::text, 'professional'::text, 'coupons'::text]));

create table if not exists public.coupon_curators (
  profile_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.coupon_curators enable row level security;
alter table public.coupon_curators force row level security;
-- No anon/authenticated policies at all — only service_role (our admin
-- action) reads/writes this table. Mirrors how sensitive role tables are
-- handled elsewhere in this app.
revoke all on table public.coupon_curators from anon, authenticated;

create or replace function public.is_coupon_curator()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.coupon_curators c
    where c.profile_id = (select auth.uid())
  );
$$;

revoke all on function public.is_coupon_curator() from public, anon;
grant execute on function public.is_coupon_curator() to authenticated;

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  curator_profile_id uuid not null references auth.users (id) on delete cascade,
  curator_display_name text,
  category_id uuid references public.categories (id) on delete set null,
  title text not null,
  body text not null,
  image_url text,
  link_url text,
  promo_code text,
  status text not null default 'published'
    check (status in ('published', 'archived')),
  source text not null default 'direct'
    check (source in ('direct', 'submission')),
  source_submission_id uuid,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_title_len_chk check (char_length(title) between 1 and 200),
  constraint coupons_body_len_chk check (char_length(body) between 1 and 4000),
  constraint coupons_link_url_len_chk check (link_url is null or char_length(link_url) <= 2000),
  constraint coupons_promo_code_len_chk check (promo_code is null or char_length(promo_code) <= 100)
);

create index if not exists coupons_status_published_idx
  on public.coupons (status, published_at desc);
create index if not exists coupons_category_idx on public.coupons (category_id);
create index if not exists coupons_curator_idx on public.coupons (curator_profile_id);

alter table public.coupons enable row level security;
alter table public.coupons force row level security;

drop policy if exists "anyone can read published coupons" on public.coupons;
create policy "anyone can read published coupons"
  on public.coupons for select
  to anon, authenticated
  using (status = 'published');

-- Writes only via service_role (lib/coupons/actions.ts re-checks
-- is_coupon_curator server-side before ever touching this table).
revoke insert, update, delete on table public.coupons from anon, authenticated;
grant select on table public.coupons to anon, authenticated;

create table if not exists public.coupon_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by_profile_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text not null,
  image_url text,
  link_url text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  resulting_coupon_id uuid references public.coupons (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint coupon_submissions_title_len_chk check (char_length(title) between 1 and 200),
  constraint coupon_submissions_body_len_chk check (char_length(body) between 1 and 4000),
  constraint coupon_submissions_link_url_len_chk check (link_url is null or char_length(link_url) <= 2000),
  constraint coupon_submissions_review_note_len_chk check (review_note is null or char_length(review_note) <= 2000)
);

create index if not exists coupon_submissions_status_idx
  on public.coupon_submissions (status, created_at desc);

alter table public.coupon_submissions enable row level security;
alter table public.coupon_submissions force row level security;

drop policy if exists "authenticated can submit coupons" on public.coupon_submissions;
create policy "authenticated can submit coupons"
  on public.coupon_submissions for insert
  to authenticated
  with check (
    submitted_by_profile_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and resulting_coupon_id is null
  );

drop policy if exists "submitter can read own submissions" on public.coupon_submissions;
create policy "submitter can read own submissions"
  on public.coupon_submissions for select
  to authenticated
  using (submitted_by_profile_id = (select auth.uid()));

-- Review (approve/reject) always goes through the service-role action so
-- we can atomically create the resulting coupons row — no direct
-- authenticated UPDATE policy.
revoke update, delete on table public.coupon_submissions from anon, authenticated;

create table if not exists public.coupon_comments (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  profile_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  status text not null default 'visible'
    check (status in ('visible', 'hidden')),
  created_at timestamptz not null default now(),
  constraint coupon_comments_body_len_chk check (char_length(body) between 1 and 1000)
);

create index if not exists coupon_comments_coupon_idx
  on public.coupon_comments (coupon_id, created_at asc);

alter table public.coupon_comments enable row level security;
alter table public.coupon_comments force row level security;

drop policy if exists "anyone can read visible comments" on public.coupon_comments;
create policy "anyone can read visible comments"
  on public.coupon_comments for select
  to anon, authenticated
  using (status = 'visible');

drop policy if exists "authenticated can comment" on public.coupon_comments;
create policy "authenticated can comment"
  on public.coupon_comments for insert
  to authenticated
  with check (profile_id = (select auth.uid()) and status = 'visible');

revoke update, delete on table public.coupon_comments from anon, authenticated;

-- Starter categories for the "coupons" taxonomy domain (categories.domain
-- already used this way for other section-scoped taxonomies). Exact final
-- list is TBD — editable later via /admin/system/taxonomy, this is just a
-- non-empty starting point so the publish form isn't blank on day one.
insert into public.categories (slug, name, name_en, domain, is_active, sort_order)
values
  ('coupons-food', 'Еда и рестораны', 'Food & Dining', 'coupons', true, 10),
  ('coupons-beauty', 'Красота и здоровье', 'Beauty & Health', 'coupons', true, 20),
  ('coupons-shopping', 'Магазины и товары', 'Shopping', 'coupons', true, 30),
  ('coupons-services', 'Услуги', 'Services', 'coupons', true, 40),
  ('coupons-entertainment', 'Развлечения и события', 'Entertainment', 'coupons', true, 50),
  ('coupons-other', 'Другое', 'Other', 'coupons', true, 90)
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
