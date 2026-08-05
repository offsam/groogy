# Enrichment

## Purpose

Fill-empty enrichment of published (and queue) entities from sources, scrapes, geocoders, LLM summaries.

## Source of Truth

- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Enrichment
- **BFS follow / CMS chrome (normative):** [`ENRICH_RESOURCE_FOLLOW_POLICY_V1.md`](../../architecture/runtime/ENRICH_RESOURCE_FOLLOW_POLICY_V1.md)
- Audit: [`ENRICHMENT_AUDIT_V1.md`](../../audits/ENRICHMENT_AUDIT_V1.md)
- Rules: [`ENRICHMENT_RULES_V1.md`](../../audits/ENRICHMENT_RULES_V1.md)
- Infrastructure notes: [`ENRICHMENT_INFRASTRUCTURE_V1.md`](../../audits/ENRICHMENT_INFRASTRUCTURE_V1.md)

## Primary documents

- [`PIPELINE_AUDIT_V1.md`](../../audits/PIPELINE_AUDIT_V1.md)
- [`FIELD_AUDIT_V1.md`](../../audits/FIELD_AUDIT_V1.md)
- [`../ai/INDEX.md`](../ai/INDEX.md)

## Primary code location

- [`../../../scripts/business-enrich/`](../../../scripts/business-enrich/)
- Follow policy SoT: [`enrich_follow_policy.py`](../../../scripts/business-enrich/enrich_follow_policy.py)
- Runner: [`run_enrichment_pipeline.py`](../../../scripts/business-enrich/run_enrichment_pipeline.py)
- Queue: [`../../../scripts/import-review/enrich_queue.py`](../../../scripts/import-review/enrich_queue.py)
- Media: [`../../../scripts/media-pipeline/`](../../../scripts/media-pipeline/)
- Paste-enrich (admin): [`lib/admin/paste-enrich.ts`](../../../lib/admin/paste-enrich.ts)

## Main database objects

- Target entity tables (`businesses`, `professionals`, …)
- RPC: `service_enrich_business_from_queue` (lifecycle)

## Entry points

- Manual CLI scripts under `scripts/business-enrich/`
- Media: `scripts/media-pipeline/run_media_pipeline.py`
- Admin «Обогатить» / «Вставить текст» on live cards

## Main RPC

- `service_enrich_business_from_queue`

## Contract tests (CI)

- `scripts/business-enrich/test_enrich_follow_policy.py` — no blogroll chase from own site
- `lib/admin/paste-enrich-contract.test.ts` — Google paste → name on live cards

## Main API

- None (CLI)

## Related documents

- [`IMPORT.md`](./IMPORT.md), [`PUBLISH.md`](./PUBLISH.md), [`DUPLICATES.md`](./DUPLICATES.md)

## Deprecated paths

- Treat one-off `data/` JSON under `scripts/business-enrich/data/` as run artifacts, not SoT
