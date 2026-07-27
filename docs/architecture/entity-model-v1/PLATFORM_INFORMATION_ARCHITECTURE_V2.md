# Platform Information Architecture V2

Architecture only. **No SQL. No migrations. No production changes. No code changes.**

Built from **all available project sources**, not Telegram alone.  
Categories come from observed data + locked [`TAXONOMY_V1`](./TAXONOMY_V1.md) / [`TAXONOMY_FREEZE_V1`](./TAXONOMY_FREEZE_V1.md) — not empty invented trees.

Machine companion: [`platform_taxonomy_v2.json`](./platform_taxonomy_v2.json).  
Telegram deep-dive remains in [`PLATFORM_INFORMATION_ARCHITECTURE_V1.md`](./PLATFORM_INFORMATION_ARCHITECTURE_V1.md).

**Status:** ready for product approval.

---

## 0. Sources used

| # | Source | Unit | Size |
|---|--------|------|-----:|
| 1 | Telegram `Fun for Mom` + `LA_OrangeCounty` `*_reviewer_v1.json` | Logical posts | **8 866** (4 127 + 4 739) |
| 2 | Facebook seed curated | `facebook-entities/` + `consolidated-18/`, deduped by name | **52** unique |
| 3 | Facebook batches 1–6 | Raw seed dumps (overlap) | 115 items / 92 unique names |
| 4 | Published Business | Live `/api/platform-stats` | **315** approved |
| 5 | Published Professional | Domain table | **0** (not in production) |
| 6 | `import_review_items` | Live queue (documented snapshot) | **5 585** |
| 7 | Published listings | Live stats + hub counts | **43** total · hub-filtered: MP **14** · services **28** · lechu **0** · transfers **0** |
| 8 | Current Taxonomy | `taxonomy_*_v1.json` + RU freeze | 5 entity trees |
| 9 | Home navigation | `lib/platform/sections.ts` | 5 sections |

**Category breakdown for published Business** uses the earlier DB snapshot (~307 rows by slug); live total is now **315**. Relative mix is unchanged enough for IA decisions.

---

## 1. Inventory by source (Stage 1)

| Source | Total | Business | Professional | Marketplace | Jobs | Real Estate | Events | Community | Other |
|--------|------:|---------:|-------------:|------------:|-----:|------------:|-------:|----------:|------:|
| **Telegram** | 8 866 | 1 137 | 2 290 | 835 | 783 | 766 | 325 | 1 647 | 1 083 |
| **Facebook curated** | 52 | 19 | 25 | ~0–1* | 2 | 5 | — | — | 1 |
| **Published live** | — | **315** | **0** | **14**† | **0** | **0** | **0** | — | services listings **28**† |
| **import_review** | 5 585 | 1 081 | 2 298‡ | 767 | **0** | 820 | 299 | — | lechu 279 · transfers 33 · org 6 |

\* Facebook marketplace goods are sparse in curated seed (mostly people/companies).  
† Hub-filtered listing counts from `/api/hub-category-counts` (default region).  
‡ `private_specialist` in queue.

Telegram hub mapping = analyzer `classification`  
(`direct_specialist_ad`, `direct_business_ad`, `marketplace_item`, `job_post`, `real_estate_listing`, `event_ad`, community trio, noise/unclear).

---

## 2. Unified statistics (Stage 2)

### Method (not a naive sum)

1. **Do not add** Telegram + `import_review` — queue is largely Telegram-fed.  
2. **Do not add** Facebook seed on top of published Business — seed upserts into catalog.  
3. **Live catalog** = published domain rows (truth for “what users see now”).  
4. **Pipeline mass** = `import_review` `entity_type` (future cards).  
5. **Intent-only** = Telegram for Jobs / Community when absent from DB/queue.

### Live catalog now

| Entity | Count | Notes |
|--------|------:|-------|
| Business | **315** | Only mature published directory |
| Professional | **0** | Table not shipped |
| Marketplace | **14** | Active listings (region hub filter) |
| Jobs | **0** | |
| Real Estate inventory | **0** | |
| Events inventory | **0** | |
| Service listings (transitional) | **28** | Not Professional entity |
| Lechu / Transfers | **0 / 0** | In nav, empty live |

