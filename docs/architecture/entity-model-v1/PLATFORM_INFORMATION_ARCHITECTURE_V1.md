# Platform Information Architecture V1

Architecture only. **No SQL. No migrations. No production changes.**  
Categories are derived from the Telegram dataset — not invented empty trees.

Stats artifact: [`ia_stats_snapshot.json`](./ia_stats_snapshot.json).

---

## 0. Dataset & method

| Item | Value |
|------|--------|
| Sources | `Fun for Mom` + `LA_OrangeCounty` full `*_reviewer_v1.json` runs |
| Unit | Logical posts (multi-message ads already merged) |
| **Analyzed** | **8 866** posts (4 127 + 4 739) |
| Top-level split | Analyzer `classification` (intent of the post) |
| Categories inside hubs | LLM `extracted_entity.category` (controlled vocab in collector) |
| Marketplace leaves | Text heuristics (pipeline left ~70% of marketplace as `other`) |
| Subcategories in data | **`subcategory` is null for 100% of posts** — no data-driven deep tree |

Not limited to published cards: includes `accepted` / `needs_review` / `rejected`.

---

## 1. Top-level sections (Stage 1)

| Section (hub) | Count | % of 8 866 | Source classification |
|---------------|------:|----------:|------------------------|
| **Professional** | 2 290 | 25.8% | `direct_specialist_ad` |
| **Business** | 1 137 | 12.8% | `direct_business_ad` |
| **Community — seeking** | 1 126 | 12.7% | `recommendation_request` |
| **Marketplace** | 835 | 9.4% | `marketplace_item` |
| **Noise / irrelevant** | 784 | 8.8% | `irrelevant` |
| **Jobs** | 783 | 8.8% | `job_post` |
| **Real Estate** | 766 | 8.6% | `real_estate_listing` |
| **Events** | 325 | 3.7% | `event_ad` |
| **Community — discussion** | 270 | 3.0% | `discussion` |
| **Community — recommendations** | 251 | 2.8% | `third_party_recommendation` |
| **Unclear** | 215 | 2.4% | `unclear` |
| **Noise — incomplete promo** | 84 | 0.9% | `self_promotion_without_contact` |

### Proposed product hubs (after collapsing community/noise)

| Hub | Role | Include noise? |
|-----|------|----------------|
| Professional | Private specialists | No |
| Business | Companies / orgs | No |
| Marketplace | Goods buy/sell/give | No |
| Jobs | Hiring / personal hire | No |
| Real Estate | Housing / commercial space | No |
| Events | Meetups, classes, parties | No |
| **Community** | Seeking help + tips (not a catalog of businesses) | Soft product surface |
| *(filter)* | irrelevant / unclear / incomplete | Moderated out — not a nav hub |

**Not justified as top hubs from this dataset:** Lost & Found (~35 keyword hits), dedicated Transfers (~6), Lechu-as-hub (keyword hits are mostly false positives inside other classes).

**Services:** do **not** add a parallel top hub. Services live as Business offers / Professional services (Entity Model). Raw Telegram “service ads” already land in Business or Professional.

---

## 2. Categories by hub (Stage 2)

Only categories with real volume. `%` = share of that hub.

### 2.1 Business (n=1 137)

| Category | Count | % |
|----------|------:|--:|
| auto_services | 228 | 20.1 |
| car_rental | 185 | 16.3 |
| moving | 174 | 15.3 |
| food | 154 | 13.5 |
| real_estate_services | 105 | 9.2 |
| other | 85 | 7.5 |
| accounting | 41 | 3.6 |
| beauty | 39 | 3.4 |
| legal | 29 | 2.6 |
| childcare | 22 | 1.9 |
| health | 19 | 1.7 |
| education | 16 | 1.4 |
| insurance | 15 | 1.3 |
| events, travel, cleaning, professional_services, locksmith, home_services | ≤7 each | &lt;1 |

**Suggested Business nav labels (RU):** Автосервис · Аренда авто · Переезды · Еда / рестораны · Недвижимость (агентства) · Бухгалтерия · Красота · Юристы · Няни/центры · Медицина · Образование · Страхование · Прочее.

### 2.2 Professional (n=2 290)

Pipeline categories:

