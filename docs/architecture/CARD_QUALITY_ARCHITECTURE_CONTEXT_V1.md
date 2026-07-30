# Card Quality Architecture Context V1

**Date:** 2026-07-28  
**Type:** Architecture context (history + rationale) — **not** an audit, not a redesign, not an implementation plan  
**Audience:** anyone making further Pipeline / Enrichment / Completeness / Review decisions  

**Purpose:** restore the *why* behind card-quality architecture so new work respects existing agreements, not only today’s code shape.

**Companion factual inventories (what exists):**  
[`COMPLETENESS_SCORE_AUDIT_V1.md`](./COMPLETENESS_SCORE_AUDIT_V1.md) · [`CARD_PROCESSING_ARCHITECTURE_V1.md`](./runtime/CARD_PROCESSING_ARCHITECTURE_V1.md) · [`ENRICHMENT_RULES_V1.md`](../audits/ENRICHMENT_RULES_V1.md) · [`QUALITY_CARD_RULES_V1.md`](../audits/QUALITY_CARD_RULES_V1.md)

---

## 1. History of the quality system

The platform did not start with a single “Card Quality” product. Quality emerged as **layered answers to successive operational problems**. Understanding the timeline matters: later layers were added *beside* earlier ones, not as replacements, because each layer serves a different custody moment (queue vs search vs catalog health vs publish safety).

### Phase A — Import Review as the quality surface (early)

**Problem:** Telegram/Facebook posts arrive messy; humans must decide publish / reject / duplicate.  
**Decision:** Put all importer output into `import_review_items` with `review_status`, contacts arrays, AI classify fields (`ai_decision` / `ai_confidence` / `ai_reason`), and an audit trail.  
**Why:** One queue item model for every source (later formalized in Admin Review Center architecture). Source must not fork the UI.  
**Quality meaning then:** “Can a moderator act?” — contact presence, title, city, category, photos — not a catalog richness score.

### Phase B — Contact priority + queue completeness counter (Admin list)

**Problem:** Moderators drowned in thin cards; phone-bearing cards should float up.  
**Decision:** SQL `import_review_contact_priority_score` (phone ≫ WhatsApp ≫ Telegram ≫ …) as the **default list sort**, with a tiny `import_review_completeness_score` (0–7 binary flags) as a **secondary** key.  
**Why:** Triage speed. Contact path is the strongest publish signal for community ads; counting filled metadata fields is a cheap “how whole is this row?” without a weighted catalog model.  
**Why not one unified score yet:** Queue rows lack hours, offers, ratings, geo — a business-style weight table would lie about “catalog quality.”

### Phase C — Publish gate ≠ richness (Quality Card Rules)

**Problem:** Thin entities were reaching public status; tightening DB `NOT NULL` would break most of the already-published catalog.  
**Decision:** Document and enforce **QUALITY_CARD_RULES** — max ~5–6 hard fields per entity type — in `import_review_publish_gate_errors()` (G3), consulted by approve + autopublish, **not** as overnight `NOT NULL` on tables.  
**Why:** Separate *permission to go live* from *how good the card looks*. Hours at ~3% fill must not block publish; address is trustful but storefront-less businesses exist. Gate is deliberately narrow.  
**Quality meaning:** “Minimum usable public card,” measured as pass/fail on named columns.

### Phase D — Enrichment as fill-empty ops (CLI toolbox)

**Problem:** After (and partly before) publish, contacts/geo/hours/ratings remain empty; collectors cannot invent them safely.  
**Decision:** Grow `scripts/business-enrich/` and queue enrich (`run_enrichment_pipeline`, `enrich_queue`) under an implicit then explicit policy: **fill-empty-only**, junk-host denylists, official-source hours/ratings.  
**Why:** Community trust — a wrong phone is worse than an empty phone. LLM inventing contacts was ruled out (`ENRICHMENT_RULES` tiers A/B/C).  
**Quality meaning:** Enrichment *improves* cards; it does not *decide* publish.

### Phase E — Entity Completeness Score columns (infrastructure prep)

