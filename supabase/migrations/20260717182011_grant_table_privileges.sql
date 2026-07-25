-- Migration: grant_table_privileges
-- Исправление к 20260717175146_mvp_core_schema.sql.
-- Проблема: RLS-политики чтения были созданы, но табличный GRANT SELECT
-- для ролей API (anon/authenticated) отсутствовал. PostgREST требует и RLS,
-- и табличную привилегию — без неё любое чтение отклонялось с
-- "permission denied for table ..." (HTTP 401/403).
-- Колоночные привилегии (grant update(...)/insert(...)) в исходной миграции
-- применились корректно и здесь не дублируются.

-- Публичный каталог: чтение доступно anon и authenticated.
-- Видимость строк дополнительно ограничена RLS (categories.is_active,
-- businesses.status = 'approved', плюс политика владельца для своих карточек).
grant select on categories to anon, authenticated;
grant select on businesses to anon, authenticated;

-- Собственный профиль: публичного чтения нет (anon не получает грант),
-- RLS ограничивает выборку строкой владельца.
grant select on profiles to authenticated;

-- Собственные заявки «Это мой бизнес» и строки владения.
grant select on business_claims to authenticated;
grant select on business_owners to authenticated;
