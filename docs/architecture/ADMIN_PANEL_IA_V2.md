# Admin Panel Information Architecture V2

**Status:** Proposed — awaiting approval as multi-year Admin IA SoT  
**Type:** ADR / Architecture Document  
**Date:** 2026-07-28  
**Constraint for this document:** architecture only — no code, UI, routes, or migrations  

**Supersedes (for whole-panel IA):** [`../audits/ADMIN_PANEL_IA_AUDIT_V1.md`](../audits/ADMIN_PANEL_IA_AUDIT_V1.md) findings → this is the **target**.  
**Complements (Review workspace UX detail):** [`entity-model-v1/ADMIN_REVIEW_CENTER_V1.md`](./entity-model-v1/ADMIN_REVIEW_CENTER_V1.md) — still valid for card workspace, bulk, provenance; **Inbox/IA tree below is authoritative** for navigation.

---

## 0. Decision summary

| Decision | Choice |
|---|---|
| Primary axis of Admin | **Entity lifecycle + moderator tasks**, not data origin |
| Single work queue | **Review Center → Inbox** (one queue, many saved Views) |
| Role of Imports | **Provenance, health, history** — not a second moderation product |
| Role of Catalog | **Published / live** entities only |
| New entity types | Plug into Inbox filters + Catalog leaf — **never** a new top-level hub card |
| New AI / import pipelines | Emit **Review Tasks** into Inbox; show under Imports as source history |
| Card chrome in Review | **Same public card component** + moderation chrome overlay |
| Migration | Additive nav + redirects; no big-bang delete of old URLs |

**Accepted:** After approval, this document is the foundation for gradual Admin rebuild. New features must fit this IA or explicitly amend it.

---

## 1. Current problems (condensed)

Full inventory: [`../audits/ADMIN_PANEL_IA_AUDIT_V1.md`](../audits/ADMIN_PANEL_IA_AUDIT_V1.md).

1. **Origin-first hub** — Telegram / Directories / Recommendations / Import Review look like separate products.  
2. **Multiple queues for the same job** — approve/reject/reclassify split across `import_review_items` UIs and several `import_comment_recommendations` UIs.  
3. **Incomplete Catalog** — no Admin browsers for Professionals, Jobs, Events.  
4. **No persistent nav** — every path starts at a flat card grid.  
5. **Same identity, many doors** — one specialist can exist as recommendation + import item + live professional with no unified task.  
6. **Does not scale** — each new source or AI pipeline invites another top-level section.

---

## 2. Governing principles

### P1 — Lifecycle, not origin

Admin answers:

| Question | Module |
|---|---|
| What needs a human decision? | **Review Center** |
| What is already live? | **Catalog** |
| Where did data come from / how healthy is ingestion? | **Imports** |
| What is community-generated friction? | **Community** |
| Who can act? | **Users** |
| How is the platform performing? | **Analytics** |
| How is the system configured? | **System** |

Origin (Telegram, Facebook, YP, CSV, AI pipeline name) is **metadata and filter**, never a peer of “Businesses.”

### P2 — One Inbox for all work

There must **not** be parallel “main queues” for the same class of work.  
Telegram AI, Facebook AI, Professional Cleanup, Business Cleanup, Claims, Reports, Duplicates, future pipelines → **Review Tasks** in one Inbox.

### P3 — Views, not pages

“Professionals”, “Telegram”, “Claims” are **saved Views** (filter presets) over Inbox — not separate queue products.

### P4 — Extensibility without new top-level sections

| New thing | Where it lands |
|---|---|
| New entity type (e.g. Vehicle) | Catalog leaf + Inbox `entity_type` + taxonomy |
| New import source | System → Sources + Imports tree + Inbox `source` filter |
| New AI pipeline | Emits tasks with `pipeline` / `task_kind`; Inbox View optional |
| New report type | Community + Inbox `task_kind=report` |

**Forbidden by default:** adding another `/admin/foo-queue` hub card for a new pipeline.

### P5 — Public card is the card

Review uses the **same visual card** as the public site for that entity type. Admin only adds:

- moderation action bar  
- provenance / AI / assignment panel  
- queue context (next, bulk, view name)

No parallel “admin card design system.”

### P6 — Safe migration

Old URLs remain until Views + Inbox parity exist. Redirects preserve bookmarks. No forced cutover day.

---

## 3. Target navigation tree