### Pipeline mass (`import_review` 5 585)

| entity_type | Count |
|-------------|------:|
| private_specialist | 2 298 |
| business | 1 081 |
| real_estate | 820 |
| marketplace_listing | 767 |
| event | 299 |
| lechu_listing | 279 |
| transfer_listing | 33 |
| organization | 6 |

By source: `telegram:la_orange_county` 3 273 · `telegram` 2 307 · `facebook` 5.  
**Jobs in import_review: 0** despite **783** Telegram job posts.

### Projected mix after pipeline lands

| Hub | Basis | Scale |
|-----|-------|------:|
| Professional | queue | ~2 300 — **largest future directory** |
| Business | live 315 + ~1 081 typed queue (minus dups) | grows |
| Real Estate | ~820 queue | hundreds |
| Marketplace | 14 live + ~767 queue | hundreds |
| Jobs | 783 Telegram only | **must design hub**; empty DB/queue |
| Events / Lechu / Transfers | queue | post-MVP |
| Community | ~1 647 Telegram intent | soft surface, not card entity |

---

## 3–4. Categories with multi-source counts (Stages 3–4)

Canonical slugs = [`TAXONOMY_V1`](./TAXONOMY_V1.md).  
RU display = [`taxonomy_ru_v1_final.json`](./taxonomy_ru_v1_final.json).  
`import_queue` category field **mixes entity types** — demand signal only; prefer TG + published + FB for scoring.

### Business

| slug | name_ru | TG | FB seed | Published* | Queue† | Signal TG+FB+Pub |
|------|---------|---:|--------:|-----------:|-------:|-----------------:|
| food | Рестораны и кафе | 154 | 1 | 19 | 295 | 174 |
| grocery | Продукты | 0 | 1 | 7 | 0 | 8 |
| beauty | Красота | 39 | 1 | 60 | 569 | 100 |
| medical | Медицина | 19 | 1 | 17 | 185 | 37 |
| legal | Юристы | 29 | 2 | 15 | 211 | 46 |
| finance | Бухгалтерия и налоги | 41 | 1 | 7 | 103 | 49 |
| insurance | Страхование | 15 | 1 | 6 | 39 | 22 |
| auto | Автосервис | 228 | 2 | 31 | 409 | 261 |
| car_rental | Аренда авто | 185 | 0 | 0 | 202 | 185 |
| moving | Переезды | 174 | 1 | 0 | 187 | 175 |
| home_services | Услуги для дома | 6 | 2 | 56‡ | — | 64 |
| └ cleaning | Уборка | 4 | 0 | 0 | — | 4 |
| education | Образование | 16 | 2 | 34 | 442 | 52 |
| fitness | Фитнес | 0 | 0 | 14 | 91 | 14 |
| pets | Животные | 0 | 0 | 2 | 33 | 2 |
| travel | Визы и путешествия | 6 | 0 | 1 | 128 | 7 |
| real_estate_agencies | Агентства недвижимости | 105 | 2 | 1 | 821 | 108 |
| events | Праздники и площадки | 7 | 1 | 6 | 167 | 14 |
| childcare | Детские центры | 22 | 0 | 0 | 153 | 22 |
| other | Другое | 85 | 0 | 31§ | 1237 | 116 |

\* Snapshot ~307. ‡ Includes legacy published `services`. § Includes null-category published.

**Legacy map:** `restaurants→food`, `groceries→grocery`, `services→home_services`, `real_estate→real_estate_agencies`.

### Professional (TG primary; published = 0)

| slug | name_ru | TG | Notes |
|------|---------|---:|-------|
| beauty | Красота | 509 | + nails / hair_makeup / massage |
| education | Репетиторы | 388 | + languages / stem_music |
| legal | Юристы | 165 | + immigration / general |
| medical | Здоровье | 116 | ≠ Business «Медицина» |
| photography_video | Фото и видео | 108 | |
| fitness | Тренеры | 59 | |
| finance | Бухгалтеры | 61 | |
| auto | Мастера по авто | 92 | |
| travel | Визы и путешествия | 84 | |
| food | Домашняя еда | 63 | |
| childcare | Няни | 40 | |
| professional_services | Дизайн, SMM и IT | 165 | |
| home_services | Мастера для дома | 14+ | |
| pets | Уход за животными | 7 | keep small |
| insurance | Страховые агенты | 14 | keep small |
| real_estate | Риелторы | 2+ | agency ≠ this |
| other | Другое | 387 | shrink via import |

