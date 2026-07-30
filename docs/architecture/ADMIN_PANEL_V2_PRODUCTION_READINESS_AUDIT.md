# Admin Panel V2 — Production Readiness Audit

**Date:** 2026-07-28  
**Type:** Audit only — no DB/API changes, no deletions, no refactor  
**Verdict:** Admin Panel V2 is **not yet complete**. Core Review Center + Catalog shell are production-usable; full legacy retirement and several IA sections remain open.  
**Related:** [`ADMIN_PANEL_IA_V2.md`](./ADMIN_PANEL_IA_V2.md), [`ADMIN_PANEL_INBOX_UX_V1.md`](./ADMIN_PANEL_INBOX_UX_V1.md), [`ADMIN_PANEL_REVIEW_WORKSPACE_AUDIT_V1.md`](./ADMIN_PANEL_REVIEW_WORKSPACE_AUDIT_V1.md), [`ADMIN_PANEL_PHASE6_SOFT_MIGRATION_V1.md`](./ADMIN_PANEL_PHASE6_SOFT_MIGRATION_V1.md)

**Build check (audit day):** `tsc` / ESLint (touched admin shell) / `npm run build` — pass.

---

## 0. Executive verdict

| Area | Status |
|---|---|
| Dashboard | Functional but Incomplete |
| Inbox | Functional but Incomplete |
| Review Workspace | Functional but Incomplete |
| Catalog | Functional but Incomplete |
| Imports | Functional but Incomplete (IA URLs redirect → legacy) |
| Entity Workspace | Functional but Incomplete (= Review Workspace; no separate product) |
| Users | Functional but Incomplete |
| Roles | Stub |
| Reports | Stub |
| Settings | Missing |
| Navigation | Production Ready (shell) |
| Search | Functional but Incomplete (Inbox + Catalog only) |
| Metrics | Functional but Incomplete |
| Legacy Compatibility | Functional but Incomplete |

**Can we say “Admin Panel V2 завершена”?** **No.**

**Can moderators work daily in V2 paths?** **Mostly yes** for Review (Inbox → Workspace) and Catalog browse; Dashboard and several nav leaves still push operators into legacy URLs.

---

## 1. Section readiness (IA areas)

| Section | Status | Evidence |
|---|---|---|
| **Dashboard** (`/admin`) | Functional but Incomplete | Live counts + links, but links target **legacy** queues (`/admin/import-review`, `/admin/claims`, …), copy still says “Phase 1 shell” |
| **Inbox** | Functional but Incomplete | 14 Saved Views, bulk, priority, metrics, sticky UX — fetch caps ~100–400/source; assignment localStorage; Archive bulk Coming Soon |
| **Review Workspace** | Functional but Incomplete | Approve/Reject/Edit for all 4 review types; Merge partial; Archive only claim→business; Pros/Jobs/Events archive Coming Soon |
| **Catalog** | Functional but Incomplete | Shared `CatalogBrowser` for 5 entities; Archive always Coming Soon; Businesses edit → legacy `/admin/businesses/[id]/edit`; Events edit missing |
| **Imports** | Functional but Incomplete | Telegram/Directories UI is real on **legacy** URLs; IA paths only `redirect()` → legacy; Facebook/CSV stubs |
| **Entity Workspace** | Functional but Incomplete | Same as Review Workspace (`/admin/review/[taskId]`); no Catalog-side entity workspace |
| **Users** | Functional but Incomplete | `/admin/users` real (`AdminUsersPanel`); Admins/Roles stubs |
| **Roles** | Stub | `/admin/users/roles` → `AdminComingSoon` |
| **Reports** | Stub | `/admin/community/reports` → Coming Soon |
| **Settings** | Missing | No route, nav item, or component |
| **Navigation** | Production Ready | `AdminShell` + `ADMIN_NAV` + legacy highlight rules work |
| **Search** | Functional but Incomplete | Inbox client search + Catalog `q`; no global admin search |
| **Metrics** | Functional but Incomplete | Inbox metrics bar + Dashboard counts + Analytics panel; not unified |
| **Legacy Compatibility** | Functional but Incomplete | Soft banners + dual URLs; **Hard Redirect not ready**; IA→legacy redirects still inverted vs target end-state |

---

## 2. Screen-by-screen audit

