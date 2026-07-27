# Claims

## Purpose

Admin/user handling of business claim requests.

## Source of Truth

- Design: [`OWNERSHIP_SOURCE_CLAIM.md`](../../architecture/entity-model-v1/OWNERSHIP_SOURCE_CLAIM.md)
- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Ownership / Claim

## Primary documents

- [`OWNERSHIP.md`](./OWNERSHIP.md)

## Primary code location

- Admin page: [`../../../app/admin/claims/page.tsx`](../../../app/admin/claims/page.tsx)
- Panel: [`../../../components/admin/AdminClaimsPanel.tsx`](../../../components/admin/AdminClaimsPanel.tsx)
- Lib: [`../../../lib/claims/`](../../../lib/claims/)

## Main database objects

- `business_claims`
- `business_owners`

## Entry points

- `/admin/claims`
- Claim Server Actions in `lib/claims/`

## Main RPC

- `admin_review_business_claim`

## Main API

- None dedicated

## Related documents

- [`../admin/INDEX.md`](../admin/INDEX.md), [`MODERATION.md`](./MODERATION.md)

## Deprecated paths

- Unknown / none listed separately