```
/admin
├── Review Center                    ★ default landing for moderators
│   ├── Inbox                        (universal queue + Views)
│   └── Task detail / workspace      (/admin/review/[taskId])
│
├── Catalog
│   ├── Businesses
│   ├── Professionals
│   ├── Marketplace
│   ├── Jobs
│   └── Events
│
├── Imports
│   ├── Telegram
│   │   ├── Los Angeles / Orange County
│   │   ├── San Diego
│   │   ├── Sacramento
│   │   └── San Francisco
│   ├── Facebook
│   │   ├── Russian LA
│   │   ├── Fun for Moms
│   │   └── …
│   ├── Directories
│   │   ├── Google
│   │   ├── Yelp
│   │   ├── BBB
│   │   └── (legacy YP catalogs: Orange Pages, Svoi, …)
│   ├── CSV
│   └── (other registered sources)
│
├── Community
│   ├── Reviews
│   ├── Recommendations
│   ├── Reports
│   └── Abuse
│
├── Users
│   ├── Users
│   ├── Admins
│   ├── Roles
│   └── Permissions
│
├── Analytics
│   ├── Platform
│   ├── Moderation
│   ├── Imports
│   ├── AI
│   └── Growth
│
└── System
    ├── Taxonomy / Categories
    ├── Import Pipelines
    ├── AI Rules
    ├── Feature Flags
    └── Sources
```

**Default home:** `/admin` → **Review Center Inbox** (not Analytics). Analytics remains one click away.

Persistent left (or top) nav shows these **seven** roots only. Badge on Review Center = open Inbox count.

---

## 4. Module specifications

### 4.1 Review Center

#### Role

The **main Admin module**. All human decisions that change publication, ownership, merge, or safety flow through here.

#### Inbox

Single queue of **Review Tasks**. A Review Task is a normalized work item, regardless of backing table/pipeline.

**Everything that opens a task (non-exhaustive, must stay open-ended):**

| Task family | Examples |
|---|---|
| Entity publish / classify | Business, Professional, Marketplace, Job, Event candidates |
| Community moderation | User Reviews awaiting decision |
| Ownership | Ownership Claims |
| Safety | Listing reports, review reports, Abuse |
| Quality | Duplicates, Professional Cleanup, Business Cleanup |
| AI / import gate | Telegram AI Review, Facebook AI Review, future pipelines |

#### Logical task model (architecture — not a migration mandate)

Every Inbox row exposes at least:

| Field | Purpose |
|---|---|
| `task_id` | Stable id for workspace URL |
| `task_kind` | `entity_review` \| `claim` \| `report` \| `duplicate` \| `cleanup` \| `abuse` \| … |
| `entity_type` | business, professional, marketplace, job, event, review, … / null |
| `status` | pending, in_review, needs_more_info, ready_to_publish, blocked, … |
| `priority` | derived + override |
| `source` / `import_source` | channel + specific group/catalog |
| `pipeline` | telegram_ai, facebook_ai, professional_cleanup, … |
| `ai_confidence` / `ai_reason` | when applicable |
| `region` / `category` | when known |
| `assignee_admin_id` | optional |
| `created_at` / `updated_at` | |
| `linked_entity_id` | if already live (cleanup, claim, report) |
| `candidate_payload_ref` | pointer to import_review_items / recommendations / etc. |

**Physical storage (implementation guidance, not required day-one):**

- Phase 1: **union query / materialized view** over existing tables with a stable `task_id` scheme (`iri:{uuid}`, `rec:{uuid}`, `claim:{uuid}`, …).  
- Phase 2 (optional): dedicated `admin_review_tasks` table if union cost or assignment/audit demands it.  
**IA does not require Phase 2 to ship Inbox.**

#### Inbox filters (minimum)

| Filter | Notes |
|---|---|
| Entity Type | Incl. “unset / ambiguous” |
| Source | telegram, facebook, directory, csv, user, system, … |
| Import Source | Concrete group/catalog (LA OC, Svoi, …) |
| Pipeline | telegram_ai, facebook_ai, professional_cleanup, … |
| AI Confidence | range + “no AI” |
| Status | open statuses default |
| Priority | high / normal / low |
| Assigned Admin | me / unassigned / user |
| Created Date | relative + absolute |
| Region | hub / metro |
| Category | taxonomy |
| Task Kind | claim, report, duplicate, cleanup, entity_review, … |
| Free text | title, phone, slug, id |

Filters compose. URL encodes the active filter set so Views and deep links share one mechanism.