Priority: **Critical** (blocks daily moderation / release) · **High** · **Medium** · **Low**

### 2.1 Review Center

| URL | Purpose | Used now? | Works | Broken / gaps | Remaining | Prio |
|---|---|---|---|---|---|---|
| `/admin/review` | Section landing | Yes (redirect) | Redirect → Inbox | — | Optional index UI | Low |
| `/admin/review/inbox` | Primary moderator queue | **Yes — primary** | Views, filters, bulk Approve/Reject, assign UI, priority, metrics, keyboard | Archive bulk Soon; assignment not multi-device; scale caps | Server pagination; DB assignment; Archive API | High |
| `/admin/review/views` | Saved Views index | Yes | Lists system presets → Inbox | No user-custom Views UI | Custom Views CRUD | Medium |
| `/admin/review/[taskId]` | Review Workspace | **Yes — primary** | Card preview, Approve/Reject, Edit link, Merge/Archive where wired | Pros/Jobs/Events archive; full merge UX | Archive APIs; richer editors | High |
| `/admin/review/[taskId]/edit` | Workspace Edit | Yes | Import detail embed; rec/event fields; claim→business form | Marketplace/job/event dedicated editors incomplete | Per-entity editors | Medium |

### 2.2 Catalog

| URL | Purpose | Used now? | Works | Gaps | Remaining | Prio |
|---|---|---|---|---|---|---|
| `/admin/catalog` | Section index | Yes | Link grid from nav | — | — | Low |
| `/admin/catalog/businesses` | Live businesses | Yes | List/search/status/sort; public cards | Archive Soon; Edit → legacy form URL | Wire archive; keep edit under Catalog | High |
| `/admin/catalog/professionals` | Live professionals | Yes | List/search | Archive Soon; Edit → public `/professional/.../edit` | Admin archive + admin edit chrome | High |
| `/admin/catalog/marketplace` | Live marketplace | Yes | List/search | Archive Soon | Admin archive | Medium |
| `/admin/catalog/jobs` | Live jobs | Yes | List/search | Archive Soon; edit via business manage | Admin archive | Medium |
| `/admin/catalog/events` | Live events | Yes | List/search | No Edit; Archive Soon | Event admin edit + archive | High |

### 2.3 Imports

| URL | Purpose | Used now? | Works | Gaps | Remaining | Prio |
|---|---|---|---|---|---|---|
| `/admin/imports` | Section index | Yes | Link grid | — | — | Low |
| `/admin/imports/telegram` | IA Telegram | Compatibility only | **Redirect →** `/admin/telegram-groups` | Not a real IA page | Flip: legacy → IA hard redirect after UI host move | Critical* |
| `/admin/imports/directories` | IA Directories | Compatibility only | **Redirect →** `/admin/directories` | Same | Same | Critical* |
| `/admin/imports/facebook` | FB import history | Nav only | Coming Soon stub | No UI | History panel | Medium |
| `/admin/imports/csv` | CSV history | Nav only | Coming Soon stub | No UI | History panel | Low |
| `/admin/telegram-groups` (+`/[source]`) | Telegram history (real) | **Yes** | Stats, list, Inbox deep links, banners | Dual with IA URL | Host UI under IA path; hard-redirect legacy | High |
| `/admin/directories` (+`/[source]`) | Directory history (real) | **Yes** | Same pattern | Dual with IA URL | Same | High |
| `/admin/yellow-pages` | Alias | Rare | Redirect → directories | — | Keep alias forever or document | Low |

\*Critical for “V2 complete / legacy off”, not for daily moderation (legacy URL works).

### 2.4 Community

| URL | Purpose | Used now? | Works | Gaps | Remaining | Prio |
|---|---|---|---|---|---|---|
| `/admin/community` | Section index | Yes | Links | — | — | Low |
| `/admin/community/reviews` | IA reviews | Compatibility | **Redirect →** `/admin/reviews` | No IA-hosted UI | Move or wrap reviews under IA | High |
| `/admin/community/recommendations` | IA recommendations | Compatibility | **Redirect →** `/admin/recommendations` | Dual with Inbox View | Prefer Inbox; hard-redirect list | High |
| `/admin/community/reports` | User reports | Nav only | Stub | — | Product + UI | Medium |
| `/admin/reviews` | Legacy reviews queue | Yes | Real moderation UI | Not under IA chrome as home | Soft banner missing vs other legacy | Medium |
| `/admin/recommendations` | Legacy rec list | Yes | Full list + approve | Overlaps Inbox | Hard redirect to Inbox View | High |

