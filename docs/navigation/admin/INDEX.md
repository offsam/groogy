# Admin Index

Admin App Router pages + panels. Design doc: [`ADMIN_REVIEW_CENTER_V1.md`](../../architecture/entity-model-v1/ADMIN_REVIEW_CENTER_V1.md) (live UI may be transitional — see freeze).

---

## Pages (`app/admin/`)

| Area | Page |
|---|---|
| Home | [`../../../app/admin/page.tsx`](../../../app/admin/page.tsx) |
| Import Review | [`../../../app/admin/import-review/page.tsx`](../../../app/admin/import-review/page.tsx), [`[id]/page.tsx`](../../../app/admin/import-review/[id]/page.tsx) |
| Recommendations | [`../../../app/admin/recommendations/page.tsx`](../../../app/admin/recommendations/page.tsx) |
| Businesses | [`../../../app/admin/businesses/page.tsx`](../../../app/admin/businesses/page.tsx), [`new`](../../../app/admin/businesses/new/page.tsx), [`[id]/edit`](../../../app/admin/businesses/[id]/edit/page.tsx) |
| Listings | [`../../../app/admin/listings/page.tsx`](../../../app/admin/listings/page.tsx) |
| Events | [`../../../app/admin/events/page.tsx`](../../../app/admin/events/page.tsx) |
| Claims | [`../../../app/admin/claims/page.tsx`](../../../app/admin/claims/page.tsx) |
| Reviews | [`../../../app/admin/reviews/page.tsx`](../../../app/admin/reviews/page.tsx) |
| Users | [`../../../app/admin/users/page.tsx`](../../../app/admin/users/page.tsx) |
| Analytics | [`../../../app/admin/analytics/page.tsx`](../../../app/admin/analytics/page.tsx) |
| Master data | [`../../../app/admin/master-data/page.tsx`](../../../app/admin/master-data/page.tsx) |
| Directories | [`../../../app/admin/directories/page.tsx`](../../../app/admin/directories/page.tsx), [`[source]`](../../../app/admin/directories/[source]/page.tsx) |
| Telegram groups | [`../../../app/admin/telegram-groups/page.tsx`](../../../app/admin/telegram-groups/page.tsx), [`[source]`](../../../app/admin/telegram-groups/[source]/page.tsx) |
| Yellow pages | [`../../../app/admin/yellow-pages/page.tsx`](../../../app/admin/yellow-pages/page.tsx) |

---

## UI components

- Folder: [`../../../components/admin/`](../../../components/admin/)
- Business admin panel: [`../../../components/business/AdminBusinessesPanel.tsx`](../../../components/business/AdminBusinessesPanel.tsx)

---

## Lib / actions

- Import review: [`../../../lib/import-review/`](../../../lib/import-review/)
- Admin queries: [`../../../lib/admin/`](../../../lib/admin/)
- Business admin: [`../../../lib/business/admin-actions.ts`](../../../lib/business/admin-actions.ts), [`admin-queries.ts`](../../../lib/business/admin-queries.ts)
- Claims: [`../../../lib/claims/`](../../../lib/claims/)
- Reviews admin: [`../../../lib/reviews/`](../../../lib/reviews/)
- Master data: [`../../../lib/master-data/`](../../../lib/master-data/)

---

## Runtime links

- Review: [`../runtime/REVIEW.md`](../runtime/REVIEW.md)
- Publish: [`../runtime/PUBLISH.md`](../runtime/PUBLISH.md)
- Claims: [`../runtime/CLAIMS.md`](../runtime/CLAIMS.md)
- Moderation: [`../runtime/MODERATION.md`](../runtime/MODERATION.md)
- Recommendations: [`../runtime/RECOMMENDATIONS.md`](../runtime/RECOMMENDATIONS.md)
