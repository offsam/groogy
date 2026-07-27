# Publish

## Purpose

Turn approved import-review (or autopublish-eligible) items into live entity rows.

## Source of Truth

- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) (Publish subsystem)
- Design: [`JOBS_AND_PUBLISH.md`](../../architecture/entity-model-v1/JOBS_AND_PUBLISH.md), freeze publish rules in [`ARCHITECTURE_FREEZE_V1.md`](../../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md)
- Quality gates (audit): [`QUALITY_CARD_RULES_V1.md`](../../audits/QUALITY_CARD_RULES_V1.md)

## Primary documents

- [`REVIEW_WORKFLOW_V1.md`](../../architecture/entity-model-v1/REVIEW_WORKFLOW_V1.md)
- [`PIPELINE_AUDIT_V1.md`](../../audits/PIPELINE_AUDIT_V1.md)

## Primary code location

- [`../../../lib/import-review/actions.ts`](../../../lib/import-review/actions.ts) — `approveImportReviewItemAction`
- [`../../../scripts/import-review/autopublish_strong_accepted.py`](../../../scripts/import-review/autopublish_strong_accepted.py)
- Recommendation publish: [`../../../lib/import-review/recommendation-actions.ts`](../../../lib/import-review/recommendation-actions.ts), [`../../../scripts/business-enrich/publish_recommendation_catalog.py`](../../../scripts/business-enrich/publish_recommendation_catalog.py)

## Main database objects

- `import_review_items` (`published_entity_type`, `published_entity_id`, `review_status`)
- Target tables: `businesses`, `professionals`, `listings` (+ detail tables), `events`, `jobs` (see entity index)

## Entry points

- Admin UI approve path: [`../../../app/admin/import-review/`](../../../app/admin/import-review/)
- CLI autopublish: `scripts/import-review/autopublish_strong_accepted.py`

## Main RPC

- Named in lifecycle: `service_autopublish_marketplace_listing`, `service_autopublish_specialist_service`, `service_import_review_mark_autopublished`, `service_enrich_business_from_queue`
- Definitions: `supabase/migrations/`

## Main API

- None dedicated — Server Actions + admin UI

## Related documents

- [`REVIEW.md`](./REVIEW.md), [`IMPORT.md`](./IMPORT.md), [`../entities/INDEX.md`](../entities/INDEX.md)

## Deprecated paths

- See freeze / mapping for legacy status names: [`ENTITY_TYPE_MAPPING_V1.md`](../../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md)
