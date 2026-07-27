# Project Index

**Question answered:** Where do I go?

Read [`AI_AGENT_START_HERE.md`](./AI_AGENT_START_HERE.md) first.

Compact TOC only. No explanations.

---

## Runtime

- Index: [`runtime/INDEX.md`](./runtime/INDEX.md)
- Live map: [`../architecture/runtime/PLATFORM_LIFECYCLE_V1.md`](../architecture/runtime/PLATFORM_LIFECYCLE_V1.md)
- Canonical card pipeline: [`../architecture/runtime/CARD_PROCESSING_ARCHITECTURE_V1.md`](../architecture/runtime/CARD_PROCESSING_ARCHITECTURE_V1.md)
- Extraction/classification contract (P2–P3, drift-checked in CI): [`../architecture/pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md`](../architecture/pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md)
- Card lifecycle: [`../architecture/card/CARD_LIFECYCLE_ARCHITECTURE_V1.md`](../architecture/card/CARD_LIFECYCLE_ARCHITECTURE_V1.md)
- Stabilization: [`../architecture/runtime/ARCHITECTURE_STABILIZATION_V1.md`](../architecture/runtime/ARCHITECTURE_STABILIZATION_V1.md)

---

## Domain / alignment

- Core domain: [`../architecture/domain/CORE_DOMAIN_ARCHITECTURE_V1.md`](../architecture/domain/CORE_DOMAIN_ARCHITECTURE_V1.md)
- Alignment roadmap (violations + stages): [`../architecture/ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md`](../architecture/ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md)

---

## Entity Model

- Index: [`entities/INDEX.md`](./entities/INDEX.md)
- Freeze (canonical design): [`../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md`](../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md)
- Type aliases: [`../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md`](../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md)
- Gap vs live: [`../architecture/entity-model-v1/IMPLEMENTATION_GAP_ANALYSIS_V1.md`](../architecture/entity-model-v1/IMPLEMENTATION_GAP_ANALYSIS_V1.md)
- Category unification audit (pre-freeze): [`../architecture/entity-category-unification-audit.md`](../architecture/entity-category-unification-audit.md)

---

## Database

- Index: [`database/INDEX.md`](./database/INDEX.md)
- Live migrations: [`../../supabase/migrations/`](../../supabase/migrations/)
- Generated TS types: [`../../types/database.ts`](../../types/database.ts)
- Alignment notes: [`../architecture/entity-model-v1/DATABASE_ALIGNMENT_V1.md`](../architecture/entity-model-v1/DATABASE_ALIGNMENT_V1.md)
- ⚠️ [`../database-schema.md`](../database-schema.md) — historical **proposal**; not live SoT

---

## API

- Index: [`api/INDEX.md`](./api/INDEX.md)
- Routes root: [`../../app/api/`](../../app/api/)

---

## Admin

- Index: [`admin/INDEX.md`](./admin/INDEX.md)
- App root: [`../../app/admin/`](../../app/admin/)
- Design: [`../architecture/entity-model-v1/ADMIN_REVIEW_CENTER_V1.md`](../architecture/entity-model-v1/ADMIN_REVIEW_CENTER_V1.md)

---

## Import Pipeline

- Runtime entry: [`runtime/IMPORT.md`](./runtime/IMPORT.md)
- Review entry: [`runtime/REVIEW.md`](./runtime/REVIEW.md)
- Publish entry: [`runtime/PUBLISH.md`](./runtime/PUBLISH.md)
- Pipeline audit (data facts): [`../audits/PIPELINE_AUDIT_V1.md`](../audits/PIPELINE_AUDIT_V1.md)

---

## Search

- Entry: [`runtime/SEARCH.md`](./runtime/SEARCH.md)

---

## AI

- Index: [`ai/INDEX.md`](./ai/INDEX.md)

---

## Integrations

- Telegram collector: [`../../scripts/telegram-collector/README.md`](../../scripts/telegram-collector/README.md)
- Facebook collector: [`../../scripts/facebook-collector/README.md`](../../scripts/facebook-collector/README.md)
- Directory scrapers: `scripts/business-enrich/scrape_*.py` (see [`ai/INDEX.md`](./ai/INDEX.md))
- Supabase clients: [`../../lib/supabase/`](../../lib/supabase/)

---

## Security

- Server AI allowlist / OpenRouter: [`../../lib/ai/openrouter.ts`](../../lib/ai/openrouter.ts)
- AI search guard: [`../../lib/security/ai-search-guard.ts`](../../lib/security/ai-search-guard.ts)
- Rate limit: [`../../lib/security/rate-limit.ts`](../../lib/security/rate-limit.ts)
- Redact: [`../../lib/security/redact.ts`](../../lib/security/redact.ts)
- Access / ACL design: [`../architecture/entity-model-v1/ACCESS_MODEL_V1.md`](../architecture/entity-model-v1/ACCESS_MODEL_V1.md), [`../architecture/entity-model-v1/ENTITY_ACL_V1.md`](../architecture/entity-model-v1/ENTITY_ACL_V1.md)
- Workspace secrets rule: [`.cursor/rules/secrets-security.mdc`](../../.cursor/rules/secrets-security.mdc)
- Scope rule: [`.cursor/rules/no-freelancing.mdc`](../../.cursor/rules/no-freelancing.mdc)

