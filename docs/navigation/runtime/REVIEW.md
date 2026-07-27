# Review

## Purpose

Human (and workflow) moderation of `import_review_items` before publish.

## Source of Truth

- Design workflow: [`REVIEW_WORKFLOW_V1.md`](../../architecture/entity-model-v1/REVIEW_WORKFLOW_V1.md)
- Design UI: [`ADMIN_REVIEW_CENTER_V1.md`](../../architecture/entity-model-v1/ADMIN_REVIEW_CENTER_V1.md) *(freeze: live `/admin/import-review` may be transitional)*
- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Import Review

## Primary documents

- Freeze: [`ARCHITECTURE_FREEZE_V1.md`](../../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md)
- Gap: [`IMPLEMENTATION_GAP_ANALYSIS_V1.md`](../../architecture/entity-model-v1/IMPLEMENTATION_GAP_ANALYSIS_V1.md)

## Primary code location

- UI: [`../../../app/admin/import-review/`](../../../app/admin/import-review/)
- Components: [`../../../components/admin/ImportReview*`](../../../components/admin/)
- Lib: [`../../../lib/import-review/`](../../../lib/import-review/)
- Queue scripts: [`../../../scripts/import-review/`](../../../scripts/import-review/)

## Main database objects

- `import_review_items`
- `import_review_audit`
- Enum `import_review_status` (legacy vs workflow names — mapping doc)

## Entry points

- `/admin/import-review`
- RPCs `admin_import_review_*` / `admin_list_import_review_items`

## Main RPC

- See lifecycle + migrations (`admin_import_review_set_status`, `save_fields`, `mark_approved`, `counts`, `write_audit`, list RPC)

## Main API

- Server Actions in `lib/import-review/actions.ts`

## Related documents

- [`PUBLISH.md`](./PUBLISH.md), [`IMPORT.md`](./IMPORT.md), [`../admin/INDEX.md`](../admin/INDEX.md)

## Deprecated paths

- Legacy status aliases: [`ENTITY_TYPE_MAPPING_V1.md`](../../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md)
