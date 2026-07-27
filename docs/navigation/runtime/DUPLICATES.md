# Duplicates

## Purpose

Detect and merge duplicate queue items and published entities.

## Source of Truth

- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Duplicate Detection
- Data notes: [`PLATFORM_DATA_AUDIT_V1.md`](../../audits/PLATFORM_DATA_AUDIT_V1.md), [`RECOMMENDATIONS_V1.md`](../../audits/RECOMMENDATIONS_V1.md)

## Primary documents

- Pipeline: [`PIPELINE_AUDIT_V1.md`](../../audits/PIPELINE_AUDIT_V1.md)

## Primary code location

- Collector dedupe: [`../../../scripts/telegram-collector/dedupe.py`](../../../scripts/telegram-collector/dedupe.py)
- Queue: `scripts/import-review/dedupe_open_queue.py`, `merge_pending_clusters.py`, `merge_queue_into_existing.py`
- Publish-time: `findDuplicateMatches` in [`../../../lib/import-review/actions.ts`](../../../lib/import-review/actions.ts)
- Entity: [`find_business_duplicates.py`](../../../scripts/business-enrich/find_business_duplicates.py), [`merge_approved_duplicates.py`](../../../scripts/business-enrich/merge_approved_duplicates.py), [`merge_professional_duplicates.py`](../../../scripts/business-enrich/merge_professional_duplicates.py)

## Main database objects

- `import_review_items.source_fingerprint`, `duplicate_*`, `recurring_cluster_id`
- RPC: `admin_merge_businesses` (lifecycle)

## Entry points

- CLI scripts above
- Admin import-review duplicate status

## Main RPC

- `admin_merge_businesses`

## Main API

- None

## Related documents

- [`REVIEW.md`](./REVIEW.md), [`PUBLISH.md`](./PUBLISH.md), [`ENRICHMENT.md`](./ENRICHMENT.md)

## Deprecated paths

- Unknown
