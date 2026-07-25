-- Migration: mvp_core_schema
-- Первая миграция MVP для Russian Business AI.
-- Источник: docs/database-schema.md (взято только MVP-подмножество).
-- Область: справочник категорий, карточки бизнесов, профили пользователей,
-- подтверждение владения бизнесом (claims) и основа кабинета владельца
-- (главная, поиск со списком и картой, страница компании, аккаунт).
-- НЕ включено (отложено на следующие этапы согласно docs/database-schema.md):
--   таблицы переводов (i18n), locations/hours/contacts/images, отзывы и триггер
--   рейтинга, подписки, спонсорские места, журнал модерации, AI-эмбеддинги,
--   search_logs; расширения postgis / pgvector / pg_trgm / unaccent.

-- ============ ENUM-типы ============
-- Статус публикации карточки (подмножество content_status из документа).
create type content_status as enum (
  'draft',
  'pending',
  'approved',
  'rejected',
  'archived'
);

-- Роль пользователя (для будущей авторизации; в MVP по умолчанию 'user').
create type user_role as enum (
  'user',
  'business_owner',
  'moderator',
  'admin'
);

-- Статус заявки «Это мой бизнес».
create type business_claim_status as enum (
  'pending',
  'approved',
  'rejected',
  'cancelled'
);

