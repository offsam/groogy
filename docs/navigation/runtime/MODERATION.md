# Moderation

## Purpose

Admin status changes and report handling for businesses, listings, reviews.

## Source of Truth

- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Moderation
- Access: [`ACCESS_MODEL_V1.md`](../../architecture/entity-model-v1/ACCESS_MODEL_V1.md)

## Primary documents

- Review workflow (import queue): [`REVIEW.md`](./REVIEW.md)
- Reviews reputation: [`REVIEWS.md`](./REVIEWS.md)

## Primary code location

- Business status: [`../../../lib/business/admin-actions.ts`](../../../lib/business/admin-actions.ts)
- Admin businesses UI: [`../../../components/business/AdminBusinessesPanel.tsx`](../../../components/business/AdminBusinessesPanel.tsx)
- Listings admin: [`../../../app/admin/listings/page.tsx`](../../../app/admin/listings/page.tsx)
- Reviews admin: [`../../../app/admin/reviews/page.tsx`](../../../app/admin/reviews/page.tsx)

## Main database objects

- Status columns on entities
- `listing_reports`, `review_reports` (lifecycle)

## Entry points

- `/admin/businesses`, `/admin/listings`, `/admin/reviews`

## Main RPC

- Lifecycle: `admin_set_business_status`, `admin_set_listing_status`, `admin_set_listing_report_status`, `admin_set_report_status`, `admin_set_review_moderation`

## Main API

- Server Actions / admin UI

## Related documents

- [`../admin/INDEX.md`](../admin/INDEX.md), [`CLAIMS.md`](./CLAIMS.md)

## Deprecated paths

- Unknown
