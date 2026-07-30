# Admin Panel IA V2 — Phase 6 Soft Migration

**Date:** 2026-07-28  
**ADR:** [`ADMIN_PANEL_IA_V2.md`](./ADMIN_PANEL_IA_V2.md)  
**Scope:** Soft-migration banners + audit. No DB / API / business-logic moves. Legacy URLs kept.

## Banner

Component: `components/admin/LegacyMigrationBanner.tsx`  
Mapping: `lib/admin/legacy-migration.ts`  
Dismiss: `sessionStorage` key `krugi-admin-legacy-banner:<id>` (per page, current session).

## Legacy → New audit table

| Legacy URL | New section | Status |
|---|---|---|
| `/admin/import-review` | Review Center / Inbox | Partial |
| `/admin/import-review/[id]` | Review Workspace `/admin/review/[taskId]` | Partial |
| `/admin/recommendations` | Review Center / Recommendations View | Partial |
| `/admin/claims` | Review Center / Claims View | Partial |
| `/admin/events` (verification) | Review Center / Events View | Partial |
| `/admin/telegram-groups` | Imports / Telegram | Partial |
| `/admin/directories` | Imports / Directories | Partial |
| `/admin/businesses` | Catalog / Businesses | Partial |
| `/admin/listings` | Catalog / Marketplace | Partial |
| `/admin/reviews` | Community / Reviews | Partial |
| `/admin/master-data` | System / Taxonomy | Partial |
| `/admin/yellow-pages` | → directories redirect | Can be removed later |

### Status legend

- **Fully Migrated** — no separate legacy UX; only redirects/aliases remain  
- **Partial** — new IA is primary entry; legacy still hosts actions or richer tools  
- **Legacy Only** — no IA equivalent yet  
- **Can be removed later** — alias / empty after cutover

## Fully aligned with ADR (so far)

- Persistent Admin sidebar (Phase 1)  
- Review Center Inbox + Views + Workspace shell (Phases 2–3)  
- Imports as history/diagnostics (Phase 4)  
- Catalog: Businesses, Professionals, Marketplace, Jobs, Events (Phase 5)  
- Soft banners pointing moderators to new IA (Phase 6)

## Still to implement (ADR remaining)

- Event verification approve/reject in Workspace  
- Admin Archive/Unpublish for Pros / Jobs / Events in Catalog  
- Users → Admins / Roles pages  
- Community → Reports  
- Imports → Facebook / CSV history  
- Soft-redirect cutover (retire dual entry after ≥1 release)  
- Optional `admin_review_tasks` table (Phase 7, only if needed)

## Removable after full cutover

After Workspace parity + ≥1 release of soft redirects:

- `/admin/import-review` (+ `[id]` after workspace edit parity)  
- `/admin/recommendations`  
- `/admin/claims` (if Workspace covers claim review)  
- `/admin/events` verification list (keep public `/events`)  
- Direct dual entry to `/admin/telegram-groups` / `/admin/directories` if only IA Imports URLs remain  
- `/admin/yellow-pages` (already redirect)

Keep redirects for bookmarks ≥1 release after delete.
