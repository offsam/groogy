# Ownership

## Purpose

Separate Source / Import / Owner / Claim concepts on entities.

## Source of Truth

- [`OWNERSHIP_SOURCE_CLAIM.md`](../../architecture/entity-model-v1/OWNERSHIP_SOURCE_CLAIM.md)
- Freeze resolutions: [`ARCHITECTURE_FREEZE_V1.md`](../../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md)
- ACL: [`ENTITY_ACL_V1.md`](../../architecture/entity-model-v1/ENTITY_ACL_V1.md) (Variant A)
- Access: [`ACCESS_MODEL_V1.md`](../../architecture/entity-model-v1/ACCESS_MODEL_V1.md)

## Primary documents

- [`ENTITY_BASE_MODEL.md`](../../architecture/entity-model-v1/ENTITY_BASE_MODEL.md)
- Live claim/ownership notes: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Ownership / Claim

## Primary code location

- [`../../../lib/claims/`](../../../lib/claims/)
- Helpers referenced in lifecycle: `owns_business()`, `owns_professional()`, `can_manage_job()` (SQL migrations)

## Main database objects

- `business_claims`, `business_owners`
- Entity owner columns (e.g. `owner_profile_id` on professionals/jobs — see entity docs)

## Entry points

- User claim flows via `lib/claims/actions.ts`
- Admin claims UI — [`CLAIMS.md`](./CLAIMS.md)

## Main RPC

- `admin_review_business_claim` (lifecycle)
- Ownership helpers in migrations

## Main API

- Server Actions (claims), not a dedicated public REST surface

## Related documents

- [`CLAIMS.md`](./CLAIMS.md), [`../entities/INDEX.md`](../entities/INDEX.md)

## Deprecated paths

- Documented naming conflicts resolved in freeze (e.g. `profile_id` vs `owner_profile_id`) — follow freeze