#### Saved Views (not separate pages)

Views = named filter presets (+ sort). Examples:

| View | Intent |
|---|---|
| All Tasks | All open |
| Professionals | entity_type=professional |
| Businesses | entity_type=business |
| Marketplace | entity_type=marketplace |
| Jobs | entity_type=job |
| Events | entity_type=event |
| Telegram | source=telegram |
| Facebook | source=facebook |
| Needs Review | status in pending/needs_more_info + low confidence or cleanup |
| High Confidence | ai_confidence ≥ threshold, ready path |
| Claims | task_kind=claim |
| Reports | task_kind=report |
| Duplicates | task_kind=duplicate |
| Professional Cleanup | pipeline=professional_cleanup |
| Unassigned | assignee is null |

Admins may create personal Views later; product ships system Views above.

#### Workspace (task detail)

Route sketch: `/admin/review/[taskId]` (canonical).  
Legacy `/admin/import-review/[id]` redirects or embeds same workspace.

Layout:

1. **Public entity card** (shared component) — preview of how it will / does appear.  
2. **Moderation panel** (Admin-only): actions, fields edit, AI reason, provenance, duplicates, assignment.  
3. **Queue chrome**: View name, next/prev, bulk membership.

Actions (unified vocabulary; availability by task_kind):

- Publish / Confirm as entity type  
- Change entity type + category  
- Reject / Archive  
- Merge  
- Mark duplicate  
- Request more info  
- Assign  
- Open in Catalog (if linked live entity)  
- Open import provenance (Imports deep link)

Align quick-actions with [`ADMIN_REVIEW_CENTER_V1.md`](./entity-model-v1/ADMIN_REVIEW_CENTER_V1.md) § quick actions.

#### Explicit non-goals for Review Center

- Not an analytics dashboard.  
- Not a place to configure pipelines (→ System).  
- Not a full CRM for published entities (→ Catalog).

---

### 4.2 Catalog

#### Role

Manage **already published / live** (and archived) entities. Browse, search, edit, soft-archive, open public page, jump to related Review Task if one is open.

```
Catalog
├── Businesses
├── Professionals
├── Marketplace
├── Jobs
└── Events
```

#### Rules

- Default filter: `status` appropriate to type (e.g. approved/published/active).  
- Pending **candidates** do not live primarily here — they live in Inbox.  
- “Needs attention” badges on a Catalog row deep-link to Inbox task.  
- Merge tools for live duplicates: start in Catalog or Inbox Duplicates View; same merge action.  
- Creating a new Business from Admin remains here (or “Create” that opens draft → optional Review Task if gated).

#### Extensibility

New entity type → new Catalog leaf + taxonomy. No new Admin root.

---

### 4.3 Imports

#### Role

**History and health of provenance** — not a competing Inbox.

```
Imports
├── Telegram → Region → Group
├── Facebook → Group
├── Directories → Provider / catalog
├── CSV → batch
└── …
```

Each leaf shows:

- last run / volume / error rate  
- open Review Tasks **count** (link → Inbox pre-filtered)  
- published entities linked to this source  
- raw batch / fingerprint ops notes  

#### Rules

- Clicking a card from Imports opens **Review workspace** or Catalog — Imports does not invent a third moderation UI.  
- “Moderate this group’s backlog” = button → Inbox View with `import_source` set.  
- Adding a source registers it in **System → Sources**; tree updates from registry, not hardcoded forever (seed with today’s TG/YP lists).

#### Why Imports stays separate from Review

Moderators think in tasks; ops/leads think in “is Sacramento RusRek stuck?” Both needs exist; **Inbox must not be replaced by source folders**.

---

### 4.4 Community

| Leaf | Purpose |
|---|---|
| Reviews | Browse / history of user reviews; open moderation → Inbox Reviews View |
| Recommendations | Approved / historical comment clusters (audit); open pending → Inbox |
| Reports | Listing/review report history; open → Inbox Reports |
| Abuse | Escalations, bans, safety notes (future-ready leaf) |

**Actionable** items always surface in Inbox; Community is the **library + policy surface**.

---

### 4.5 Users

| Leaf | Purpose |
|---|---|
| Users | All profiles |
| Admins | Filtered admins |
| Roles | role assignment (today: admin/user; expand later) |
| Permissions | Fine-grained ACL when introduced — placeholder leaf OK |

Supports Inbox assignment and audit (“who approved”).

---

### 4.6 Analytics

