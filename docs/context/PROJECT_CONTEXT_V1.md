# PROJECT CONTEXT V1

**Audience:** any LLM (ChatGPT, Claude, Gemini, Cursor) before work on this repository.  
**Role:** product + architecture orientation. **Not** a Source of Truth. **Does not** redefine architecture.  
**After this file:** [`AI_AGENT_START_HERE.md`](../navigation/AI_AGENT_START_HERE.md) → [`PROJECT_INDEX.md`](../navigation/PROJECT_INDEX.md) → subsystem SoT → code.

Every claim below is aggregated from existing project docs. Where Vision / North Star lack a single dedicated SoT, wording is marked **derived**.

---

## 1. Project Overview

**КРУГИ** is a community platform for Russian-speaking people: a trusted local directory and classifieds surface (hubs / regions), not a generic global marketplace.

It ingests messy community content (Telegram, Facebook, directories, seeds), turns it into typed **cards**, runs them through **human review**, then publishes into a public catalog that people can search, claim, review, and recommend.

**Who it is for**

- Residents discovering businesses, specialists, jobs, and local offers in their hub.
- Owners / professionals who later **claim** imported cards and manage them.
- Moderators / admins who operate import review, claims, catalog, and quality.

**Problems it solves**

- Community ads and recommendations are scattered across chats and pages.
- Raw posts are noisy, duplicated, mis-typed, and unsafe to publish blindly.
- Imported data must stay public and useful **before** an owner exists.
- Catalog trust requires separation of provenance, ownership, and reputation.

**Main value**

A curated, entity-first catalog where **quality and human judgment gate publish**, AI assists extraction/classification/enrichment/search, and ownership is honest (imported ≠ owned).

---

## 2. Product Vision

**Derived** from Core Domain, Platform IA V2, Freeze hub decisions, and live Lifecycle — not a separate Vision.md.

КРУГИ becomes the default place to find and recommend Russian-speaking **organizations** (Business) and **named specialists** (Professional), plus adjacent hubs for marketplace, jobs, and real estate as those entities mature. Community seeking and recommendations are first-class behaviors, but not every Telegram intent becomes a card entity.

Target public hubs (Freeze C9 / IA): **Бизнесы · Специалисты · Купи-продай · Работа · Недвижимость**. Events, Lechu, Transfers, and similar surfaces are later or transitional — not MVP freeze equals.

The same human account can act as Customer (demand), Business manager, and Professional owner without splitting identity into parallel “customer” tables.

---

## 3. North Star

**Derived** long-term goal:

> Build a trustworthy, hub-local Russian-speaking discovery platform where every public card has clear type, provenance, and publish readiness — and where ownership, reputation, and search grow on that foundation without inventing a second architecture.

Operational translation (from Alignment Roadmap + Card Processing): make the **approved canon executable** (deterministic pipeline, gates, registry, truthful ownership), then expand Relations / AI quality / remaining entity workstreams without rewriting the five-layer domain model or inventing parallel birth paths.

---

## 4. Core Principles

Real principles reflected across Freeze, Core Domain, Card Processing, Ownership, Quality, and Navigation:

| Principle | Meaning in this repo |
|---|---|
| **Entity First** | Domain cards (Business, Professional, listings, jobs, …) are the product unit — not chat threads or free-form posts. |
| **Human Review** | Publish custody ends with a human (or tightly gated autopublish). AI does not silently invent public catalog rows. |
| **Quality First** | Publish gate ≠ richness score ≠ search sort. Wrong contact is worse than empty contact. |
| **AI Assisted** | Collectors, classifiers, enrichment, and search intent help operators and users; they stay server-side and contract-bound. |
| **Source of Truth** | One writable SoT per concept; registries, ratings, search results are mirrors / projections / caches. |
| **Runtime Driven** | For “what runs today,” prefer Platform Lifecycle + code over design freeze when they diverge — then close gaps via Alignment Roadmap. |
| **Ownership ≠ Source ≠ Import** | Three independent facts; never collapse importer/admin into owner. |
| **Design vs Runtime honesty** | Freeze/Core Domain = intent; Lifecycle/Card Lifecycle = live; Roadmap = violations → tasks. |
| **Navigation never invents architecture** | Docs under `docs/navigation/` point; they do not redesign. |

