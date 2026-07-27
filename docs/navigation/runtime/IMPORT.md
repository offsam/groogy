# Import

## Purpose

Ingest Telegram / Facebook / directory source material into the import-review queue.

## Source of Truth

- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Collectors / Import
- Pipeline facts: [`PIPELINE_AUDIT_V1.md`](../../audits/PIPELINE_AUDIT_V1.md)

## Primary documents

- Collector READMEs: [`../../../scripts/telegram-collector/README.md`](../../../scripts/telegram-collector/README.md), [`../../../scripts/facebook-collector/README.md`](../../../scripts/facebook-collector/README.md)
- AI index: [`../ai/INDEX.md`](../ai/INDEX.md)

## Primary code location

- [`../../../scripts/telegram-collector/`](../../../scripts/telegram-collector/)
- [`../../../scripts/facebook-collector/`](../../../scripts/facebook-collector/)
- Queue loaders: [`../../../scripts/import-review/import_needs_review.py`](../../../scripts/import-review/import_needs_review.py)
- Yellow pages import: [`../../../scripts/business-enrich/import_yellow_pages_cards.py`](../../../scripts/business-enrich/import_yellow_pages_cards.py)
- Shared helpers: [`../../../scripts/import-review/common.py`](../../../scripts/import-review/common.py)

## Main database objects

- `import_review_items`
- `import_review_audit`
- Related: `import_comment_recommendations` (recommendations track)

## Entry points

- CLI collectors / `import_needs_review.py`
- Admin directories / yellow-pages / telegram-groups UI (see [`../admin/INDEX.md`](../admin/INDEX.md))

## Main RPC

- Queue list/write RPCs documented in lifecycle (`admin_list_import_review_items`, `admin_import_review_*`)

## Main API

- None for collectors (CLI)

## Related documents

- [`REVIEW.md`](./REVIEW.md), [`ENRICHMENT.md`](./ENRICHMENT.md), [`../ai/INDEX.md`](../ai/INDEX.md)

## Deprecated paths

- Unknown beyond mapping aliases — see [`ENTITY_TYPE_MAPPING_V1.md`](../../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md)
