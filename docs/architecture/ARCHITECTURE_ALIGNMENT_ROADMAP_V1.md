# ARCHITECTURE ALIGNMENT ROADMAP V1

**Final alignment audit.** The architecture is considered approved:
the five domain layers (Identity → Objects → Relations → Facts → Projections),
the canonical pipeline (`runtime/CARD_PROCESSING_ARCHITECTURE_V1.md`),
the core domain model (`domain/CORE_DOMAIN_ARCHITECTURE_V1.md`),
and the runtime canon (`runtime/PLATFORM_LIFECYCLE_V1.md` + stabilization).
This document does NOT design anything new — it lists what in the existing repo
violates the approved architecture and the concrete work to close each violation.

Every problem below is already evidenced in the audit corpus (references given);
nothing here is speculative. Scales: criticality/risk — low/med/high;
complexity — S (hours), M (days), L (a workstream).

---

## PART I — Violation inventory

### Layer 1 · Identity

| | P-1 Admin-as-owner for imported listings/jobs |
|---|---|
| Violates | acting subject (approving admin) recorded as owning subject; economic owner unrepresented |
| Why a problem | blocks ownership handover, donations-to-owner, honest "мои объявления"; poisons future Relations features |
| Criticality | **high** (grows with every publish) |
| End state | imported listings/jobs are unowned-until-claimed, like businesses; admin identity only in audit/facts |
| No data migration? | no — existing `owner_id` rows need reassignment; new publishes fixable immediately |
| Gradual? | yes — fix the route first, backfill later |
| Documented in | PLATFORM_LIFECYCLE §4.2/§12; CARD_LIFECYCLE §4; layer audit (chat 2026-07-27) |
| Touches | `approveImportReviewItemAction`, listings/jobs RLS, claim flow |

| | P-2 No professional claim ("это я") |
|---|---|
| Violates | object about a subject with no way to bind the subject |
| Criticality | med (blocks self-service growth for the largest personal-card class) |
| End state | claim flow for professionals reusing `business_claims` machinery pattern |
| No data migration? | yes — purely additive |
| Gradual? | yes |
| Documented in | CORE_DOMAIN §9.2; PLATFORM_LIFECYCLE §4.2 |
| Touches | new claim path, `professionals.owner_profile_id`, admin claims UI |

| | P-3 Ownership transfer / revocation absent |
|---|---|
| Violates | relation without full lifecycle (grant-only) |
| Criticality | med |
| End state | transfer/revoke as audited RPCs emitting facts |
| No data migration? | yes | Gradual? | yes |
| Documented in | PLATFORM_LIFECYCLE §4.2, §13.5 |
| Touches | `business_owners`, claims UI, domain_events |

| | P-4 No account teardown |
|---|---|
| Violates | subject lifecycle has no end |
| Criticality | low today, legal-risk later |
| End state | defined deletion flow (identity + owned-content policy) |
| No data migration? | yes | Gradual? | yes |
| Documented in | PLATFORM_LIFECYCLE §13.13; CORE_DOMAIN §3 GAP |
| Touches | profiles, auth, owned entities policy |

### Layer 2 · Objects

| | P-5 Entities registry covers 2 of 9 kinds |
|---|---|
| Violates | no unified address space → every linking feature must invent addressing |
| Criticality | **high** (prerequisite for Relations-layer features) |
| End state | every published object mirrored in `entities` (sync triggers + backfill), same pattern as professionals/jobs |
| No data migration? | additive backfill inserts only — safe |
| Gradual? | yes, kind by kind |
| Documented in | PLATFORM_LIFECYCLE V-7 |
| Touches | businesses/listings/events triggers, registry view |

| | P-6 Vehicle: advertised kind without storage |
|---|---|
| Violates | object kind exists in enums + public page, zero objects possible |
| Criticality | low (confusing, not corrupting) |
| End state | product decision executed: remove page/enum usage OR build entity (RECOMMENDATIONS P4) |
| No data migration? | yes | Gradual? | yes |
| Documented in | PLATFORM_LIFECYCLE V-6 |
| Touches | `app/vehicles`, classifiers, enums (leave values, stop advertising) |

| | P-7 Real-estate workstream frozen mid-flight |
|---|---|
| Violates | 26 objects published under wrong kind; kind blocked for new cards |
| Criticality | med (contained by the freeze) |
| End state | Phase 3 executed: draft schema applied → publish route → human pass on 26 rows → unfreeze |
| No data migration? | no — that's the point of the workstream |
| Gradual? | yes (schema → route → backfill) |
| Documented in | PHASE_PLAN §3.3; DATA_CLEANUP §3.5; REAL_ESTATE_ENTITY_V1 |
| Touches | new table, actions.ts, classifiers, 26 rows |

