# CARD PROCESSING ARCHITECTURE V1

**Normative.** This document defines the *only* sanctioned way a card moves through
the system. Its descriptive counterpart is `../card/CARD_LIFECYCLE_ARCHITECTURE_V1.md`
(what actually happens today, with GAPs); this document says what MUST happen, using
the existing implementation as the base and proposing only the minimal changes (§10)
needed to make the pipeline deterministic for every card.

No code, no DB changes, no migrations in this document.

**Inputs studied:** PLATFORM_LIFECYCLE_V1, CARD_LIFECYCLE_ARCHITECTURE_V1,
ENRICHMENT_RULES_V1, ENRICHMENT_INFRASTRUCTURE_V1, QUALITY_CARD_RULES_V1,
NULL_CLASSIFICATION_ALGORITHM_V1, PIPELINE_AUDIT_V1, IMPLEMENTATION_GAP_ANALYSIS_V1,
and the pipeline code (`scripts/telegram-collector`, `scripts/facebook-collector`,
`scripts/import-review`, `scripts/business-enrich`, `lib/import-review/actions.ts`,
migrations through `20260727230000`).

---

## 1. The canonical pipeline

```text
P0 COLLECT → P1 INGEST → P2 EXTRACT → P3 CLASSIFY → P4 DEDUPE
          → P5 REVIEW → P6 PUBLISH → P7 POST-ENRICH → P8 LIVE/RETIRE
              [G1]        [G2]                [G3]
```

This order is **the only allowed order** (§2). Three hard gates (G1–G3, §3) separate
the phases where the card changes custody: artifacts → queue → entity.

All stages except P5 are machine-executed (rule or AI); P5 is the only stage where a
human judges content (§8). Every stage is launched manually today — the canon does not
require a scheduler, it requires *order and gates*.

---

## 2. Stages: the single allowed order

| # | Stage | May repeat? | Idempotent? | Actor | Runs today as |
|---|---|---|---|---|---|
| P0 | COLLECT — source → batch artifacts | yes (new date windows) | yes per window (checkpoint/resume) | AI + rule | collectors CLI |
| P1 | INGEST — artifacts → `import_review_items` (`pending`) | yes (re-run same batch) | **yes** — `source_fingerprint` unique makes re-insert a no-op | rule | `import_needs_review.py --apply` |
| P2 | EXTRACT — fill the queue row from its own material (contacts from source_text, photo hydration, website/directory fill) | yes, any time before P6 | **yes** — fill-empty-only by convention | rule | `hydrate_queue_media.py`, `run_enrichment_pipeline.py`, `enrich_queue.py` |
| P3 | CLASSIFY — set `entity_type` + `target_collection` (+confidence/reason) or park with `[needs_manual_type]` | yes, but **only on rows still NULL** | yes — PATCH guarded by `entity_type=is.null`; never overwrites a set type | rule (regex tree per NULL_CLASSIFICATION_ALGORITHM_V1) or human | `classify_null_queue.py`, admin edit |
| P4 | DEDUPE — cluster reposts, mark satellites `duplicate` | yes | yes for clustering (stable keys); duplicate-marking is reversible (`duplicate → pending`) | rule (+human confirm on publish) | `dedupe_open_queue.py`, `merge_pending_clusters.py` |
| P5 | REVIEW — human decision on the card | yes until `approved` | n/a (judgment) | **human only** | admin UI → `admin_import_review_set_status` / `save_fields` |
| P6 | PUBLISH — entity created, queue row terminally `approved` | **no** — `approved` is terminal; re-approve is an idempotent no-op returning the existing mapping | **yes by construction** (idempotent re-approve in both mark RPCs) | human (approve) or rule (autopublish of `ready_to_publish`) | `approveImportReviewItemAction` / `autopublish_strong_accepted.py` |
| P7 | POST-ENRICH — fill-empty on the entity from allowed sources (ENRICHMENT_RULES tiers A/B/C) | yes, unbounded | **yes** — fill-empty-only; re-runs converge | rule (+AI for tier C) | `business-enrich` scripts, media pipeline |
| P8 | LIVE/RETIRE — owner/admin edits, reviews projection, merge, archive | yes | merge: no (one-way, audited via `business.merged` event); edits: n/a | human + triggers | admin UI, owner UI, RPCs |

**Forbidden orderings** (violations of the canon even though nothing physically stops
some of them today):
- P6 before P3 — publishing an untyped card (blocked by TS check + gate must harden, §10.1).
- P6 before P4 at least once — publishing without any duplicate check (the approve
  action's `findDuplicateMatches` satisfies P4 minimally; skipping it via `force`
  without a recorded reason is a violation).
- P2/P3 writes after P6 to the queue row — the queue row is frozen provenance
  post-publish; all post-publish work targets the entity (P7).
