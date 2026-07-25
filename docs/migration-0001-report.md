# Отчёт: первая миграция MVP

**Файл:** `supabase/migrations/20260717175146_mvp_core_schema.sql`
**Статус:** подготовлена, **не применена**. Таблицы в Supabase не создавались.
**Источник:** `docs/database-schema.md` (взято только MVP-подмножество).

## Что будет создано

### Расширения
Нет. Для MVP достаточно встроенного `gen_random_uuid()` (доступен в Supabase по умолчанию).

### ENUM-типы
| Тип | Значения | Зачем в MVP |
|---|---|---|
| `content_status` | `draft`, `pending`, `approved`, `rejected`, `archived` | Управление публикацией карточки (`businesses.status`) |
| `user_role` | `user`, `business_owner`, `moderator`, `admin` | Роль пользователя (`profiles.role`), для будущей авторизации |
| `business_claim_status` | `pending`, `approved`, `rejected`, `cancelled` | Статус заявки «Это мой бизнес» (`business_claims.status`) |

### Таблицы

**`categories`** — справочник категорий.
| Поле | Тип | Ограничения |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `slug` | `text` | NOT NULL, UNIQUE |
| `name` | `text` | NOT NULL (название на русском) |
| `icon` | `text` | nullable (имя иконки Lucide) |
| `sort_order` | `integer` | NOT NULL, default `0` |
| `is_active` | `boolean` | NOT NULL, default `true` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |

**`businesses`** — карточки бизнесов.
| Поле | Тип | Ограничения |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `slug` | `text` | NOT NULL, UNIQUE |
| `category_id` | `uuid` | FK → `categories(id)` ON DELETE SET NULL |
| `name` | `text` | NOT NULL |
| `short_description` | `text` | nullable (для карточек в списке) |
| `description` | `text` | nullable (полное описание) |
| `status` | `content_status` | NOT NULL, default `approved` |
| `rating_avg` | `numeric(3,2)` | NOT NULL, default `0`, CHECK 0–5 |
| `reviews_count` | `integer` | NOT NULL, default `0`, CHECK ≥ 0 |
| `phone` | `text` | nullable |
| `website` | `text` | nullable |
| `image_url` | `text` | nullable |
| `address_line` | `text` | nullable |
| `city` | `text` | nullable |
| `region` | `text` | nullable (штат, напр. CA) |
| `latitude` | `double precision` | CHECK −90…90 |
| `longitude` | `double precision` | CHECK −180…180 |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

**`profiles`** — профиль пользователя, расширяет `auth.users` (1:1).
| Поле | Тип | Ограничения |
|---|---|---|
| `id` | `uuid` | PK, FK → `auth.users(id)` ON DELETE CASCADE |
| `display_name` | `text` | nullable (из метаданных провайдера) |
| `avatar_url` | `text` | nullable (из метаданных провайдера) |
| `role` | `user_role` | NOT NULL, default `user` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