### 2.5 Users / Analytics / System

| URL | Purpose | Used now? | Works | Gaps | Remaining | Prio |
|---|---|---|---|---|---|---|
| `/admin/users` | Users & roles toggle | Yes | Promote/demote | No filters/search at scale | Soft improvements | Medium |
| `/admin/users/admins` | Admins list | Nav only | Stub | — | Filter of users or dedicated list | Low |
| `/admin/users/roles` | Roles matrix | Nav only | Stub | — | RBAC UI (likely V2.1+) | Medium |
| `/admin/analytics` | Site analytics | Yes | Stats panel | Not “Reports” product | Keep; rename vs Community Reports | Low |
| `/admin/system` | System landing | Redirect | → taxonomy | — | — | Low |
| `/admin/system/taxonomy` | Taxonomy IA | Compatibility | **Redirect →** `/admin/master-data` | — | Host under IA | Medium |
| `/admin/master-data` | Categories/geo/lang | Yes | Real | No soft banner | Banner + later hard redirect | Medium |
| `/admin/settings` | Settings | **No** | — | Missing | Decide scope; add or remove from mental model | Medium |

### 2.6 Dashboard & legacy catalog/tools

| URL | Purpose | Used now? | Works | Gaps | Remaining | Prio |
|---|---|---|---|---|---|---|
| `/admin` | Dashboard | Yes | Counts + cards | Links to **legacy**, outdated Phase 1 copy | Point cards to Inbox/Catalog IA; add Inbox CTA | **Critical** |
| `/admin/import-review` (+`/[id]`) | Legacy import queue/detail | Compat / some habits | Full UI + banner | Duplicates Inbox/Workspace | Hard redirect → Inbox / Workspace | High |
| `/admin/claims` | Legacy claims | Compat | Panel + banner | Duplicates Inbox Claims View | Hard redirect | High |
| `/admin/events` | Events verification list | Compat | Display + banner | Approve lives in Workspace | Redirect to Inbox Events View | High |
| `/admin/businesses` | Legacy business admin | **Yes (power tools)** | Merge, status, bulk | Parallel to Catalog | Keep until Catalog parity; then redirect browse | High |
| `/admin/businesses/new` | Create business | Yes | Form | — | Link from Catalog CTA | Medium |
| `/admin/businesses/[id]/edit` | Edit business | Yes | Form | Also used from Workspace/Catalog | Keep as editor host or embed | Medium |
| `/admin/listings` | Listings + reports filter | Yes | Moderation | Catalog Marketplace incomplete for reports | Bridge Community Reports | Medium |

---

## 3. Component audit

### 3.1 Unified (keep)

| Pattern | Canonical | Used by |
|---|---|---|
| Nav shell | `AdminShell` + `lib/admin/nav.ts` | All `/admin/*` |
| Coming Soon | `AdminComingSoon` | 5 stubs |
| Soft migration | `LegacyMigrationBanner` + `legacy-migration.ts` | 9 legacy pages |
| Catalog list | `CatalogBrowser` | 5 catalog leaves |
| Import source stats | `ImportSourceStatsCard` | Directory + Telegram source panels |
| Inbox aggregation | `lib/admin/inbox/*` + `ReviewInboxPanel` | Inbox |
| Workspace | `ReviewWorkspace*` + `review-workspace/*` | Task pages |
| Public cards in review | `ReviewWorkspaceCard` → public card components | Workspace |

### 3.2 Duplicates (do not delete yet — candidates)

| Duplicate | vs | Note |
|---|---|---|
| `DirectorySourcePanel` ≈ `TelegramSourcePanel` | Almost identical | Merge → `ImportSourcePanel` in V2.1 |
| `ImportReviewQueuePanel` | `ReviewInboxPanel` | Legacy queue; retire after hard redirect |
| `CommentRecommendationsPanel` | Inbox Recommendations View + Workspace | Legacy list |
| `AdminClaimsPanel` / `AdminEventsVerificationPanel` | Inbox Views + Workspace | Legacy lists |
| Section index pages (catalog/imports/community) | Copy-pasted link grids | Optional `AdminSectionIndex` |
| Dashboard link cards | Sidebar `ADMIN_NAV` | Dashboard should compose nav/counts, not parallel IA |
| Business list: Catalog vs `AdminBusinessesPanel` | Catalog browse vs power tools | Need explicit “Advanced” home before removing legacy |

