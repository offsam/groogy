# Admin Panel V2 — IA Independence Report

**Date:** 2026-07-28  
**Scope:** Remove IA→legacy `redirect()`; host Imports / Community / System under V2 URLs.

## 1. IA sections now independent (no redirect to legacy)

| Section | Status |
|---|---|
| `/admin/imports` | Native overview + History / Diagnostics (diag Soon) |
| `/admin/imports/telegram` (+`/[source]`) | Native — shared UI with legacy URL |
| `/admin/imports/directories` (+`/[source]`) | Native — shared UI |
| `/admin/imports/facebook`, `/csv` | Native Coming Soon |
| `/admin/community/reviews` | Native — same panel as legacy |
| `/admin/community/recommendations` | Native — panel + Inbox links |
| `/admin/community/reports` | Native Coming Soon (CTA → community reviews) |
| `/admin/system` | Native index |
| `/admin/system/taxonomy` | Native — same master-data panel |
| `/admin/system/health|jobs|tasks|logs|diagnostics` | Native Coming Soon |
| `/admin/settings` | Native Coming Soon |

## 2. Redirects removed (IA → legacy)

| Source (was) | Target (was) | Now |
|---|---|---|
| `/admin/imports/telegram` | `/admin/telegram-groups` | Renders `TelegramImportsIndex` |
| `/admin/imports/directories` | `/admin/directories` | Renders `DirectoriesImportsIndex` |
| `/admin/community/reviews` | `/admin/reviews` | Renders `AdminReviewsPanel` |
| `/admin/community/recommendations` | `/admin/recommendations` | Renders `CommentRecommendationsPanel` |
| `/admin/system/taxonomy` | `/admin/master-data` | Renders `AdminMasterDataPanel` |
| `/admin/system` | `/admin/system/taxonomy` | Native System index |

## 3. Remaining redirects / legacy navigations

| Source | Target | Reason | Remove? |
|---|---|---|---|
| `/admin/review` | `/admin/review/inbox` | IA section → default leaf | **No** (IA→IA) |
| `/admin/yellow-pages` | `/admin/directories` | Alias → legacy host | Later → imports/directories |
| Login `redirect(/login?next=…)` | login | Auth | **No** |
| Non-admin `redirect("/")` | home | Authz | **No** |
| Missing task `redirect(inbox)` | Inbox | Workspace guard | **No** |
| Legacy pages still serve UI | self | Compat layer | Keep until Hard Redirect |
| Soft banners / Dashboard | IA only | Done | — |
| `CommentRecommendationsPanel` internal links (if any legacy) | varies | Panel may still mention old paths | Audit in V2.1 |
| Catalog Edit → `/admin/businesses/[id]/edit` | legacy editor host | Editor not moved | **No** until editor under Catalog |
| Workspace Edit may embed forms hosted on legacy routes | — | Shared components | OK |

## 4. Final independence table

| Раздел | IA Native | Legacy Redirect | Ready for Hard Redirect |
|---|---|---|---|
| Dashboard | Yes | No | Yes (already IA-only links) |
| Inbox / Workspace | Yes | No | Yes for queues |
| Catalog | Yes | No (edit may open legacy form URL) | Partial |
| Imports | Yes | No | Yes (legacy telegram/directories can redirect → IA) |
| Community | Yes | No | Yes (legacy reviews/recommendations → IA) |
| System | Yes | No | Yes (master-data → taxonomy) |
| Users | Yes | No | Partial (admins/roles Soon) |
| Settings | Stub | No | N/A |
| Reports | Stub (community) | No | N/A |

## 5. What still blocks turning legacy off

1. Catalog Archive / business merge power tools on `/admin/businesses`
2. Listings reports until Community Reports is real
3. Hard Redirect flip for old queue URLs (import-review, claims, events, recommendations)
4. Soft soak + analytics on legacy hits
5. Optional: move business editor under Catalog path

## 6. Independence estimate

- **Moderator IA paths (Dashboard → Inbox → Workspace → Imports/Community/System nav):** ~**90%** independent (no IA→legacy redirects).
- **Full panel including Catalog power tools + Reports/Settings depth:** ~**75%**.
- **Safe to delete legacy code:** still **~0%** until Hard Redirect soak completes.

*Legacy URLs remain available; they are no longer required for IA navigation.*
