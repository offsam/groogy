# Admin Panel — Information Architecture Audit V1

**Date:** 2026-07-28  
**Constraint:** audit + recommendation only. **No code, UI, or route changes** in this pass.  
**Goal:** make Admin a moderator workspace organized by **tasks and entities**, not by **data origin**. Target: any card reachable in **2–3 clicks**.

---

## 1. Executive summary

Today’s Admin hub (`/admin`) is a **flat grid of 12 tools**, mostly named after **pipelines and sources** (Import Review, Telegram-группы, Справочники, Рекомендации из комментариев, События — верификация). Catalog tools exist only for **Businesses** and **Listings**; there is **no Admin catalog for Professionals, Jobs, or Events** (beyond a verification queue).

**Core problem:** the same moderation work (approve / reject / reclassify / publish) is split across **four queues** that share overlapping intent and often the **same underlying table** (`import_comment_recommendations`), plus a **fifth** queue (`import_review_items`). An admin looking for “Professionals from LA Telegram” must guess between Import Review, Telegram-группы, and Recommendations — and still cannot open a global Professionals catalog.

**Verdict:** the panel is usable for small volume; at tens of thousands of cards it will feel chaotic.

**Target IA (approved path):** [`../architecture/ADMIN_PANEL_IA_V2.md`](../architecture/ADMIN_PANEL_IA_V2.md) — Review Center Inbox · Catalog · Imports (provenance) · Community · Users · Analytics · System.

---

## 2. Current inventory (as shipped)

### 2.1 Navigation model

| Surface | What exists |
|---|---|
| Hub | `/admin` — card grid (`LINKS` in `app/admin/page.tsx`) |
| Global sidebar | **None** — only Header link «Админ» → hub |
| In-section nav | Mostly «← к админке» / «← к очереди» |
| Legacy redirect | `/admin/yellow-pages` → `/admin/directories` |

There is **no persistent IA tree**. Every session starts at the hub; depth is hub → page → (optional) detail.

### 2.2 Route map

| Route | UI title (intent) | Primary data | Entity focus | Status |
|---|---|---|---|---|
| `/admin` | Админ-панель | Dashboard counts | — | Active hub |
| `/admin/analytics` | Аналитика | `get_admin_platform_analytics` | Site traffic, catalog growth | Active |
| `/admin/claims` | Заявки «Это мой бизнес» | `business_claims` | Business ownership | Active queue |
| `/admin/import-review` | Импорт → Требуют проверки | `import_review_items` | All entity types (via `target_collection`) | Active queue |
| `/admin/import-review/[id]` | Detail + approve/reject | same + `raw_payload` | One card | Active |
| `/admin/events` | События — верификация | `import_comment_recommendations` (`kind=event`) + published `events` peek | Events | Active queue |
| `/admin/recommendations` | Рекомендации из комментариев | `import_comment_recommendations` (`kind=profi`, FB-oriented copy) | Pro / business / service buckets | Active queue |
| `/admin/directories` | Справочники | Index of directory sources | Yellow Pages–style | Active index |
| `/admin/directories/[source]` | Per-directory queue | `import_comment_recommendations` (`yellow_pages` + `directory_source`) | Mostly businesses/pros | Active |
| `/admin/telegram-groups` | Telegram-группы | Index of TG sources | TG comment/cards | Active index |
| `/admin/telegram-groups/[source]` | Per-group queue | `import_comment_recommendations` (telegram `directory_source`) | Mixed | Active |
| `/admin/businesses` | Бизнесы и дубликаты | `businesses` + merge pairs | Business catalog + pending + merge | Active |
| `/admin/businesses/new` | Создать бизнес | insert business | Business | Active |
| `/admin/businesses/[id]/edit` | Edit business | `businesses` | Business | Active |
| `/admin/listings` | Модерация объявлений | `listings` + reports | Marketplace + services | Active |
| `/admin/reviews` | Модерация отзывов | reviews moderation queue | Reviews on entities | Active |
| `/admin/users` | Админы и пользователи | `admin_list_users` | Roles | Active |
| `/admin/master-data` | Master Data | categories, languages, geography | Taxonomy | Active |
| `/admin/yellow-pages` | — | redirect | — | Legacy |

