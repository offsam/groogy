# Platform Taxonomy V1

Готовая таксономия для БД / импорта / поиска / фильтров / UI.  
**Без SQL, миграций и изменений production.** Сущности Entity Model не меняются.

> **RU display names:** канон — [`taxonomy_ru_v1_final.json`](./taxonomy_ru_v1_final.json) / Freeze. Колонки `name_ru` в таблицах ниже и в `taxonomy_*_v1.json` могут быть черновиком.

Основано на: Telegram, Facebook seed, published Business, `import_review_items`, [`PLATFORM_INFORMATION_ARCHITECTURE_V2.md`](./PLATFORM_INFORMATION_ARCHITECTURE_V2.md), [`platform_taxonomy_v2.json`](./platform_taxonomy_v2.json).

**Entity binding:** см. [`ARCHITECTURE_FREEZE_V1.md`](./ARCHITECTURE_FREEZE_V1.md) §4 + [`ENTITY_TYPE_MAPPING_V1.md`](./ENTITY_TYPE_MAPPING_V1.md).

Machine files:

| File | Entity |
|------|--------|
| [`taxonomy_business_v1.json`](./taxonomy_business_v1.json) | Business |
| [`taxonomy_professional_v1.json`](./taxonomy_professional_v1.json) | Professional |
| [`taxonomy_marketplace_v1.json`](./taxonomy_marketplace_v1.json) | Marketplace |
| [`taxonomy_jobs_v1.json`](./taxonomy_jobs_v1.json) | Jobs |
| [`taxonomy_real_estate_v1.json`](./taxonomy_real_estate_v1.json) | Real Estate |

---

## Rules (all entities)

1. **One primary category** per card; ≤3 secondary (Entity Model).  
2. Depth ≤ **3** (category → subcategory → specialization). Prefer 1–2.  
3. Same slug may exist on Business and Professional **only** with an intersection rule (see §4).  
4. Counts: `telegram` / `facebook_seed` / `published` / `import_queue_mixed` — **do not sum** Telegram+import.  
5. `other` is a temporary bucket, not a product destination.

---

## 1. Business

**Rule:** organization / brand (LLC, salon, shop, agency).

| slug | name_ru | parent | signal* | sources (tg / fb / pub / queue†) |
|------|---------|--------|--------:|----------------------------------|
| food | Еда и рестораны | — | 174 | 154 / 1 / 19 / 295 |
| grocery | Продукты | — | 8 | 0 / 1 / 7 / 0 |
| beauty | Красота | — | 100 | 39 / 1 / 60 / 569 |
| medical | Медицина | — | 37 | 19 / 1 / 17 / 185 |
| legal | Юристы / юрфирмы | — | 46 | 29 / 2 / 15 / 211 |
| finance | Финансы и бухгалтерия | — | 49 | 41 / 1 / 7 / 103 |
| insurance | Страхование | — | 22 | 15 / 1 / 6 / 39 |
| auto | Автосервис | — | 261 | 228 / 2 / 31 / 409 |
| car_rental | Аренда авто | — | 185 | 185 / 0 / 0 / 202 |
| moving | Переезды | — | 175 | 174 / 1 / 0 / 187 |
| home_services | Дом и сервисы | — | 64 | 6 / 2 / 56 / — |
| └ cleaning | Клининг | home_services | — | subcategory |
| education | Образование | — | 52 | 16 / 2 / 34 / 442 |
| fitness | Фитнес | — | 14 | 0 / 0 / 14 / 91 |
| pets | Питомцы | — | 2 | 0 / 0 / 2 / 33 |
| travel | Путешествия | — | 7 | 6 / 0 / 1 / 128 |
| real_estate_agencies | Агентства недвижимости | — | 108 | 105 / 2 / 1 / 821 |
| events | Площадки / ивент-бизнес | — | 14 | 7 / 1 / 6 / 167 |
| childcare | Детские центры | — | 22 | 22 / 0 / 0 / 153 |
| other | Прочее | — | 116 | 85 / 0 / 31 / 1237 |

\*signal = tg+fb+published. †queue mixes entity types.

**Legacy map:** `restaurants→food`, `groceries→grocery`, `services→home_services`, `real_estate→real_estate_agencies`, `auto` stays `auto`.

---

## 2. Professional

**Rule:** private specialist / person brand.

| slug | name_ru | depth | tg | notes |
|------|---------|-------|---:|-------|
| beauty | Красота | + nails, hair_makeup, massage | 509 | Largest Pro class |
| education | Репетиторы | + languages, stem_music | 388 | |
| legal | Юристы | + immigration, general | 165 | |
| medical | Здоровье | flat | 116 | |
| photography_video | Фото / видео | flat | 108 | Primary on Pro |
| fitness | Тренеры | flat | 59 | |
| finance | Бухгалтеры | flat | 61 | |
| auto | Автомастера | flat | 92 | Solo vs Business shop |
| travel | Травел / визы | flat | 84 | |
| food | Домашняя еда | flat | 63 | |
| childcare | Няни | flat | 40 | |
| professional_services | Дизайн / SMM / IT | flat | 165 | |
| home_services | Дом и ремонт | flat | 14+ | Absorbs tiny cleaning |
| pets | Зоо / груминг | flat | 7 | keep small |
| insurance | Страховые агенты | flat | 14 | keep small |
| real_estate | Риелторы | flat | 2+ | Agency ≠ this |
| other | Прочее | flat | 387 | Shrink |