**Problem:** After enrichment campaigns, operators needed a **quantitative** way to see catalog fill and enrichment effect; no per-field provenance yet.  
**Decision:** Add `businesses.completeness_score` / `professionals.completeness_score` + Python weight tables in `completeness_score.py`; refresh by explicit CLI `--apply`, **no trigger**.  
**Why:** Measurable enrichment delta (before→after); independent of gate and of search sort. Weights came from an infrastructure-prep specification (documented with known arithmetic caveats — see §2).  
**Why not auto on every write:** avoid silent score thrash and expensive related-count queries (offers/jobs) on every admin edit until product owns that cost.

### Phase F — Search ranking completeness (product UX, separate)

**Problem:** Empty / half-empty businesses floated oddly in SQL search and AI search results.  
**Decision:** In-memory `lib/business/completeness.ts` — push thin cards down after distance / hint match.  
**Why:** Fast, uses fields already on the public Business DTO (`presenceFlags`, coords, reviews). Did **not** wait for DB column backfill or mapper changes.  
**Quality meaning:** Relative sort key for discovery, not a stored KPI.

### Phase G — Canonical pipeline spine P0–P8 (runtime architecture)

**Problem:** Many scripts; operators (and agents) lacked a single allowed order.  
**Decision:** `CARD_PROCESSING_ARCHITECTURE_V1` — Collect → Ingest → Extract → Classify → Dedupe → Review → Publish → Post-Enrich → Live; gates G1–G3; forbid P7 writing queue and P2 writing entities.  
**Why:** Determinism and custody: queue is provenance until approve; entity is SoT after. Human judgment only at Review (P5 / later P5D).

### Phase H — Pre-publish enrich as Review sub-stages (P5A–C), auto OFF

**Problem:** Moderators should decide on a fuller card; post-only enrich leaves Review looking at raw extraction.  
**Decision:** Reposition **existing queue enrich** as P5A–C before P5D moderator; tags in `review_notes`; CLI orchestrator; **no auto launch**; entity-only enrich (Places, ratings, pro summary) remains P7.  
**Why:** Reuse, not a second enrichment stack; avoid enum migration; keep Places cost and entity schema constraints after publish.

### Parallel track — Designed Review workflow (13 states) vs live enum (7)

**Problem:** Product wanted richer workflow (`imported`, `ai_classified`, `edited`, `merged`, …).  
**Decision (freeze):** Workflow V1 names are **canonical intent**; live DB keeps 7 values as **aliases** until a deliberate enum expansion (`ARCHITECTURE_FREEZE` C7, `PLATFORM_LIFECYCLE` V-1).  
**Why:** Shipping moderation and gates mattered more than renaming states under load; expanding enums without migration plan is high-risk.

---

## 2. Completeness Score — why this formula

### 2.1 Why a score exists at all

Three distinct jobs were never meant to share one number:

| Job | Mechanism chosen | Why that mechanism |
|---|---|---|
| May this card go public? | Quality Card / G3 pass–fail | Hard safety; sparse fields must not block the catalog |
| Which queue row should a moderator open next? | Contact priority (+ tiny 0–7) | Contact path dominates import quality for ads |
| How rich is a published Business/Pro? | Entity weight sum (`completeness_score.py`) | Enrichment KPI and catalog health |
| Which result should appear higher in search? | Search completeness helper | UX ranking with DTO fields already loaded |

The entity Completeness Score answers **only the third**. Treating it as publish permission or inbox priority would conflate those jobs.

### 2.2 Why these weights (Business / Professional)

Documented origin: infrastructure-prep task captured in [`ENRICHMENT_INFRASTRUCTURE_V1.md`](../audits/ENRICHMENT_INFRASTRUCTURE_V1.md) — weights implemented **as specified**, with caveats recorded rather than silently “fixed.”

**Business intent (read from the weight table + gate contrast):**

- **Identity / findability** (name, category, city, image, short blurb) — enough to recognize the card; overlaps gate but still scored so empty category hurts richness metrics even when grandfathered live rows exist.  
- **Reachability** (phone, website, socials, email, booking) — contact richness beyond the gate’s “≥1 path.”  
- **Place truth** (address, geo, hours) — hours weighted **high (8)** because they are rare, expensive (Places), and high user value; geo/address scored so map and trust improve without being publish blockers.  
- **Social proof** (Google/Yelp ratings & review volume) — official-source tier B; rewards enrich campaigns without inventing stars.  
- **Commercial depth** (offers ≥3, priced offer, featured “promo,” related jobs) — catalog as marketplace of services, not just a phone book.  
- **Provenance** (`source_url`) — small weight; encourages linkage back to import.  
- **facebook_url / whatsapp** — reserved weights (2+2) for schema growth; columns were absent, so points stay 0 by design (“если поле есть”), **not** rescaled to fake a 100 max. Spec arithmetic sums to **98**; reachable ~**96**. Left as-is so scores stay comparable to the written table.