### 2.3 Hub menu items (as labeled today)

Order and framing from `app/admin/page.tsx`:

1. Аналитика — visits / growth  
2. Заявки на владение — claims  
3. Импорт → Требуют проверки — AI import queue (**origin-first**)  
4. События — верификация — events from FB pipeline (**origin-first**)  
5. Рекомендации из комментариев — FB comments (**origin-first**)  
6. Справочники — Yellow Pages catalogs (**origin-first**)  
7. Telegram-группы — TG sources (**origin-first**)  
8. Бизнесы — published + pending + merge (**entity**, incomplete)  
9. Объявления — listings + reports (**entity**, incomplete)  
10. Отзывы — review moderation (**community**)  
11. Админы и пользователи — roles  
12. Master Data — taxonomy  

**Missing from hub (gaps):** Professionals catalog, Jobs catalog, Events catalog (browse published), unified “all pending work”, Reports center, AI ops, Import health.

### 2.4 Queues and tables (mental model)

```
┌─────────────────────────────────────────────────────────────┐
│ import_review_items                                         │
│  → /admin/import-review                                     │
│  Sources: telegram:*, facebook:*, professional_cleanup_v1…  │
│  Actions: edit → approve into businesses/pros/jobs/…        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ import_comment_recommendations  (ONE table, many UIs)       │
│  kind=profi  → /admin/recommendations                       │
│  kind=event  → /admin/events                                │
│  yellow_pages bucket + directory_source                     │
│              → /admin/directories/[source]                  │
│  telegram directory_source                                  │
│              → /admin/telegram-groups/[source]              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Live catalog / community                                    │
│  businesses → /admin/businesses                             │
│  listings   → /admin/listings                               │
│  reviews    → /admin/reviews                                │
│  claims     → /admin/claims                                 │
│  (professionals / jobs / events — NO admin catalog pages)   │
└─────────────────────────────────────────────────────────────┘
```

### 2.5 Per-section scorecard

| Section | Purpose | Entities shown | Data source | Overlap | Used now? | Needed? |
|---|---|---|---|---|---|---|
| Analytics | Growth / traffic | Aggregate metrics | RPC analytics | Partial overlap with Catalog KPIs | Yes | Yes — keep under Analytics |
| Claims | Ownership moderation | Business claims | `business_claims` | Distinct | Yes | Yes — under Review Center |
| Import Review | Pre-publish AI/import cards | All via `target_collection` | `import_review_items` | Overlaps Recommendations/TG for similar posts | Yes (incl. Professional Cleanup handoff) | Yes — but reframe as Review + nested by source |
| Events verification | Approve event candidates | Events | `import_comment_recommendations` | Overlaps Import Review `events` target | Yes | Merge into Review Center → Events (keep source filters) |
| Recommendations | Comment-mined contacts | Pro/business/service | same table | Triple overlap with directories + telegram UIs | Yes | Fold into Review Center / Imports |
| Directories | YP per catalog | Mostly business/pro | same table | Same as Recommendations with different filter | Yes | Become Imports → Yellow Pages → source |
| Telegram groups | TG per chat | Mixed | same table | Same as Recommendations/Import Review | Yes | Become Imports → Telegram → region/group |
| Businesses | Catalog + merge + pending | Business | `businesses` | Pending businesses also arrive via Import Review | Yes | Keep as Catalog → Businesses; pending slice also in Review |
| Listings | Listing moderation + reports | Marketplace/services | `listings` | Reports could live under Community | Yes | Catalog + Review + Community Reports |
| Reviews | Review moderation | Reviews | reviews tables | Distinct | Yes | Community / Review Center |
| Users | Roles | Profiles | `admin_list_users` | Distinct | Yes | Users |
| Master Data | Taxonomy | Categories, geo, languages | master-data queries | Distinct | Yes | System / Settings |
| Yellow Pages (legacy) | Redirect | — | — | — | Redirect only | Keep redirect during migration |