Metrics that **operators actually need**, split by concern:

| Slice | Examples |
|---|---|
| **Platform** | DAU/WAU proxies, page views, contact reveals, top paths |
| **Moderation** | Inbox backlog, age p50/p95, throughput/day, reject reasons, assignee load |
| **Imports** | rows ingested / source, error rate, time-to-first-review |
| **AI** | confidence distributions, auto vs human paths, model/pipeline mix |
| **Growth** | catalog size by entity, new approved/day, claims resolved |

Today’s `/admin/analytics` maps mostly to Platform + Growth; Moderation/Imports/AI are **required additions** for scale — can start as simple SQL/RPC cards.

Avoid vanity charts that don’t change a weekly ops decision.

---

### 4.7 System

| Leaf | Purpose |
|---|---|
| Taxonomy / Categories | Today’s Master Data |
| Import Pipelines | Registered pipelines, schedules, owners |
| AI Rules | Gates, confidence thresholds, denylists (policy, not secrets) |
| Feature Flags | Gradual Admin/IA rollout |
| Sources | Canonical source registry (feeds Imports tree + filters) |

No secrets in UI. Keys stay in env / vault.

---

## 5. Unified card rule

```
┌─────────────────────────────────────────────┐
│  Moderation chrome (Admin only)             │
│  actions · AI · provenance · assignment     │
├─────────────────────────────────────────────┤
│                                             │
│   <PublicEntityCard type={entity_type} />   │
│   same component as /business, /professional│
│   /marketplace, /jobs, /events, …           │
│                                             │
└─────────────────────────────────────────────┘
```

| Do | Don’t |
|---|---|
| Reuse public card + preview adapters | Build ImportReviewTypedCard forever as the “real” product card |
| Fix public card once for Admin + site | Fork styles per queue |
| Hide public CTAs that confuse (claim, contact) via props | Redesign a separate admin visual language |

Existing typed preview components are **migration scaffolding** until public cards accept a `variant="adminPreview"` (or equivalent). Target end-state: one component family.

---

## 6. User scenarios (acceptance)

| # | Scenario | Path (≤3 clicks from Admin) |
|---|---|---|
| S1 | Clear all open work | Review → Inbox (All Tasks) |
| S2 | Only Professionals | Inbox → View Professionals |
| S3 | Professional Cleanup batch | Inbox → View Professional Cleanup |
| S4 | Telegram LA professionals | Inbox filters entity+import_source **or** Imports → TG → LA → “Open backlog” → Inbox |
| S5 | Approve ownership claim | Inbox → View Claims → task |
| S6 | Find live spa in Glendale | Catalog → Businesses → search |
| S7 | Edit published professional | Catalog → Professionals → edit / public |
| S8 | See if Svoi import is healthy | Imports → Directories → Svoi |
| S9 | New Vehicle entity later | Catalog → Vehicles + Inbox entity filter — **no new root** |
| S10 | New “Gmaps enrich” AI | System register pipeline → tasks appear in Inbox; optional View |

---

## 7. Scalability

### 7.1 Targets

| Scale | Expectation |
|---|---|
| 50k entities | Inbox + Catalog snappy with indexed filters |
| 500k entities | Cursor/keyset pagination; no full-table sorts in UI; search via indexed columns / search service |
| Dozens of sources | Sources registry; Imports tree generated; filter facets cached |
| Dozens of AI pipelines | `pipeline` facet; no new pages |
| Multiple admins | Assignment + optimistic locking / “in_review by X”; audit log |

### 7.2 Bottlenecks and mitigations

| Risk | Mitigation |
|---|---|
| Union Inbox over many tables slow | Materialized open-tasks view; eventual `admin_review_tasks`; always filter+limit before join |
| Hub count storm (today: per-source counts) | Single Inbox open-count + cheap facets; Imports health async |
| Unbounded filter cardinality | Facets top-N + search-within-facet |
| Concurrent edit | `in_review` + assignee; conflict message on stale update |
| Search across 500k | Dedicated search index later; until then require entity_type + status |
| Bulk actions | Chunked server jobs; progress, not one huge transaction |
| Card render cost | Virtualize Inbox list; detail loads one card |
| RLS / admin RPC | Keep security definer list RPCs; never client-wide scans |

### 7.3 What this IA deliberately avoids

- N queue UIs × M sources (quadratic product surface).  
- Loading all open tasks into the browser.  
- Analytics that scan raw events on every Admin page load.

