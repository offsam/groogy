# Knowledge Refresh Report V1

**Date:** 2026-07-27 (baseline) · **Context maintenance follow-up:** 2026-07-28 · **Section routing:** 2026-07-29 · **USA location canon:** 2026-07-30  
**Scope:** Documentation synchronization only (navigation / knowledge layer)  
**Start:** [`PROJECT_CONTEXT_V1.md`](../context/PROJECT_CONTEXT_V1.md) → [`AI_AGENT_START_HERE.md`](./AI_AGENT_START_HERE.md) → full linked graph vs repo

---

## Summary

| Check | Result |
|---|---|
| Broken navigation links (after sync) | **0** |
| Content docs under `docs/` reachable from Start/Index | **all** (architecture + audits + migration report + schema proposal) |
| Architecture / runtime / SQL / API behavior changed | **Yes** (2026-07-30 — USA location canon; see below) |
| PROJECT_CONTEXT present in agent chain | **Yes** (as of 2026-07-28) |
| PROJECT_CONTEXT update required (2026-07-28 pass) | **No** — see § PROJECT_CONTEXT freshness |
| PROJECT_CONTEXT update required (2026-07-29 section routing) | **Review next pass** — new SoT [`ENTITY_SECTION_ROUTING_V1.md`](../architecture/pipeline/ENTITY_SECTION_ROUTING_V1.md); Context not auto-rewritten |
| PROJECT_CONTEXT update required (2026-07-30 location canon) | **Review next pass** — new SoT [`USA_LOCATION_CANON_V1.md`](../architecture/runtime/USA_LOCATION_CANON_V1.md); Context not auto-rewritten |

---

## 2026-07-30 — USA Location Canon

| Path | Change |
|---|---|
| [`USA_LOCATION_CANON_V1.md`](../architecture/runtime/USA_LOCATION_CANON_V1.md) | **New** SoT: county_geoid ladder, publish gate, place tokens, group catalog |
| [`runtime/INDEX.md`](./runtime/INDEX.md) | Canon pointer to location SoT |
| [`PROJECT_INDEX.md`](./PROJECT_INDEX.md) | Link to location SoT |

Code companions: `lib/geo/resolve-entity-location.ts`, `data/geo/source_location_groups.json`, migration `20260730120000_usa_location_canon.sql`.

---

## 2026-07-29 — Entity section routing

| Path | Change |
|---|---|
| [`ENTITY_SECTION_ROUTING_V1.md`](../architecture/pipeline/ENTITY_SECTION_ROUTING_V1.md) | **New** SoT: P3 router + publish pair gate + live move + redirects |
| [`pipeline/INDEX.md`](./pipeline/INDEX.md) | Linked new SoT |
| [`runtime/INDEX.md`](./runtime/INDEX.md) | Canon pointer to section routing |
| [`entities/INDEX.md`](./entities/INDEX.md) | Link to section routing |
| [`admin/INDEX.md`](./admin/INDEX.md) | Wrong-section Review Center page |

Code SoT companions: `scripts/import-review/entity_routing.py`, `lib/import-review/entity-routing.ts`, `lib/admin/move-entity-section.ts`, migration `20260729180000_entity_section_routing_and_moves.sql`.

---

## Documents updated (navigation only)

| Path | Change |
|---|---|
| [`AI_AGENT_START_HERE.md`](./AI_AGENT_START_HERE.md) | Added Extraction contract + DB types ritual to approved corpus table |
| [`PROJECT_INDEX.md`](./PROJECT_INDEX.md) | Pipeline index, domain events, DB ritual first-hop, CI, seed/master-data/jobs/entity-model/runtime scripts, alignment under Architecture Decisions |
| [`runtime/INDEX.md`](./runtime/INDEX.md) | Rebuilt canon pointer block; added Domain Events row + CI |
| [`runtime/DOMAIN_EVENTS.md`](./runtime/DOMAIN_EVENTS.md) | **New** entry-point for `scripts/runtime/` |
| [`runtime/IMPORT.md`](./runtime/IMPORT.md) | Linked extraction contract + pipeline index |
| [`pipeline/INDEX.md`](./pipeline/INDEX.md) | **New** pipeline navigation index |
| [`database/INDEX.md`](./database/INDEX.md) | Related links: ritual, domain events, CI |
| [`ai/INDEX.md`](./ai/INDEX.md) | Card processing, extraction contract, CI drift tests |
| [`DEPENDENCY_MAP.md`](./DEPENDENCY_MAP.md) | Domain Events dependency node |
| This report | Added |

---

## Broken links fixed

- Pre-sync: **0** broken markdown link targets in `docs/navigation/`.
- No obsolete href removals required.
- Prior session gap: `runtime/INDEX.md` had **not** received the canon pointer update (write failed earlier) — **fixed** in this refresh.

---

## Documentation gaps found (reported, not invented)

