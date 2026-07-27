# Architecture Final Audit V1

Независимый архитектурный аудит перед первым применением миграций.  
**Дата:** 2026-07-26 · **База:** `ARCHITECTURE_FREEZE_V1` + draft SQL + live schema alignment docs.  
**Scope:** docs + draft SQL only. App/lib/UI не трогались. SQL не применялся. `db push` не выполнялся.

Связанные документы: [`ARCHITECTURE_FREEZE_V1.md`](./ARCHITECTURE_FREEZE_V1.md), [`001_additive_schema.sql`](./001_additive_schema.sql), [`002_seed_platform_categories.sql`](./002_seed_platform_categories.sql), [`ENTITY_TYPE_MAPPING_V1.md`](./ENTITY_TYPE_MAPPING_V1.md).

---

## Главный вывод

# **ДА** — с обязательными pre-push условиями

Архитектура Entity Model V1 **готова к первому осторожному применению additive-миграций**, при условии checklist ниже. Базовая модель (Account → Profiles → независимые entities, Ownership/Source/Claim, ACL Variant A, пять MVP-хабов) стабильна и не требует переработки ядра.

| Подтверждение | Статус |
|---------------|--------|
| Breaking changes **не ожидаются**, если соблюсти pre-push checklist | ✅ |
| Entity Model можно считать **стабильной** (freeze layer) | ✅ |
| **Additive** schema можно применять (без drop/rename live tables) | ✅ |
| Дальнейшее развитие возможно **без переработки базовой архитектуры** | ✅ |

**Не готов как «применить 001+002 as-is в один шаг».** Seed `002` всё ещё отражает live home hubs (Услуги / Лечу / Transfers), а не freeze TAXONOMY. Применение `002` без rewrite = будущий rename хабов / перепривязка `category_entity_types` (мягкий breaking для taxonomy UX, не для domain tables).

---

## Pre-push checklist (обязательно)

| # | Действие | Критичность | Сделано в audit? |
|---|----------|-------------|------------------|
| 1 | `jobs.business_id` → `ON DELETE SET NULL` (не CASCADE) | P0 | ✅ исправлено в draft `001` |
| 2 | **Не** применять `002` до rewrite hubs → freeze (Специалисты, Купи-продай, …) | P0/P1 | ⚠️ предупреждение в header `002` |
| 3 | Зафиксировать alias: DB enum `marketplace_item` ≡ product/taxonomy `marketplace` | P1 | ✅ в header `001` + mapping doc |
| 4 | Первый push = **только `001`** (или `001` + rewritten `002`); не смешивать со старым seed | P1 | docs |
| 5 | Status map: `professional_status.approved` ↔ registry `published`; review legacy ↔ workflow | P1 | app layer / later enum expand |
| 6 | Stub `vehicles` / `events`: без sync-triggers — писать через `entities_upsert` или добавить triggers до inventory write | P1 | header `001` |
| 7 | `businesses` Base columns (`source_type`, `owner_profile_id`) — **отдельный** additive ALTER позже | P2 | later |

---

## 1. Entity Model

### Вердикт: стабильна

| Entity | Cardinality vs Profile | Связи | Замечание |
|--------|------------------------|-------|-----------|
| `profiles` | 1:1 `auth.users` | центр | OK |
| `professionals` | 0..1 claimed (`owner_profile_id` unique partial) | portfolio / services / credentials 1:N | OK; NULL owner = unclaimed |
| `businesses` | 0..N via `business_owners` | live table; registry sync | Base columns later additive |
| `listings` (marketplace) | N via `owner_id` / publisher | details 1:1 | OK; dual `listing_type=job` transitional |
| `jobs` | N; optional `business_id` | creator nullable (import) | CASCADE→SET NULL fixed |
| `real_estate_listings` | N; optional business/pro provider | Base fields in draft | OK |
| `vehicles` / `events` | stubs | later taxonomy | OK as stubs |
| `entities` | registry 1:1 per (type, source_id) | `entity_categories` N:M | OK |