**Professional intent:**

- Heavier **any_contact (15)** and **category_not_other (10)** — specialists without contact or dumped into `pro_other` fail product usefulness even if named.  
- **card_summary (5)** — tier-C AI synthesis from own text is an allowed richness signal unique to pros.  
- **image (8)** — face/brand for specialist cards.  
- City **or** service area — mobile specialists without storefront.  
- Weights sum cleanly to **100**.

**Description heuristic (≥40 chars / ≥6 words / not placeholder):** stops scoring stub blurbs and template filler as “real copy,” acknowledging template blurbs exist as last-resort ops tools.

### 2.3 What “ranges” mean

**There are no official product bands (0–20 / 20–40 / …) for Completeness Score.**  
The number is an **additive point total** (optionally read as `score / max_possible`). Interpreting bands is informal operator habit, not architecture.

Rough **operational reading** people use in practice (not normative):

| Rough band (Business /98) | Typical meaning in ops talk |
|---|---|
| Very low | Identity + maybe one contact; enrichment not run or sources empty |
| Mid | Contacts + some copy/city/image; still missing hours/geo/ratings/offers |
| High | Post-Places / post-offers / ratings present — enrichment campaign landed |

Professional /100 reads similarly with contact+category+image dominating early gains.

### 2.4 Business problems the score solves

1. Measure enrichment campaign effect (before→after in pipeline reports).  
2. Rank catalog health for Business/Pro without waiting for provenance columns.  
3. Give a single integer ops can sort/filter in SQL after `--apply`.  

It does **not** solve: publish permission, inbox triage, search ranking (those use other mechanisms by design).

### 2.5 Compromises explicitly accepted

| Compromise | Why accepted |
|---|---|
| Business max 98 / practical 96 | Do not rescale; keep fidelity to the written weight table |
| Promotions = featured offers proxy | No promotions table; document assumption |
| Manual `--apply`, no trigger | Cost + clarity of when score updates |
| Queue uses a “floor” mapping of the same scorer | Queue lacks hours/offers; score is a lower bound, not final |
| Search uses a different formula | DTO-ready ranking without depending on column freshness |
| No Marketplace/Job/Event entity scorer | Different schemas; listing has a separate queue `LISTING_WEIGHTS` when needed |

---

## 3. Important architectural decisions (decision · reason · alternatives · rejected because)

### D1 — Multiple completeness-like numbers instead of one global score

- **Decision:** Keep entity scorer, queue 0–7, search helper, autopublish 0–7, admin checklist separate.  
- **Reason:** Different custody (queue vs entity), different field availability, different consumers (moderator vs end-user search vs ops KPI).  
- **Alternatives:** One score for everything; force search to read DB column; force gate to use score thresholds.  
- **Rejected:** One score would either block publish on sparse hours, or undervalue enrichment richness, or invent queue fields that do not exist. Gate must stay pass/fail on named fields (`QUALITY_CARD_RULES`).

### D2 — Publish gate ignores Completeness Score

- **Decision:** G3 = Quality Card field rules only.  
- **Reason:** Live fill rates made richness thresholds catastrophic (e.g. hours ~3%). Gate stops *new thin* rows; does not re-litigate grandfathered catalog via score.  
- **Alternatives:** Require score ≥ N to approve.  
- **Rejected:** Would halt publish and conflate enrichment progress with legal/usable minimum.

### D3 — Fill-empty-only enrichment + AI stop-list (tiers A/B/C)

- **Decision:** Never overwrite non-empty; never LLM-invent contacts/address/money/ratings; hours/ratings only from named official sources; generative only for constrained fields (e.g. pro `card_summary` from own text).  
- **Reason:** Trust and harm model for a community directory.  
- **Alternatives:** Always-refresh from latest scrape; LLM-fill empty phones from “likely” patterns.  
- **Rejected:** Overwrites destroy moderator/owner truth; invented contacts are actively harmful (`ENRICHMENT_RULES`).