| Gap | Notes |
|---|---|
| No `ADR*.md` | Still true; roadmap + freeze + core domain stand in |
| No deployment runbook | Still Unknown under Deployment |
| No dedicated `docs/security.md` | Pointers to `lib/security/*` + ACL docs only |
| No Transfer/Lechu/Event entity freeze docs | Still via LISTINGS / lifecycle / mapping “later” |
| Vehicle storage vs page | Still called out in entities index / audits |
| `docs/audits/FABLE_RUN_LOG.txt` | Run artifact, not architecture; not indexed as SoT |
| `scripts/runtime/data/*` | Local consumer artifact; not SoT |
| QUALITY_CARD_RULES backtick paths | Relative names without folders (e.g. `` `PLATFORM_DATA_AUDIT_V1.md` ``) — doc hygiene outside nav; files exist under `docs/audits/` |
| Code areas with thin/no dedicated architecture doc | `scripts/business-seed/`, `scripts/jobs/`, `scripts/entity-model/`, `scripts/master-data/` — now **reachable via Integrations**; SoT remains their `SOURCE.md` / scripts themselves |
| Server Actions vs REST | API index already notes most mutations are Server Actions under `lib/**/actions.ts` |

---

## Code vs documentation (implementation presence)

Verified present and now linked from navigation where missing before:

| Area | Evidence |
|---|---|
| CI | `.github/workflows/ci.yml` |
| Extraction contract + tests | `docs/architecture/pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md`, `test_extraction_contract.py`, `test_review_tags.py` |
| DB types ritual | `docs/architecture/runtime/DB_TYPES_RITUAL_V1.md` |
| Domain events consumer | `scripts/runtime/consume_domain_events.py` |
| Stabilization / registry migrations | `supabase/migrations/*architecture_stabilization*`, `*full_entity_registry*` (linked via SoT docs, not duplicated) |
| Admin pages / API routes | Match existing `admin/INDEX.md` and `api/INDEX.md` listings |

---

## Recommended new entry points

| Recommendation | Status |
|---|---|
| `runtime/DOMAIN_EVENTS.md` | **Added** |
| `pipeline/INDEX.md` | **Added** |
| Optional later: `CI.md` under navigation | Not added — CI linked from Project Index + runtime/ai/database; create only if CI surface grows |
| Optional later: `SEEDING.md` for business-seed/master-data | Not added — Integrations section + `SOURCE.md` sufficient for now |

---

Do **not** treat `docs/database-schema.md` as live schema.

---

## PROJECT_CONTEXT freshness (required every Knowledge Refresh)

[`PROJECT_CONTEXT_V1.md`](../context/PROJECT_CONTEXT_V1.md) is a **derived** orientation document. Knowledge Refresh must check it; it must **not** auto-rewrite it.

### Checklist (fill every refresh)

| Question | How to answer |
|---|---|
| Did any Source of Truth change since Context **Last Reviewed**? | Compare SoT paths listed in Context § Maintenance Metadata / Sources Used (Freeze, Lifecycle, Core Domain, Card Processing, Extraction contract, Alignment Roadmap, Ownership, IA, …) |
| Do those changes affect Context wording? | Map to Context sections (Overview, Domain, Ownership, Pipeline, Status, Roadmap, Anti Goals, …) |
| Is a Context update required? | **Yes / No / Partial** — record only; do not rewrite Context unless explicitly tasked |
| Which Context sections to review? | List section names, or `none` |

### Follow-up 2026-07-28 — first Context freshness pass

| Field | Result |
|---|---|
| Context file | [`PROJECT_CONTEXT_V1.md`](../context/PROJECT_CONTEXT_V1.md) — present |
| Context Last Reviewed | **2026-07-28** (Maintenance Metadata) |
| SoT changed since Last Reviewed? | **No** for this pass (Context created/reviewed same day after prior SoT anchors; Card Processing mtime 2026-07-28 precedes Context review) |
| Changes affect Context? | **N/A** (no SoT drift after Last Reviewed) |
| **Context update required?** | **No** |
| Sections to review | `none` |
| Action taken | Maintenance Metadata + Knowledge/Navigation hooks added; Context body not rewritten for architecture |
| Stale-Context agent rule | Documented in [`AI_AGENT_START_HERE.md`](./AI_AGENT_START_HERE.md) |

**Procedure for future refreshes:** update this subsection (or append a dated follow-up). If **Context update required = Yes**, leave a clear Yes + section list; open a separate explicit task to edit Context — never silent auto-sync.

---

## Reachability note for agents (updated)

Canonical start:

1. [`PROJECT_CONTEXT_V1.md`](../context/PROJECT_CONTEXT_V1.md)
2. [`AI_AGENT_START_HERE.md`](./AI_AGENT_START_HERE.md)
3. [`PROJECT_INDEX.md`](./PROJECT_INDEX.md)
4. Subsystem SoT → implementation

From that chain you can reach:

1. All approved canon docs (domain, card pipeline, extraction, lifecycle, live map, stabilization, freeze, alignment roadmap).
2. All entity-model-v1 docs (via freeze/index graph).
3. All `docs/audits/*.md`.
4. Collectors, import-review, enrich, media, runtime consumer, seed/master-data/jobs/entity-model scripts.
5. Admin pages, API routes, CI, types ritual.

Do **not** treat `docs/database-schema.md` as live schema.
Do **not** treat `PROJECT_CONTEXT_V1.md` as architecture law.