| Category | Count | % |
|----------|------:|--:|
| beauty | 509 | 22.2 |
| education | 388 | 16.9 |
| other | 387 | 16.9 |
| legal | 165 | 7.2 |
| professional_services | 165 | 7.2 |
| health | 116 | 5.1 |
| photography_video | 108 | 4.7 |
| auto_services | 92 | 4.0 |
| travel | 84 | 3.7 |
| food | 63 | 2.8 |
| accounting | 61 | 2.7 |
| fitness | 59 | 2.6 |
| childcare | 40 | 1.7 |
| insurance, events, cleaning, pet_services, home_services, … | small | |

Text-refined leaves (where useful): tutors (languages heavy), hair/makeup, nails/lashes/brows, immigration vs general legal, photo/video, designers/SMM, fitness coaches.

### 2.3 Marketplace (n=835)

Pipeline `category` is weak (~70% `other`). Text-based leaves:

| Leaf | Count | % |
|------|------:|--:|
| other_goods | 421 | 50.4 |
| furniture | 95 | 11.4 |
| free_giveaway | 64 | 7.7 |
| kids_baby | 62 | 7.4 |
| wanted_seeking | 38 | 4.6 |
| auto_parts | 29 | 3.5 |
| clothing | 27 | 3.2 |
| vehicles | 25 | 3.0 |
| electronics | 21 | 2.5 |
| books_media | 18 | 2.2 |
| appliances_home | 17 | 2.0 |
| sports_outdoors | 10 | 1.2 |
| tools / pets_goods / decor | tiny | |

**Nav:** Мебель · Дети · Отдам даром · Ищу / куплю · Одежда · Электроника · Авто / запчасти · Бытовая техника · Спорт · Прочее.  
Vehicles-for-sale may later move to a **Vehicles** entity; volume here is still small.

### 2.4 Jobs (n=783)

| Leaf (text / sector) | Count | % |
|----------------------|------:|--:|
| driver | 152 | 19.4 |
| other_jobs | ~100 | ~13 |
| cleaning_housekeeping | 87 | 11.1 |
| beauty / salon staff | ~114 | ~15 |
| photo/video crew | ~69 | ~9 |
| childcare / nanny | ~43 | ~5 |
| food / kitchen | ~58 | ~7 |
| sales / office | 32+ | ~6 |
| construction / moving / delivery | smaller | |

**Nav:** Водители · Уборка · Красота (мастера) · Няни / уход · Общепит · Офис / продажи · Стройка / грузчики · Фото/видео · Другое.

### 2.5 Real Estate (n=766)

| Leaf | Count | % |
|------|------:|--:|
| apartment_rent | 366 | 47.8 |
| room_rent | 250 | 32.6 |
| other_real_estate | 128 | 16.7 |
| commercial | 22 | 2.9 |

**Nav:** Квартиры (аренда) · Комнаты · Коммерция · Прочее (продажа домов rare in this sample).

### 2.6 Events (n=325)

Dominant tag `events` (43.7%); rest bleed into travel / education / food / fitness / childcare (community classes & kids activities).

**Nav (flat):** Мероприятия · Детские · Обучение / лекции · Спорт · Еда / дегустации · Другое — **no deep tree**.

### 2.7 Community — seeking (n=1 126)

Same category vocabulary as services (health, legal, childcare, beauty, …): people asking “who do you recommend?”.

This is **intent = request**, not a third catalog of providers. Surface as «Запросы» / feed, optionally linking into Professional/Business search — not duplicate category IA.

---

## 3. Subcategories (Stage 3)

| Hub | Subcategories? | Why |
|-----|----------------|-----|
| Business | **Mostly no** in MVP | Pipeline has no subcategory data; top categories already specific (moving, car_rental) |
| Professional | **Selective only** | Beauty → nails / hair / makeup; Education → languages vs other; Legal → immigration vs general — only if UI filters need them |
| Marketplace | **No deep tree** | Until better tagging; use flat leaves + «Прочее» |
| Jobs | **No** | Flat job types enough |
| Real Estate | **Yes (2–3)** | apartment vs room vs commercial — high volume, clear UX |
| Events | **No** | Too small for depth |

Do not build taxonomy depth “for completeness.”

---

## 4. Stats highlights (Stage 4)

### Unexpectedly large

