# AI Agent — Start Here

**Mandatory first document for every AI agent working in this repository.**

This is a navigation layer only. It does not redefine architecture.

---

## Workflow (required)

1. Read **this file**.
2. Open [`PROJECT_INDEX.md`](./PROJECT_INDEX.md).
3. Navigate to the relevant subsystem index / entry-point.
4. Read **only** the required entry-point documents.
5. **Only then** inspect source code.
6. **Never** scan the whole repository first.
7. **Never** duplicate or rewrite existing architecture documents.
8. Always use the documented **Source of Truth** for the topic.
9. If multiple implementations exist, follow the **documented canonical** path; treat others as transitional/legacy only when docs say so.
10. If no Source of Truth exists, **stop** and report the ambiguity — do not invent one.

---

## Approved architecture corpus (do not confuse layers)

| Layer | What it is | Start here |
|---|---|---|
| **Core domain** | Five-layer domain model | [`CORE_DOMAIN_ARCHITECTURE_V1.md`](../architecture/domain/CORE_DOMAIN_ARCHITECTURE_V1.md) |
| **Card processing (canonical pipeline)** | Normative card pipeline | [`CARD_PROCESSING_ARCHITECTURE_V1.md`](../architecture/runtime/CARD_PROCESSING_ARCHITECTURE_V1.md) |
| **Card lifecycle** | Actual lifecycle for card types | [`CARD_LIFECYCLE_ARCHITECTURE_V1.md`](../architecture/card/CARD_LIFECYCLE_ARCHITECTURE_V1.md) |
| **Live runtime map** | What runs in the repo today | [`PLATFORM_LIFECYCLE_V1.md`](../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) |
| **Runtime stabilization** | Stabilization notes | [`ARCHITECTURE_STABILIZATION_V1.md`](../architecture/runtime/ARCHITECTURE_STABILIZATION_V1.md) |
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

---

## Next step

→ [`PROJECT_INDEX.md`](./PROJECT_INDEX.md)