---

## 8. Migration plan (no breakage)

Principle: **additive shell → Views over legacy → redirect → retire labels**.

### Phase 0 — Approve this document

Freeze IA; reject new origin-first hub cards.

### Phase 1 — Shell without behavior change

- Add persistent Admin nav with seven roots.  
- Map **existing routes** under the new labels (links only).  
- Default `/admin` can remain hub **or** soft-land Inbox link as primary CTA.  
- **No page deletes.**

Example mapping:

| New nav | Existing routes (temporary) |
|---|---|
| Review Center | `/admin/import-review`, `/admin/claims`, `/admin/events`, `/admin/recommendations`, … |
| Catalog | `/admin/businesses`, `/admin/listings` |
| Imports | `/admin/telegram-groups`, `/admin/directories` |
| Community | `/admin/reviews` |
| Users | `/admin/users` |
| Analytics | `/admin/analytics` |
| System | `/admin/master-data` |

### Phase 2 — Inbox Views (thin)

- Introduce `/admin/review` Inbox UI that **links/embeds** filtered legacy queues as Views.  
- Professional Cleanup View → current `source=professional_cleanup_v1` filter.  
- Still one physical implementation path per View if needed — **user-visible** single Inbox.

### Phase 3 — Unified task workspace

- Shared workspace chrome + public card.  
- Redirect `/admin/import-review/[id]` → `/admin/review/[taskId]`.  
- Wire claims/reports into same chrome where feasible.

### Phase 4 — Imports as history only

- Source pages lose primary approve chrome; “Open in Inbox” becomes primary CTA.  
- Keep stats/history.

### Phase 5 — Catalog completeness

- Professionals / Jobs / Events admin lists.  
- Split listings Marketplace vs Services if still required by product.

### Phase 6 — Retire duplicate entry points

- Soft-redirect `/admin/recommendations`, `/admin/telegram-groups`, `/admin/directories`, `/admin/events` verification to Inbox/Imports Views.  
- Keep redirects ≥1 release.

### Phase 7 — Optional task table / search

- Only if metrics prove union Inbox insufficient.

**Rollback:** feature flags per phase; old URLs always work during Phases 1–6.

---

## 9. Implementation recommendations (ordered)

1. **Approve IA V2** (this doc).  
2. Phase 1 nav shell (lowest risk, immediate clarity).  
3. Formalize Review Task id scheme + open-count RPC.  
4. Inbox + system Views (Professionals, Cleanup, Claims first — highest pain).  
5. Public card in workspace (stop admin-only card drift).  
6. Catalog Professionals (closes biggest Catalog gap).  
7. Imports demotion to provenance.  
8. Analytics Moderation/Imports/AI slices.  
9. Assignment for multi-admin.  
10. Only then consider `admin_review_tasks` table if needed.

---

## 10. Relationship to prior docs

| Doc | Role after V2 approval |
|---|---|
| [`ADMIN_PANEL_IA_AUDIT_V1.md`](../audits/ADMIN_PANEL_IA_AUDIT_V1.md) | Historical evidence; points here |
| [`ADMIN_REVIEW_CENTER_V1.md`](./entity-model-v1/ADMIN_REVIEW_CENTER_V1.md) | Workspace UX, bulk, provenance — **keep**; navigation superseded by this IA |
| [`PROFESSIONAL_CLEANUP_HANDOFF_ADMIN_REVIEW_V1.md`](../audits/PROFESSIONAL_CLEANUP_HANDOFF_ADMIN_REVIEW_V1.md) | Cleanup → Inbox View `Professional Cleanup` |
| Platform IA V2 / Freeze | Entity taxonomy remains SoT for entity_type/category |

---

## 11. Non-goals / explicit exclusions

- No code or UI changes in the approval of this document.  
- No requirement to merge Postgres tables on day one.  
- No redesign of public site IA.  
- No new top-level Admin section for the next pipeline without amending this ADR.

---

## 12. Approval checklist

Before calling Admin IA V2 “accepted”:

- [ ] Product agrees: Inbox is the only primary work queue  
- [ ] Product agrees: Imports is provenance, not moderation  
- [ ] Engineering agrees: union Inbox acceptable for Phase 2–3  
- [ ] Design agrees: public card + moderation chrome  
- [ ] Ops agrees: Analytics slices (esp. Moderation backlog age)

**Upon approval:** treat this file as Admin Panel IA Source of Truth until a V3 ADR supersedes it.