- P7 scripts writing to queue rows, or P2 scripts writing to entities.

---

## 3. Gates

### G1 — Ingest gate (P1 boundary; enforced today)

A row may enter the queue only if: `source_fingerprint` present and unique (DB
unique index — hard), `raw_payload` + `source_text`/media reference present,
`source`/`source_url` provenance filled, `review_status='pending'`, and **no review
fields set** (notes/decisions belong to humans). `entity_type`/`target_collection`
are either valid enum values or NULL — invalid guesses are dropped to NULL by
`map_post()` (enforced).

### G2 — Type gate (P3→P5 boundary; enforced by convention + TS check)

A card may be *offered for review triage as publishable* only when
`entity_type` AND `target_collection` are set and consistent
(ENTITY_TYPE_MAPPING_V1 aliases). Untyped rows must carry `[needs_manual_type]`
(with the MEDIUM proposal inline when one exists) — silent NULLs are a violation.
**Never default to `business`** (NULL_CLASSIFICATION §5.3 — the preview-only fallback
in `resolveImportPreviewKind()` must never leak into data).

### G3 — Publish gate (P6; enforced in the DB since 2026-07-27)

`public.import_review_publish_gate_errors()` — the single source of truth
(QUALITY_CARD_RULES_V1 rules; RE frozen). Consulted as pre-check by every path and
re-raised inside `admin_import_review_mark_approved` /
`service_import_review_mark_autopublished`. **No publish path may carry its own gate
logic.** Additional per-container gates that remain valid: `listings_validate_publish`
trigger (listings only), duplicate confirmation (`force` requires human intent).

---

## 4. Per-stage contract

Legend: SoT = where truth lives during/after the stage. "Required after" = fields that
MUST be non-empty when the stage completes successfully (a card missing them did not
complete the stage — it did not "partially pass").

| Stage | Input | Output | SoT | Required after | Possible errors | Next allowed |
|---|---|---|---|---|---|---|
| P0 | source channel access, date window, LLM budget | batch JSON + checkpoint | artifacts (replayable, not SoT) | batch file with `extracted_entity` per post | flood-wait, LLM budget abort (resume from checkpoint), auth loss | P1 |
| P1 | batch JSON, `--source-key` | queue rows `pending` | `import_review_items` | `source_fingerprint`, `source`, `source_text` or media, `raw_payload`, `first_seen` | fingerprint collision (=already ingested, skip silently), env/keys missing | P2 |
| P2 | queue row + its own source material | fill-empty patch: `phone[]`, `email[]`, `website[]`, `instagram[]`, `telegram_username`, `city`, `preview_image_url`, `price` | `import_review_items` | nothing new is *required* (a contactless card is legal here — it will fail G3 later); formats must be canonical: E.164 phones, bare IG handles, normalized URLs | network fetch failures (skip, never fail batch), junk-host contamination (blocked by `JUNK_HOST_PARTS`/`PLATFORM_HOSTS`), OCR misreads (tier-B lower trust) | P3 (or P2 again) |
| P3 | queue row (`entity_type IS NULL`) | typed row + `classification_confidence`/`classification_reason`, or `[needs_manual_type]` tag | `import_review_items` | `entity_type`+`target_collection` both set together, or the tag present | ambiguous both-signals (→ park, never guess), classifier drift vs collector regexes | P4, P5 |
| P4 | open queue rows | `recurring_cluster_id`, `occurrence_count`, satellites → `duplicate` (with `duplicate_of_*` target — DB-required) | `import_review_items` | on `duplicate` rows: the duplicate target | false-positive cluster (recoverable: restore), cross-layer dup vs published entity found only at P6 | P5 (survivor), P8-archive path (satellites) |
| P5 | typed, deduped rows | decision: `in_review`/`needs_more_info`(notes)/`rejected`(reason)/`duplicate`(target)/`ready_to_publish`; field edits via `save_fields` | `import_review_items` + `import_review_audit` (every transition) | per decision: required notes/reason/target (DB-enforced); human tags where the gate demands them (`[event_date_confirmed]`, `[human_confirmed]`) | attempting to leave `approved` (DB raises), missing reason/notes (DB raises) | P6, or back to P2–P4 |
| P6 | row passing G3 | entity row in target table; queue row `approved` + `published_entity_{type,id}`; audit row; domain event | **entity table** (queue row becomes frozen provenance) | entity: type-required fields per QUALITY_CARD_RULES; queue: back-link pair set | gate errors (fail-fast, nothing created), duplicate matches without `force`, entity insert failure (queue stays open — safe), **activation failure after listing insert** (known partial state: draft listing linked, error surfaced — must be re-driven manually) | P7 |
| P7 | published entity + allowed sources | fill-empty patch per ENRICHMENT_RULES tier A/B/C; `completeness_score` | entity table | provenance discipline: a tier-A/B value must be attributable to a named source (until per-field provenance exists: report files) | wrong-but-empty fills (bad city/category — the known risk class), quota/cost stops (Places), parse gaps (hours formats) | P7 again, P8 |
| P8 | live entity | owner/admin edits, review projections, merge (children re-pointed, loser archived, event emitted), status changes | entity table (+`reviews` subsystem for reputation) | — | merge conflicts (slug/same-author reviews — handled), no un-merge tool, no auto-expiry (all retirement is manual) | P8, terminal archive |