**Отсутствующие связи (намеренно):** нет `professional_business_links` (C1 freeze).  
**Лишние связи:** нет.  
**Масштабирование без ALTER существующих PK:** да — новые entity = новые таблицы + enum value + category tree; junction через `entities`.

### Проблемы

| ID | Проблема | P | Schema change? | До push? |
|----|----------|---|----------------|----------|
| E1 | Live `businesses.owner_id` / `business_owners` vs Base `owner_profile_id` не унифицированы на businesses | P1 | Later additive columns + dual-read | Документировать; не блокер `001` |
| E2 | `listings.listing_type=job` vs таблица `jobs` | P1 | Data migrate later; не dual-register в `entities` | После Jobs publish path |
| E3 | Registry enum `marketplace_item` ≠ docs slug `marketplace` | P1 | Нет, если alias frozen | Alias в mapping — **не** rename enum post-push |

---

## 2. Database

### Вердикт: additive draft в целом корректен; один P0 устранён

| Область | Оценка |
|---------|--------|
| PK/FK | UUID PK; FK на profiles/businesses с SET NULL / RESTRICT на categories parent | OK |
| Indexes | status/type/slug/city; jobs business_id | OK для MVP; geo GIST later |
| Constraints | source_type check; unique slug; one primary category | OK |
| Enums | entity_type, offer_kind, registry/pro status | Fragmented status vocab (см. P1) |
| Nullable | owner NULL для import — корректно | OK |
| Cascades | Pro children CASCADE; category parent RESTRICT; **jobs.business_id SET NULL** | OK after fix |
| Unique | `(entity_type, source_id)`; one Pro per owner | OK |
| Perf | 100k OK; 1M нужен geo + search index plan | P2 |

### Проблемы

| ID | Проблема | P | Schema? | До push? |
|----|----------|---|---------|----------|
| D1 | ~~`jobs.business_id ON DELETE CASCADE` уничтожал вакансии~~ | **P0** | Да | ✅ fixed in draft |
| D2 | Нет GIST/geo indexes на RE/vehicles/jobs lat-lng | P2 | Additive indexes | После появления объёма |
| D3 | Нет sync triggers для vehicles/events → `entities` | P1 | Triggers или app upsert | До inventory write |
| D4 | Fragmented status: Pro `approved`, registry `published`, jobs text, listings `active` | P1 | Prefer converge new tables; map live | Mapping layer; не блокер |
| D5 | RLS: unclaimed Pro/Jobs с `owner_profile_id IS NULL` — публичный read только published; write через admin/`is_admin`/service role | P1 | Policy review | Verify before Pro import publish |
| D6 | Нет роли `moderator` отдельно от `is_admin()` | P2 | Later roles table | Post-MVP |

---

## 3. Taxonomy

### Вердикт: freeze docs OK; seed `002` **не** готов

| Правило | Freeze docs | Draft seed `002` |
|---------|-------------|------------------|
| Каждая MVP-категория → entity | ✅ 5 trees | ⚠️ hubs services/lechu/transfers |
| Entity без category tree | ❌ нет у MVP | Professional через hub-services — wrong hub |
| Категории без назначения | Events later = hidden OK | hub-events seeded active |
| Расширение без schema | `platform_categories` rows + `category_entity_types` | OK pattern |

### Проблемы

| ID | Проблема | P | Schema? | До push? |
|----|----------|---|---------|----------|
| T1 | `002` hubs: Услуги/Лечу/Transfers как primary; нет `hub-professionals`; MP title «Marketplace» | **P0** для apply `002` | Seed rewrite only | **Да — rewrite до apply `002`** |
| T2 | `category_entity_types` на hub-services → professional | P1 | Seed | С T1 |
| T3 | Filters (24/7, выезд) ≠ categories — OK if not in platform_categories as hubs | P2 | Нет | Docs only |

---

## 4. Import Pipeline

