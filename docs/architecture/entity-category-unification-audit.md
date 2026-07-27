# Аудит и подготовка единой модели сущностей и категорий

**Статус:** только аудит и план. Миграции **не применены**. Production **не изменён**.  
**Дата:** 2026-07-25  
**Ограничение:** защита от парсинга контактов (`businesses_public`, strip SSR, contacts API) **не ослабляется**.

---

## 1. Текущая архитектура

### 1.1 Как устроено сейчас

Главная и UX-навигация (`PLATFORM_SECTIONS`: Бизнесы / Marketplace / Услуги / Лечу / Transfers) **не равны** схеме БД, но на практике сильно влияют на домены:

| UX-раздел | Таблица(ы) | Категории | Тип в БД |
|-----------|-----------|-----------|----------|
| `/search` | `businesses` | `categories` (flat, domain≈business) | `content_status` |
| `/marketplace` | `listings` + `marketplace_listing_details` | `listing_categories` (domain=marketplace) | `listing_type=marketplace_item` |
| `/services` | `listings` + `service_listing_details` | `listing_categories` (domain=services) | `listing_type=service` |
| `/transfers` | `listings` + `transfer_listing_details` | `listing_categories` (domain=transfers) | `listing_type=transfer` |
| `/lechu` | `listings` + `lechu_listing_details` | `listing_categories` (domain=lechu) | `listing_type=transport_carry` |
| `/business/[slug]/offers/...` | `business_offers` | `categories` (+ JSONB `attributes`) | `business_offer_type` |

Тип сущности сегодня задаётся **таблицей / enum-полем**, а не общим реестром:

- бизнес → строка в `businesses`;
- объявление → строка в `listings` + `listing_type`;
- оффер бизнеса → строка в `business_offers` + `offer_type`.

### 1.2 Инвентарь сущностей (сводка)

#### Business

