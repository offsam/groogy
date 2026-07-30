# Admin Panel IA V2 — Phase 1 Shell (implemented)

**Date:** 2026-07-28  
**ADR:** [`ADMIN_PANEL_IA_V2.md`](./ADMIN_PANEL_IA_V2.md)  
**Scope:** Navigation shell only — no queue/catalog logic migration.

## Delivered

- Persistent Admin sidebar (`components/admin/AdminShell.tsx`) via `app/admin/layout.tsx`
- Nav config + legacy map: `lib/admin/nav.ts`
- Coming Soon placeholder: `components/admin/AdminComingSoon.tsx`
- New IA routes under `/admin/review|catalog|imports|community|system|…`

## Next phase (Phase 2)

Unify Inbox Views over existing queues (no new top-level products): thin `/admin/review` that filters/links Import Review, Claims, Events, Recommendations as **Views**.

## Phase 2 status

Implemented: `/admin/review/inbox` aggregates Import Review, Claims, Events, Recommendations via `lib/admin/inbox/*`. Saved Views = filter presets. Legacy pages unchanged.