```text
Source → Import (import_review_items) → AI Classification
  → Review → Publish (domain row, owner NULL) → Search → Profile
```

| Этап | Риск потери / schema change |
|------|------------------------------|
| Source | OK; Source immutable на domain |
| Import | Legacy `private_specialist` → map | Alias layer |
| AI | category slug must match taxonomy tree | Wire pickers |
| Review | 7-status enum vs 12-state workflow | Expand enum later / store aliases |
| Publish | Jobs/Pro/RE paths слабо в коде; Business strong | Implementation, not schema break |
| Search | Unified SearchDocument not built | Additive index / view |
| Profile | Claim sets owner; Admin ≠ owner | Frozen rule OK |

### Проблемы

| ID | Проблема | P | Schema? | До push? |
|----|----------|---|---------|----------|
| I1 | Jobs ~783 TG вне queue — product gap | P1 | Нет | Import wiring later |
| I2 | Publish без `entities` sync на stubs | P1 | Triggers | С D3 |
| I3 | Review status expand (`edited`,`merged`,…) | P2 | ALTER TYPE additive | Cutover Review Center |
| I4 | Enrichment fields only in queue JSON → domain | P2 | Domain columns as needed | Per-entity |

---

## 5. Review Workflow

| Тема | Оценка |
|------|--------|
| States (12) | Spec complete |
| Transitions | Diagram + restore rules OK |
| Moderation | Review Center V1 not built; live transitional |
| Publish | owner stays NULL — frozen |
| Rollback | Restore → needs_review; unpublish gated | OK as policy |
| Re-moderation | Supported via Restore | OK |

### Проблемы

| ID | Проблема | P | Schema? | До push? |
|----|----------|---|---------|----------|
| R1 | Live enum ⊂ workflow states | P1 | Additive enum values | С Review Center cutover |
| R2 | Нет soft-lock `locked_by` в live schema | P2 | Column later | With Review Center |

**Не блокер первого `001` push** — workflow живёт в queue table, не в entity registry.

---

## 6. Permissions / ACL

| Тема | Оценка |
|------|--------|
| Roles | `is_admin()` + ownership; moderator later |
| Ownership | Variant A: `business_owners` only for Business; else `owner_profile_id` | Frozen |
| RLS | Draft policies на Pro/Jobs/stubs; Business live strong | OK direction |
| Multi-admin Business | `business_owners` already N | OK |
| Moderators | Collapsed into admin today | P2 |
| Business owners | Live ACL | OK |

### Проблемы

| ID | Проблема | P | Schema? | До push? |
|----|----------|---|---------|----------|
| A1 | Unclaimed entity manage только admin/service | P1 | Policy clear | Verify RLS before mass import publish |
| A2 | Universal Entity ACL (Variant B) deferred | P2 | New table later | Post-MVP OK |
| A3 | Multi-moderator + audit already partial on import_review | P2 | Extend | With Review Center |

---

## 7. API

Будущий public/API без смены модели:

- Resource by `(entity_type, id|slug)` via `entities` + domain table  
- Categories via `platform_categories` tree + `entity_categories`  
- Auth via profile + owns_* helpers  

| ID | Проблема | P | Schema? | До push? |
|----|----------|---|---------|----------|
| API1 | Нет стабильного versioned API surface в коде | P2 | Нет | Product |
| API2 | Status vocabulary fragmentation усложняет DTO | P1 | Mapping | Document DTO map |

Модель данных **не** требует redesign под REST/mobile API.

---

## 8. Search

Целевой контракт (freeze): `SearchDocument` = id, entity_type, category, geo, title, status=published.

| Сейчас | Цель |
|--------|------|
| AI search mostly Business-centric | Fan-out / unified index from `entities` |
| No single FTS across Pro/Jobs/RE | Additive materialized view or external index |

| ID | Проблема | P | Schema? | До push? |
|----|----------|---|---------|----------|
| S1 | Нет единого search index | P1 | View/index later | After entities backfill |
| S2 | Synonyms/app layer separate from DB | P2 | Нет | OK |