### 2.6 Filters that exist today (high level)

| Area | Filters |
|---|---|
| Import Review | status, collection, contact flags, search `q` (incl. `source`), sort, Professional Cleanup chip |
| Recommendations | status, bucket (professional/business/…), category, page |
| Directories / Telegram source pages | RecommendationQueueFilters (status, entity, category…) |
| Listings | filter status, domain marketplace|services, `q` |
| Reviews | moderation status / reported |
| Businesses | merge-oriented list (less “entity browser”) |

**Gap:** Import Review can search by source string, but **cannot** navigate Source → City/Group → Entity in a tree. Telegram index is by **group**, not by **region folder**.

---

## 3. Structural problems

### 3.1 Duplicates / near-duplicates

| Pair / cluster | Why it hurts |
|---|---|
| Recommendations ↔ Directories ↔ Telegram-groups | Same table, different entry points; admin must know *which UI* matches the source |
| Events page ↔ Import Review `events` | Two paths to publish events |
| Import Review ↔ Recommendations | Same person/offer can land in both pipelines |
| Hub “Импорт → Требуют проверки” wording | Sounds like only Telegram AI; now also Professional Cleanup + other sources |

### 3.2 Same card, multiple homes

A specialist mentioned in a FB comment and later scraped from Svoi / TG can appear as:

1. `import_comment_recommendations` row (Recommendations or Telegram or Directory UI)  
2. `import_review_items` row (Import Review)  
3. Live `professionals` / `businesses` row (only businesses have Admin catalog)

There is **no cross-queue identity panel** (“this card also exists in X”).

### 3.3 Origin-first IA (wrong primary axis)

Current mental model: *Where did it come from?*  
Needed mental model: *What do I need to do / what entity is this?*

Origin remains important — but as a **secondary** filter under Imports / Review, not as top-level siblings that look like unrelated products.

### 3.4 Incomplete Catalog

| Entity | Public site | Admin catalog | Admin queue |
|---|---|---|---|
| Business | Yes | Yes (`/admin/businesses`) | Partial (pending status + Import Review) |
| Professional | Yes | **No** | Import Review + Recommendations + Cleanup |
| Marketplace | Yes | Via listings | Listings + Import Review |
| Job | Yes | **No** | Import Review only |
| Event | Yes | **No** (peek on events page) | Events page + Import Review |

### 3.5 Click-path failures (2–3 click goal)

| Task | Typical path today | Clicks | Failure mode |
|---|---|---:|---|
| Moderate LA TG professional | Hub → Telegram-groups → pick group → filter entity | 3–4 | Wrong if item only in Import Review |
| Find published professional | Hub → ??? | ∞ | **No admin page** |
| Professional Cleanup batch | Hub → Import Review → chip/filter | 3 | Easy to miss; not labeled as Cleanup on hub |
| Approve YP Orange Pages business | Hub → Directories → Orange Pages → item | 3 | OK if you know it’s “directories” not “recommendations” |
| Ownership claim | Hub → Claims | 2 | OK |
| Merge duplicate businesses | Hub → Businesses | 2 | OK for businesses only |

### 3.6 Other friction

- No persistent left nav → every deep link loses context.  
- Hub loads **many parallel count queries** (per directory + TG source) — fine now, worse as sources grow.  
- “+ Добавить бизнес” on hub privileges Business creation; no equivalent for other entities.  
- Listings mixes **marketplace catalog** and **user reports** in one title.

---

## 4. Recommended architecture

Organize Admin into **six top-level areas** (persistent nav). Depth rule: **Area → Section → Item** (≤3 clicks). Origin is never a top-level peer of “Businesses”; it lives under **Imports** or as a filter inside Review.