Five domain layers (Alignment / Core Domain framing): **Identity → Objects → Relations → Facts → Projections**. Features must respect layer boundaries (e.g. reputation is a projection of reviews, not an import field).

---

## 5. High-Level Architecture

Canonical card pipeline (normative order — Card Processing Architecture):

```text
Collectors (P0)
    ↓
Ingest → queue (P1)
    ↓
Extract (P2) → Classify (P3) → Dedupe (P4)
    ↓
Review (P5)
    ├── P5A Auto Enrichment (queue)
    ├── P5B AI Enrichment (queue)
    ├── P5C Completeness + Quality (queue)
    └── P5D Moderator Review (human)
    ↓
Publish (P6) ── gates G1 / G2 / G3
    ↓
Post-Enrich on entity (P7)
    ↓
Live / Retire (P8)
    ↓
Public site · Search · Recommendations · Claims
```

Supporting platform surfaces (Lifecycle): Admin (review / imports / catalog / claims / community), Auth + profiles, Domain events outbox + consumer, Enrichment CLIs, CI drift checks on extraction/classification contract.

**Important live notes**

- Auto launch of P5A–C is **OFF** (CLI dry-run / capped apply only).
- Search is **live SQL** (+ AI search-intent route) — no separate search index pipeline.
- Admin Panel IA V2 is the **target** admin information architecture; legacy routes may still exist during soft migration.

---

## 6. Domain Model

Core identity triangle (Core Domain):

| Concept | What it is | Card? |
|---|---|---|
| **Business** | Organization / venue / brand the community visits or hires | Yes |
| **Professional** | One named person selling skill/time under their own name | Yes |
| **Customer** | User role on `auth.users` + `profiles` (demand side) | **No** — never a separate `customers` table |

Disambiguation: if the card would survive the person leaving → Business; else → Professional. Never both as one identity.

Entity maturity (design vs live — see Entities Index + Freeze + audits; counts in IA snapshots age quickly):

| Entity | Design | Live storage / publish | Notes |
|---|---|---|---|
| Business | Frozen + mature | Live catalog; primary published directory | Claims + multi-manager ACL |
| Professional | Frozen | Live table + publish path; claim “это я” still GAP | Largest pipeline mass historically |
| Marketplace | Frozen hub «Купи-продай» | `listings` + marketplace details | |
| Job | Frozen | `jobs` table (canonical; not dual-registered as listing jobs) | |
| Real Estate | Designed; Phase 3 workstream | Publish frozen mid-flight for wrong-kind history | Agency→Business; agent→Professional; unit→RE listing |
| Event | Lifecycle / mapping; no dedicated ENTITY_*.md | `events` live path | Post-MVP freeze stance for taxonomy trees |
| Vehicle | Enum / page advertised | Storage disputed / incomplete | Product decision required (Roadmap C3) |
| Transfer / Lechu | “Later” in Freeze | Listing subtypes + detail tables | Design incomplete; not MVP hubs |

Hub rule (Freeze): no taxonomy tree without a domain entity for MVP; Events/Lechu/Transfers = later.

---

## 7. Ownership Model

Canonical law (`OWNERSHIP_SOURCE_CLAIM` + Freeze C13):

| Concept | Answers | Changes on claim? |
|---|---|---|
| **Ownership** | Who controls the record inside the platform now? | Yes (NULL → owner / managers) |
| **Source** | Where did the data originally come from? | **Never** |
| **Import** | Who/what ran the import pipeline? | No (historical) |
| **Claim** | Process that turns a reader into an owner | Process history ≠ current ownership SoT |
| **Admin** | Operator / reviewer | Must **not** become owner of imported cards |

Rules agents must not violate:

- Imported cards are **unowned until claimed** (`owner_profile_id` NULL where applicable).
- Do not treat importer, admin, `created_by`, or `source_*` as ownership.
- Business management after claim uses `business_owners` (access); provenance stays immutable.
- Professional ownership is singular (`owner_profile_id`); business claim machinery is the template for the missing professional claim flow.
- Ownership grants editing; it does **not** rewrite provenance or reviews.