-- ============ Категории ============
create table categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  icon        text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ============ Бизнесы ============
create table businesses (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  category_id       uuid references categories(id) on delete set null,
  name              text not null,
  short_description text,
  description       text,
  status            content_status not null default 'approved',
  rating_avg        numeric(3,2) not null default 0 check (rating_avg >= 0 and rating_avg <= 5),
  reviews_count     integer not null default 0 check (reviews_count >= 0),
  phone             text,
  website           text,
  image_url         text,
  address_line      text,
  city              text,
  region            text,
  latitude          double precision check (latitude >= -90 and latitude <= 90),
  longitude         double precision check (longitude >= -180 and longitude <= 180),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index businesses_category_idx on businesses (category_id);
create index businesses_status_idx   on businesses (status);
create index businesses_rating_idx   on businesses (rating_avg desc);

-- ============ Профили пользователей ============
-- Расширяет auth.users (1:1). Удаление пользователя удаляет профиль.
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  role         user_role not null default 'user',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ============ Подтверждение владения: заявки ============
-- Пользователь подаёт заявку «Это мой бизнес»; решение принимает модератор
-- (сервер, service role). Одобрение создаёт строку в business_owners.
create table business_claims (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references businesses(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  status               business_claim_status not null default 'pending',
  verification_method  text,
  verification_details text,
  applicant_message    text,
  moderator_note       text,
  reviewed_by          uuid references auth.users(id) on delete set null,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Не более одной активной (pending) заявки на пару бизнес+пользователь.
create unique index business_claims_one_pending_idx
  on business_claims (business_id, user_id)
  where status = 'pending';

create index business_claims_business_idx on business_claims (business_id);
create index business_claims_user_idx     on business_claims (user_id);

-- ============ Подтверждённые владельцы ============
create table business_owners (
  business_id uuid not null references businesses(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'owner',
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index business_owners_user_idx on business_owners (user_id);

-- ============ Утилита: автообновление updated_at ============
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger businesses_set_updated_at
  before update on businesses
  for each row
  execute function set_updated_at();

create trigger profiles_set_updated_at
  before update on profiles
  for each row
  execute function set_updated_at();

create trigger business_claims_set_updated_at
  before update on business_claims
  for each row
  execute function set_updated_at();

-- ============ Автосоздание профиля после регистрации ============
-- Срабатывает на вставку в auth.users (email/password и OAuth: Google, Facebook).
-- display_name / avatar_url берутся из метаданных провайдера, если есть.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();

-- ============ RLS ============
alter table categories      enable row level security;
alter table businesses      enable row level security;
alter table profiles        enable row level security;
alter table business_claims enable row level security;
alter table business_owners enable row level security;

-- Табличные привилегии для ролей API. PostgREST требует и RLS-политику,
-- и табличный GRANT: без SELECT-гранта чтение отклоняется ("permission denied"),
-- даже при наличии разрешающей политики. Видимость строк ограничивает RLS ниже.
grant select on categories      to anon, authenticated;
grant select on businesses      to anon, authenticated;
grant select on profiles        to authenticated;
grant select on business_claims to authenticated;
grant select on business_owners to authenticated;

-- Публичный каталог: только чтение через anon/authenticated.
create policy "categories are publicly readable"
  on categories
  for select
  to anon, authenticated
  using (is_active = true);

create policy "approved businesses are publicly readable"
  on businesses
  for select
  to anon, authenticated
  using (status = 'approved');

-- Профили: доступ только к собственному, публичного чтения нет.
create policy "profiles are readable by owner"
  on profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles are updatable by owner"
  on profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Защита от эскалации привилегий: пользователь не может менять свой role.
-- role остаётся под управлением сервера (service role обходит privileges и RLS).
revoke update on profiles from anon, authenticated;
grant update (display_name, avatar_url) on profiles to authenticated;

-- ============ RLS: заявки на владение ============
-- Создание: только от своего user_id и только в статусе pending,
-- без модераторских полей.
create policy "users can create own claims"
  on business_claims
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and moderator_note is null
  );

-- Чтение: только собственные заявки.
create policy "users can read own claims"
  on business_claims
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Изменение: только отмена собственной pending-заявки (pending -> cancelled).
create policy "users can cancel own pending claims"
  on business_claims
  for update
  to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status = 'cancelled');

-- Колоночные привилегии: клиент задаёт только «свои» поля заявки.
-- status при INSERT берётся из default (pending); модераторские поля
-- (status/moderator_note/reviewed_by/reviewed_at) меняет только сервер.
-- Для отмены заявки клиенту доступна на UPDATE только колонка status,
-- а политика выше допускает единственный переход pending -> cancelled.
revoke all on business_claims from anon;
revoke insert, update on business_claims from authenticated;
grant insert (business_id, user_id, verification_method, verification_details, applicant_message)
  on business_claims to authenticated;
grant update (status) on business_claims to authenticated;

-- ============ RLS: владельцы бизнесов ============
-- Чтение: пользователь видит только собственные строки владения.
create policy "owners can read own ownership rows"
  on business_owners
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Добавление/удаление владельцев — только service role (политик нет,
-- privileges отозваны): выполняется серверной модерацией.
revoke all on business_owners from anon;
revoke insert, update, delete on business_owners from authenticated;

-- ============ RLS: редактирование бизнеса владельцем ============
-- UPDATE в Postgres RLS требует видимости строки (SELECT). Публичная политика
-- покрывает только approved, поэтому владельцу даётся чтение своих карточек
-- в любом статусе (пригодится и для кабинета).
create policy "owners can read own businesses"
  on businesses
  for select
  to authenticated
  using (
    exists (
      select 1 from business_owners bo
      where bo.business_id = businesses.id
        and bo.user_id = (select auth.uid())
    )
  );

create policy "owners can update own businesses"
  on businesses
  for update
  to authenticated
  using (
    exists (
      select 1 from business_owners bo
      where bo.business_id = businesses.id
        and bo.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from business_owners bo
      where bo.business_id = businesses.id
        and bo.user_id = (select auth.uid())
    )
  );

-- Колоночные привилегии: владельцу доступны только публичные данные карточки.
-- Системные поля (status, rating_avg, reviews_count, slug, created_at,
-- updated_at) на UPDATE клиенту недоступны — ими управляет сервер.
revoke update on businesses from anon, authenticated;
grant update (
  name,
  short_description,
  description,
  phone,
  website,
  image_url,
  address_line,
  city,
  region,
  latitude,
  longitude,
  category_id
) on businesses to authenticated;