Queue `private_specialist` ≈ **2 298**.

### Marketplace (TG text leaves; pipeline category mostly `other`)

| slug | name_ru | TG leaf | Keep |
|------|---------|--------:|------|
| furniture | Мебель | ~95–123 | yes |
| kids | Детские вещи | ~30–62 | yes |
| free | Отдам даром | ~64–105 | yes |
| wanted | Ищу | ~38–48 | yes |
| clothing | Одежда | ~8–27 | yes |
| electronics | Электроника | ~12–21 | yes |
| home | Для дома | ~14–17 | yes |
| auto_parts | Запчасти | ~13–29 | yes |
| vehicles | Машины | ~12–25 | yes |
| sports | Спорт | ~7–10 | yes |
| other | Другое | ~400+ | temp |

Merged micro-leaves: tools, pets_goods, books_media → other/home.

### Jobs (Telegram only — **pipeline gap**)

| slug | name_ru | TG |
|------|---------|---:|
| drivers | Водители | ~152–186 |
| cleaning | Уборка | ~87–91 |
| beauty | Красота | ~99–114 |
| childcare | Няни и уход | ~43 |
| restaurant | Рестораны и кухня | ~58–120 |
| office | Офис и продажи | ~49 |
| skilled_trades | Стройка и ремёсла | ~16–27 |
| photo_video | Фото и видео | ~8–69 |
| other | Другое | ~100–212 |

**Not added:** Healthcare as top Jobs category — signal ≈0–2 in refine; do not invent.

### Real Estate inventory

| slug | name_ru | TG |
|------|---------|---:|
| apartments | Квартиры | ~270–366 |
| rooms | Комнаты | ~250–313 |
| houses | Дома | low / keep slot |
| commercial | Коммерческая | ~4–22 |
| short_term | Посуточно | sparse / keep slot |
| other | Другое | ~128–150 |

Agencies stay on **Business.real_estate_agencies**; agents on **Professional.real_estate**.

---

## 5. Source comparison (Stage 5)

| Observation | Explanation |
|-------------|-------------|
| Telegram over-weights **Professional** (25.8%) | Chat ads are person-branded masters; many never become LLC pages |
| Facebook curated skews **Business + Professional people** with richer contacts | Seed selection favors complete profiles; not representative of chat noise |
| Marketplace almost absent on Facebook seed | Seed pipeline targeted businesses/specialists, not goods |
| **Jobs only in Telegram** (783); **0** in import_review / published | Jobs rejected or never written to queue — product/pipeline gap, not “no demand” |
| Published is **Business-only** maturity | Autopublish + schema shipped for businesses first |
| import_review ≠ Telegram totals | Community, noise, duplicates, and Jobs filtered out before queue |
| Published `services` large (56) vs TG home_services tiny | Legacy catch-all category on live catalog |
| Queue `real_estate_services` huge (821) | Mix of agencies + listings; split by entity in taxonomy |
| Lechu/Transfers in queue (279/33) but **0** live and still in home nav | Nav ahead of data / entity maturity |

---

## 6. Final platform structure (Stage 6)

Max depth **3**. Prefer 1–2.

```text
Бизнесы
  ├─ categories (see §3 Business)
  │    └─ subcategory only where data warrants (cleaning under home_services)
  └─ cards

Специалисты
  ├─ categories (+ beauty/education/legal subcats)
  └─ cards

Купи-продай
  ├─ flat categories
  └─ cards

Работа
  ├─ flat categories
  └─ cards

Недвижимость
  ├─ flat categories
  └─ cards

(later) События · Лечу · Переводы · Сообщество
```