Live today: full claim machinery for **Business**; professional / listings / events claim paths incomplete or different (see Lifecycle § Ownership + Alignment Stage D).

---

## 8. Runtime Pipeline

Lifecycle of a card (compressed from Card Processing + Platform Lifecycle):

1. **Collect** — Telegram / Facebook / directory scrapers / seeds produce batch artifacts.
2. **Ingest** — rows enter `import_review_items` (`pending`) with unique `source_fingerprint`.
3. **Extract** — fill-empty contacts/media/geo from the row’s own material (queue SoT).
4. **Classify** — set `entity_type` + `target_collection` together, or park with `[needs_manual_type]`. **Never default NULL → business.**
5. **Dedupe** — cluster reposts; satellites → `duplicate`.
6. **Review** — optional queue enrich (P5A–C), then human decision (approve / reject / needs info / duplicate / ready_to_publish).
7. **Publish** — G3 `import_review_publish_gate_errors()`; entity row becomes SoT; queue row freezes as provenance.
8. **Post-enrich** — entity-only fill-empty (Places, geocode, ratings, summaries, …) under Enrichment Rules tiers.
9. **Live** — owner/admin edits, reviews projection, merge/archive; retirement is manual.

Forbidden examples: publish untyped cards; enrich writing the wrong custody layer (P7→queue or P2→entity); mutating approved queue rows; inventing parallel birth paths that bypass the queue when the roadmap says one path.

---

## 9. Design vs Runtime

| Layer | Documents | Use for |
|---|---|---|
| **Design / Freeze** | `ARCHITECTURE_FREEZE_V1`, entity docs, Taxonomy, Access/ACL, Review Workflow V1 names | Intent, resolved contradictions, target hubs |
| **Normative pipeline** | `CARD_PROCESSING_ARCHITECTURE_V1`, Extraction/Classification Contract | Allowed order, gates, contracts (CI-pinned pieces) |
| **Core domain** | `CORE_DOMAIN_ARCHITECTURE_V1` | Business / Professional / Customer decisions + GAPs |
| **Live runtime** | `PLATFORM_LIFECYCLE_V1`, `CARD_LIFECYCLE_ARCHITECTURE_V1`, Stabilization | What code/DB actually do today |
| **Alignment** | `ARCHITECTURE_ALIGNMENT_ROADMAP_V1` | Named violations → tasks; prefer its stated canon when docs conflict |
| **Audits** | `docs/audits/*` | Supporting facts / measurements — **not** product law unless Freeze says so |
| **Navigation** | `docs/navigation/*` | Pointers only |

If Freeze and Lifecycle disagree: do not “fix” production to match freeze in one leap — follow the Roadmap task and the documented SoT for the task type (design vs live). If still ambiguous: **stop and report**.

Known class of tensions (documented, not invented here): review workflow names (13-state intent vs 7-state live aliases); status vocabularies across tables; Admin IA V2 target vs transitional `/admin/import-review`; RE freeze; Vehicle advertising without storage; historical admin-as-owner (addressed in Stage D for listings/jobs — verify before assuming all entity kinds are clean).

---

## 10. Data Quality

Quality is **layered** (Card Quality Architecture Context) — do not collapse into one score:

| Layer | Role |
|---|---|
| **Publish gate (G3)** | Narrow pass/fail minimum for going live (`QUALITY_CARD_RULES` via `import_review_publish_gate_errors`) |
| **Queue triage scores** | Contact priority + small queue completeness for moderator sorting |
| **Enrichment** | Fill-empty-only; junk-host denylists; tiers A/B/C; no LLM-invented contacts |
| **Entity completeness_score** | Catalog fill KPI (CLI refresh; not the publish gate) |
| **Search completeness** | Separate in-memory sort helper for discovery UX |
| **Duplicate detection** | Queue clustering + publish-time duplicate confirmation |
| **Pre-publish enrich (P5A–C)** | Make review decisions on fuller queue rows; auto OFF |

Reputation is a **projection of reviews**, not enrichment output. External ratings stay source-labeled and must not blend into platform rating.

Mass AI enrichment is frozen until per-field provenance (Roadmap F1).

---

## 11. Search

**Current concept (Lifecycle + Search entry-point):**