---

## 5. Forbidden states

A card in any of these states is **broken**, not "in progress":

| # | Forbidden state | Why / how it can arise today |
|---|---|---|
| F1 | `review_status='approved'` with `published_entity_id IS NULL` | mark RPC always sets both; only a rogue direct write could produce it |
| F2 | published entity from an imported card with no `source_url`/`source_kind` | provenance loss — publish paths must map it |
| F3 | queue row `approved` whose entity row no longer exists (hard-deleted) | admin hard delete without cleanup — orphan back-link |
| F4 | `entity_type` set but `target_collection` NULL (or vice versa) | partial classification writes — P3 must set the pair atomically |
| F5 | typed as `real_estate` AND published anywhere | frozen: gate returns the RE error for every path |
| F6 | `entity_type IS NULL` and no `[needs_manual_type]` tag and older than one classification pass | silent NULL — invisible to triage |
| F7 | `duplicate` without any `duplicate_of_*` target | DB-blocked in the status RPC |
| F8 | queue row mutated after `approved` (any field except nothing) | post-publish queue writes — the row is frozen provenance |
| F9 | entity rating fields written by anything but the reviews trigger | reputation is a projection (CORE_DOMAIN §5) |
| F10 | published entity failing G3 rules *at publish time* | structurally prevented since the gate backstop; historical pre-gate rows are grandfathered, not violations |
| F11 | active listing without its detail row / with inactive category | `listings_validate_publish` blocks at activation |
| F12 | two publishable queue rows in one `recurring_cluster_id` both open | dedupe incomplete — survivor must be единственный |

Dead-but-legal states (documented, not violations): business `draft`/`pending`,
listing/job `expired`, job `pending` — enum values no runtime path sets.

---

## 6. Repetition and idempotency (summary)

- **Repeatable, idempotent, safe at any pre-publish moment:** P1 (fingerprint no-op),
  P2 (fill-empty), P3 (NULL-guarded), P4 clustering.
- **Repeatable with human meaning:** P5 (status can cycle until approved).
- **One-shot:** P6 (terminal `approved`; re-call is a defined no-op).
- **Repeatable forever:** P7 (fill-empty convergent).
- **Non-repeatable, audited:** merge in P8 (one-way; summary persisted as
  `business.merged` domain event; no rollback tool — restraint required).

Idempotency is the property that makes the manual runtime survivable: any operator
(or agent) may re-run P1–P4/P7 without reading state first. Any new pipeline step MUST
preserve this property (fill-empty + guarded PATch + natural keys), or it does not
belong in the pipeline.

---

## 7. Mandatory stages relative to publication

**Before P6 (mandatory):** P1 (there is no card otherwise), P3 (typed — G2),
P4 at minimum as the publish-time duplicate check, P5 for every card that is not
`ready_to_publish`-strong, G3 always. P2 is *de facto* mandatory for most types
because G3 demands contacts/image/price that only P2 fills — canon: run P2 at least
once before P5 so humans triage enriched cards, not raw ones.

**After P6 (allowed/expected):** P7 enrichment (unbounded), P8 ownership claim,
reviews accumulation, merge, archive. Nothing after P6 may touch the queue row.

---

## 8. Human intervention points (exhaustive)

| Point | Form | Mandatory? |
|---|---|---|
| P5 decision | status change + notes/reason via RPC | yes — the only content-judgment stage |
| Gate-demanded confirmations | `[event_date_confirmed]`, `[human_confirmed]` tags in `review_notes` | yes, for events / specialist-`other` |
| Duplicate override | `force` on approve after reviewing matches | yes when matches exist |
| MEDIUM classification confirmations | `[needs_manual_type]` queue with inline proposals | yes for the parked backlog |
| P8 moderation/merge/claims | admin RPCs | as needed |
| Everything else | — | machines only; a human editing extraction output outside `save_fields` is off-canon |

---

## 9. CARD HEALTH MODEL

### 9.1 Properties of a healthy card