Индексация **единым способом** возможна через `entities` + triggers — архитектура готова; реализация — после apply + backfill.

---

## 9. Масштабирование

| Сценарий | Выдержит? | Условие |
|----------|-----------|---------|
| 100k объектов | ✅ | Current indexes + RLS |
| 1M объектов | ✅ с работой | Partition-by-type optional; geo GIST; search out-of-band; connection pool |
| Десятки entity types | ✅ | New tables + enum value + category tree |
| Новые категории | ✅ | Rows in `platform_categories` |
| Новые страны | 🟡 | `platform_subdivisions` / cities model US-centric — extend geo tables, not entity PK |
| Новые языки | ✅ | `name_ru` / `name_en` + i18n JSON later; no PK break |

---

## 10. Future Features — breaking?

| Feature | Breaking schema? | Как вписать |
|---------|------------------|-------------|
| События | Нет | `events` stub + taxonomy later |
| Сделки / платежи / подписки | Нет | Новые billing tables; FK на profile/business |
| AI | Нет | Server pipelines; queue metadata |
| Рейтинг / отзывы | Нет | Live `reviews` на business; generalize via `entity_id` later **additive** |
| CRM | Нет | Side tables / CRM module |
| Мобильное приложение | Нет | Same API model |
| Геопоиск | Нет | Indexes + PostGIS optional additive |

Ни одна из перечисленных фич **не требует** перелома Account / Ownership / ACL A / пяти MVP entity tables.

---

## Сводка по критичности

### P0 — исправить до apply соответствующего SQL

| ID | Что | Schema? | Статус |
|----|-----|---------|--------|
| D1 | jobs CASCADE → SET NULL | Да (draft) | ✅ fixed |
| T1 | Rewrite `002` hubs under freeze | Seed only | ⛔ block apply `002` |

### P1 — желательно до push или сразу после `001`

- E1/E3 aliases ownership & marketplace_item  
- D3–D5 triggers / status map / unclaimed RLS verify  
- I1 Jobs into queue (product)  
- R1 review enum plan  
- S1 unified search plan  
- T2 category_entity_types with new hubs  

### P2 — можно отложить

- Geo indexes, moderator role, Variant B ACL, Review soft-lock, countries i18n, API versioning, businesses Base ALTER  

---

## Что исправлять до первого db push vs позже

| До первого push | Позже (additive / product) |
|-----------------|----------------------------|
| D1 CASCADE (done) | Businesses Base columns |
| Не apply `002` as-is / rewrite seed | Review enum expand |
| Confirm marketplace_item alias | Unified search index |
| Apply strategy: `001` first | Jobs import wiring |
| RLS smoke for unclaimed publish path | Events/vehicles triggers when shipping |

---

## Подтверждения аудита

1. **Найденные проблемы** перечислены выше (E/D/T/I/R/A/API/S).  
2. **Критичность** P0/P1/P2 проставлена.  
3. **Требуют ли schema change** — указано по каждому ID.  
4. **До первого db push** — D1 + block/rewrite `002`; остальное — mapping/verify.  
5. **Позже** — P2 и product gaps из IMPLEMENTATION_GAP.  
6. **Готовность к первому применению миграций:**

# **ДА**

при условиях: (a) draft `001` с SET NULL, (b) `002` не применяется без taxonomy rewrite, (c) aliases status/`marketplace_item` приняты как закон до cutover.

Дополнительно подтверждается:

- breaking changes **не ожидаются** при additive apply `001` и phased seed;  
- **Entity Model стабильна**;  
- **additive schema** — правильный путь;  
- развитие (события, платежи, отзывы на entity, geo, mobile) — **без переработки базовой архитектуры**.

---

## Что не делалось (по заданию)

- Не изменялись `app/`, `lib/`, UI  
- Не применялся SQL / `db push`  
- Не менялась freeze-архитектура (кроме точечного P0 в draft `001` + headers)  
- Production не трогался  