---

## Deployment

- **Unknown as dedicated docs** — no deployment runbook found under `docs/`.
- App: Next.js (`package.json` scripts: `dev` / `build` / `start`)
- DB: Supabase project + `supabase/migrations/`

---

## Architecture Decisions

- No `ADR*.md` files found in repo.
- Resolution / freeze layer: [`../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md`](../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md)
- Freeze report: [`../architecture/entity-model-v1/ARCHITECTURE_FREEZE_REPORT_V1.md`](../architecture/entity-model-v1/ARCHITECTURE_FREEZE_REPORT_V1.md)
- Final audit: [`../architecture/entity-model-v1/ARCHITECTURE_FINAL_AUDIT_V1.md`](../architecture/entity-model-v1/ARCHITECTURE_FINAL_AUDIT_V1.md)
- Overview report: [`../architecture/entity-model-v1/REPORT.md`](../architecture/entity-model-v1/REPORT.md)

---

## Data quality / audits (supporting)

Folder: [`../audits/`](../audits/)

| Doc |
|---|
| [`PLATFORM_DATA_AUDIT_V1.md`](../audits/PLATFORM_DATA_AUDIT_V1.md) |
| [`ENTITY_AUDIT_V1.md`](../audits/ENTITY_AUDIT_V1.md) |
| [`FIELD_AUDIT_V1.md`](../audits/FIELD_AUDIT_V1.md) |
| [`PIPELINE_AUDIT_V1.md`](../audits/PIPELINE_AUDIT_V1.md) |
| [`ENRICHMENT_AUDIT_V1.md`](../audits/ENRICHMENT_AUDIT_V1.md) |
| [`ENRICHMENT_RULES_V1.md`](../audits/ENRICHMENT_RULES_V1.md) |
| [`ENRICHMENT_INFRASTRUCTURE_V1.md`](../audits/ENRICHMENT_INFRASTRUCTURE_V1.md) |
| [`QUALITY_CARD_RULES_V1.md`](../audits/QUALITY_CARD_RULES_V1.md) |
| [`DEAD_FIELDS_V1.md`](../audits/DEAD_FIELDS_V1.md) |
| [`NULL_CLASSIFICATION_ALGORITHM_V1.md`](../audits/NULL_CLASSIFICATION_ALGORITHM_V1.md) |
| [`RECOMMENDATIONS_V1.md`](../audits/RECOMMENDATIONS_V1.md) |
| [`DATA_CLEANUP_PLAN_V1.md`](../audits/DATA_CLEANUP_PLAN_V1.md) |
| [`PHASE_PLAN_V1.md`](../audits/PHASE_PLAN_V1.md) |

---

## Information Architecture / Taxonomy

- IA V2: [`../architecture/entity-model-v1/PLATFORM_INFORMATION_ARCHITECTURE_V2.md`](../architecture/entity-model-v1/PLATFORM_INFORMATION_ARCHITECTURE_V2.md)
- IA V1 (secondary): [`../architecture/entity-model-v1/PLATFORM_INFORMATION_ARCHITECTURE_V1.md`](../architecture/entity-model-v1/PLATFORM_INFORMATION_ARCHITECTURE_V1.md)
- Taxonomy freeze: [`../architecture/entity-model-v1/TAXONOMY_FREEZE_V1.md`](../architecture/entity-model-v1/TAXONOMY_FREEZE_V1.md)
- Taxonomy: [`../architecture/entity-model-v1/TAXONOMY_V1.md`](../architecture/entity-model-v1/TAXONOMY_V1.md)
- RU labels: [`../architecture/entity-model-v1/TAXONOMY_RU_V1.md`](../architecture/entity-model-v1/TAXONOMY_RU_V1.md)
- JSON assets: via [`TAXONOMY_V1.md`](../architecture/entity-model-v1/TAXONOMY_V1.md) (`taxonomy_*_v1.json`, `taxonomy_ru_v1_final.json`)

---

## Navigation maintenance

- Rules: [`NAVIGATION_RULES.md`](./NAVIGATION_RULES.md)
- Coverage report: [`NAVIGATION_COVERAGE_REPORT.md`](./NAVIGATION_COVERAGE_REPORT.md)
- Dependency map: [`DEPENDENCY_MAP.md`](./DEPENDENCY_MAP.md)