### D4 — Queue enrich vs entity enrich (P2/P5A vs P7)

- **Decision:** Queue scripts write only `import_review_items`; entity scripts write only published tables; order P0…P6 then P7.  
- **Reason:** After approve, queue row is frozen provenance; entity is SoT (`CARD_PROCESSING`).  
- **Alternatives:** Enrich only after publish; or write Places into queue columns.  
- **Rejected:** Queue has no lat/lng/hours/ratings columns; Places cost should not run on every pending row; freezing provenance requires not mutating approved queue rows.

### D5 — Pre-publish enrich (P5A–C) reuses queue modules; auto OFF

- **Decision:** Orchestrate existing `run_enrichment_pipeline` steps before moderator; tags; no cron.  
- **Reason:** Fuller card at Review without a new enrichment product; Places/AI summary stay entity-side.  
- **Alternatives:** New P7 clone for queue; auto-enrich every `pending` row.  
- **Rejected:** Duplication; cost/surprise writes; violates “no new enrichment stack” and dry-run-first ops culture.

### D6 — Live 7 review statuses; designed 13 as aliases

- **Decision:** Do not expand DB enum until a dedicated migration program; map workflow names in docs/UI.  
- **Reason:** Freeze C7 — workflow is canonical intent; production machine already enforces audit + terminal `approved`.  
- **Alternatives:** Immediate enum migration to 13 states.  
- **Rejected:** High migration risk vs moderation continuity; tags cover enrich sub-phases without enum growth (`CARD_PROCESSING` §10 explicitly rejects new stage columns/statuses as required).

### D7 — Contact priority primary sort; completeness secondary in Review list

- **Decision:** Default `p_sort=priority` → `cps` desc, then `cms` (0–7), then confidence.  
- **Reason:** A card with a phone is actionable; a card with title+city but no contact is not.  
- **Alternatives:** Sort purely by AI confidence or by entity-style weighted score.  
- **Rejected:** Confidence ≠ publishability; weighted entity score unavailable/misleading on queue.

### D8 — Autopublish uses eligibility completeness (0–7) + contact buckets + confidence — not entity score

- **Decision:** `eligibility.py` ranks strong accepted cards with a simple field count.  
- **Reason:** Autopublish runs on queue rows before entity exists.  
- **Alternatives:** Require entity completeness after a draft publish.  
- **Rejected:** Would invent a draft-entity loop not in the canon.

### D9 — Admin checklist (`preview-completeness`) is UX, not scoring

- **Decision:** Show “есть/нужно” field list for moderators and recommendation preview.  
- **Reason:** Human-readable “what to fill before publish,” aligned to preview card, not ops KPI.  
- **Alternatives:** Show only the integer entity score in UI.  
- **Rejected:** Integer without breakdown does not tell moderators which field to edit; queue floor ≠ final score.

### D10 — No per-field provenance columns (yet)

- **Decision:** Accept report-file / in-memory `sources` dicts; do not block enrichment on provenance schema.  
- **Reason:** Provenance is acknowledged debt (`ENRICHMENT_RULES`, lifecycle); additive enrichment still valuable.  
- **Alternatives:** Block all enrich until provenance ships.  
- **Rejected:** Would freeze catalog improvement; fill-empty + tier rules are the interim control.

### D11 — Manual pipeline launches (no required scheduler)

- **Decision:** Canon requires **order and gates**, not a workflow engine (`CARD_PROCESSING`).  
- **Reason:** Idempotent CLI + human Review is survivable; scheduler is optional later.  
- **Alternatives:** Mandatory queue framework / always-on enrich.  
- **Rejected:** Out of scope for deterministic architecture; increases accidental mass writes.

### D12 — Real Estate publish frozen

- **Decision:** Approve of RE types parks `needs_more_info` until Phase 3 table ready.  
- **Reason:** Prevent misroute into marketplace listings (historical damage).  
- **Alternatives:** Keep publishing into listings.  
- **Rejected:** Corrupts marketplace SoT (`PLATFORM_LIFECYCLE`).

---

## 4. Document / ADR map (quality-related)

There is **no** numbered `ADR-0001` series in-repo. The following **architecture and freeze docs act as ADRs** for their domains. Brief descriptions only.