### 3.3 Forms / editors / dialogs / badges

| Kind | Status |
|---|---|
| Forms | `AdminBusinessForm` unified for business create/edit; import fields in `ImportReviewDetailPanel`; rec fields in `ReviewWorkspaceEditPanel` |
| Dialogs/modals | `ImportReviewPreviewModal`, `RecommendationPreviewModal` — legacy-only |
| Drawers | No shared admin drawer primitive |
| Badges | Ad-hoc Tailwind chips (priority bands, Soon) — not a design-system badge |
| Toolbars | Inbox sticky toolbar vs Catalog filter row vs legacy panels — three patterns |
| Metrics | Inbox metrics vs Dashboard counts vs Analytics — three surfaces |

**Safe to delete later (after hard redirects + soak):** legacy queue panels/modals/contact icons clusters once zero imports remain. **Do not delete now.**

---

## 4. Legacy audit

### 4.1 Pages

| Legacy URL | Role | Disposition |
|---|---|---|
| `/admin/import-review` | Compat queue | Used · **can hard-redirect** after soak → Inbox |
| `/admin/import-review/[id]` | Compat detail | Used · **can hard-redirect** → `/admin/review/import_review:{id}` |
| `/admin/claims` | Compat | Used · **can hard-redirect** → Inbox `?view=claims` |
| `/admin/events` | Compat verification list | Used · **can hard-redirect** → Inbox `?view=events` |
| `/admin/recommendations` | Compat list | Used · **can hard-redirect** → Inbox `?view=recommendations` |
| `/admin/telegram-groups` (+source) | **Real Imports UI host** | Used · **cannot remove** until UI moved under `/admin/imports/telegram` |
| `/admin/directories` (+source) | **Real Imports UI host** | Used · same for directories |
| `/admin/yellow-pages` | Alias | Compat · keep redirect |
| `/admin/businesses` (+new/edit) | Power catalog + editor | Used · **cannot remove** until Catalog Archive/Merge parity |
| `/admin/listings` | Listings + reports | Used · **cannot remove** until Reports/Catalog parity |
| `/admin/reviews` | Reviews moderation | Used · **cannot remove** until Community Reviews hosts UI |
| `/admin/master-data` | Taxonomy | Used · **cannot remove** until System Taxonomy hosts UI |

### 4.2 Components (legacy cluster)

| Component | Disposition |
|---|---|
| `ImportReviewQueuePanel`, `ImportReviewPreviewModal` | Compat · delete after import-review hard redirect |
| `ImportReviewDetailPanel` | **Still required** — Workspace `/edit` embeds it |
| `ImportReviewContactIcons`, `ImportReviewTypedCard` | Mixed — TypedCard still in Workspace |
| `CommentRecommendationsPanel`, `RecommendationPreviewModal`, `RecommendationQueueFilters` | Compat · delete after recommendations redirect |
| `AdminClaimsPanel`, `AdminEventsVerificationPanel` | Compat · delete after claims/events redirect |
| `LegacyMigrationBanner` | Compat tooling · remove after hard redirects complete |
| `AdminBusinessesPanel` (under `components/business`) | Live power tools · keep until Catalog parity |

### 4.3 Hooks / services / API / layouts

| Asset | Disposition |
|---|---|
| Admin layout `app/admin/layout.tsx` | **Cannot remove** — V2 shell |
| `lib/admin/*` inbox/workspace/catalog/imports | V2 core · keep |
| `lib/import-review/*`, `lib/business/admin-actions`, claim-actions | **Cannot remove** — Workspace/bulk call these |
| No separate admin REST API layer | N/A — server actions |
| Soft-migration sessionStorage keys | Compat · clear after banners gone |

---

## 5. Dead code audit (report only — nothing deleted)

