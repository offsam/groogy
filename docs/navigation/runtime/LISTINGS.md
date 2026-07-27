# Listings (Marketplace / Services / Transfer / Lechu)

## Purpose

Shared `listings` runtime for marketplace items, services, transfers, and lechu (`transport_carry`).

## Source of Truth

- Marketplace design: [`MARKETPLACE_ENTITY_V1.md`](../../architecture/entity-model-v1/MARKETPLACE_ENTITY_V1.md)
- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Marketplace / Listings
- Mapping: Transfer/Lechu marked “later” in freeze mapping — live tables still exist; treat design as incomplete
- Data audit: [`ENTITY_AUDIT_V1.md`](../../audits/ENTITY_AUDIT_V1.md)

## Primary documents

- [`ENTITY_TYPE_MAPPING_V1.md`](../../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md)
- Storage checklist: [`../../../scripts/listings-storage-checklist.md`](../../../scripts/listings-storage-checklist.md)

## Primary code location

- Lib: [`../../../lib/listings/`](../../../lib/listings/)
- Public: [`../../../app/marketplace/`](../../../app/marketplace/), [`../../../app/services/`](../../../app/services/), [`../../../app/transfers/`](../../../app/transfers/), [`../../../app/lechu/`](../../../app/lechu/)
- Admin: [`../../../app/admin/listings/page.tsx`](../../../app/admin/listings/page.tsx)
- Move script: [`../../../scripts/business-enrich/move_pros_to_lechu_transfers.py`](../../../scripts/business-enrich/move_pros_to_lechu_transfers.py)
- Reclassify: [`../../../scripts/import-review/reclassify_lechu_transfers.py`](../../../scripts/import-review/reclassify_lechu_transfers.py)

## Main database objects

- `listings`
- `marketplace_listing_details`
- `service_listing_details`
- `transfer_listing_details`
- `lechu_listing_details`
- Catalog views (migrations)
- Triggers: `transition_listing_status`, `listings_validate_publish` (lifecycle)

## Entry points

- `/marketplace`, `/services`, `/transfers`, `/lechu`
- Import publish → listing types
- `/admin/listings`

## Main RPC

- Listing admin status / catalog RPCs — see migrations + lifecycle

## Main API

- Listing source: [`../../../app/api/listing/[id]/source/route.ts`](../../../app/api/listing/[id]/source/route.ts)

## Related documents

- [`PUBLISH.md`](./PUBLISH.md), [`PUBLIC_WEBSITE.md`](./PUBLIC_WEBSITE.md), [`../entities/INDEX.md`](../entities/INDEX.md)

## Deprecated paths

- Dual “services” as listing vs professional — mapping warns transitional `target_collection=services`
