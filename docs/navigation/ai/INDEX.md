# AI Index

Collectors, classifiers, enrichment, LLM wiring. Navigation only.

Live overview: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § collectors / AI.

---

## Collectors

| Source | Location | README |
|---|---|---|
| Telegram | [`../../../scripts/telegram-collector/`](../../../scripts/telegram-collector/) | [`README.md`](../../../scripts/telegram-collector/README.md); SoT collect fields: [`TELEGRAM_COLLECTION_CARD_RULES_V1.md`](../../architecture/pipeline/TELEGRAM_COLLECTION_CARD_RULES_V1.md) |
| Facebook | [`../../../scripts/facebook-collector/`](../../../scripts/facebook-collector/) | [`README.md`](../../../scripts/facebook-collector/README.md) |
| Directories / Yellow Pages scrapers | `scripts/business-enrich/scrape_*.py`, `import_yellow_pages_cards.py` | — |

---

## Classifiers / decision

| Piece | Location |
|---|---|
| Telegram analyzers | [`../../../scripts/telegram-collector/analyzers.py`](../../../scripts/telegram-collector/analyzers.py) |
| Telegram reviewer (promote/keep/reject) | [`../../../scripts/telegram-collector/reviewer.py`](../../../scripts/telegram-collector/reviewer.py) |
| Facebook LLM + decision policy | [`facebook_llm.py`](../../../scripts/facebook-collector/facebook_llm.py), [`facebook_decision_policy.py`](../../../scripts/facebook-collector/facebook_decision_policy.py) |
| Null queue classification | [`../../../scripts/import-review/classify_null_queue.py`](../../../scripts/import-review/classify_null_queue.py) |
| Algorithm notes (audit) | [`../../audits/NULL_CLASSIFICATION_ALGORITHM_V1.md`](../../audits/NULL_CLASSIFICATION_ALGORITHM_V1.md) |
| Recommendation buckets | [`../../../scripts/business-enrich/classify_recommendation_buckets.py`](../../../scripts/business-enrich/classify_recommendation_buckets.py) |
| Category map (import) | [`../../../scripts/import-review/category_map.py`](../../../scripts/import-review/category_map.py) |

---

## Enrichment

| Piece | Location |
|---|---|
| Runtime entry | [`../runtime/ENRICHMENT.md`](../runtime/ENRICHMENT.md) |
| Scripts root | [`../../../scripts/business-enrich/`](../../../scripts/business-enrich/) |
| Unified runner | [`run_enrichment_pipeline.py`](../../../scripts/business-enrich/run_enrichment_pipeline.py) |
| Queue enrich | [`../../../scripts/import-review/enrich_queue.py`](../../../scripts/import-review/enrich_queue.py) |
| Media pipeline | [`../../../scripts/media-pipeline/`](../../../scripts/media-pipeline/) |
| Audit / rules | [`../../audits/ENRICHMENT_AUDIT_V1.md`](../../audits/ENRICHMENT_AUDIT_V1.md), [`ENRICHMENT_RULES_V1.md`](../../audits/ENRICHMENT_RULES_V1.md), [`ENRICHMENT_INFRASTRUCTURE_V1.md`](../../audits/ENRICHMENT_INFRASTRUCTURE_V1.md) |

---

## Reviewer (collector-side)

- Telegram: [`../../../scripts/telegram-collector/reviewer.py`](../../../scripts/telegram-collector/reviewer.py), [`run_reviewer.py`](../../../scripts/telegram-collector/run_reviewer.py)
- Human Import Review (not LLM): [`../runtime/REVIEW.md`](../runtime/REVIEW.md)

---

## LLM integrations (app)

| Piece | Location |
|---|---|
| OpenRouter client / allowlist | [`../../../lib/ai/openrouter.ts`](../../../lib/ai/openrouter.ts) |
| Search intent | [`../../../lib/ai/search-intent.ts`](../../../lib/ai/search-intent.ts) |
| API route | [`../../../app/api/search/ai/route.ts`](../../../app/api/search/ai/route.ts) |
| Guard | [`../../../lib/security/ai-search-guard.ts`](../../../lib/security/ai-search-guard.ts) |

Collector LLM:

- [`../../../scripts/telegram-collector/llm_client.py`](../../../scripts/telegram-collector/llm_client.py)
- [`../../../scripts/telegram-collector/cost.py`](../../../scripts/telegram-collector/cost.py)

---

## Prompts

- **No dedicated `prompts/` directory found.**
- Prompts live inside collector / enrichment Python modules and `lib/ai/*` — open the calling file; do not invent a prompt registry.

---

## AI pipelines (documented flows)

- Lifecycle mermaid + stages: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md)
- Card processing: [`CARD_PROCESSING_ARCHITECTURE_V1.md`](../../architecture/runtime/CARD_PROCESSING_ARCHITECTURE_V1.md)
- Extraction/classification contract: [`EXTRACTION_CLASSIFICATION_CONTRACT_V1.md`](../../architecture/pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md)
- Pipeline index: [`../pipeline/INDEX.md`](../pipeline/INDEX.md)
- Pipeline audit: [`../../audits/PIPELINE_AUDIT_V1.md`](../../audits/PIPELINE_AUDIT_V1.md)
- CI drift tests: [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) → `test_extraction_contract.py`, `test_review_tags.py`