```
Admin
├── Review Center          ← work queues (task-first)
├── Imports                ← sources & ingestion health (origin-first)
├── Catalog                ← published / live entities
├── Community              ← reviews, recommendations, reports, claims*
├── Users
└── Analytics
    └── System / Master Data (or sibling “System”)
```

\*Claims can sit under Review Center **or** Community; recommend **Review Center** (action queue) with a mirror link from Catalog → Business.

### 4.1 Review Center

**Job:** “What needs a human decision today?”

```
Review Center
├── Inbox (all open: pending + in_review + needs_more_info)
├── By entity
│   ├── Businesses
│   ├── Professionals
│   ├── Marketplace
│   ├── Jobs
│   ├── Events
│   └── Other / unclassified
├── Ownership Claims
├── Listing Reports
└── Review reports (user reports on reviews)
```

**Implementation note (future):** Inbox is a **union view** over:

- open `import_review_items`
- open `import_comment_recommendations` (all kinds/sources)
- pending `business_claims`
- open listing/review reports  

Entity tabs apply `target_collection` / `target_bucket` / entity filters.  
**Do not** force admins to pick Telegram vs FB first when the task is “clear Professionals backlog.”

Professional Cleanup items (`source=professional_cleanup_v1`) appear under **Professionals** automatically.

### 4.2 Imports

**Job:** “Work a source end-to-end” and “see ingestion health.”

```
Imports
├── Telegram
│   ├── Sacramento
│   │   ├── Адаптация в Сакраменто
│   │   └── RusRek Sacramento
│   ├── San Francisco
│   │   ├── RusRek SF
│   │   └── SF General
│   ├── San Diego
│   │   ├── RusRek SD
│   │   └── SD General
│   ├── Los Angeles / Orange County
│   │   ├── LA / OC
│   │   └── Fun for Mom
│   └── (future groups…)
├── Facebook Groups
│   └── (keyed by source_channel / group name as data allows)
├── Yellow Pages / Directories
│   ├── Orange Pages
│   ├── Svoi.us
│   ├── Russian Seattle
│   ├── Boston Pages
│   ├── Zerkalo MN
│   ├── RusPagesUSA
│   ├── To4ka
│   ├── Slavic Seattle
│   ├── Our Texas
│   └── EchoRU
├── Google Maps / Places   (when pipeline exists)
├── CSV / one-off imports
└── Pipeline health (batches, errors, last run — analytics-lite)
```

**Inside each group leaf**, always show **entity chips**:

- All · Business · Professional · Marketplace · Job · Event  

Examples of intended URLs (conceptual):

- `Admin → Imports → Telegram → Los Angeles → Professionals`  
- `Admin → Imports → Yellow Pages → Svoi → Businesses`  
- `Admin → Imports → Facebook → {group} → Events`

This replaces today’s separate top-level **Telegram-группы**, **Справочники**, and much of **Рекомендации / События** as *entry points* (those UIs become filtered views of the same queues).

### 4.3 Catalog

**Job:** “Find or edit something already on the platform.”

```
Catalog
├── Businesses      (today’s /admin/businesses + edit/new/merge)
├── Professionals   (NEW admin browser: approved/archived, search, open public card)
├── Marketplace     (listings domain=marketplace)
├── Services        (listings domain=services — if still distinct)
├── Jobs            (NEW)
└── Events          (NEW browse published; verification stays in Review)
```

Rule: **Catalog never owns the primary moderation inbox**; deep links “Open in Review” when status is pending.

### 4.4 Community

```
Community
├── Reviews (moderation)
├── Recommendations feed (read-only / audit of approved comment clusters — optional)
└── Reports (listing + review reports if not under Review Center)
```

Prefer putting **actionable** reports in Review Center Inbox; Community holds history and policies.

### 4.5 Users

```
Users
├── All users
├── Admins
├── Roles
└── Permissions (when finer ACL exists)
```

Maps to today’s `/admin/users` (expand later).