**Hub display names (RU freeze):**  
Бизнесы · Специалисты · **Купи-продай** · Работа · Недвижимость

---

## 7. Taxonomy check (Stage 7)

Against current live `categories` + TAXONOMY_V1:

| Decision | Items | Why |
|----------|-------|-----|
| **Keep** | beauty, auto, food/restaurants family, legal, education, medical, finance, insurance, fitness, pets, travel, events, … | Strong multi-source signal |
| **Merge** | `services` → `home_services`; `restaurants` → `food`; `groceries` → `grocery`; locksmith/tiny cleaning → home_services; MP tools/books/pets_goods → other/home | Too small or legacy catch-all |
| **Remove as top IA** | Lost & Found; “Services” as home section; **Барахолка** as hub label | Not data hubs / rejected naming |
| **Add** | `car_rental`, `moving`; full Professional / Jobs / RE trees; MP `free`/`wanted` | Large TG signal, missing as first-class |
| **Rename (display only)** | Marketplace → **Купи-продай**; home_services → Услуги для дома; travel → Визы и путешествия; vehicles → Машины; pets biz → Животные | RU freeze / US audience |

Slugs of TAXONOMY_V1 stay; live legacy slugs map via `legacy_slug_map`.

---

## 8. Home navigation check (Stage 8)

### Current (`PLATFORM_SECTIONS`)

| Section | Title | Live (default hub) | Data reality |
|---------|-------|-------------------:|--------------|
| businesses | Бизнесы | 182 | Aligns |
| marketplace | Marketplace | 14 | Aligns as hub; **EN title** wrong for RU product |
| services | Услуги | 28 | **Misaligned** — service listings ≠ Professional entity; hides ~2 300 queue specialists |
| lechu | Лечу | 0 | Queue 279; **empty live**; early for MVP nav |
| transfers | Переводы | 0 | Queue 33; **empty live**; early for MVP nav |

### Answers

| Question | Answer |
|----------|--------|
| Хватает ли разделов? | **Нет** для реального микса: нет Специалисты / Работа / Недвижимость |
| Чего не хватает? | Специалисты, Работа, Недвижимость |
| Что лишнее в MVP? | Лечу, Переводы (данные почти/полностью пустые live) |
| Services? | Переходный listing-type; **заменить** хабом Специалисты |
| Community? | ~1 647 TG intent — soft later, не карточки MVP |
| Jobs? | Обязателен по Telegram; сейчас отсутствует в nav и в queue |
| Marketplace? | Оставить; назвать **Купи-продай** |
| Real Estate? | Обязателен по queue (~820) |
| Lechu / Transfers? | После MVP |

### Recommended MVP nav

1. Бизнесы  
2. Специалисты  
3. Купи-продай  
4. Работа  
5. Недвижимость  

---

## 9. MVP sequencing (Stage 9)

| Tier | What |
|------|------|
| **Обязательно для MVP** | 5 хабов выше; TAXONOMY_V1 categories; Professional entity + publish path; Jobs entity + **import path** (close 783 gap); RE inventory entity; marketplace category leaves; RU labels from freeze |
| **Желательно после MVP** | Events hub; shrink `other`; claim/enrichment; better MP tagging |
| **Можно позже** | Lechu; Transfers; Community surface; Vehicles split from MP |
| **Не требуется** | Lost & Found top category; 4+ level trees; Healthcare Jobs category; Барахолка naming |

---

## 10. vs Information Architecture V1

| V1 | V2 |
|----|----|
| Telegram-only | All sources |
| Hubs from chat classification | Hubs from live + queue + TG intent |
| Deep TG leaves | Locked to TAXONOMY_V1 + RU freeze |
| — | Home nav gap analysis |
| — | MVP tiers |
| Marketplace informal | **Купи-продай** display |

---

## 11. Confirmations

- Production **not** changed  
- SQL **not** written / applied  
- Migrations **not** created or applied  
- Application code **not** changed  
- Documents only: this file, `platform_taxonomy_v2.json`, `REPORT.md` update  

---

## 12. Approval ask

Approve:

1. Five MVP hubs (incl. **Купи-продай**, not Барахолка / not EN “Marketplace”).  
2. Category trees = TAXONOMY_V1 + RU freeze.  
3. Home nav replacement plan (drop Services/Lechu/Transfers from MVP primary nav).  
4. Jobs import gap as a **required** pipeline fix (architecture note only — no code in this task).

---

## 13. Final Validation (Freeze gate)

Machine block: `platform_taxonomy_v2.json` → `validation_freeze_v1`.

**Decision: Taxonomy Ready for Freeze** (`READY_FOR_FREEZE`).

После утверждения этого раздела изменения Taxonomy — только отдельным архитектурным решением (V2+). База для Admin Review Center и новых импортов.

### 13.1 Category statistics (primary count + %)

Primary = TG for Pro/MP/Jobs/RE; Business = signal (TG+FB+Published). Queue **not** summed into %.

#### Business (signal total 1 456)

| Category | Count | % |
|----------|------:|--:|
| Автосервис | 261 | 17.9 |
| Аренда авто | 185 | 12.7 |
| Переезды | 175 | 12.0 |
| Рестораны и кафе | 174 | 12.0 |
| Другое | 116 | 8.0 |
| Агентства недвижимости | 108 | 7.4 |
| Красота | 100 | 6.9 |
| Услуги для дома | 64 | 4.4 |
| Образование | 52 | 3.6 |
| Бухгалтерия и налоги | 49 | 3.4 |
| Юристы | 46 | 3.2 |
| Медицина | 37 | 2.5 |
| Детские центры | 22 | 1.5 |
| Страхование | 22 | 1.5 |
| Фитнес | 14 | 1.0 |
| Праздники и площадки | 14 | 1.0 |
| Продукты | 8 | 0.5 |
| Визы и путешествия | 7 | 0.5 |
| Животные | 2 | 0.1 |

#### Professional (TG 2 274)

| Category | Count | % |
|----------|------:|--:|
| Красота | 509 | 22.4 |
| Репетиторы | 388 | 17.1 |
| Другое | 387 | 17.0 |
| Юристы | 165 | 7.3 |
| Дизайн, SMM и IT | 165 | 7.3 |
| Здоровье | 116 | 5.1 |
| Фото и видео | 108 | 4.7 |
| Мастера по авто | 92 | 4.0 |
| Визы и путешествия | 84 | 3.7 |
| Домашняя еда | 63 | 2.8 |
| Бухгалтеры | 61 | 2.7 |
| Тренеры | 59 | 2.6 |
| Няни | 40 | 1.8 |
| … | smaller | |

#### Marketplace (TG leaves ~809)

| Category | Count | % |
|----------|------:|--:|
| Другое | 421 | 52.0 |
| Мебель | 95 | 11.7 |
| Отдам даром | 64 | 7.9 |
| Детские вещи | 62 | 7.7 |
| Ищу | 38 | 4.7 |
| Запчасти | 29 | 3.6 |
| Одежда | 27 | 3.3 |
| Машины | 25 | 3.1 |
| Электроника | 21 | 2.6 |
| Для дома | 17 | 2.1 |
| Спорт | 10 | 1.2 |

#### Jobs (TG leaves ~699)

| Category | Count | % |
|----------|------:|--:|
| Водители | 152 | 21.7 |
| Красота | 114 | 16.3 |
| Другое | 100 | 14.3 |
| Уборка | 87 | 12.4 |
| Фото и видео | 69 | 9.9 |
| Рестораны и кухня | 58 | 8.3 |
| Офис и продажи | 49 | 7.0 |
| Няни и уход | 43 | 6.2 |
| Стройка и ремёсла | 27 | 3.9 |

#### Real Estate (TG leaves 766)

| Category | Count | % |
|----------|------:|--:|
| Квартиры | 366 | 47.8 |
| Комнаты | 250 | 32.6 |
| Другое | 128 | 16.7 |
| Коммерческая | 22 | 2.9 |
| Дома / Посуточно | slots | keep |

#### Events (TG 325 — **not MVP freeze**)

Topic leaks (travel/education/food as “category”) — post-MVP; not part of frozen Taxonomy V1 trees.