- Catalog discovery via SQL queries over live entity tables / helpers (`app/search`, `lib/supabase/queries`, listings queries).
- AI **search intent** endpoint (`/api/search/ai`) via server-only OpenRouter allowlist, with guards and rate limits — clients never receive raw keys or arbitrary model choice.
- Spellcheck / synonyms helpers exist in `lib/search/`.
- Completeness can demote thin business cards in ranking UX.

**Explicitly not implemented / deferred**

- Dedicated search index / reindex pipeline (Roadmap: do **not** build next year unless measured pain).
- `search_logs` table (older mentions; Lifecycle notes absence).

Treat “add Elasticsearch / full reindex platform” as out of line with current canon unless product revisits the Roadmap exception.

---

## 12. AI Architecture

Existing AI-related components (from AI Index + Lifecycle — do not invent missing ones):

| Component | Exists? | Notes |
|---|---|---|
| Collector LLM / analyzers (Telegram, Facebook) | Yes | Classification / decision assist on inbound posts |
| Queue classification (`classify_null_queue`, category maps) | Yes | Rule/regex tree + human; contract CI-checked |
| Extraction / queue enrichment | Yes | Contacts, media hydrate, fill-empty |
| Entity enrichment toolbox | Yes | `business-enrich`, media pipeline; provenance still incomplete |
| Duplicate / cluster tooling | Yes | Queue dedupe scripts + publish checks |
| Quality / completeness scoring | Yes | Scripts + gate rules; not a single “AI judge” product |
| Recommendations classification / admin panels | Yes | Mention/recommendation flows; birth-path alignment still a Roadmap item |
| Search Assistant (intent) | Yes | Server route + allowlist |
| Unified prompt registry | **No** | Prompts live inside calling modules |
| Graph DB / generic EAV AI memory | **No** — explicitly undesired near-term |

Human Import Review is **not** an LLM stage (P5D).

---

## 13. Navigation

Required reading order for any agent:

```text
PROJECT_CONTEXT_V1.md          ← product + orientation (this file)
        ↓
AI_AGENT_START_HERE.md         ← mandatory workflow + approved corpus
        ↓
PROJECT_INDEX.md               ← compact TOC (“where do I go?”)
        ↓
Subsystem index / entry-point  ← runtime/, entities/, ai/, admin/, …
        ↓
Source of Truth document       ← Freeze / Lifecycle / Card Processing / …
        ↓
Implementation                 ← app/, lib/, scripts/, supabase/
```

Rules: never scan the whole repo first; never rewrite SoT docs as a side effect of exploration; prefer documented canonical paths over legacy twins.

Maintenance: [`NAVIGATION_RULES.md`](../navigation/NAVIGATION_RULES.md), coverage report, dependency map, knowledge refresh report.

---

## 14. Current Project Status

Statuses below are **derived** from Alignment Roadmap stage notes (2026-07-27), Knowledge Refresh, Project Index, and Lifecycle gaps — not a new audit.

| Area | Status | Basis |
|---|---|---|
| Core domain model (design) | ✅ Complete | Core Domain + Freeze |
| Entity model freeze (MVP hubs) | ✅ Complete | Freeze pack |
| Navigation layer | ✅ Complete | Start Here / Index / entry-points |
| Card processing canon (docs + G3) | ✅ Complete | Card Processing; Stage A done |
| Extraction/classification contract + CI | ✅ Complete | Stage A4–A5 |
| Entities registry (address space) | ✅ Complete | Stage C1 done |
| Ownership design | ✅ Complete | Ownership / ACL docs |
| Ownership runtime (business claim) | 🟡 Partial | Business live; professional claim GAP |
| Admin-as-owner cleanup (listings/jobs) | ✅ Done (D1–D2) | Stage D; verify other kinds before assuming |
| Runtime pipeline execution | 🟡 Partial | Manual stages; P5A–C auto OFF; more facts/events remain |
| Domain events consumer | 🟡 Partial | B2 done; B3–B5 remain |
| Data quality / gates | ✅ Gate complete | Enrichment provenance / F-stage open |
| Search | 🟡 Partial | Live SQL + AI intent; no index |
| AI architecture | 🟡 Partial | Collectors/enrich/search exist; provenance unlocks mass enrich |
| Admin Panel IA V2 | 🟡 In progress | Target SoT + soft migration / audits |
| Real Estate workstream | 🟡 Frozen mid-flight | Stage C5 pending |
| Vehicle | 🟡 Decision pending | Stage C3 |
| Deployment docs | 🟡 Partial / Unknown | App+Supabase+CI exist; no dedicated runbook |
| Alignment Stage A | ✅ Done | Roadmap |
| Alignment Stages E–F | ⚪ Not started | Relations + AI/data-quality cleanup |