### Normative / freeze (treat as binding intent)

| Document | Role |
|---|---|
| [`entity-model-v1/ARCHITECTURE_FREEZE_V1.md`](./entity-model-v1/ARCHITECTURE_FREEZE_V1.md) | Resolves contradictions (Pro≠Business link, review name aliases, hubs, ACL A, …) |
| [`runtime/CARD_PROCESSING_ARCHITECTURE_V1.md`](./runtime/CARD_PROCESSING_ARCHITECTURE_V1.md) | Canonical P0–P8 order, gates G1–G3, idempotency, forbidden states |
| [`runtime/PLATFORM_LIFECYCLE_V1.md`](./runtime/PLATFORM_LIFECYCLE_V1.md) | Live runtime SoT: state machines, publish, enrichment posture, known variances |
| [`runtime/ARCHITECTURE_STABILIZATION_V1.md`](./runtime/ARCHITECTURE_STABILIZATION_V1.md) | Stabilization decisions (incl. publish gate backstop) |
| [`audits/ENRICHMENT_RULES_V1.md`](../audits/ENRICHMENT_RULES_V1.md) | AI/enrich field tiers A/B/C — what may never be invented |
| [`audits/QUALITY_CARD_RULES_V1.md`](../audits/QUALITY_CARD_RULES_V1.md) | Minimum publish fields per entity — G3 content |
| [`entity-model-v1/REVIEW_WORKFLOW_V1.md`](./entity-model-v1/REVIEW_WORKFLOW_V1.md) | Designed 13-state review machine (intent) |
| [`entity-model-v1/ADMIN_REVIEW_CENTER_V1.md`](./entity-model-v1/ADMIN_REVIEW_CENTER_V1.md) | Review UI architecture: one queue model, provenance, speed |
| [`ADMIN_PANEL_IA_V2.md`](./ADMIN_PANEL_IA_V2.md) | Admin IA ADR — Review Center as decision hub |
| [`domain/CORE_DOMAIN_ARCHITECTURE_V1.md`](./domain/CORE_DOMAIN_ARCHITECTURE_V1.md) | Domain actors / aggregates |
| [`entity-model-v1/ENTITY_TYPE_MAPPING_V1.md`](./entity-model-v1/ENTITY_TYPE_MAPPING_V1.md) | Legacy↔canonical type/status aliases |
| [`pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md`](./pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md) | Extraction/classify contract (formats, stop-lists) |

### Lifecycle / card narrative

| Document | Role |
|---|---|
| [`card/CARD_LIFECYCLE_ARCHITECTURE_V1.md`](./card/CARD_LIFECYCLE_ARCHITECTURE_V1.md) | Descriptive lifecycle + GAPs vs design |
| [`P5_PRE_PUBLISH_ENRICH_INTEGRATION_V1.md`](./P5_PRE_PUBLISH_ENRICH_INTEGRATION_V1.md) | P5A–C integration of existing queue enrich |
| [`P7_POST_ENRICH_CAPABILITIES_AUDIT_V1.md`](./P7_POST_ENRICH_CAPABILITIES_AUDIT_V1.md) | What P7 can/cannot do |
| [`ENRICHMENT_PIPELINE_EXISTENCE_AUDIT_V1.md`](./ENRICHMENT_PIPELINE_EXISTENCE_AUDIT_V1.md) | Existing pipeline inventory |
| [`PIPELINE_COVERAGE_AUDIT_V1.md`](./PIPELINE_COVERAGE_AUDIT_V1.md) | Source × entity coverage |
| [`COMPLETENESS_SCORE_AUDIT_V1.md`](./COMPLETENESS_SCORE_AUDIT_V1.md) | Factual map of all scorers |

### Enrichment / quality audits (evidence)

| Document | Role |
|---|---|
| [`audits/ENRICHMENT_AUDIT_V1.md`](../audits/ENRICHMENT_AUDIT_V1.md) | What scripts fill which fields |
| [`audits/ENRICHMENT_INFRASTRUCTURE_V1.md`](../audits/ENRICHMENT_INFRASTRUCTURE_V1.md) | Completeness columns + weight caveats + scraper fixes |
| [`audits/PIPELINE_AUDIT_V1.md`](../audits/PIPELINE_AUDIT_V1.md) | Pipeline stage inventory |
| [`audits/FIELD_AUDIT_V1.md`](../audits/FIELD_AUDIT_V1.md) | Field fill reality |
| [`audits/DEAD_FIELDS_V1.md`](../audits/DEAD_FIELDS_V1.md) | Unused / default-only fields |
| [`audits/NULL_CLASSIFICATION_ALGORITHM_V1.md`](../audits/NULL_CLASSIFICATION_ALGORITHM_V1.md) | Untyped queue decision tree |