| Поле | Значение |
|------|----------|
| Таблица | `businesses` |
| TS | `types/business.ts` → `Business` |
| Routes | `/search`, `/business/[slug]`, `/map` |
| API | `/api/search/businesses`, `/api/search/ai`, `/api/business/[slug]/contacts` |
| Категория | `categories` через `businesses.category_id` (одна) |
| Статус | `content_status`: draft/pending/approved/rejected/archived/**deferred** |
| Detail | `opening_hours` jsonb; контакты в колонках |
| Профиль | `business_owners`, `business_claims` |
| RLS | anon SELECT на таблицу **отозван**; публичный каталог = view `businesses_public` (флаги без контактов); owners/admins — политики на таблице |
| Индексы | category, status, rating, state_code, city_geoid |

#### Listing (marketplace / service / transfer / lechu)

| Поле | Значение |
|------|----------|
| Таблица | `listings` + detail-таблицы |
| TS | `types/listing.ts` → `Listing` |
| Routes | `/marketplace`, `/services`, `/transfers`, `/lechu` (+ `[id]`) |
| Queries | `lib/listings/queries.ts`, views `*_catalog` |
| Категория | `listing_categories` через detail.`category_id` / `service_category_id` |
| Статус | `listing_status` (+ visibility) |
| Detail | marketplace / service / transfer / lechu tables |
| Профиль | `owner_id` → `profiles`; опционально `publisher_business_id` |
| RLS | public active+visibility; owner; admin |
| Индексы | type/status, city, geo FKs, publisher |

#### Business offers

| Поле | Значение |
|------|----------|
| Таблица | `business_offers` |
| TS | `types/business-offer.ts` |
| Route | `/business/[slug]/offers/[offerSlug]` |
| Категория | `categories.id` (+ пустой `subcategory_id`) |
| Статус | draft/active/archived |
| Detail | **JSONB `attributes`** по `offer_type` |
| RLS | public via `business_offer_is_public()` |

#### Private specialist / Professional

| Поле | Значение |
|------|----------|
| Отдельной таблицы **нет** | |
| Pipeline | `import_review_items.entity_type=private_specialist` |
| Publish | часто → `businesses` + `listings(service)` (autopublish specialist) |
| Каталог | смешивается с `/services` через `publisher_type` |

#### Job / Vehicle / RealEstate / Event

| Сущность | Статус |
|----------|--------|
| Job | enum `listing_type=job`, import target `jobs` — **нет detail-таблицы и UI** |
| Vehicle | enum `listing_type=vehicle`; attrs в `business_offers` offer_type=vehicle — **нет standalone UI** |
| RealEstate | import target; property attrs в `business_offers` — **нет standalone UI** |
| Event | import target `events` — **нет таблицы** |

#### Lechu / Transfer

Уже полноценные listing-домены (`transport_carry` / `transfer`) с detail-таблицами, категориями и каталогами.

### 1.3 Два дерева категорий

| | `categories` | `listing_categories` |
|--|--------------|----------------------|
| Назначение | бизнесы + business_offers | listings всех доменов |
| `parent_id` | **нет** (плоско) | **есть** |
| Имена | `name`, `name_en` | `name_ru`, `name_en` |
| Домен | text CHECK (`business`/`marketplace`/`services`) | enum `listing_domain` + `listing_type` |
| Admin | `getBusinessCategoriesAdmin` | `admin_upsert_listing_category` |

### 1.4 География сейчас

- Справочники: `platform_countries`, `platform_subdivisions`, `platform_counties`, `platform_cities`, `platform_city_counties`.
- На сущностях: city/state/state_code/city_geoid/lat/lng; у бизнеса ещё `address_line`, `location_precision` (street|county).
- Service area: **только text** в `service_listing_details.service_area` и иногда в `business_offers.attributes.service_area`.
- ZIP: на `profiles.postal_code`; у бизнесов ZIP часто внутри `address_line`, отдельной колонки нет.
- Хабы UX: `lib/regions/hubs.ts` (county geoids + map bounds) — **не таблица категорий**.

### 1.5 Offer kind сейчас

Нет единого `offer_kind`. Вместо него:

- marketplace: `listing_transaction_type` = sell | free | exchange | wanted;
- business offers: `offer_type` = service | product | vehicle | property | rental | …;
- property attrs: `listing_type` sale|rent|lease внутри JSONB;
- services: ось pricing, не sell/buy.

### 1.6 Поиск

- Бизнесы: `/api/search/businesses`, `/api/search/ai` → service role → `mapBusinessList` (без контактов).
- Listings: отдельные catalog views + query helpers.
- Популярное: `popular_resource_scores` RPC.
- Anti-scrape: контакты не в list/search index; reveal только `/api/business/[slug]/contacts` после auth.

---

## 2. Найденные конфликты с новым каноном

1. **Два независимых дерева категорий** вместо одного хаб→подкатегория с `allowed_entity_types`.
2. **`categories` без `parent_id`**; глубина 1; `listing_categories` уже иерархичны, но привязаны к `listing_type`/`domain` (сценарий зашит в категорию).
3. **Нет `entity_categories` junction**; у бизнеса и listing — один FK category; secondary нет.
4. **Нет канонических `entity_type`**: Business / Professional / MarketplaceItem / Job / Vehicle / RealEstate / Event / Lechu / Transfer — частично enum, частично таблица, частично только import.
5. **Professional смешивается с Business и Service listing** (autopublish создаёт оба).
6. **`offer_kind` размазан** по `transaction_type`, `offer_type`, JSONB.
7. **UX-домены = `listing_domain`**, что канон запрещает как источник истины для схемы.
8. **Нет общей модели location/service_area** (polygon/radius/publicity flags).
9. **Job/Vehicle/RealEstate/Event** — заготовки без полноценных таблиц/UI.
10. **`business_offers` дублирует** marketplace/vehicle/property сценарии внутри бизнеса через JSONB.
11. Контакты уже правильно вынесены из публичной выдачи — новая модель **не должна** класть их в entities/search/public views.

---

## 3. Таблица соответствия (старое → новое)

| Текущая сущность | → entity_type | Текущая категория | → новая категория (направление) | offer_kind | typed details | Миграция |
|------------------|---------------|------------------|----------------------------------|------------|---------------|----------|
| `businesses` | **Business** | `categories` (flat) | Хаб по текущему slug (restaurants, beauty, auto…) + опц. leaf | обычно нет / service на уровне offers | opening_hours, contacts (private), geo | Да: primary `entity_categories`; контакты остаются на businesses |
| private_specialist → business+service listing | **Professional** | service `listing_categories` + иногда business category | Хаб услуг/красоты и т.п. | `service` / `hire` | service modes, experience, languages | Да: **развести** с Business; не дублировать без правила |
| `listings` marketplace_item | **MarketplaceItem** | listing_categories domain=marketplace | Те же leaf под хабом Marketplace | map: sell→sell, free→giveaway, exchange→exchange, wanted→buy/seek | condition, delivery, qty | Да: offer_kind + entity_categories |
| `listings` service (publisher=profile) | **Professional** (предпочтительно) или Service-listing под Professional | services categories | Хаб услуг | `service` | service_listing_details | Да: классификация publisher_type |
| `listings` service (publisher=business) | остаётся **оффером Business** или отдельный Service listing linked to Business | services categories | secondary на Business / offer | `service` | — | Да: политика «не плодить второй Professional» |
| `listings` transfer | **Transfer** | transfers categories | Хаб Transfers / route subcats | `service` (или transfer-specific) | transfer_listing_details | Лёгкая: rename entity_type layer |
| `listings` transport_carry | **Lechu** | lechu categories | Хаб Лечу | `service` / carry-specific | lechu_listing_details | Лёгкая |
| `listings` job (enum only) | **Job** | — | Хаб Работа | `hire` / `seek` | future job_details | Создать detail + UI позже |
| `listings` vehicle (enum only) | **Vehicle** | — | Хаб Авто | sell/rent | future vehicle_details | Создать detail; перенос из business_offers attrs — отдельно |
| business_offers product | остаётся **Offer** на Business (не новый entity_type) | business categories | secondary optional | sell | product attrs | Не форсировать в MarketplaceItem |
| business_offers vehicle/property/rental | Offer на Business **или** будущий Vehicle/RealEstate | JSONB | typed tables позже | sell/rent | attrs → typed | Поэтапно |
| import event | **Event** | — | Хаб События | — | future | Только после схемы |
| import real_estate | **RealEstate** | — | Хаб Недвижимость | sell/rent | future | Только после схемы |

**Важно:** `listing_type ≠ entity_type`. Пример: `transport_carry` → Lechu; `service` + profile → Professional; `service` + business publisher → не Professional автоматически.

---

## 4. Рекомендуемая целевая схема

### 4.1 `entity_type`

**Рекомендация:** PostgreSQL **enum** `public.entity_type` (+ check на приложениях).

Обоснование: фиксированный канон из ~9 значений; удобные RLS/CHECK; не нужна отдельная таблица, пока нет per-type metadata в БД. Lookup-таблицу можно добавить позже, если появятся labels/icons в БД.

```text
Business | Professional | MarketplaceItem | Job | Vehicle | RealEstate | Event | Lechu | Transfer
```

### 4.2 `categories` (единое дерево)

Минимум:

```text
id, parent_id, slug, name_ru, name_en,
allowed_entity_types entity_type[],  -- см. ниже
status (active|hidden|deprecated),
sort_order, created_at, updated_at
```

Глубина ≤ 2: constraint `parent_id is null OR parent.parent_id is null`.

**`allowed_entity_types`:** массив enum `entity_type[]` + GIN.

- Плюсы: простые фильтры `allowed_entity_types @> ARRAY['business']`, один select.
- Минусы vs junction: чуть сложнее «кто может в категорию X» в админке.
- **Выбор:** массив enum + GIN; junction `category_entity_types` — только если понадобится RLS по типу на уровне строк категории.

Не хранить `offer_kind` / `listing_domain` в категории.

### 4.3 `entity_categories`

```text
entity_id uuid
entity_type entity_type
category_id uuid references categories(id)
role text check (role in ('primary','secondary'))
created_at timestamptz
primary key (entity_id, entity_type, category_id)
```

Ограничения БД:

- unique partial: одна primary на (entity_id, entity_type);
- max 3 secondary: trigger/count check;
- category.allowed_entity_types содержит entity_type;
- secondary same-hub (root parent) unless `category_cross_links`;
- нельзя дублировать category_id.

### 4.4 `category_cross_links`

```text
primary_hub_id uuid  -- root category
secondary_category_id uuid
allowed_entity_types entity_type[] null  -- optional narrower
```

Без строки — кросс-хаб запрещён.

### 4.5 `offer_kind`

**Рекомендация:** общий enum + таблица допустимых пар:

```text
offer_kind: sell | buy | rent | hire | seek | service | giveaway | exchange
entity_offer_kinds (entity_type, offer_kind)  -- allow-list
```

Масштабируемо, проверяемо CHECK/trigger на detail-таблицах. Не плодить enum на каждый entity_type.

Маппинг со старого:

| Старое | Новое |
|--------|-------|
| sell | sell |
| free | giveaway |
| exchange | exchange |
| wanted | buy или seek (нужно правило; см. §13) |
| service listing | service |
| hire/job | hire / seek |

### 4.6 География

Общий слой (не обязательно одна физическая таблица сразу):

**Вариант A (предпочтительный на старте):**  
нормализованная `entity_locations`:

```text
entity_id, entity_type
public_address_line, private_address_line
city, county_geoid, state_code, postal_code
latitude, longitude
location_precision (street|city|county|approx)
public_exact_address boolean
display_mode (exact|city_centroid|county)
service_radius_m int null
service_area_text text null
service_area_geom geography null  -- future
```

**Вариант B:** оставить колонки на domain-таблицах + view `v_entity_locations` для поиска.

Рекомендация: **B на фазе 1** (меньше риска для published data), **A на фазе 2** после стабилизации entity registry.

Публичность точного адреса: `public_exact_address=false` → в public views только city/centroid (аналог anti-scrape для адреса).

---

## 5. Сравнение polymorphic relations

| Вариант | FK integrity | Orphans | RLS | Сложность | Вердикт |
|---------|--------------|---------|-----|-----------|---------|
| **A. Только (entity_id, entity_type) без registry** | Нет настоящего FK | Высокий риск | Сложно единообразно | Низкая | Недостаточно |
| **B. Общий `entities` registry** | FK на `entities.id`; source_table+source_id unique | ON DELETE cascade из registry | Единые политики на registry + domain | Средняя | **Рекомендуется** |
| **C. Одна универсальная таблица всех сущностей** | Отличный FK | Низкий | Один RLS | Ломает listings/offers/detail | **Отклонить** |
| **D. Отдельные junction на каждый тип** (`business_categories`, …) | Настоящие FK | Низкий | Проще per-table | Дублирование правил | Запасной |

### Предлагаемый `entities` (не внедрять без подтверждения)

```text
entities (
  id uuid PK default gen_random_uuid(),
  entity_type entity_type not null,
  source_table text not null,
  source_id uuid not null,
  status text not null,           -- зеркало/нормализация published|hidden|...
  created_at, updated_at,
  unique (source_table, source_id),
  unique (id, entity_type)        -- для составных FK из entity_categories
)
```

Триггеры на `businesses` / `listings` / … : insert/update/delete → sync registry.  
`entity_categories.entity_id` → `entities.id`.  
Удаление: delete domain row → cascade registry → cascade entity_categories.

---

## 6. Рекомендуемый вариант

1. **Сохранить domain-таблицы** (businesses, listings+details, future professionals/jobs/…).
2. **Ввести `entities` registry** как тонкий слой для categories/search/location links.
3. **Одно дерево `categories`** (миграция из `categories` + `listing_categories`).
4. **`entity_categories`** с primary/secondary и DB constraints.
5. **`offer_kind` + `entity_offer_kinds`**; не класть offer_kind в категорию.
6. **География:** фаза 1 — view/нормализация поверх существующих колонок; фаза 2 — `entity_locations`.
7. **Professional** — отдельный `entity_type` и со временем таблица `professionals` (или чёткий subtype listing); прекратить авто-дубль business+service без явного правила.
8. **Anti-scrape сохранить:** контакты только на domain-таблицах за RLS/reveal API; **запрет** в `entities`, public views, search payloads.

UX «Бизнесы / Профи / Все» — фильтр по `entity_type`, не отдельная схема категорий.

---

## 7. План миграции (без применения)

1. **Создать** enum `entity_type`, таблицы `categories_v2` (или `platform_categories`), `entity_categories`, `category_cross_links`, `entity_offer_kinds`, опционально `entities` — **additive**, старые таблицы не дропать.
2. **Перенести категории:** mapping slug old→new; hubs из listing domains + business roots; dry-run отчёт unmapped.
3. **Backfill `entities`** из businesses + listings (active/approved).
4. **Primary `entity_categories`** из текущих FK.
5. **Secondary** — только явным правилом/админкой (не авто LLM).
6. **offer_kind** из transaction_type / heuristics; отчёт конфликтов wanted→buy|seek.
7. **География:** view `v_entity_geo` без переноса колонок в v1.
8. **TypeScript:** новые типы рядом со старыми; dual-read.
9. **Server actions / admin:** писать в оба слоя на переходный период.
10. **Поиск:** добавить filter entity_type + category tree; бизнесы по-прежнему через strip/list API.
11. **Admin master-data:** одно дерево; deprecate dual editors.
12. **RLS:** registry readable publicly for published ids only; **no contacts**; domain tables unchanged для контактов.
13. **Обратная совместимость:** старые URL `/business/:slug`, `/marketplace/:id` сохранить; redirects не ломать.
14. **Удаление старых полей** (`businesses.category_id`, dual category tables) — только после метрик dual-read и feature flag off.

Обязательно: idempotent SQL; rollback = drop new objects / stop dual-write; dry-run scripts; **no data delete**.

---

## 8. Риски

| Риск | Уровень | Митигация |
|------|---------|-----------|
| Потеря published URL/slug | Высокий | Не менять slug; registry source_id = текущий id |
| Дубли Professional↔Business | Высокий | Явная матрица publish rules до backfill |
| Ослабление anti-scrape | Критический | Чеклист в каждом PR; запрет контактов в views/search |
| Пустые каталоги при смене RLS | Высокий | Dual-read; service role search уже есть |
| Неверный wanted→offer_kind | Средний | Ручной allow-list + отчёт |
| JSONB business_offers vs typed Vehicle/RE | Средний | Не форсировать в v1 |
| Сложность polymorphic без registry | Высокий | Выбрать B до кода |
| Performance entity_categories joins | Средний | Индексы (entity_type, category_id), materialized later |

---

## 9. Файлы, которые потребуется изменить (после утверждения)

**Схема / SQL**

- `supabase/migrations/*` (новые, additive)
- `types/database.ts`

**Типы / домен**

- `types/business.ts`, `types/listing.ts`, `types/business-offer.ts`, `types/master-data.ts`
- новый `types/entity.ts` / `lib/entities/*`

**Запросы / поиск**

- `lib/supabase/queries.ts`, `lib/supabase/mappers.ts`
- `lib/listings/queries.ts`
- `app/api/search/businesses/route.ts`, `app/api/search/ai/route.ts`
- `lib/platform/popular-resources.ts`, hub stats

**Admin**

- `components/master-data/AdminMasterDataPanel.tsx`
- `lib/master-data/*`, admin RPCs

**UI (позже, не в этом этапе)**

- фильтры Все/Бизнесы/Профи; category tree components
- **не** трогать hero/home navigation в первой волне схемы

**Сохранить без ослабления**

- `businesses_public`, contacts API, `mapBusinessList` / `stripBusinessContacts`
- запрет browser→Supabase full business select

---

## 10. SQL-черновик (НЕ ПРИМЕНЯТЬ)

```sql
-- DRAFT ONLY — do not apply without explicit approval.
-- Additive, idempotent-ish sketch for review.

create type public.entity_type as enum (
  'business',
  'professional',
  'marketplace_item',
  'job',
  'vehicle',
  'real_estate',
  'event',
  'lechu',
  'transfer'
);

create type public.offer_kind as enum (
  'sell', 'buy', 'rent', 'hire', 'seek', 'service', 'giveaway', 'exchange'
);

create type public.category_status as enum ('active', 'hidden', 'deprecated');
create type public.entity_category_role as enum ('primary', 'secondary');

create table if not exists public.platform_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.platform_categories(id) on delete restrict,
  slug text not null unique,
  name_ru text not null,
  name_en text,
  allowed_entity_types public.entity_type[] not null default '{}',
  status public.category_status not null default 'active',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_categories_depth_chk check (parent_id is distinct from id)
);

-- Depth ≤ 2 enforced by trigger (parent must be root).

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  entity_type public.entity_type not null,
  source_table text not null,
  source_id uuid not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, source_id),
  unique (id, entity_type)
);

create table if not exists public.entity_categories (
  entity_id uuid not null references public.entities(id) on delete cascade,
  entity_type public.entity_type not null,
  category_id uuid not null references public.platform_categories(id) on delete restrict,
  role public.entity_category_role not null,
  created_at timestamptz not null default now(),
  primary key (entity_id, category_id),
  foreign key (entity_id, entity_type) references public.entities(id, entity_type)
);

create unique index if not exists entity_categories_one_primary_uidx
  on public.entity_categories (entity_id)
  where role = 'primary';

create table if not exists public.category_cross_links (
  primary_hub_id uuid not null references public.platform_categories(id) on delete cascade,
  secondary_category_id uuid not null references public.platform_categories(id) on delete cascade,
  allowed_entity_types public.entity_type[],
  primary key (primary_hub_id, secondary_category_id),
  constraint category_cross_links_hub_is_root check (true) -- enforce via trigger: primary_hub.parent_id is null
);

create table if not exists public.entity_offer_kinds (
  entity_type public.entity_type not null,
  offer_kind public.offer_kind not null,
  primary key (entity_type, offer_kind)
);

-- Example seed pairs (illustrative)
-- insert into entity_offer_kinds values
--   ('marketplace_item','sell'), ('marketplace_item','buy'), ...
--   ('professional','service'), ('job','hire'), ('job','seek');

-- Triggers (names only — implement in real migration):
-- trg_platform_categories_max_depth
-- trg_entity_categories_max_secondary
-- trg_entity_categories_allowed_type
-- trg_entity_categories_hub_or_cross_link
-- trg_sync_entity_from_businesses / listings

-- PUBLIC SAFETY: never add phone/email/urls to entities or platform_categories.
-- Keep businesses_public / contacts API unchanged.
```

---

## 11. RLS-план

| Объект | anon | authenticated | notes |
|--------|------|---------------|-------|
| `platform_categories` | SELECT where status=active | same + admin all | |
| `entities` | SELECT where status in published-set | same | **без join на контакты** |
| `entity_categories` | SELECT via readable entity | same | |
| `category_cross_links` | SELECT | SELECT | |
| `businesses` | **no SELECT** (как сейчас) | owners/admins only | |
| `businesses_public` | SELECT | SELECT | flags only |
| contacts API | deny | session + rate limit | |
| `listings` / catalogs | как сейчас | как сейчас | не тащить business contacts |
| `entities` search RPCs | security definer с strip | — | возвращать только safe columns |

Правило ревью: любой новый view с `businesses` — checklist anti-scrape.

---

## 12. План тестирования

1. **Dry-run mapping:** все `categories` + `listing_categories` slugs → new tree; отчёт unmapped.
2. **Backfill counts:** #businesses = #entity primary business; listings by type.
3. **URL smoke:** существующие `/business/:slug`, listing ids открываются.
4. **Anti-scrape regression:** anon `businesses` → deny; list API без phone/email/urls; guest SSR без plaintext; contacts API 401 без сессии.
5. **Search «маникюр»:** результаты с facet Все / Business / Professional (после dual-read).
6. **Secondary/cross-hub:** reject без allow-list; accept с записью.
7. **Max secondary:** 4-я secondary → ошибка БД.
8. **Admin:** создание категории depth 3 → reject.
9. **Rollback drill:** отключение dual-write возвращает старые queries.
10. **Popular/home:** секция «Популярное» не пустеет (service role catalog).

---

## 13. Открытые вопросы (блокируют безопасное внедрение)

1. **Professional:** отдельная таблица `professionals` сразу, или сначала флаг/registry поверх `listings(service)+publisher=profile`?
2. **Autopublish specialist:** оставляем пару Business+Service, только Professional, или Business без `/services` карточки?
3. **`wanted` → `buy` или `seek`?** Нужно продуктовое правило.
4. **Business offers (product/vehicle/property):** остаются офферами бизнеса навсегда или мигрируют в MarketplaceItem/Vehicle/RealEstate?
5. **Имена хабов:** русские ярлыки единого дерева vs сохранение domain labels Marketplace/Услуги только в UX?
6. **Нужен ли `entities` registry в v1** или начинаем с per-table junctions (`business_categories`, …) проще для FK?
7. **Slug коллизии** между `categories.slug` и `listing_categories.slug` (например `other`) — стратегия rename/prefix?
8. **Публичность адреса:** default для существующих бизнесов street vs city_centroid?
9. **Кто владеет secondary categories** при merge бизнесов / import?
10. **Срок dual-write** и критерий удаления `businesses.category_id`?

---

## Приложение A — Запрос «маникюр» (целевое поведение)

1. Normalize query + synonyms (уже есть `lib/search/synonyms.ts`).
2. Match category slugs/names (beauty / nails) including **secondary**.
3. Filter `entities.status` published + `entity_categories`.
4. Facets: `Все | Business | Professional` via `entity_type`.
5. Optional: `offer_kind=service`, geo hub/radius.
6. Rank: text relevance + distance + popularity scores.
7. Response cards: **list-safe** (no contacts); deep link to profile/contacts reveal.

AI-консьерж не реализуется; модели достаточно для будущего intent → entity_type + category + offer_kind + geo.

---

## Приложение B — Что сознательно не сделано

- `supabase db push` / production migration  
- массовый update данных / delete категорий  
- изменение главной / навигации  
- LLM-переклассификация  
- ослабление anti-scrape  

**Стоп.** Ждём ответов на §13 и отдельного подтверждения перед любой миграцией.