---

## 15. Roadmap Summary

Source: [`ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md`](../architecture/ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md). Architecture is considered **approved**; the roadmap lists **violations → tasks**, not a new design.

**Completed (high level)**

- Stage **A** foundation (gates, tag registry, orchestrator, extraction contract, CI, types ritual, nav sync).
- Stage **B** early runtime (scheduled maintenance, first domain-events consumer).
- Stage **C1** full entities registry sync/backfill.
- Stage **D1–D2** stop admin-as-owner for imported listings/jobs + backfill convention **unowned-until-claimed**.

**In progress / remaining inside open stages**

- B3–B5 (card-health report, more facts, enrichment.completed events).
- C2–C5 (status-helper adoption, Vehicle decision, recommendations birth channel, Real Estate Phase 3).
- D3–D5 (professional claim, ownership transfer/revoke, account teardown).
- Stages **E** (ownership representation / affiliation) and **F** (provenance, blurb decontamination, professional reviews wiring).

**Next large themes (when pulled by product)**

1. Keep agent-safety canon executable (do not regress Stage A).
2. Finish runtime breathing (events + enrichment observability).
3. Identity completion (professional claim, transfer/revoke).
4. Relations (affiliation) when social/link features arrive.
5. Provenance before mass AI enrichment; RE Phase 3 when product prioritizes it.

**Explicitly not near-term** (Roadmap Part III): status enum renames; event-bus frameworks; graph DB / EAV; `customers` table; un-merge tooling; search index pipeline; fabricated historical provenance backfill.

---

## 16. Canonical Source of Truth

Primary documents (≤20). Navigate here after Context + Start Here + Index.

| Document | Purpose | When to open |
|---|---|---|
| [`AI_AGENT_START_HERE.md`](../navigation/AI_AGENT_START_HERE.md) | Mandatory agent workflow | Every coding session after this Context |
| [`PROJECT_INDEX.md`](../navigation/PROJECT_INDEX.md) | Compact TOC | Finding the right subsystem |
| [`CORE_DOMAIN_ARCHITECTURE_V1.md`](../architecture/domain/CORE_DOMAIN_ARCHITECTURE_V1.md) | Business / Professional / Customer law | Identity, reviews, reputation, GAPs |
| [`ARCHITECTURE_FREEZE_V1.md`](../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md) | Design resolution layer | Entity/taxonomy/ACL contradictions |
| [`CARD_PROCESSING_ARCHITECTURE_V1.md`](../architecture/runtime/CARD_PROCESSING_ARCHITECTURE_V1.md) | Normative P0–P8 pipeline | Any import/review/publish/enrich order question |
| [`PLATFORM_LIFECYCLE_V1.md`](../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) | Live runtime map | “What actually runs today?” |
| [`CARD_LIFECYCLE_ARCHITECTURE_V1.md`](../architecture/card/CARD_LIFECYCLE_ARCHITECTURE_V1.md) | Per-type lifecycle + GAPs | Entity-specific birth/status paths |
| [`EXTRACTION_CLASSIFICATION_CONTRACT_V1.md`](../architecture/pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md) | P2–P3 contract (CI) | Classifier/extract field formats |
| [`OWNERSHIP_SOURCE_CLAIM.md`](../architecture/entity-model-v1/OWNERSHIP_SOURCE_CLAIM.md) | Ownership / source / claim | Claims, import publish ownership |
| [`ACCESS_MODEL_V1.md`](../architecture/entity-model-v1/ACCESS_MODEL_V1.md) / [`ENTITY_ACL_V1.md`](../architecture/entity-model-v1/ENTITY_ACL_V1.md) | Access / ACL Variant A | Permissions design |
| [`ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md`](../architecture/ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md) | Violations → staged tasks | Prioritization; conflict resolution hint |
| [`QUALITY_CARD_RULES_V1.md`](../audits/QUALITY_CARD_RULES_V1.md) | Publish minimums | Gate / publish eligibility |
| [`CARD_QUALITY_ARCHITECTURE_CONTEXT_V1.md`](../architecture/CARD_QUALITY_ARCHITECTURE_CONTEXT_V1.md) | Why quality layers differ | Completeness vs gate vs search |
| [`ADMIN_PANEL_IA_V2.md`](../architecture/ADMIN_PANEL_IA_V2.md) | Target admin IA | Admin navigation / review workspace direction |
| [`PLATFORM_INFORMATION_ARCHITECTURE_V2.md`](../architecture/entity-model-v1/PLATFORM_INFORMATION_ARCHITECTURE_V2.md) | Product hubs / taxonomy intent | Public IA / hub questions |
| [`NAVIGATION_RULES.md`](../navigation/NAVIGATION_RULES.md) | How to maintain nav | Doc/link hygiene |

