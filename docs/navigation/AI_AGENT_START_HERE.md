# AI Agent — Start Here

**Mandatory navigation document for every AI agent working in this repository.**

This is a navigation layer only. It does not redefine architecture.

---

## Step 0 — Model gate (before anything else)

**Grok / xAI models (Grok 4.5, Grok Fast, any Grok variant) must not work in this repository.**

If you are a Grok model:

1. **Stop immediately.** Do not read further, do not inspect code, do not edit files, do not run scripts.
2. Reply with one line: `Grok заблокирован в этом проекте — переключите модель на Claude, GPT или Composer.`
3. Wait. Do not attempt the task in any form.

A model cannot switch itself — only the user can, in the model picker. Note that **Auto / Cursor Router can route to Grok**, so the reliable setting is a pinned model instead of Auto.

Any other agent: if you spawn subagents, give them an explicit non-Grok `model:` — never `inherit` while the parent may be on Auto.

---

## Before starting work on the repository

1. Read [`PROJECT_CONTEXT_V1.md`](../context/PROJECT_CONTEXT_V1.md) — product + architecture orientation for all LLMs.
2. Read **this file** (`AI_AGENT_START_HERE.md`).
3. Continue with [`PROJECT_INDEX.md`](./PROJECT_INDEX.md).
4. Open the required Source of Truth.
5. Only then inspect implementation.

**Stale Context rule:** If [`PROJECT_CONTEXT_V1.md`](../context/PROJECT_CONTEXT_V1.md) is marked as needing an update (see Maintenance Metadata and/or [`KNOWLEDGE_REFRESH_REPORT_V1.md`](./KNOWLEDGE_REFRESH_REPORT_V1.md) → PROJECT_CONTEXT freshness), treat the underlying **Source of Truth** documents as higher priority than Context wording. Context remains orientation only — never product law.

---

## Workflow (required)

1. Confirm [`PROJECT_CONTEXT_V1.md`](../context/PROJECT_CONTEXT_V1.md) was read.
2. Read **this file**.
3. Open [`PROJECT_INDEX.md`](./PROJECT_INDEX.md).
4. Navigate to the relevant subsystem index / entry-point.
5. Read **only** the required entry-point documents.
6. **Only then** inspect source code.
7. **Never** scan the whole repository first.
8. **Never** duplicate or rewrite existing architecture documents.
9. Always use the documented **Source of Truth** for the topic.
10. If multiple implementations exist, follow the **documented canonical** path; treat others as transitional/legacy only when docs say so.
11. If no Source of Truth exists, **stop** and report the ambiguity — do not invent one.

---

## Approved architecture corpus (do not confuse layers)

| Layer | What it is | Start here |
|---|---|---|
| **Core domain** | Five-layer domain model | [`CORE_DOMAIN_ARCHITECTURE_V1.md`](../architecture/domain/CORE_DOMAIN_ARCHITECTURE_V1.md) |
| **Card processing (canonical pipeline)** | Normative card pipeline | [`CARD_PROCESSING_ARCHITECTURE_V1.md`](../architecture/runtime/CARD_PROCESSING_ARCHITECTURE_V1.md) |
| **Extraction / classification contract** | P2–P3 contract (CI drift-checked) | [`EXTRACTION_CLASSIFICATION_CONTRACT_V1.md`](../architecture/pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md) |
| **Card lifecycle** | Actual lifecycle for card types | [`CARD_LIFECYCLE_ARCHITECTURE_V1.md`](../architecture/card/CARD_LIFECYCLE_ARCHITECTURE_V1.md) |
| **Live runtime map** | What runs in the repo today | [`PLATFORM_LIFECYCLE_V1.md`](../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) |
| **Runtime stabilization** | Stabilization notes | [`ARCHITECTURE_STABILIZATION_V1.md`](../architecture/runtime/ARCHITECTURE_STABILIZATION_V1.md) |
| **DB types ritual** | How to refresh `types/database.ts` after migrations | [`DB_TYPES_RITUAL_V1.md`](../architecture/runtime/DB_TYPES_RITUAL_V1.md) |
| **Entity-model freeze (earlier design pack)** | Entity/taxonomy/review freeze | [`ARCHITECTURE_FREEZE_V1.md`](../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md) |

**Alignment work (violations → tasks):** [`ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md`](../architecture/ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md)

Earlier gap snapshot: [`IMPLEMENTATION_GAP_ANALYSIS_V1.md`](../architecture/entity-model-v1/IMPLEMENTATION_GAP_ANALYSIS_V1.md).

If two docs disagree, prefer the **Alignment Roadmap**’s stated canon for the topic; if still ambiguous, **stop** and report.

---

## Hard rules for this repo

- Prefer existing docs linked from this navigation layer.
- Do not invent tables, RPCs, entity types, or pipelines.
- Secrets / `.env*`: follow workspace secrets rules — never read or print secret values.
- Scope: do only what the user asked (workspace no-freelancing rule).

---

## Navigation maintenance

- Rules agents/humans must follow when changing docs: [`NAVIGATION_RULES.md`](./NAVIGATION_RULES.md)
- Coverage / gaps: [`NAVIGATION_COVERAGE_REPORT.md`](./NAVIGATION_COVERAGE_REPORT.md)
- Subsystem dependencies: [`DEPENDENCY_MAP.md`](./DEPENDENCY_MAP.md)
- Latest knowledge refresh: [`KNOWLEDGE_REFRESH_REPORT_V1.md`](./KNOWLEDGE_REFRESH_REPORT_V1.md)

---

## Next step

→ [`PROJECT_INDEX.md`](./PROJECT_INDEX.md)