| | P-8 Five status dialects for one lifecycle |
|---|---|
| Violates | one lifecycle, five vocabularies; per-table literals everywhere |
| Criticality | med (drift generator for cheap models) |
| End state | all public "is live?" checks route through `is_publicly_listed()`; **no enum renames** |
| No data migration? | yes — query/view changes only |
| Gradual? | yes, opportunistic per file |
| Documented in | V-3; ENTITY_BASE_MODEL §3; STABILIZATION D-4 (partial) |
| Touches | views, lib queries |

| | P-9 `import_comment_recommendations` = second birth channel |
|---|---|
| Violates | parallel quasi-object store minting cards outside the canonical pipeline |
| Criticality | med |
| End state | recommendation-sourced cards enter `import_review_items` (P1) and pass the same gates; recommendations table remains a *fact* store (mentions), not a birth channel |
| No data migration? | yes for the route; existing rows stay |
| Gradual? | yes |
| Documented in | PIPELINE_AUDIT §3; CARD_LIFECYCLE 2.3 (events dual path); layer audit |
| Touches | `publish_recommendation_*` scripts, admin recommendations UI |

### Layer 3 · Relations

| | P-10 Two representations of one relation type (ownership) |
|---|---|
| Violates | business ownership = first-class table; professional ownership = bare FK without lifecycle/basis |
| Criticality | med |
| End state | ownership relations follow one convention (first-class, dated, attributed); FK may remain as a cache |
| No data migration? | no — backfill FK → relation rows (additive, mechanical) |
| Gradual? | yes |
| Documented in | CORE_DOMAIN §6 (single rule per entity kind — refined); layer audit |
| Touches | professionals, future claim flow (P-2 should land on the unified convention) |

| | P-11 Affiliation Business↔Professional absent |
|---|---|
| Violates | the central ecosystem relation type doesn't exist |
| Criticality | med (blocks "связи между сущностями") |
| End state | typed M:N link per CORE_DOMAIN §4 (already specified: link, never identity; no transitive ownership) |
| No data migration? | yes — new, empty |
| Gradual? | yes |
| Documented in | CORE_DOMAIN §4, §9.1 |
| Touches | new link table + rules, professional/business pages later |

### Layer 4 · Facts

| | P-12 Enrichment/AI writes bypass the facts layer (no per-field provenance) |
|---|---|
| Violates | "AI пишет только факты-предложения"; run reports live as JSON files outside the system |
| Criticality | **high — the only violation that becomes irreversible over time** (sources blend unrecoverably) |
| End state | per-field provenance (side table or columns per ENRICHMENT_RULES §"Why"), scripts record source per write; mass AI-enrichment frozen until then |
| No data migration? | additive; historical writes grandfathered as `unknown` |
| Gradual? | yes — new writes first, backfill never (honest unknown) |
| Documented in | ENRICHMENT_RULES §"Why"; ENRICHMENT_INFRA §6.4; CARD_PROCESSING D-2 |
| Touches | enrich scripts' write path, one new store |

| | P-13 Entity mutations produce no facts |
|---|---|
| Violates | "изменение состояния — только через факт"; audit exists only for queue + merge |
| Criticality | med |
| End state | owner/admin/status mutations emit `domain_events` (seam exists; one `perform emit…` per official path) |
| No data migration? | yes | Gradual? | yes, path by path |
| Documented in | PLATFORM_LIFECYCLE §10; layer audit |
| Touches | admin RPCs, owner-edit actions |

| | P-14 Enrichment runs invisible to the system |
|---|---|
| Violates | facts (run reports) stored as local JSON only |
| Criticality | low-med |
| End state | each `--apply` run emits `enrichment.completed` event with summary (counts, script, fields) |
| No data migration? | yes | Gradual? | yes — one helper in the shared script pattern |
| Documented in | CARD_PROCESSING §10.5 spirit; layer audit |
| Touches | business-enrich common pattern |

### Layer 5 · Projections

| | P-15 Templated blurbs contaminate ground truth |
|---|---|
| Violates | interpretation (`russian_card_blurbs` templates) written into `description`, indistinguishable from real content |
| Criticality | med |
| End state | templated rows identifiable (they match known templates — detectable retroactively), marked or regenerated; script stops writing unmarked template copy |
| No data migration? | mostly — detection + tagging pass |
| Gradual? | yes |
| Documented in | ENRICHMENT_RULES tier C table (self-flagged) |
| Touches | `russian_card_blurbs.py`, affected rows |