Supporting: Enrichment Rules / audits, Entities Index, pipeline index, Knowledge Refresh Report.  
**Not** live schema SoT: `docs/database-schema.md` (historical proposal).

---

## 17. AI Working Rules

1. Read **this** `PROJECT_CONTEXT_V1` first.
2. Read [`AI_AGENT_START_HERE.md`](../navigation/AI_AGENT_START_HERE.md), then [`PROJECT_INDEX.md`](../navigation/PROJECT_INDEX.md).
3. Open only the **Source of Truth** for the subsystem you touch.
4. Inspect implementation **after** SoT — never repo-wide fishing first.
5. Do not treat outdated code paths, transitional admin routes, or audits as product law.
6. Distinguish **Design** (Freeze / Core Domain) from **Runtime** (Lifecycle / code).
7. Prefer Alignment Roadmap’s stated canon when documents conflict; if still unclear — **stop and report**.
8. Do not invent tables, RPCs, entity types, pipelines, or customer reputation systems.
9. Do only what the user asked (workspace no-freelancing rule).
10. Never read or print secrets (`.env*`, keys, sessions).
11. LLM calls stay server-only on allowlisted models; no client-supplied model IDs/prompts/keys.
12. Before proposing “next architecture,” check Anti Goals and Roadmap Part III.

---

## 18. Anti Goals

Do **not** propose or implement (unless the user explicitly overrides with a new SoT version):

1. A second architecture that bypasses Card Processing order or invents a parallel birth path for catalog cards.
2. Collapsing Source / Ownership / Import / Admin into one field or treating admin as owner of imports.
3. A `customers` table or public customer reputation score.
4. Graph database / generic EAV “entity store” replacing typed tables + registry.
5. Status enum renames “for cleanliness” (use helpers; Roadmap forbids churn).
6. Heavy event-bus / job-queue frameworks before outbox+consumer is proven insufficient.
7. Search index / reindex platform without measured pain and Roadmap revisit.
8. Mass AI enrichment without per-field provenance (F1 freeze).
9. LLM-invented phones/contacts/hours presented as facts.
10. Publishing untyped cards or defaulting NULL types to `business`.
11. Dual mobile/desktop page trees or hover-only primary actions (product UI rules).
12. Rewriting Freeze / Core Domain / Lifecycle in place of linking them; treating this Context as a SoT.
13. Un-merge tooling, fabricated historical provenance, or national flags in UI.
14. Promoting Vehicle / Transfer / Lechu / Events as MVP-equal finished entities without reading Freeze + audits + Roadmap.
15. Scope freelancing: restyles, “while we’re here” refactors, or unsolicited migrations.

---

## 19. Sources Used

Documents consulted to assemble this Context (aggregation only):