**`business_claims`** — заявки «Это мой бизнес».
| Поле | Тип | Ограничения |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `business_id` | `uuid` | NOT NULL, FK → `businesses(id)` ON DELETE CASCADE |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE |
| `status` | `business_claim_status` | NOT NULL, default `pending` |
| `verification_method` | `text` | nullable (телефон, email домена, документ и т.п.) |
| `verification_details` | `text` | nullable |
| `applicant_message` | `text` | nullable (сообщение заявителя) |
| `moderator_note` | `text` | nullable (заметка модератора, только сервер) |
| `reviewed_by` | `uuid` | nullable, FK → `auth.users(id)` ON DELETE SET NULL |
| `reviewed_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

**`business_owners`** — подтверждённые владельцы (основа кабинета владельца).
| Поле | Тип | Ограничения |
|---|---|---|
| `business_id` | `uuid` | FK → `businesses(id)` ON DELETE CASCADE |
| `user_id` | `uuid` | FK → `auth.users(id)` ON DELETE CASCADE |
| `role` | `text` | NOT NULL, default `'owner'` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |

PK — составной `(business_id, user_id)`.

### Индексы
| Индекс | Таблица | Поля |
|---|---|---|
| `categories_slug_key` (авто) | `categories` | UNIQUE (`slug`) |
| `businesses_slug_key` (авто) | `businesses` | UNIQUE (`slug`) |
| `businesses_category_idx` | `businesses` | `category_id` (фильтр по категории) |
| `businesses_status_idx` | `businesses` | `status` (публичный фильтр) |
| `businesses_rating_idx` | `businesses` | `rating_avg DESC` («лучшие по рейтингу») |
| `business_claims_one_pending_idx` | `business_claims` | UNIQUE (`business_id`, `user_id`) WHERE `status = 'pending'` — не более одной активной заявки на пару бизнес+пользователь |
| `business_claims_business_idx` | `business_claims` | `business_id` |
| `business_claims_user_idx` | `business_claims` | `user_id` |
| `business_owners_user_idx` | `business_owners` | `user_id` (выборка «мои бизнесы») |

### Связи
- `businesses.category_id` → `categories.id`, `ON DELETE SET NULL` (у бизнеса одна категория; удаление категории обнуляет ссылку, не удаляя бизнес).
- `profiles.id` → `auth.users.id`, `ON DELETE CASCADE` (1:1; удаление пользователя удаляет профиль).
- `business_claims.business_id` → `businesses.id`, `ON DELETE CASCADE`; `business_claims.user_id` → `auth.users.id`, `ON DELETE CASCADE`; `business_claims.reviewed_by` → `auth.users.id`, `ON DELETE SET NULL`.
- `business_owners`: составной PK `(business_id, user_id)`, оба FK с `ON DELETE CASCADE`.

### Функции и триггеры
- `set_updated_at()` + триггеры `businesses_set_updated_at`, `profiles_set_updated_at`, `business_claims_set_updated_at` — обновляют `updated_at` при UPDATE.
- `handle_new_user()` (SECURITY DEFINER, `search_path = ''`) + триггер `on_auth_user_created` на `auth.users` — автоматически создаёт профиль после регистрации (email/password и OAuth Google/Facebook). `display_name`/`avatar_url` берутся из метаданных провайдера (`full_name`/`name`, `avatar_url`/`picture`), `role` по умолчанию `user`. `on conflict (id) do nothing` для идемпотентности.

### RLS-политики
RLS включён на всех пяти таблицах.

Публичное чтение (`anon`, `authenticated`):
| Политика | Таблица | Действие | Условие |
|---|---|---|---|
| `categories are publicly readable` | `categories` | SELECT | `is_active = true` |
| `approved businesses are publicly readable` | `businesses` | SELECT | `status = 'approved'` |

Профили — только собственные, **публичного чтения нет**:
| Политика | Таблица | Действие | Роль | Условие |
|---|---|---|---|---|
| `profiles are readable by owner` | `profiles` | SELECT | `authenticated` | `auth.uid() = id` |
| `profiles are updatable by owner` | `profiles` | UPDATE | `authenticated` | `auth.uid() = id` (USING и WITH CHECK) |

Заявки на владение (`business_claims`):
| Политика | Действие | Роль | Условие |
|---|---|---|---|
| `users can create own claims` | INSERT | `authenticated` | `user_id = auth.uid()` AND `status = 'pending'` AND модераторские поля пусты |
| `users can read own claims` | SELECT | `authenticated` | `user_id = auth.uid()` |
| `users can cancel own pending claims` | UPDATE | `authenticated` | USING: своя pending-заявка; WITH CHECK: новый статус `cancelled` |

Владельцы (`business_owners`):
| Политика | Действие | Роль | Условие |
|---|---|---|---|
| `owners can read own ownership rows` | SELECT | `authenticated` | `user_id = auth.uid()` |

INSERT/UPDATE/DELETE-политик на `business_owners` нет, привилегии отозваны → записи создаёт/удаляет только сервер (service role) при модерации заявок.

Редактирование бизнеса владельцем (`businesses`):
| Политика | Действие | Роль | Условие |
|---|---|---|---|
| `owners can read own businesses` | SELECT | `authenticated` | есть строка в `business_owners` для `auth.uid()` |
| `owners can update own businesses` | UPDATE | `authenticated` | есть строка в `business_owners` (USING и WITH CHECK) |

SELECT-политика владельца обязательна: в Postgres UPDATE под RLS требует видимости строки, а публичная политика покрывает только `approved`.

### Колоночные привилегии (защита системных полей)
| Таблица | Отозвано | Выдано `authenticated` |
|---|---|---|
| `profiles` | UPDATE (все колонки) | UPDATE только `display_name`, `avatar_url` — `role` менять нельзя |
| `business_claims` | ALL у `anon`; INSERT/UPDATE у `authenticated` | INSERT только `business_id`, `user_id`, `verification_method`, `verification_details`, `applicant_message`; UPDATE только `status` (политика допускает единственный переход `pending → cancelled`) |
| `business_owners` | ALL у `anon`; INSERT/UPDATE/DELETE у `authenticated` | только чтение своей строки |
| `businesses` | UPDATE (все колонки) | UPDATE только публичных полей: `name`, `short_description`, `description`, `phone`, `website`, `image_url`, `address_line`, `city`, `region`, `latitude`, `longitude`, `category_id`. Поля `status`, `rating_avg`, `reviews_count`, `slug`, `created_at`, `updated_at` недоступны |

Клиент не может: назначить себя владельцем, одобрить свою заявку, изменить статус/рейтинг бизнеса, изменить свою роль. Все привилегированные операции — сервер через service role (обходит RLS и privileges).

OAuth Google и Facebook настраиваются в Supabase Auth (Dashboard → Authentication → Providers) и отдельных таблиц не требуют. Telegram не реализуется.

## Процесс «Это мой бизнес»

1. **Заявка.** Авторизованный пользователь на странице бизнеса нажимает «Это мой бизнес» и отправляет заявку: создаётся строка в `business_claims` со `status = 'pending'` (только от собственного `user_id`; способ подтверждения и сообщение — опциональны). Частичный уникальный индекс не даёт создать вторую активную заявку на тот же бизнес.
2. **Отмена (опционально).** Пока заявка `pending`, пользователь может сам перевести её в `cancelled` — это единственное изменение, доступное клиенту.
3. **Модерация.** Модератор (серверный код с service role, будущая админка) проверяет заявку и выставляет `approved` или `rejected`, заполняя `reviewed_by`, `reviewed_at`, `moderator_note`.
4. **Одобрение.** При `approved` сервер в той же транзакции создаёт строку в `business_owners (business_id, user_id, role = 'owner')`.
5. **Кабинет владельца.** С этого момента пользователь видит свои бизнесы (`business_owners` + SELECT-политика владельца на `businesses`) и может редактировать публичные данные карточки — но не `status`, не рейтинг и не системные поля. Интерфейс кабинета — следующий этап.

## Известные риски и решения

| Риск | Как закрыт / что остаётся |
|---|---|
| Пользователь одобряет свою заявку | Закрыт: UPDATE-грант только на `status`, WITH CHECK допускает лишь `cancelled` |
| Пользователь назначает себя владельцем | Закрыт: на `business_owners` нет INSERT-политики и привилегия отозвана |
| Владелец меняет `status`/`rating_avg`/`slug` | Закрыт: колоночный GRANT на UPDATE не включает системные поля |
| Эскалация `profiles.role` | Закрыт: UPDATE-грант только на `display_name`, `avatar_url` |
| Заявка от чужого имени | Закрыт: WITH CHECK `user_id = auth.uid()` |
| Одобрение заявки без записи владельца (рассинхрон) | **Остаётся на сервере**: одобрение и вставка в `business_owners` должны выполняться одной транзакцией в будущем модерационном коде |
| Несколько pending-заявок от разных пользователей на один бизнес | Допустимо by design; сервер при одобрении должен проверять, не назначен ли уже владелец |
| Спам заявками (cancel → новая pending) | Не закрыт на уровне БД; при необходимости — rate limiting на сервере |
| `cancelled → pending` обратным UPDATE | Закрыт: USING требует `status = 'pending'`, отменённая заявка больше не редактируема клиентом |

## Осознанно отложено (вне MVP, есть в `docs/database-schema.md`)

## Осознанно отложено (вне MVP, есть в `docs/database-schema.md`)

| Отложено | Причина |
|---|---|
| Таблицы переводов (`*_translations`), `languages`, `countries` | Приложение сейчас одноязычное (RU), одна страна |
| PostGIS (`geography`, GIST-индекс) | Карта только показывает маркеры по `lat/lng`; поиска «рядом» ещё нет — хватает `latitude`/`longitude` |
| `business_categories` (m2m) | У бизнеса сейчас одна категория (FK) |
| `locations`, `business_hours`, `business_contacts` | Один адрес и один телефон/сайт → колонки на `businesses` |
| `business_images` | Пока одно изображение (`image_url`) |
| `business_reviews` + триггер рейтинга | `rating_avg` и `reviews_count` — статичные колонки |
| `business_subscriptions`, `sponsored_placements` | Premium и спонсорство — будущие этапы |
| `moderation_actions` | Журнал модерации — будущий этап (поле `status` уже готово) |
| `business_embeddings` (pgvector), `search_logs` | AI-поиск и аналитика — будущие этапы |
| `profiles.preferred_language` (из документа) | i18n отложён; в MVP это поле не добавляется |

Структура выбрана так, чтобы отложенные подсистемы добавлялись новыми миграциями без переделки таблиц `categories` и `businesses`.

## Статус: ПРИМЕНЕНО (2026-07-17)

Миграция применена к проекту `zmsbosigfmnmyavuhlyb` (russian-business-ai, ca-central-1).
Supabase CLI установлен локально (devDependency); подключение к удалённой БД шло через
временную login-role по access-token, **пароль БД не использовался и нигде не логировался**.

```bash
npx supabase login                              # вход под аккаунтом-владельцем проекта
npx supabase link --project-ref zmsbosigfmnmyavuhlyb
npx supabase db push --dry-run                  # проверка на конфликты
npx supabase db push                            # применение
npx supabase migration list                     # local == remote
```

Применённые версии:

| Версия | Файл | Назначение |
|---|---|---|
| `20260717175146` | `mvp_core_schema.sql` | Таблицы, enum'ы, индексы, триггеры, RLS, колоночные привилегии |
| `20260717182011` | `grant_table_privileges.sql` | Фикс: табличный `GRANT SELECT` для ролей API |

### Найденный и исправленный дефект грантов

При проверке после применения обнаружено: RLS-политики чтения были созданы, но
**табличный `GRANT SELECT` для `anon`/`authenticated` отсутствовал**. PostgREST требует
одновременно и разрешающую RLS-политику, и табличную привилегию — без гранта любое чтение
через publishable-ключ отклонялось с `permission denied for table ...` (HTTP 401/403).
Колоночные привилегии (`grant update(...)`, `grant insert(...)`) применились корректно.

Исправление внесено отдельной миграцией `20260717182011_grant_table_privileges.sql`
(редактировать уже применённую миграцию не стали). Те же гранты добавлены в исходный
`mvp_core_schema.sql`, чтобы развёртывание с нуля было корректным без фикс-миграции
(гранты идемпотентны).

### Результаты проверки

| Проверка | Результат |
|---|---|
| Таблицы `categories`/`businesses`/`profiles`/`business_claims`/`business_owners` | существуют |
| RLS включён на всех пяти | да |
| Триггер `on_auth_user_created` на `auth.users` | есть |
| `authenticated` может менять `profiles.role` (UPDATE) | нет (эскалация закрыта) |
| `authenticated` может менять `businesses.status` (UPDATE) | нет (системное поле закрыто) |
| Колоночные UPDATE: `profiles.display_name`, `businesses.name`; INSERT `claims`; cancel `claims.status` | разрешены |
| Табличный `GRANT SELECT` для API-ролей (после фикса) | есть на всех пяти |
| Публичное чтение через anon: `categories` возвращает только `is_active=true` | подтверждено функционально |
| Публичное чтение через anon: `businesses` возвращает только `status='approved'` | подтверждено функционально |
| Чтение `profiles` через anon | запрещено (`permission denied`) |

Функциональные тесты выполнены временными строками (active/inactive, approved/draft),
которые затем удалены; посторонние объекты Supabase не изменялись.