| | P-16 Dead public projection: professional ratings |
|---|---|
| Violates | projection exposed with no derivation (misleading zero-state) |
| Criticality | med |
| End state | professional reviews wired into the **existing** reviews subsystem (approved decision), columns become real projections |
| No data migration? | additive target column in reviews subsystem |
| Gradual? | yes |
| Documented in | V-11; CORE_DOMAIN §5, §9.3 |
| Touches | reviews subsystem, professional pages |

### Cross-cutting (canon operability)

| # | Problem | Crit | End state | Docs |
|---|---|---|---|---|
| P-17 | No scheduler calls `run_scheduled_maintenance()`; outbox has zero consumers | **high** | any external cron → maintenance; one first consumer (even log-only) stamping `processed_at` | STABILIZATION §7.1–2 |
| P-18 | No CI at all | **high** | one workflow: tsc + eslint + py_compile + RLS-check SQL | advice audit §2.3 |
| P-19 | Extraction/classification contract lives only in code | **high** for agents | `EXTRACTION_CLASSIFICATION_CONTRACT_V1` (regexes verbatim, formats, thresholds, stop-lists, tag registry) | doc-sufficiency audit; CARD_PROCESSING §10.4 |
| P-20 | G3 silent on NULL collection; S4 steps unordered; tags retyped in 4 places | med | CARD_PROCESSING §10.1–3 executed (gate branch, orchestrator wrapper, tag constants) | CARD_PROCESSING §10 |
| P-21 | `types/database.ts` hand-maintained | med | types regeneration step in the migration ritual | STABILIZATION §7.4 |
| P-22 | Doc drift: QUALITY_CARD_RULES names TS as enforcement point; `docs/navigation/` tree sits untracked/unreviewed | low | one-line doc fix; review+commit or discard navigation layer | this audit |

---

## PART II — Roadmap (tasks only)

Format: goal / result / depends on / complexity / risk / prerequisites.

### Stage A — Foundation Cleanup (agent-safety; canon becomes executable)

| T | Task | Result | Deps | Cx | Risk | Ready-before |
|---|---|---|---|---|---|---|
| A1 | Harden G3: error on `target_collection IS NULL` (P-20) | gate returns explicit error; F4/F6 leak closed | — | S | low | none |
| A2 | Tag registry: one shared constants source for the 4 review_notes tags (P-20) | Python module + TS constants, all four call sites switched | — | S | low | none |
| A3 | P2–P4 orchestrator wrapper script (P-20) | one entry point running hydrate→extract→classify→dedupe with shared flags | A2 | S | low | none |
| A4 | Write EXTRACTION_CLASSIFICATION_CONTRACT_V1 (P-19) | regexes verbatim, field formats, thresholds, stop-lists documented and diff-checked against code | A2 | M | low | none |
| A5 | CI workflow: tsc, eslint, py_compile, RLS checks (P-18) | red PRs on regressions | — | S | low | repo push access |
| A6 | Types regeneration ritual (P-21) | documented step + first regenerated `types/database.ts` diff reviewed | A5 | S | med (large diff review) | CI green baseline |
| A7 | Doc sync: QUALITY_CARD enforcement line; decide/review/commit `docs/navigation/` (P-22) | corpus internally consistent | — | S | low | none |

### Stage B — Runtime Cleanup (the canon starts breathing)

| T | Task | Result | Deps | Cx | Risk | Ready-before |
|---|---|---|---|---|---|---|
| B1 | Point an external cron at `run_scheduled_maintenance()` (P-17) | verification expiry actually runs; heartbeat event visible | — | S | low | choose cron host |
| B2 | First outbox consumer stamping `processed_at` (P-17) | events flow end-to-end; consumer pattern established | B1 | M | low | A5 |
| B3 | Card-health report wired into maintenance (CARD_PROCESSING §10.5) | H/F/D predicates as read-only report + `card_health.violation` events | B1 | M | low | CARD_PROCESSING §9 as spec |
| B4 | Emit facts from remaining official mutation paths (P-13) | status/owner-edit RPC paths emit domain_events | B2 | M | low | B2 consumer exists |
| B5 | Enrichment runs emit `enrichment.completed` (P-14) | every `--apply` visible in-system | B2 | S | low | — |

### Stage C — Objects Cleanup