### 13.2 Provenance (TG / FB / Published / Queue)

Full per-slug matrix in `validation_freeze_v1.entities.*`. Summary:

| Pattern | Categories |
|---------|------------|
| **Multi-source** (TG+Pub±FB) | beauty, food, auto, medical, legal, education, finance, insurance |
| **TG-heavy, weak published** | car_rental, moving, childcare (biz), most Pro, all Jobs, RE inventory |
| **Published-heavy / legacy** | home_services (← services), fitness, grocery |
| **Queue-inflated / mixed entity** | real_estate_agencies, Pro.real_estate, beauty/education queue counts |
| **MP almost TG-only** | furniture, free, wanted, kids, … |

Queue column is **mixed entity_type** — do not treat as Business-only.

### 13.3 Classification quality audit

Cross-check: analyzer `classification` hub vs `extracted_entity.entity_type` (excl. community/noise hubs).

| Problem | Count | Examples | Cause |
|---------|------:|----------|-------|
| Business → Real Estate | **52** | «Сдам помещение в бьюти-студии…»; «Сдаю комнату Park Newport…» | Ad framed as business; body is rental inventory |
| Business → Professional | **15** | homemade food; realtor promo | Person brand vs org |
| Events → Real Estate | 1 | cabinet rental for beauty | Event mis-tag |
| Marketplace → service cats | **~254** | MP tagged `auto_services`/`childcare`/`food` | Shared service vocabulary on goods |
| Marketplace → Other | **581 (69.6%)** | weakly tagged goods | No goods leaf vocab in LLM category |
| Jobs → Other | **224 (28.6%)** | generic hiring | Weak jobs leaves in category field |
| RE → `real_estate_services` bucket | **702 (91.6%)** | apartments/rooms all one slug | Inventory leaves missing from analyzer vocab |
| Biz looks personal / Pro looks org | 45 / 143 | heuristic | Boundary noise for Review Center |

**Entity-type mismatch total (excl. community): 68** — manageable in Review Center; **not** a taxonomy-structure blocker.

### 13.4 Classifier assessment

| Stable (rules/LLM OK) | Confused | Needs prompt/rules | Other hotspots |
|----------------------|----------|--------------------|----------------|
| beauty, education, auto, car_rental, moving, food, legal, drivers, cleaning(jobs), apartments, rooms, furniture, free | business↔RE rentals; business↔pro person; MP goods vs service tags | MP goods vocab; RE apartments/rooms; jobs sector→leaf; LLC vs «я мастер» | MP 69.6% · Jobs 28.6% · Pro 16.9% · Biz 7.5% |

Improvements = **classifier/import**, not new taxonomy trees.

### 13.5 Per-category status (MVP trees)

| Status | Meaning | Count (approx) |
|--------|---------|----------------|
| **Stable** | Freeze as-is | ~52 |
| **Needs Review** | Keep slug; fix mapping/classifier in Review Center | ~9 (`other` buckets, home_services legacy, RE agency/realtor queue inflate, jobs photo_video) |
| **Merge Candidate** | Optional later fold | sports (MP) — **do not merge before freeze** unless product insists |
| **Remove Candidate** | None in MVP trees | Events topic-leaks only (out of freeze scope) |

`Needs Review` ≠ «remove from taxonomy». It means Review Center + import rules must clean assignment.

### 13.6 Conclusion

| Question | Answer |
|----------|--------|
| **Готова ли Taxonomy к Freeze?** | **Да — Ready for Freeze** |
| Какие проблемы остаются? | High `other` on MP/Jobs/Pro; Jobs not in import_review; RE leaf under-tagging; Biz↔RE booth rentals; legacy published `services` |
| Что чинить после запуска? | Classifier prompts/rules; Review Center remaps; shrink `other`; Jobs queue write path |
| Блокеры перед Review Center? | **Нет.** Taxonomy structure sufficient; Review Center is the right place to fix assignment quality |

### 13.7 Confirmations (this validation)

- Production / SQL / migrations / code — **unchanged**  
- Docs updated only: this file, `platform_taxonomy_v2.json`, `REPORT.md`