- `docs/navigation/AI_AGENT_START_HERE.md`
- `docs/navigation/PROJECT_INDEX.md`
- `docs/navigation/NAVIGATION_RULES.md`
- `docs/navigation/NAVIGATION_COVERAGE_REPORT.md`
- `docs/navigation/KNOWLEDGE_REFRESH_REPORT_V1.md`
- `docs/navigation/DEPENDENCY_MAP.md` (orientation)
- `docs/navigation/entities/INDEX.md`
- `docs/navigation/ai/INDEX.md`
- `docs/navigation/runtime/OWNERSHIP.md`
- `docs/navigation/runtime/SEARCH.md`
- `docs/architecture/domain/CORE_DOMAIN_ARCHITECTURE_V1.md`
- `docs/architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md`
- `docs/architecture/entity-model-v1/OWNERSHIP_SOURCE_CLAIM.md`
- `docs/architecture/entity-model-v1/PLATFORM_INFORMATION_ARCHITECTURE_V1.md` (hub / community intent)
- `docs/architecture/entity-model-v1/PLATFORM_INFORMATION_ARCHITECTURE_V2.md`
- `docs/architecture/runtime/CARD_PROCESSING_ARCHITECTURE_V1.md`
- `docs/architecture/runtime/PLATFORM_LIFECYCLE_V1.md`
- `docs/architecture/card/CARD_LIFECYCLE_ARCHITECTURE_V1.md` (via Start Here / Index references)
- `docs/architecture/ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md`
- `docs/architecture/CARD_QUALITY_ARCHITECTURE_CONTEXT_V1.md`
- `docs/architecture/ADMIN_PANEL_IA_V2.md` (via Index)
- `docs/audits/QUALITY_CARD_RULES_V1.md` (via quality context / lifecycle)
- Pipeline / enrichment / professional cleanup audits — supporting confirmation of current operational themes only

---

## 20. Maintenance Metadata

**Role of this file:** derived LLM orientation. **Not** a Source of Truth. When stale, prefer Freeze / Lifecycle / Core Domain / Card Processing / Alignment Roadmap over any wording here.

| Field | Value |
|---|---|
| **Last Reviewed** | 2026-07-28 |
| **Context update required** | No (as of Last Reviewed; see Knowledge Refresh) |
| **Based On** | [`CORE_DOMAIN_ARCHITECTURE_V1.md`](../architecture/domain/CORE_DOMAIN_ARCHITECTURE_V1.md) · [`ARCHITECTURE_FREEZE_V1.md`](../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md) · [`CARD_PROCESSING_ARCHITECTURE_V1.md`](../architecture/runtime/CARD_PROCESSING_ARCHITECTURE_V1.md) · [`PLATFORM_LIFECYCLE_V1.md`](../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) · [`CARD_LIFECYCLE_ARCHITECTURE_V1.md`](../architecture/card/CARD_LIFECYCLE_ARCHITECTURE_V1.md) · [`OWNERSHIP_SOURCE_CLAIM.md`](../architecture/entity-model-v1/OWNERSHIP_SOURCE_CLAIM.md) · [`PLATFORM_INFORMATION_ARCHITECTURE_V2.md`](../architecture/entity-model-v1/PLATFORM_INFORMATION_ARCHITECTURE_V2.md) |
| **Alignment Reference** | [`ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md`](../architecture/ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md) — Stage A done; B1–B2 / C1 / D1–D2 done; remaining B3–B5, C2–C5, D3–D5, E, F |
| **Knowledge Refresh Reference** | [`KNOWLEDGE_REFRESH_REPORT_V1.md`](../navigation/KNOWLEDGE_REFRESH_REPORT_V1.md) (report date **2026-07-27**; Context freshness follow-up **2026-07-28**) |
| **Navigation Coverage Reference** | [`NAVIGATION_COVERAGE_REPORT.md`](../navigation/NAVIGATION_COVERAGE_REPORT.md) § PROJECT_CONTEXT chain |
| **Maintenance rule** | [`NAVIGATION_RULES.md`](../navigation/NAVIGATION_RULES.md) → PROJECT_CONTEXT maintenance |
| **Maintenance Notes** | Created 2026-07-28 as aggregated Context. Content refresh not required on that date relative to listed SoT anchors. Future SoT edits must re-run the Knowledge Refresh Context checklist — do not auto-rewrite this file. |

---

*End of PROJECT_CONTEXT_V1. This file aggregates existing project documentation. It introduces no new architecture.*