### Entity / publish / ownership

| Document | Role |
|---|---|
| [`entity-model-v1/BUSINESS_ENTITY_V1.md`](./entity-model-v1/BUSINESS_ENTITY_V1.md) | Business entity contract |
| [`entity-model-v1/PROFESSIONAL_ENTITY_V1.md`](./entity-model-v1/PROFESSIONAL_ENTITY_V1.md) | Professional entity contract |
| [`entity-model-v1/MARKETPLACE_ENTITY_V1.md`](./entity-model-v1/MARKETPLACE_ENTITY_V1.md) | Marketplace |
| [`entity-model-v1/JOBS_ENTITY_V1.md`](./entity-model-v1/JOBS_ENTITY_V1.md) · [`JOBS_AND_PUBLISH.md`](./entity-model-v1/JOBS_AND_PUBLISH.md) | Jobs + publish rules |
| [`entity-model-v1/OWNERSHIP_SOURCE_CLAIM.md`](./entity-model-v1/OWNERSHIP_SOURCE_CLAIM.md) | Source / claim model |
| [`entity-model-v1/ACCESS_MODEL_V1.md`](./entity-model-v1/ACCESS_MODEL_V1.md) | Platform vs entity access |
| [`ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md`](./ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md) | Alignment program |

### Navigation indexes (entry points, not ADR text)

| Document | Role |
|---|---|
| [`../navigation/runtime/ENRICHMENT.md`](../navigation/runtime/ENRICHMENT.md) | Enrichment map |
| [`../navigation/runtime/PUBLISH.md`](../navigation/runtime/PUBLISH.md) | Publish map |
| [`../navigation/runtime/REVIEW.md`](../navigation/runtime/REVIEW.md) | Review map |
| [`../navigation/runtime/SEARCH.md`](../navigation/runtime/SEARCH.md) | Search map |
| [`../navigation/runtime/IMPORT.md`](../navigation/runtime/IMPORT.md) | Import map |
| [`../navigation/pipeline/INDEX.md`](../navigation/pipeline/INDEX.md) | Pipeline index |
| [`../navigation/AI_AGENT_START_HERE.md`](../navigation/AI_AGENT_START_HERE.md) | Agent entry |

### Admin Panel IA series (Review product surface)

| Document | Role |
|---|---|
| [`ADMIN_PANEL_IA_V2.md`](./ADMIN_PANEL_IA_V2.md) | IA ADR |
| [`ADMIN_PANEL_REVIEW_WORKSPACE_AUDIT_V1.md`](./ADMIN_PANEL_REVIEW_WORKSPACE_AUDIT_V1.md) | Workspace capabilities |
| [`ADMIN_PANEL_INBOX_UX_V1.md`](./ADMIN_PANEL_INBOX_UX_V1.md) | Inbox UX |
| [`ADMIN_PANEL_IA_INDEPENDENCE_V1.md`](./ADMIN_PANEL_IA_INDEPENDENCE_V1.md) | IA vs legacy routes |

---

## 5. Business logic — how a card should live (by architecture)

This is the **intended** story as written across SoT docs (not a code walkthrough).

### 5.1 From import to public

1. **Collect / Ingest** — Source batch → `import_review_items` with fingerprint, immutable `raw_payload`, `pending`. Provenance born here.  
2. **Extract** — Fill empty contacts/city/image from the item’s own material (text, website, directories). Idempotent.  
3. **Classify** — Set `entity_type` + `target_collection` together, or park `[needs_manual_type]`. Never silent default to business.  
4. **Dedupe** — Cluster / mark satellites `duplicate` with required target.  
5. **Review enrich (intended P5A–C)** — Same queue enrich, then completeness tagging; even partial → still human-visible. Auto off until ops choose.  
6. **Moderator (P5D)** — Human decides: edit fields, reject (+reason), duplicate, needs_more_info (+notes), promote `ready_to_publish`, or approve. Only content-judgment stage.  
7. **Publish (P6)** — G3 Quality Card must pass; entity created; queue → terminal `approved` with published ids; queue frozen.  
8. **Post-enrich (P7)** — Fill-empty on **entity** (Places, geocode, ratings, pro summary, …).  
9. **Live (P8)** — Owner/admin edits, reviews projection, merge/archive — outside import pipeline.