* **Professional** is the #1 commercial intent (bigger than Business).  
* **Community seeking** ≈ Business volume — community asks are first-class behavior.  
* **Business:** auto + car rental + moving dominate over classic “restaurants/grocery.”  
* **Jobs:** drivers and cleaners/beauty staff dominate over white-collar.  
* **Real Estate:** rentals (apt + room) dominate; sales almost absent in this sample.

### Very small (do not promote as top nav)

* locksmith, home_services (as Business tags), tools, pet goods, commercial RE, insurance (low), Lost & Found, money transfers.

### Merge candidates

| Merge | Rationale |
|-------|-----------|
| Business `cleaning` + tiny `home_services` → **Home services** | Tiny alone |
| Professional `cleaning` / `home_services` / trades → **Home & trades** | Sparse |
| Marketplace `tools` + `sports` into **Home & outdoor** until volume grows | Tiny |
| `car_rental` stay **separate** from `auto_services` | Both large and different intent |
| Community discussion + recommendations → one **Community** hub | Same product job |

### Split into own entities (Entity Model)

| From Telegram class | Platform entity |
|---------------------|-----------------|
| direct_business_ad | **Business** |
| direct_specialist_ad | **Professional** |
| marketplace_item | **Marketplace listing** |
| job_post | **Job** |
| real_estate_listing | **Real Estate** (entity stub already planned) |
| event_ad | **Event** |
| recommendation_request | Not an entity card — **Community request** (future) or search assist |

---

## 5. Final navigation structure (Stage 5)

```text
КРУГИ
│
├── Бизнесы                    → category → cards
│     Автосервис
│     Аренда авто
│     Переезды
│     Еда
│     Недвижимость (агентства)
│     Красота · Бухгалтерия · Юристы · …
│     Прочее
│
├── Специалисты                → category → [optional sub] → cards
│     Красота [ногти / волосы / …]
│     Репетиторы / обучение
│     Юристы [/ иммиграция]
│     Здоровье
│     Фото / видео
│     Авто · Путешествия · Фитнес · Бухгалтерия · …
│     Прочее
│
├── Барахолка                  → flat category → cards
│     Мебель · Дети · Дар · Ищу · Одежда · Электроника · Авто · …
│
├── Работа                     → flat type → cards
│     Водители · Уборка · Красота · Няни · Общепит · Офис · …
│
├── Недвижимость               → sub → cards
│     Квартиры
│     Комнаты
│     Коммерция
│
├── События                    → flat → cards
│
└── Сообщество (soft)          → requests / tips feed
      «Ищу рекомендацию»
      (not a parallel business directory)
```

Card surfaces still follow Entity Model: one record, many views; Business ≠ Professional.

---

## 6. Recommendations (Stage 6)

### MVP must-have hubs

1. **Professional**  
2. **Business**  
3. **Marketplace**  
4. **Jobs** (personal + business jobs per Jobs model)  

Optional but strongly data-backed for early MVP+: **Real Estate** (almost as large as Jobs).

### Add later

* **Events** (3.7%)  
* **Community / Запросы** as a product surface (large volume, different UX)  
* Vehicles entity (split from Marketplace when car sales grow)  
* Transfers / Lechu only if a cleaner dedicated corpus appears  

### Not needed as top-level

* Lost & Found  
* Generic “Services” hub (duplicates Biz/Pro)  
* Separate “Organizations” hub (6 posts tagged organization)  
* Deep subcategory trees without data  

### Categories to merge

* Tiny home/cleaning/locksmith under **Home services**  
* Marketplace micro-leaves into **Прочее** until tagged better  
* Community discussion + third-party tips → one Community  

### Categories → separate entities

* Real Estate listings → Real Estate entity (not Business with `real_estate_services` only)  
* Jobs → Jobs entity (not Marketplace, not listings.job long-term)  
* Specialists → Professional (not Business)  
* Agency offices → Business; individual realtor → Professional (`real_estate_services` bleed)

---

## 7. Alignment notes vs Entity Model

* Confirms **Professional as first-class** (largest commercial class).  
* Confirms **no required Pro↔Business link** (both appear independently).  
* **Community seeking** is user behavior, not Base Entity — don’t force into Business/Pro tables.  
* Pipeline `other` + empty `subcategory` mean IA must stay **shallow** until better classification.

---

## 8. Out of scope

SQL, seed migrations for categories, UI mockups, production taxonomy changes, inventing empty leaves.
