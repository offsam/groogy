# Reviews

## Purpose

User reviews, verification sessions, rating counters on businesses.

## Source of Truth

- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Reviews / Reputation
- Migrations under reviews MVP (see `supabase/migrations/*reviews*`)

## Primary documents

- None dedicated under `docs/architecture/entity-model-v1/` found for reviews product spec

## Primary code location

- Lib: [`../../../lib/reviews/`](../../../lib/reviews/)
- Components: [`../../../components/reviews/`](../../../components/reviews/)
- Admin: [`../../../app/admin/reviews/page.tsx`](../../../app/admin/reviews/page.tsx)

## Main database objects

- Reviews tables from reviews MVP migration set
- Business rating fields (`rating_avg`, `reviews_count`, verification counters — see field audit for fill reality)

## Entry points

- Business profile reviews UI
- `/admin/reviews`

## Main RPC

- Lifecycle: `create_verification_session`, `submit_verification_answer`, `complete_verification_session`, `admin_set_review_moderation`

## Main API

- None listed under `app/api/` for reviews

## Related documents

- [`MODERATION.md`](./MODERATION.md)
- [`FIELD_AUDIT_V1.md`](../../audits/FIELD_AUDIT_V1.md) (usage reality)

## Deprecated paths

- Unknown
