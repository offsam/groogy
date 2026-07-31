# Pipeline Index

Canonical import/extraction/classification contracts.

| Doc | Role |
|---|---|
| [`EXTRACTION_CLASSIFICATION_CONTRACT_V1.md`](../../architecture/pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md) | P2–P3 contract; CI drift-checked |
| [`TELEGRAM_COLLECTION_CARD_RULES_V1.md`](../../architecture/pipeline/TELEGRAM_COLLECTION_CARD_RULES_V1.md) | Telegram collect field targets + **no autopublish** |
| [`ENTITY_SECTION_ROUTING_V1.md`](../../architecture/pipeline/ENTITY_SECTION_ROUTING_V1.md) | P3 section router + live card move / redirects |
| [`CARD_PROCESSING_ARCHITECTURE_V1.md`](../../architecture/runtime/CARD_PROCESSING_ARCHITECTURE_V1.md) | Normative card pipeline |
| [`CARD_LIFECYCLE_ARCHITECTURE_V1.md`](../../architecture/card/CARD_LIFECYCLE_ARCHITECTURE_V1.md) | Actual card lifecycles |
| [`PIPELINE_AUDIT_V1.md`](../../audits/PIPELINE_AUDIT_V1.md) | Live data/pipeline audit facts |

## Code

- Import review scripts: [`../../../scripts/import-review/`](../../../scripts/import-review/)
- Contract tests (CI): `scripts/import-review/test_extraction_contract.py`, `scripts/import-review/test_review_tags.py`
- Workflow: [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)

## Runtime entry-points

- [`../runtime/IMPORT.md`](../runtime/IMPORT.md)
- [`../runtime/REVIEW.md`](../runtime/REVIEW.md)
- [`../runtime/PUBLISH.md`](../runtime/PUBLISH.md)