### 4.6 Analytics + System

```
Analytics
├── Growth (users, catalog sizes)
├── Imports (volume by source)
├── Moderation (throughput, backlog age)
├── AI (confidence, reject reasons)
└── Activity (page views, contact reveals — today’s analytics)

System
├── Master Data (categories, languages, geography)
└── Feature flags / ops notes (future)
```

---

## 5. Import Review — recommended hierarchy (detail)

Treat **Import Review** as the **canonical card workspace** for `import_review_items`, nested under both Review Center (by entity) and Imports (by source). Same detail page; different entry filters.

### 5.1 Tree

```
Import Review
├── All sources
├── Telegram
│   ├── Sacramento → [groups] → entity filters
│   ├── Los Angeles / OC → …
│   ├── San Diego → …
│   └── San Francisco → …
├── Facebook
│   └── [group / page keys from `source`]
├── Yellow Pages / Directories
│   └── [directory slug]
├── Professional Cleanup     ← explicit leaf (today: chip only)
├── CSV / other
└── Unparsed / unknown source
```

### 5.2 Entity filters (mandatory at every leaf)

Business · Professional · Marketplace · Job · Event · Unset  

Plus existing power filters: status, contacts, confidence, search.

### 5.3 Moderator happy paths (2–3 clicks)

| Intent | Path |
|---|---|
| Clear Professional Cleanup | Review Center → Professionals → (auto includes cleanup) **or** Imports → Professional Cleanup |
| TG LA professionals | Imports → Telegram → LA/OC → Professionals |
| FB event candidates | Review Center → Events **or** Imports → Facebook → group → Events |
| Published spa in Glendale | Catalog → Businesses → search |

### 5.4 Relationship to `import_comment_recommendations`

Short term: keep table; **unify UI** so Recommendations / Directories / Telegram / Events are **Import Review–like** or shared “Candidate” chrome under Imports/Review.  
Long term (optional): converge candidates into one queue model — **out of scope for this audit**; do not require schema change to adopt the IA.

---

## 6. Navigation rules (acceptance criteria)

1. **≤3 clicks** from Admin home to any specific open card (with correct area known).  
2. **One primary home** per open task: Review Center Inbox (or entity tab).  
3. **One primary home** per published entity: Catalog → type.  
4. **Origin is a filter**, not a competing product.  
5. No hub card whose description says “FB only” if the page also serves Telegram directories.  
6. Persistent nav shows badge counts for Review Inbox + Claims.  
7. Search (global admin search — future) can jump to Catalog or Review by id/slug/phone.

---

## 7. Migration plan (docs only — do not execute)

Phased; each phase shippable without big-bang rewrite.

### Phase A — Navigation shell (IA only)

| Action | Detail |
|---|---|
| Add Admin shell nav | Review · Imports · Catalog · Community · Users · Analytics · System |
| Re-group hub cards | Same routes, new folders/labels; **no deletes** |
| Rename labels | e.g. «Импорт → Требуют проверки» → «Import Review»; «Рекомендации…» → under Imports/Review |
| Keep redirects | Old URLs continue to work |

### Phase B — Imports tree

| Action | Detail |
|---|---|
| Nest directories + telegram-groups | Under Imports → Yellow Pages / Telegram → region → group |
| Add region folders | Sacramento, SF, SD, LA/OC (data already has `regionHint`) |
| Entity chips | On every source leaf (reuse RecommendationQueueFilters / Import Review filters) |
| Deprecate top-level | Hub no longer lists Directories/Telegram as peers of Businesses |

### Phase C — Review Center union

| Action | Detail |
|---|---|
| Inbox view | Union counts + linked lists (can start as links to filtered existing pages) |
| Entity tabs | Map to `target_collection` / buckets |
| Claims + reports | Move under Review Center nav |
| Professional Cleanup | Named leaf + Professionals tab |

### Phase D — Catalog completeness