| Candidate | Why flagged | Safe to delete now? |
|---|---|---|
| Unused **pages** | None fully unused — stubs and redirects still routed from nav | No |
| `AdminComingSoon` pages | Intentional stubs | No — until implemented or nav items removed |
| Legacy preview modals | Only legacy parents import them | No — until parents redirected away |
| Duplicate source panels | Both used | No — merge later, don’t delete one cold |
| Old Phase-1 dashboard copy / legacy `LINKS` | Not dead — actively misleading | Fix in V2.0 release (small), not delete |
| `ADMIN_LEGACY_MAPPING` notes outdated (Phase 1 wording) | Stale docs in code comments | Doc refresh only |
| Settings route | Missing, not dead | — |
| Orphan utilities | No strong unused util found under `lib/admin` beyond intentional stubs | No mass delete |

**Conclusion:** Little true dead code; most “legacy” is **live dual-path**. Deletion is gated on hard redirects + Catalog/Imports hosting moves.

---

## 6. Final gap analysis

| Feature | Status | Remaining work | ETA |
|---|---|---|---|
| Nav shell (IA tree) | Done | Keep in sync with stubs | S |
| Inbox aggregator + Views | Done (system) | Custom Views; raise scale | M |
| Inbox bulk Approve/Reject | Done | Concurrency limits; better errors | S |
| Inbox Archive bulk | Stub | Admin archive APIs first | L |
| Inbox Assign | UI only | Persist assignee in DB | M |
| Priority score | Done (computed) | Optional persist / tuning | S |
| Inbox metrics | Done | SQL aggregates at scale | M |
| Review Workspace A/R | Done | — | — |
| Workspace Edit | Partial | Event/job/marketplace admin editors | M |
| Workspace Merge | Partial | Pro merge backend + UX | L |
| Workspace Archive | Partial | Pro/Job/Event admin archive | L |
| Catalog browsers | Done (browse) | Archive + consistent Edit | M |
| Imports Telegram/Directories | Partial (legacy host) | Move UI under IA URLs | M |
| Imports Facebook/CSV | Stub | History UI | M / L |
| Community Reviews under IA | Partial (redirect) | Host or wrap | M |
| Community Reports | Stub | Product | L |
| Users | Done (basic) | Admins leaf | S |
| Roles matrix | Stub | RBAC design | L |
| Settings | Missing | Scope decision | M |
| Dashboard → IA entry | Incomplete | Relink to Inbox/Catalog | S |
| Soft migration banners | Done | — | — |
| Hard Redirects | Not ready | Prerequisites below | M |
| Legacy dual queues | Incomplete | Redirect after soak | M |
| Inbox 10k/50k perf | Not ready | Pagination + virtualization | L |
| Entity Workspace (Catalog) | Missing as separate | Optional; Workspace covers review tasks | L |

ETA: **S** ≤ ~1–3 days · **M** ~1–2 weeks · **L** multi-week / needs product+API.

---

## 7. Production checklist

### Hard Redirect готов?

**No.**

Prerequisites before flipping legacy → IA:

1. Dashboard links point to Inbox/Catalog (not legacy queues).  
2. Imports UI **hosted** at `/admin/imports/telegram|directories` (today reverse redirect).  
3. Community Reviews hosted or permanently aliased with banner.  
4. Soft soak ≥1 release with banners + analytics on legacy hits.  
5. Workspace edit covers import_review without needing `/admin/import-review/[id]`.  
6. Catalog Archive/Edit parity enough that `/admin/businesses` browse isn’t required daily (merge tools may stay longer).

### Legacy можно отключить?

**No — not globally.**

| Can soft-retire soon (after soak) | Must stay longer |
|---|---|
| `/admin/import-review`, `/admin/claims`, `/admin/events`, `/admin/recommendations` as **queues** | `/admin/businesses` merge/status power tools |
| | `/admin/listings` reports until Reports exists |
| | `/admin/reviews` until Community Reviews hosts UI |
| | `/admin/telegram-groups`, `/admin/directories` until Imports hosts UI |
| | `/admin/master-data` until Taxonomy hosts UI |
| | `ImportReviewDetailPanel` as editor implementation |

### Blockers (V2.0 “complete” claim)

1. **Dashboard still trains legacy habits** (Critical).  
2. **IA Imports/Community/System leaves are redirects to legacy**, not real homes (Critical for IA purity).  
3. **Hard Redirect matrix not implemented**.  
4. **Catalog Archive** not wired (High for Catalog completeness).  
5. **Settings missing** if IA promises System completeness (Medium — or explicitly defer).  
6. **Scale**: Inbox not production-ready for 10k+ without pagination (Medium until volume hits).

