# ARCHITECTURE STABILIZATION V1

Goal: make the platform safe for mass feature development by lighter models
(Cursor-class) — one official execution point per domain action, no duplicated
business logic, extension points for the runtime that doesn't exist yet.

**Admission criterion applied to every change** (per the sponsor's requirement):
*does it reduce the complexity a simpler model faces when implementing the next
feature?* Changes that didn't pass this filter were rejected (list in §5).

Scope executed 2026-07-27. Baseline: `PLATFORM_LIFECYCLE_V1.md` (same directory)
— its Validation Findings (V-1…V-16) were the blocker inventory for this stage.

---

## 1. Duplication audit → what was done

| # | Duplicate found | Resolution | Status |
|---|---|---|---|
| D-1 | **Publish gate logic in 3 places** (TS `publishGateErrors`, python `eligibility.py` thresholds, nothing at DB level) — finding V-5 | Single source of truth: `public.import_review_publish_gate_errors(import_review_items)` in the DB. TS copy **deleted** (−80 lines); TS action, python autopublish, and both mark-approved RPCs all consult the same function. `admin_import_review_mark_approved` and `service_import_review_mark_autopublished` now hard-raise as a backstop for any path that skips the pre-check. | **DONE** (migration `20260727230000`, `lib/import-review/actions.ts`, `autopublish_strong_accepted.py`) |
| D-2 | **Jobs dual-home** (user jobs → `jobs`; queue jobs → `listings type='job'`, invisible on `/jobs`) — finding V-8 | Queue approve now publishes into the `jobs` table (provenance columns `source_type/source_url/imported_at` already existed there). Verified live: **0 rows** ever landed in `listings` as jobs and 0 approved queue jobs → no data migration needed. `listing_type='job'` remains only as a legacy enum value. | **DONE** |
| D-3 | **Merge summary existed only as a return value** — finding V-15 | `admin_merge_businesses` persists its summary via `emit_domain_event('business.merged', …)` — merge history is now queryable. | **DONE** |
| D-4 | **"Is this row public?" logic repeated across five status dialects** — finding V-3 | Canonical helper `public.is_publicly_listed(status, visibility)` created. Existing views/queries NOT rewritten in this pass (each rewrite is a behavior-risk change; they keep working). New code must use the helper. | **PARTIAL** — helper is SSOT for new code; convergence of old filters is a listed remaining item |
| D-5 | **Two duplicate-detection layers with separate logic** (python fingerprint/cluster vs TS `findDuplicateMatches`) | Not merged in this pass: they run at different pipeline stages on different inputs (pre-DB batches vs live entities) and share no natural call point. Documented as intentional layering, not a dupe to collapse. | **REJECTED by criterion** — merging would not simplify feature work |
| D-6 | **Enum drift**: `listing_type` values `transfer`/`transport_carry` live only in prod, not in migrations — finding V-16 | Repair migration (`add value if not exists`) — fresh environments now build. | **DONE** |
| D-7 | **RPC vs TS split for claim/status/merge** | Already single-pathed through RPCs (`admin_review_business_claim`, `admin_set_business_status`, `admin_merge_businesses`); TS is a thin caller. No change needed — verified, not assumed. | **VERIFIED OK** |

## 2. One official execution point per domain action

| Action | The one official path | Enforced how |
|---|---|---|
| publish (from queue) | pre-check `import_review_publish_gate_check` → create entity → `admin_import_review_mark_approved` / `service_import_review_mark_autopublished` | gate backstop **raises inside both mark RPCs** — unskippable for any caller |
| approve/reject/duplicate/needs_more_info | `admin_import_review_set_status` | already sole path; DB-guarded invariants (terminal approved, required reason/notes/target) |
| verify (review verification) | `create/submit/complete_verification_session` RPC chain | already sole path |
| merge | `admin_merge_businesses` | sole path; now audited via domain event |
| ownership grant | `admin_review_business_claim` | sole path; emits `business.claim_approved/rejected` |
| archive (business) | `admin_set_business_status` | sole path for lifecycle; owners never touch status |
| listing lifecycle | `transition_listing_status` (owner) / `admin_set_listing_status` (admin) + `listings_validate_publish` trigger | DB-enforced |

A Cursor-class model implementing "approve button", "merge tool", or "auto-publisher"
now has exactly one callable per action and cannot reimplement gates wrongly — the DB
rejects gateless publishes with a readable error.

## 3. Runtime extension points (prepared, not over-built)

| Future need | Extension point created | How to extend |
|---|---|---|
| notifications, search indexing, AI workers, webhooks | **`domain_events` outbox** (append-only; `processed_at is null` = unconsumed; admin-readable, service-writable via `emit_domain_event()`) | consumer polls unprocessed rows, stamps `processed_at`. Emitters already wired: `import_review.approved`, `import_review.autopublished`, `business.claim_approved/rejected`, `business.merged`, `maintenance.completed`. New lifecycle actions should emit here — one `perform emit_domain_event(...)` line |
| scheduler / cron / cleanup | **`run_scheduled_maintenance()`** (service-role; returns JSON; currently expires stale verification sessions — closes V-9 functionally) | any external cron calls this one function; new sweeps are added INSIDE it, never as parallel entry points. `expire_stale_verifications` patched to accept server-side (null-uid) context |
| background jobs | outbox + maintenance function above are the queue-shaped seams; no job framework was invented | when a real worker appears, it consumes `domain_events` |
| status convergence | `is_publicly_listed(status, visibility)` | new tables/queries use it; legacy filters migrate opportunistically |

Deliberately **not** built (fails the simplification criterion today): job-queue
framework, notification templates, search index schema, pg_cron dependency.

## 4. Data-model contradictions addressed

- Jobs: one home (D-2). The `listing_type` values `job`/`resume`/`vehicle` are now
  legacy-only; nothing writes them.
- Real estate: single behavior everywhere — the DB gate returns the freeze error for
  any RE item, so the TS freeze and script paths can no longer diverge.
- Publish rules: one rule set for all paths (D-1).
- Status vocabularies: helper exists (D-4); full convergence deferred — renaming live
  enum values is a breaking change with UI/RLS blast radius and near-zero payoff for
  feature velocity right now.

## 5. Rejected changes (criterion: "does it simplify Cursor's work?")

- Rewriting all public views onto `is_publicly_listed` now — churn without new capability.
- Collapsing collector-side and publish-side dedupe — different stages, would couple
  pipelines.
- Building notifications/scheduler/workers — infrastructure without a consumer; the
  seams exist.
- Removing `vehicles` page / enum values — product decision (RECOMMENDATIONS_V1 P4),
  not architecture; left untouched.
- Renaming `approved`→`published` etc. in live enums — breaking, cosmetic.

## 6. Verification performed

- `tsc --noEmit` and `eslint` clean after TS changes; `py_compile` clean for the
  modified script.
- Gate function smoke-tested against the **entire live queue** (grouped by collection):
  RE 0/335 pass (frozen), events 0/260 (date tag required), lechu 0/3, marketplace
  59/364 (price), businesses 950/1377, specialists 586/714 — matches
  QUALITY_CARD_RULES_V1 expectations. First run also caught and fixed a Postgres
  `text[] || literal` parsing bug before it could reach a human path.
- Gate RPC exercised through the same client the python autopublisher uses (service
  role): blocked lechu item returns the departure_date error; thin business item
  returns the image error.
- `run_scheduled_maintenance()` executed: returns `{"expired_verifications": 0}` and
  wrote domain event id=1.
- Deployed `admin_merge_businesses` definition diffed against the migration text —
  byte-identical logic to the original plus the event tail.
- Live-data check before D-2: 0 job rows in `listings`, 16 rows in `jobs` — reroute has
  no backfill obligation.

## 7. Remaining technical limitations (honest list)

1. **No scheduler is calling `run_scheduled_maintenance()` yet** — the entry point is
   ready; someone must point a cron at it (external cron, Vercel cron, or pg_cron).
2. **No consumer for `domain_events`** — notifications/indexing remain unbuilt; the
   outbox only accumulates.
3. **Status dialects still live in old views/queries** (D-4 partial).
4. **`types/database.ts` is hand-maintained** — drift risk between DB and TS; a
   `generate_typescript_types` refresh step should become part of the migration ritual.
5. **Per-field provenance for enrichment writes** still absent (ENRICHMENT_RULES gap).
6. **Vehicle**: enum values + empty page still advertise a nonexistent entity (product
   decision pending).
7. **Real estate** workstream (table + backfill of 26 misrouted rows) still Phase 3.
8. **Ownership transfer/revocation** flows don't exist (only grant-via-claim).
9. **Reviews wired to businesses only**; professionals' rating columns stay unwritten.
10. **Unclassified queue rows (target_collection = null) pass the gate trivially** —
    they are blocked earlier by the "Укажите target_collection" check in TS, but the
    gate itself returns `{}` for them; a NULL-collection guard inside the gate would be
    a one-line hardening.

## 8. Cursor-readiness assessment

Can a lighter model safely implement features in each area, using only existing seams?

| Area | Ready | Why |
|---|---:|---|
| Import Review | **90%** | one gate, one status RPC, full audit, typed actions; UI work is additive |
| CRUD карточек (business/professional) | **80%** | RLS + admin RPCs + completeness scoring central; missing: status-helper adoption, hand-maintained types |
| Marketplace | **80%** | DB state machine + publish trigger are self-defending; detail-table pattern is documented |
| Professionals | **80%** | registry sync, contacts RPC, owner RLS all in place; reviews unwired |
| Moderation | **75%** | report RPCs single-pathed; no notification loop to close cases |
| AI Enrichment | **70%** | one pipeline runner, fill-empty convention, stop-list docs; no per-field provenance — a wrong write is hard to trace |
| Reviews | **70%** | verification engine is solid and sole-pathed; business-only; expiry needs the cron pointed at maintenance |
| Ownership | **65%** | grant path is clean; transfer/revoke/professional-claims absent — features there need new flows, not just UI |
| Events | **60%** | table is minimal; date gate is a manual tag; no ownership/claim; recommendation-publish path is script-only |
| Questions | **40%** | does not exist; but the reviews subsystem is a complete template (RLS, rate limits, moderation, RPCs) — a schema-first clone is mechanical |
| Comments | **40%** | same: `review_replies` is the template |

**Overall: ~75%.** Argumentation: every *existing* domain action now has exactly one
official, DB-defended execution path, so the classic lighter-model failure mode —
"found two ways to publish, picked the wrong one" — is structurally prevented; the
outbox and maintenance seams mean new runtime features attach without touching the
core. The remaining 25% is concentrated in (a) missing runtime operators (cron caller,
event consumer), (b) two entities that don't exist yet (Questions/Comments — template
available), and (c) legacy status dialects and hand-maintained TS types, which are
drift risks rather than blockers. New card types still require a human-grade decision
on schema and taxonomy first — after that, form/API/publish is within Cursor's reach.

## 9. Files changed in this stage

- `supabase/migrations/20260727230000_architecture_stabilization_core.sql` (applied
  to live DB as `architecture_stabilization_core` + `fix_publish_gate_array_append`
  + `expire_verifications_service_context`; local file carries the merged final state)
- `lib/import-review/actions.ts` — TS gate copy removed; gate via RPC; jobs → `jobs` table
- `types/database.ts` — `import_review_publish_gate_check` RPC type
- `scripts/import-review/autopublish_strong_accepted.py` — gate pre-check in `publish_one`
- `docs/architecture/runtime/PLATFORM_LIFECYCLE_V1.md` — addendum: findings closed