Published Professional = 0 today; queue ~2 298 specialists.

---

## 3. Marketplace

**Flat** (depth 1). Goods only.

furniture · kids · free · wanted · clothing · electronics · home · auto_parts · vehicles · sports · other  

`free` / `wanted` are **categories for nav** and map to `offer_kind` giveaway/seek (not mutually exclusive concepts).

Merged into other/home (too small): tools, pets_goods, books_media, home_decor.

---

## 4. Jobs

**Flat.** Same taxonomy for personal and Business-attributed jobs.

drivers · cleaning · beauty · childcare · restaurant · office · skilled_trades · photo_video · other  

**Pipeline gap:** 783 Telegram jobs, **0** in import_review/DB — taxonomy still mandatory.

---

## 5. Real Estate

**Inventory listings** (not agencies).

| slug | name_ru | tg | keep small? |
|------|---------|---:|-------------|
| apartments | Квартиры | 366 | |
| rooms | Комнаты | 250 | |
| houses | Дома | low | yes |
| commercial | Коммерция | 22 | yes |
| short_term | Посуточно | sparse | yes (slot) |
| other | Прочее | 128 | |

Subcategory depth not required beyond this flat set.

---

## 6. Intersections (controlled duplicates)

| Topic | Primary | Also allowed | Why |
|-------|---------|--------------|-----|
| Beauty | Business (salon) / Professional (master) | both | Different entity identity |
| Legal | Business (firm) / Professional (solo) | both | |
| Auto | Business (shop) | Professional (mobile solo) | |
| Photo | **Professional** | Business only if studio brand | Avoid dual cards |
| Real estate | Agency → **Business.real_estate_agencies**; agent → **Professional.real_estate**; unit → **Real Estate** listing | three surfaces | Not the same card |
| Food | Restaurant → Business; home cook → Professional | both | |
| Childcare | Center → Business; nanny → Professional / Jobs | | |

**Forbidden:** same physical offer as Business + Professional without Claim/ownership distinction; marketplace goods as Business category.

---

## 7. Category vs filter vs tag

| Kind | Examples |
|------|----------|
| **Category** | beauty, auto, furniture, drivers, apartments |
| **Subcategory** | beauty/nails, education/languages, legal/immigration |
| **Filter / attribute (not category)** | русский язык, 24/7, выезд, online, radius, price range, condition, bedrooms, employment_type, work_mode, verified, open_now, hub/city |
| **Tag (optional freeform)** | niche labels after primary category assigned |

---

## 8. Coverage

| Question | Answer |
|----------|--------|
| Can every card map to one primary category? | **Yes**, with `other` as last resort |
| Gaps today | 31 published Business **null** category → assign or `other`; Marketplace ~50% TG `other` needs better tagging; Jobs not in queue |
| Must add | `car_rental`, `moving` (Biz); Pro first-class tree; Jobs + RE trees |
| Merge | published `services` → `home_services`; tiny cleaning/home into home_services; MP micro-leaves → other/home |

---

## 9. Small categories

**Merge candidates:** MP tools/pets_goods/books; Biz locksmith→home_services.  

**Keep small:** grocery, insurance, pets, travel, fitness (Biz); houses, commercial, short_term (RE); free/wanted (MP); immigration (Pro).

---

## 10. Scale (10× / 100k cards)

| Risk | Mitigation |
|------|------------|
| `other` explosion | Force primary on publish; periodic reclassify |
| Shared slugs Business/Pro | Namespace by `entity_type` in DB (`platform_categories` + `category_entity_types`) |
| Deep trees | Cap depth 3; no 4th level |
| Jobs/RE growth | Flat leaves + filters (comp, beds) not new categories |
| 100k | Indexes on `(entity_type, category_slug)`; facets from taxonomy JSON |

Structure **holds** if `other` stays &lt;15% and intersections stay rule-based.

---

## 11. Changelog vs prior IA / mapping

| Action | Items |
|--------|--------|
| **Added** | car_rental, moving (Biz); full Pro/Jobs/RE trees; MP free/wanted; Pro subs nails/hair/immigration/languages |
| **Merged** | services→home_services; restaurants→food; groceries→grocery; cleaning into home_services; MP tiny leaves→other/home |
| **Removed as top categories** | Lost & Found; generic Services hub; parallel svc-* as separate IA (map into Pro/Biz) |
| **Not deleted from live DB** | Existing `categories` rows — map via `legacy_slug_map` when migrating later |

---

## 12. Out of scope

SQL apply, production category rewrite, UI, Events/Lechu/Transfers full trees (later hubs).