### Admin Panel V2.0 Release — must include

1. Dashboard rewired to **Inbox + Catalog + Analytics** (legacy links demoted or removed from primary cards).  
2. Documented **operator path**: Inbox → Workspace only for daily moderation.  
3. Soft migration banners remain on remaining legacy.  
4. Hard-redirect **candidates** behind flag or staged: import-review list/detail, claims, events verification, recommendations list.  
5. Production Readiness doc (this file) linked from IA SoT.  
6. No DB migrations required for V2.0.

### Moves to V2.1

1. Host Imports Telegram/Directories under IA paths; reverse redirects.  
2. Catalog Archive + Event admin edit.  
3. Server-backed Assignment + custom Saved Views.  
4. Inbox pagination / virtualization.  
5. Merge `DirectorySourcePanel`/`TelegramSourcePanel`.  
6. Community Reports product.  
7. Roles matrix / Settings.  
8. Delete retired legacy queue components after zero traffic.  
9. Unified metrics surface (optional).

---

## 8. Task list for Admin Panel V2.1

| ID | Task | Screen(s) | Priority |
|---|---|---|---|
| V21-01 | Move Telegram/Directories UI under `/admin/imports/*`; hard-redirect old paths | Imports | Critical |
| V21-02 | Host Reviews under `/admin/community/reviews` | Community | High |
| V21-03 | Catalog Archive for Business / Pro / Job / Event / Listing | Catalog | High |
| V21-04 | Event admin Edit in Catalog/Workspace | Catalog, Workspace | High |
| V21-05 | DB-backed Inbox assignment | Inbox | Medium |
| V21-06 | Custom Saved Views CRUD | Inbox, Views | Medium |
| V21-07 | Inbox server pagination + list virtualization | Inbox | Medium |
| V21-08 | Unify Import source panels | Imports | Low |
| V21-09 | Community Reports MVP | Reports | Medium |
| V21-10 | Users Admins leaf (filter) | Users | Low |
| V21-11 | Roles / Settings scope spike | Roles, Settings | Medium |
| V21-12 | Remove dead legacy queue components post-redirect | — | Low |
| V21-13 | SQL metrics for Inbox at scale | Inbox, Metrics | Medium |

---

## 9. V2.0 release task list (gap close without new products)

| ID | Task | Screen(s) | Priority | ETA |
|---|---|---|---|---|
| V20-01 | Rewire Dashboard cards → `/admin/review/inbox`, catalog, analytics | Dashboard | Critical | S |
| V20-02 | Update Dashboard copy (drop “Phase 1 shell only”) | Dashboard | High | S |
| V20-03 | Add soft banner on `/admin/reviews`, `/admin/businesses`, `/admin/listings`, `/admin/master-data` | Legacy | High | S |
| V20-04 | Stage hard redirects for import-review / claims / events / recommendations | Legacy → Inbox | High | M |
| V20-05 | Refresh `ADMIN_LEGACY_MAPPING` notes to match Workspace reality | Nav docs | Medium | S |
| V20-06 | Explicit “Advanced / legacy tools” entry for businesses merge | Catalog/Businesses | Medium | S |

---

## 10. Definition of Done — “Admin Panel V2 завершена”

All must be true:

1. Daily moderation starts at **Inbox** only (Dashboard + nav reinforce this).  
2. Every nav leaf is either **Production Ready** or explicitly **Stub** with no false “live” redirect confusion (IA URL hosts UI or is labeled Soon).  
3. Hard redirects live for retired queues; legacy queue UIs removable.  
4. Catalog supports browse + edit + archive for core entities (or documented exceptions).  
5. Imports history lives under `/admin/imports/*`.  
6. Soft banners removed after soak.  
7. This audit’s Critical/High V2.0 items closed; V2.1 list is the only remaining backlog.

**Current score:** ~**60–70%** of IA V2 target for moderator-critical paths; ~**40%** for full panel (Users/Roles/Reports/Settings/Imports hosting/Hard Redirect).

---

*End of Production Readiness Audit. No code was deleted or refactored as part of this document.*
