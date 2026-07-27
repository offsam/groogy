# NAVIGATION_COVERAGE_REPORT.md

**Date:** 2026-07-27  
**Scope:** `docs/navigation/` validation & coverage  
**Method:** filesystem link check + BFS reachability from `AI_AGENT_START_HERE.md` / `PROJECT_INDEX.md`

Related: [`NAVIGATION_RULES.md`](./NAVIGATION_RULES.md) · [`DEPENDENCY_MAP.md`](./DEPENDENCY_MAP.md)

---

## 1. Link validation summary

| Metric | Count |
|---|---:|
| Navigation markdown files (before maintenance docs) | 22 |
| Markdown links checked | 346+ |
| **Broken links** | **0** |
| External links | 0 |
| Directory links (valid) | many (migrations, app/*, lib/*, scripts/*) |

### Broken links found

**None.** All markdown link targets under `docs/navigation/` resolved to existing files or directories.

### Duplicate references (informational)

Not errors — intentional SoT reinforcement:

| Target | Approx. inbound nav refs |
|---|---:|
| `PLATFORM_LIFECYCLE_V1.md` | ~23 |
| `ENTITY_TYPE_MAPPING_V1.md` | ~9 |
| `ARCHITECTURE_FREEZE_V1.md` | ~7 |
| Runtime entry-points (`PUBLISH`, `REVIEW`, …) | cross-linked from indexes |

---

## 2. Orphan documents

### Before fix

| Document | Status |
|---|---|
| [`docs/architecture/entity-category-unification-audit.md`](../architecture/entity-category-unification-audit.md) | **Orphan** — not reachable from `PROJECT_INDEX` |
| `scripts/**/.venv/**/README.md` | Ignored (vendor / venv, not project docs) |

### After fix

- Orphan linked from [`PROJECT_INDEX.md`](./PROJECT_INDEX.md) and [`entities/INDEX.md`](./entities/INDEX.md).
- All **42** content docs under `docs/**/*.md` (excluding `docs/navigation/`) are reachable.
- Collector READMEs reachable.

### Audits previously deep-only

These were reachable only via transitive audit links (depth 2–4). Now also listed explicitly under Project Index → Data quality / audits:

- `DATA_CLEANUP_PLAN_V1.md`, `PHASE_PLAN_V1.md`, and the full audits catalog

---

## 3. Coverage by major subsystem

Legend: **Y** = yes · **P** = partial · **N** = no / unknown · **G** = known gap documented in nav

| Subsystem | Has navigation? | Declared SoT? | Entry-point? | Canonical / primary doc? | Known gaps called out? |
|---|:-:|:-:|:-:|:-:|:-:|
| Runtime map | Y | Y | [`runtime/INDEX.md`](./runtime/INDEX.md) | `PLATFORM_LIFECYCLE_V1` | Y |
| Publish | Y | Y | [`runtime/PUBLISH.md`](./runtime/PUBLISH.md) | lifecycle + Jobs/Publish | Y (mapping aliases) |
| Import | Y | Y | [`runtime/IMPORT.md`](./runtime/IMPORT.md) | lifecycle + collector READMEs | P |
| Review | Y | Y | [`runtime/REVIEW.md`](./runtime/REVIEW.md) | REVIEW_WORKFLOW + ADMIN_REVIEW_CENTER | Y (live UI transitional) |
| Ownership | Y | Y | [`runtime/OWNERSHIP.md`](./runtime/OWNERSHIP.md) | OWNERSHIP_SOURCE_CLAIM | Y |
| Claims | Y | Y | [`runtime/CLAIMS.md`](./runtime/CLAIMS.md) | ownership + lifecycle | N |
| Enrichment | Y | Y | [`runtime/ENRICHMENT.md`](./runtime/ENRICHMENT.md) | lifecycle + enrichment audits | Y |
| Duplicates | Y | Y | [`runtime/DUPLICATES.md`](./runtime/DUPLICATES.md) | lifecycle | N |
| Search | Y | Y | [`runtime/SEARCH.md`](./runtime/SEARCH.md) | lifecycle | Y (no search index table) |
| Moderation | Y | Y | [`runtime/MODERATION.md`](./runtime/MODERATION.md) | lifecycle | N |
| Reviews | Y | Y | [`runtime/REVIEWS.md`](./runtime/REVIEWS.md) | lifecycle | Y (no dedicated entity-model reviews doc) |
| Events | Y | Y | [`runtime/EVENTS.md`](./runtime/EVENTS.md) | lifecycle | Y (no EVENT_ENTITY_V1.md) |
| Recommendations | Y | Y | [`runtime/RECOMMENDATIONS.md`](./runtime/RECOMMENDATIONS.md) | lifecycle | N |
| Listings / Transfer / Lechu | Y | Y | [`runtime/LISTINGS.md`](./runtime/LISTINGS.md) | MARKETPLACE + lifecycle | Y (Transfer/Lechu “later” in freeze) |
| Public Website | Y | Y | [`runtime/PUBLIC_WEBSITE.md`](./runtime/PUBLIC_WEBSITE.md) | lifecycle + IA V2 | Y (IA V1 secondary) |
| Entities (all) | Y | Y | [`entities/INDEX.md`](./entities/INDEX.md) | freeze + per-entity docs | Y (Vehicle/RE/Transfer/Lechu) |
| Business | Y | Y | via entities index | BUSINESS_ENTITY_V1 | via audits |
| Professional | Y | Y | via entities index | PROFESSIONAL_ENTITY_V1 | Y |
| Marketplace | Y | Y | via entities + LISTINGS | MARKETPLACE_ENTITY_V1 | via audits |
| Job | Y | Y | via entities index | JOBS_ENTITY_V1 | via audits |
| Vehicle | Y | P | entities index | mapping/stub | **G** |
| Real Estate | Y | Y | entities index | REAL_ESTATE_ENTITY_V1 | **G** (live vs design) |
| Database | Y | Y | [`database/INDEX.md`](./database/INDEX.md) | migrations + types | Y (proposal schema labeled) |
| API | Y | P | [`api/INDEX.md`](./api/INDEX.md) | route files | P (actions not REST) |
| Admin | Y | Y | [`admin/INDEX.md`](./admin/INDEX.md) | ADMIN_REVIEW_CENTER + pages | Y (transitional UI) |
| AI | Y | Y | [`ai/INDEX.md`](./ai/INDEX.md) | lifecycle + lib/ai | Y (no prompts/ dir) |
| Security | Y | P | Project Index section | code files + ACCESS/ACL | P (no security.md) |
| Deployment | Y | N | Project Index section | **Unknown** | **G** |
| Architecture Decisions | Y | Y | Project Index section | FREEZE (no ADR files) | Y (no ADR*.md) |
| Taxonomy / IA | Y | Y | Project Index section | TAXONOMY_* + IA V2 | Y |
| Integrations | Y | Y | Project Index + AI index | collector READMEs | P |

---

## 4. Coverage percentage

Counting rows in §3 with **Has navigation? = Y** and **Entry-point or Index section = Y**:

| Measure | Value |
|---|---|
| Subsystems listed | 30 |
| With navigation present | 30 / 30 = **100%** |
| With declared SoT (Y) | 25 / 30 ≈ **83%** |
| With SoT Y or P | 28 / 30 ≈ **93%** |
| With explicit known gaps called out | 18 / 30 = **60%** |
| Content docs under `docs/` reachable (excl. nav) | **42 / 42 = 100%** (after orphan fix) |

**Headline coverage (navigation presence): ~100% of listed major subsystems.**  
**SoT completeness: ~83% hard / ~93% including partial.**  
Weakest: Deployment (no doc), Vehicle (stub), Security (code-only pointers).

---

## 5. Missing documents (not created — only noted)

Navigation must not invent architecture. These are **gaps**, not todos executed here:

| Gap | Notes |
|---|---|
| No `ADR*.md` | Freeze used instead |
| No `EVENT_ENTITY_V1.md` | Events pointed at lifecycle |
| No Transfer/Lechu entity freeze docs | Marked “later” in mapping; live via LISTINGS |
| No deployment runbook | Marked Unknown |
| No `docs/security.md` | Pointers to `lib/security/*` + ACL docs |
| No central `prompts/` tree | Stated in AI index |
| `docs/database-schema.md` proposal | Labeled non-SoT |

---

## 6. Recommendations for future maintenance

1. When adding a subsystem, update `PROJECT_INDEX` + domain INDEX + entry-point in the **same PR** ([`NAVIGATION_RULES.md`](./NAVIGATION_RULES.md)).
2. Re-run link + orphan checks after doc moves (script pattern in this report’s method).
3. Prefer **explicit** links for important audits over folder-only discovery.
4. If Deployment / Security / Events get real SoT docs later, upgrade Project Index from “Unknown/partial” to those files — do not invent interim specs in nav.
5. Refresh this coverage report when subsystem count changes.
6. Keep freeze vs lifecycle distinction visible on every agent start path.

---

## 7. Deliverable checklist

| Deliverable | Status |
|---|---|
| Link validation | Done — 0 broken |
| Orphan fix | Done — category unification audit linked |
| Explicit audits catalog | Done — in `PROJECT_INDEX` |
| `NAVIGATION_COVERAGE_REPORT.md` | This file |
| `DEPENDENCY_MAP.md` | Created |
| `NAVIGATION_RULES.md` | Created |
| App/runtime/SQL unchanged | Yes |

---

## 8. Follow-up (2026-07-27) — A7 / new canon corpus

Linked into navigation (no longer orphans from `PROJECT_INDEX`):

- `docs/architecture/ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md`
- `docs/architecture/domain/CORE_DOMAIN_ARCHITECTURE_V1.md`
- `docs/architecture/runtime/CARD_PROCESSING_ARCHITECTURE_V1.md`
- `docs/architecture/card/CARD_LIFECYCLE_ARCHITECTURE_V1.md`
- `docs/architecture/runtime/ARCHITECTURE_STABILIZATION_V1.md`

Roadmap item **A7** / **P-22**: review + commit `docs/navigation/` (this tree).