**In the queue (pre-publish):**
- H1 Identity: unique `source_fingerprint`; `raw_payload` intact (trigger-protected).
- H2 Provenance: `source`, `source_url`, `first_seen`/`last_seen` present; origin
  reconstructable without the entity existing.
- H3 Typed-or-parked: the (`entity_type`,`target_collection`) pair set together, or
  the row explicitly carries `[needs_manual_type]`.
- H4 Canonical formats: phones E.164, instagram bare handle, website normalized and
  non-junk-host, price numeric with currency.
- H5 Review integrity: every status change has an `import_review_audit` row; required
  notes/reason/target present for its current status.
- H6 Cluster discipline: at most one open publishable row per `recurring_cluster_id`.

**Published (post-P6):**
- H7 Bidirectional link: queue `approved` ⟺ entity exists; `published_entity_{type,id}`
  matches a live row in the right table for the `target_collection`.
- H8 Gate-clean at birth: G3 returned `{}` at publish time (guaranteed since the
  backstop; historical rows grandfathered and identifiable by `approved_at` date).
- H9 Provenance carried: `source_url`/`source_kind` (or jobs' `source_type`+
  `source_url`) on the entity.
- H10 Status sanity: entity status ∈ its enum's publicly-listed or parked values;
  `published_at` set exactly once where the schema has it.
- H11 Reputation purity: rating fields explainable entirely by the reviews subsystem
  (or NULL); external ratings only in their dedicated source-labeled columns.
- H12 Score present: `completeness_score` computed after the last enrichment pass
  (businesses/professionals).
- H13 Frozen provenance: the queue row unchanged since `approved_at`.

### 9.2 Invariant violations (complete list = F1–F12 plus drift classes)

All of §5 (F1–F12), plus violations only detectable over time:
- D1 **Format drift:** non-E.164 phone / URL-shaped instagram / junk-host website on
  a queue row or entity (P2 contract broken by a new writer).
- D2 **Provenance drift:** tier-A/B field changed with no enrichment report, no owner
  edit, no admin audit trail to attribute it to (the per-field-provenance gap makes
  this detectable only by elimination today).
- D3 **Stage regression:** a row that was typed becoming NULL again, or `approved_at`
  earlier than `first_seen` — clock/ordering corruption.
- D4 **Projection drift:** `rating`/`reviews_count` disagreeing with a recount from
  `reviews` (trigger bypassed).
- D5 **Mirror drift:** `entities` registry row disagreeing with its professional/job
  source row (sync trigger bypassed by direct SQL).
- D6 **Score staleness:** completeness_score older than the last entity write —
  benign but masks enrichment effect.

Health checking is read-only SQL over existing tables (every H/F/D above is
expressible as a SELECT); the natural home for a periodic check is the existing
`run_scheduled_maintenance()` seam — see §10.5.

---

## 10. Minimal changes required for one deterministic pipeline

Ordered; each is small, additive, and justified by a named invariant. Nothing else is
required — the pipeline above is otherwise implementable with what exists.

1. **Harden G3 for untyped rows** — `import_review_publish_gate_errors()` returns an
   error (not `{}`) when `target_collection IS NULL`. One branch in one function;
   closes the F4/F6 leak at the last line of defense.
2. **One batch orchestrator for P2–P4** — a thin wrapper script that runs
   hydrate → extract → classify → dedupe in the canonical order with shared
   `--limit/--apply` semantics, so operators (and agents) invoke *one* entry point
   instead of memorizing four. Pure composition of existing scripts; no new logic.
3. **Tag registry as a shared constant** — `[needs_manual_type]`,
   `[human_confirmed]`, `[event_date_confirmed]`, `[auto-classified:medium]` defined
   once (one Python module + one TS constant file generated from the same list) and
   documented in one table; today the strings are retyped in four places (H3/G2/G3
   depend on their exact spelling).
4. **Extraction & classification contract doc** — the regexes (verbatim), field
   formats, thresholds, and stop-lists currently living only in code
   (`contacts.py`, `reviewer.py`, `facebook_decision_policy.py`, `category_map.py`,
   `JUNK_HOST_PARTS`/`PLATFORM_HOSTS`) captured as
   `EXTRACTION_CLASSIFICATION_CONTRACT_V1` so P2/P3 are executable from docs and
   verifiable against code (already identified as the blocking gap for code-free
   agents).
5. **Health report wired into the existing maintenance seam** — the §9 predicates as
   a read-only report (SQL or script) callable from `run_scheduled_maintenance()`;
   violations emitted as `card_health.violation` domain events. Uses only existing
   extension points; turns this document's invariants from prose into a checkable
   list.

Explicitly NOT required (and rejected): new pipeline-stage column on
`import_review_items` (the stage is derivable from existing fields per §4), workflow
engine, queue framework, new statuses — the 7-state enum plus tags covers the canon.