### 5.2 How quality is determined (three lenses)

| Lens | Question | Answer in architecture |
|---|---|---|
| **Publishable?** | May it go live? | Quality Card / G3 — hard fields only |
| **Reviewable / prioritized?** | What should a human open? | Contact priority (+ queue completeness 0–7, AI confidence) |
| **Rich / enriched?** | How complete is the catalog card? | Entity Completeness Score (Business/Pro); search uses its own relative helper |

Moderator checklist (“есть/нужно”) is a **fourth lens for humans editing**, not a substitute for G3 or entity score.

### 5.3 How priority is determined

- **Review Inbox / Import list:** contact priority score first; then queue completeness; then AI confidence; then recency (RPC `priority` sort). Inbox also has a separate AI+age+type priority for mixed review types — not completeness.  
- **Autopublish:** contact bucket + confidence + eligibility completeness (0–7).  
- **Search:** hint match → distance (if near) → search completeness helper → rating/name ties.

### 5.4 How readiness to publish is determined

1. Typed + consistent `entity_type` / `target_collection` (G2).  
2. Not an unresolved duplicate (or force with intent).  
3. **G3 Quality Card** returns no errors for that target.  
4. Human (or autopublish policy) chooses approve / mark approved.  
5. `ready_to_publish` means “policy/human promoted,” **not** “completeness band X.” Enrich tags `[ready_for_moderator]` mean “P5A–C finished (even partial),” not G3 pass.

---

## 6. Known limitations (intentional vs debt vs “don’t touch lightly”)

### Looks odd but intentional

| Observation | Intent |
|---|---|
| Several “completeness” formulas | Different jobs (§2.1, D1) |
| Gate ignores Completeness Score | Hours/geo must not block publish |
| Business score max 98 / 96 | Spec fidelity; missing social columns |
| Search ignores DB `completeness_score` | Ranking shipped on DTO without column coupling |
| Designed 13 review states vs live 7 | Freeze: aliases until enum program |
| Enrichment is manual CLI | Order/gates > scheduler; avoid mass accidents |
| `approved` terminal / no unpublish | Live machine stricter than design Restore story |
| RE approve frozen to `needs_more_info` | Protect marketplace from misroute |
| Template blurbs / OCR lower trust | Allowed last-resort / extraction, not tier-C invention |
| P5A–C auto OFF | Dry-run culture; Places/AI cost control |

### Do not change without architecture revisit

Changing these is not a local tweak — it revises agreements in Freeze / Card Processing / Enrichment Rules / Quality Card:

- Fill-empty-only + AI tier A/B/C stop-list  
- G3 as sole publish gate content (and “max 5–6 fields”)  
- Queue vs entity write boundary (P2/P5 vs P7)  
- Terminal `approved` + frozen `raw_payload`  
- Independent Professional vs Business (no required link)  
- Live 7-status enum without a migration program  
- Taxonomy / hub freezes that feed classification and Review  

### Technical debt (acknowledged in SoT docs — not “bugs to silently fix”)

- No per-field provenance columns  
- Entity Completeness not continuously recomputed  
- Search score ≠ entity score (dual systems)  
- Queue completeness 0–7 ≠ entity weights  
- Workspace load hardcodes completeness 0 in one adapter path  
- Marketplace/Job/Event lack entity completeness SoT  
- Provenance / always-apply scripts exist as ops hazards  
- Designed workflow states and Review Center provenance UI ahead of DB/UI full delivery  

---

## How to use this document

Before proposing a new score, gate, enrich stage, or status:

1. Identify which **job** you are changing (publishable / triage / richness / search).  
2. Find the decision in §3 or the SoT doc in §4.  
3. Prefer extending the layer that already owns that job.  
4. Treat audits (§4 inventories) as *evidence*, this file as *rationale*.

*End of Card Quality Architecture Context V1.*