| Action | Detail |
|---|---|
| Add Professionals admin list | Search, status, open `/professional/[slug]`, “open review item if linked” |
| Add Jobs admin list | Same pattern |
| Add Events admin list | Separate from verification queue |
| Slim Businesses page | Split “merge tool” vs “browse catalog” if needed |

### Phase E — Cleanup / retire

| Action | Detail |
|---|---|
| Soft-retire duplicate entry points | Recommendations top-level → redirect to Imports/Review filtered view |
| Events top-level → Review Center → Events | Keep old URL redirect |
| Document ops runbooks | Which queue for which source |

### What **not** to do early

- Do not merge DB tables in Phase A–C.  
- Do not delete recommendation/directory pages until redirects + parity filters exist.  
- Do not redesign card chrome until IA shell is stable.

### Rename / nest / delete matrix (target end-state)

| Current | End-state |
|---|---|
| `/admin/import-review` | Review Center + Imports entry (same page, richer tree filters) |
| `/admin/recommendations` | Nested under Imports/Review; redirect from old path |
| `/admin/directories*` | Imports → Yellow Pages |
| `/admin/telegram-groups*` | Imports → Telegram → Region → Group |
| `/admin/events` | Review Center → Events (+ Catalog → Events for published) |
| `/admin/businesses*` | Catalog → Businesses |
| `/admin/listings` | Catalog → Marketplace/Services + Review → Reports |
| `/admin/reviews` | Community → Reviews |
| `/admin/claims` | Review Center → Claims |
| `/admin/users` | Users |
| `/admin/analytics` | Analytics |
| `/admin/master-data` | System |
| `/admin/yellow-pages` | Keep redirect |

---

## 8. Priority why this beats new features

At current volume, origin-sliced queues already create **wrong-door** searches (Import Review vs Telegram vs Recommendations). After Professional Cleanup handoff, another 200+ cards sit in Import Review under a chip many admins will not notice. Scaling to tens of thousands without a **task-first Review Center** and a **source tree under Imports** will multiply that chaos.

**Ship order recommendation:** Phase A (nav shell) → Phase C Inbox (even if thin) → Phase B Imports tree → Phase D Catalog gaps.

---

## 9. Out of scope / non-actions this document

- No code or UI changes  
- No route deletes  
- No schema migrations  
- No queue merges in production  

---

## 10. Related docs

- Design sketch (earlier): [`../architecture/entity-model-v1/ADMIN_REVIEW_CENTER_V1.md`](../architecture/entity-model-v1/ADMIN_REVIEW_CENTER_V1.md) — aligns with Review Center; this audit covers the **whole** Admin IA (Imports/Catalog/gaps), not only Import Review UX  
- [`PROFESSIONAL_CLEANUP_HANDOFF_ADMIN_REVIEW_V1.md`](./PROFESSIONAL_CLEANUP_HANDOFF_ADMIN_REVIEW_V1.md) — Cleanup cards now in Import Review  
- [`PROFESSIONAL_CLEANUP_PHASE2_V1.md`](./PROFESSIONAL_CLEANUP_PHASE2_V1.md)  
- Navigation: [`../navigation/admin/INDEX.md`](../navigation/admin/INDEX.md), [`../navigation/PROJECT_INDEX.md`](../navigation/PROJECT_INDEX.md)

---

## 11. Appendix — Telegram region mapping (for Imports tree)

| Region folder | Groups (current `TELEGRAM_SOURCES`) |
|---|---|
| Sacramento | sacramento-adaptation, sacramento-rusrek |
| San Francisco | sf-rusrek, sf-general |
| San Diego | sd-rusrek, sd-general |
| Los Angeles / Orange County | la-orange-county, fun-for-mom |

## 12. Appendix — Directory sources (for Imports → Yellow Pages)

Orange Pages · Russian Seattle · Svoi.us · Boston Pages · Zerkalo MN · RusPagesUSA · To4ka · Slavic Seattle · Our Texas · EchoRU  

(from `lib/import-review/directory-sources.ts`)