| T | Task | Result | Deps | Cx | Risk | Ready-before |
|---|---|---|---|---|---|---|
| C1 | Full entities registry: triggers for businesses/listings/events + backfill (P-5) | every published object addressable | — | M | low (additive) | pattern from professionals sync |
| C2 | Status-helper adoption in public queries/views (P-8) | one "is live" predicate; no renames | — | M | med (behavior-sensitive; do per-view with checks) | A5 (CI) |
| C3 | Vehicle decision executed (P-6) | page/classifier no longer advertise a storage-less kind | product decision | S | low | owner sign-off |
| C4 | Recommendations birth channel routed through the queue (P-9) | one birth path; recommendations remain mention-facts | A1–A3 | M | med | C1 |
| C5 | Real Estate Phase 3 (P-7): schema → route → 26-row human pass → unfreeze | RE cards publishable under correct kind | C1 | **L** | med | REAL_ESTATE_ENTITY_V1 as spec; human reviewer time |

### Stage D — Identity Cleanup

| T | Task | Result | Deps | Cx | Risk | Ready-before |
|---|---|---|---|---|---|---|
| D1 | Stop admin-as-owner at the route (P-1a) | new imported listings/jobs published unowned/service-owned; admin only in audit | — | M | med (RLS interplay) | decision on vacant-owner convention per existing RLS |
| D2 | Backfill: reassign historical admin-owned imports (P-1b) | ownership truthful platform-wide | D1 | M | med (data migration) | D1 stable |
| D3 | Professional claim flow (P-2) | "это я" path live, reusing claim machinery | E1 preferred | M | low | claim UI patterns |
| D4 | Ownership transfer/revoke RPCs (P-3) | full relation lifecycle, audited | B4 | M | low | — |
| D5 | Account teardown flow (P-4) | defined deletion policy executed | D4 | L | med | legal/product input |

### Stage E — Relations Cleanup

| T | Task | Result | Deps | Cx | Risk | Ready-before |
|---|---|---|---|---|---|---|
| E1 | Unify ownership representation for professionals (P-10) | first-class relation rows (FK kept as cache) | C1 | M | low | convention doc exists (CORE_DOMAIN §6) |
| E2 | Affiliation link Business↔Professional (P-11) | typed M:N per CORE_DOMAIN §4 rules | C1, E1 | M | low | — |

### Stage F — AI & Data-Quality Cleanup

| T | Task | Result | Deps | Cx | Risk | Ready-before |
|---|---|---|---|---|---|---|
| F1 | Per-field provenance store + write-path integration (P-12) | every new tier-A/B write attributable; **unblocks mass AI enrichment** | B5 | **L** | med | ENRICHMENT_RULES as spec; freeze mass enrichment until done |
| F2 | Blurb decontamination (P-15) | templated copy detectable/marked; script stops unmarked writes | F1 pattern | M | low | template inventory |
| F3 | Professional reviews wiring (P-16) | ratings become real projections; dead columns live | B-stage events | M–L | med | reviews subsystem as template (approved) |

---

## PART III — Triage

### Must be done BEFORE active feature development

**All of Stage A** (A1–A7), **B1–B2**, **C1**. Rationale: A makes cheap models safe
(one entry point, executable contract, CI net); B1–B2 turn the extension seams into a
working channel so the first feature doesn't have to build runtime; C1 gives every
future feature its addressing. Additionally **D1** (stop the bleeding on
admin-as-owner — every new publish makes P-1 bigger) and the **F1 freeze rule**
(no mass AI enrichment until provenance) — the freeze costs nothing and prevents the
one irreversible failure.

### Can be safely deferred (do when the pulling feature arrives)

B3–B5 (with the first real consumer), C2 (opportunistic), C4, D2–D4, E1–E2
(before подписки/связи features), F2, F3 (with the reviews-for-professionals
feature), C5/RE Phase 3 (when RE is a product priority), C3 (whenever the decision
is made), D5 (before public growth/marketing).

### Should NOT be done in the next year

- Status enum renames / vocabulary unification at the DB level (churn, breakage,
  zero capability; the helper covers it).
- Event bus / worker framework / job queue infrastructure (outbox + one consumer is
  enough until proven otherwise).
- Graph database or generic EAV "entity" storage (the registry + typed links cover
  the approved model).
- A `customers` table or any public customer reputation (explicitly ruled out by
  CORE_DOMAIN).
- Un-merge tooling (audited restraint is cheaper than a rollback machine nobody has
  needed yet).
- Search index / reindex pipeline (live SQL holds at current scale; revisit on
  measured pain).
- Backfilling provenance for historical enrichment writes (honest `unknown` beats
  fabricated attribution).

---

*Every task above traces to a named violation (Part I), every violation to an
approved document. No new architecture was introduced; where a task's "end state"
names a mechanism, it is the mechanism the approved docs already specify.*
