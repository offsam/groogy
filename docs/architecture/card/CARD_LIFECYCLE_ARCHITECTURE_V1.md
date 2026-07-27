# CARD LIFECYCLE ARCHITECTURE V1

The **actual** life of a card in this codebase — from raw source post to public page,
updates, and end state — documented per stage and per card type. Nothing here is a
proposal; where the system has a hole, it is marked **GAP**, not patched on paper.

**Verified against:** live schema + `scripts/telegram-collector/`,
`scripts/facebook-collector/`, `scripts/import-review/`, `scripts/business-enrich/`,
`lib/import-review/actions.ts`, migrations through `20260727230000` (single publish
gate, jobs → `jobs` table, domain-event outbox — all live as of 2026-07-27).
**Companion docs:** `runtime/PLATFORM_LIFECYCLE_V1.md` (subsystem map, state machines),
`runtime/ARCHITECTURE_STABILIZATION_V1.md` (what became single-pathed),
`domain/CORE_DOMAIN_ARCHITECTURE_V1.md` (Business/Professional/Customer semantics).

**Actor legend:** `AI` — LLM decides; `rule` — deterministic code; `human` — admin or
owner acts. Every stage below runs only when a human launches it — there is no
autonomous runtime (no cron/queue/workers).

---

## 1. The shared pipeline (all imported cards)

```text
Source → S1 Collect+Analyze → S2 AI Review → S3 Ingest → S4 Queue maintenance
       → S5 Human review → S6 Publish → S7 Post-publish enrichment
       → S8 Live updates → S9 End state
```

### S1 — Collect + Analyze

| | |
|---|---|
| Input | Raw Telegram messages (Telethon, 6-month hard window, `--allow-full-history` rejected), Facebook posts (Apify dataset), directory pages (`scrape_*.py`) |
| Output | Batch JSON in `scripts/*/data/` (merged logical posts + `extracted_entity`: entity_type guess, contacts, category guess, evidence), checkpoint file, LLM error log |
| Actor | `AI` (analyzer LLM via OpenRouter/OpenAI, hard cost cap `CostTracker`) + `rule` (merge of multi-message posts, contact regexes, per-batch dedupe) |
| SoT | none — these are pipeline artifacts, replayable; the DB is untouched |
| Transitions | n/a (pre-state) |
| GAP | batch JSONs are the only record of analyzer decisions; no provenance of prompt/model version lands in the DB later |

### S2 — AI Review pass (Reviewer v1 — collector-side, NOT human review)

| | |
|---|---|
| Input | S1 batches, `needs_review` items only |
| Output | verdict per post: `promote_to_accepted` / `keep_review` / `reject` + light corrections |
| Actor | `AI` (second LLM pass; does not re-extract facts) |
| SoT | none (still artifacts) |
| GAP | naming trap: "Reviewer" here is AI; human review is S5 (flagged as V-13) |

### S3 — Ingest into the queue

| | |
|---|---|
| Input | Reviewer output JSON + `--source-key` |
| Output | `import_review_items` rows, `review_status='pending'`, fields born from `map_post()`: source_* provenance block, `source_fingerprint` (unique — the idempotency key), entity_type/target_collection *only if the analyzer's guess is in the allowed sets, else NULL*, title/names, contacts arrays, price+currency, raw_payload (trigger-protected from update) |
| Actor | `rule` (`import_needs_review.py --apply`, idempotent re-runs safe) |
| SoT | **`import_review_items` becomes the staging SoT** for the card until publish |
| Transitions | `[*] → pending` |
| GAP | rows with unrecognized types enter as NULL-typed and sit until S4 classification; 2,574 such rows live today |

### S4 — Queue maintenance (each a separate manual CLI)

| Step | Input → Output | Actor |
|---|---|---|
| `hydrate_queue_media.py` | TG message → first photo to storage (`business-images/import-review/{id}/…`), `preview_image_url`, telegram contact backfill | rule |
| `enrich_queue.py` / `run_enrichment_pipeline.py` | own source_text → website fetch → local directory dumps; fill-empty contacts/city/image; completeness score logged before/after | rule (guarded by `JUNK_HOST_PARTS`/`PLATFORM_HOSTS`) |
| `classify_null_queue.py` | NULL-typed rows → entity_type/target_collection + `classification_confidence/reason` for HIGH only; MEDIUM stays NULL tagged `[needs_manual_type]` with the proposal; **never defaults to 'business'** | rule (reuses collector regex classifiers per NULL_CLASSIFICATION_ALGORITHM_V1) |
| `dedupe_open_queue.py`, `merge_pending_clusters.py` | repost clusters → `recurring_cluster_id`, `occurrence_count`, closed satellites | rule |
| Status here | still `pending` (or `needs_more_info`/`in_review` if a human already touched it) | |
| SoT | `import_review_items` (fill-empty only; review fields untouched) | |
| GAP | no ordering/orchestration between these steps — a human must know to run media before publish, classification before review; nothing enforces it |

### S5 — Human review

| | |
|---|---|
| Input | queue rows via `admin_list_import_review_items` (contact-priority ordering), admin UI `app/admin/import-review/` |
| Output | status decision + optional field edits (`admin_import_review_save_fields`) |
| Actor | `human` (admin) — the only stage that judges truth |
| SoT | `import_review_items` + full trail in `import_review_audit` (every transition: actor, from→to, payload) |
| Transitions | `pending ⇄ in_review`, `→ needs_more_info` (notes required), `→ duplicate` (target required), `→ rejected` (reason required), `→ ready_to_publish`; **`approved` is terminal** — no unpublish exists (V-2) |
| GAP | designed states `edited/merged/archived/imported/ai_classified` (REVIEW_WORKFLOW_V1) are not in the DB enum (V-1); restore-from-approved impossible |

### S6 — Publish (the single gate)

| | |
|---|---|
| Input | queue row in `pending`/`in_review`/`needs_more_info`/`ready_to_publish` |
| Output | entity row in the target table + `published_entity_{type,id}` back-link on the queue row + `import_review.approved`/`autopublished` domain event + audit row |
| Actor | `human` (admin approve in UI) or `rule` (`autopublish_strong_accepted.py --from-queue` for strong cards) |
| Gate | **one function for every path**: `import_review_publish_gate_errors()` in Postgres (per-type rules below; RE always frozen). Pre-checked by both paths, and re-raised inside `admin_import_review_mark_approved` / `service_import_review_mark_autopublished` — a gateless publish is structurally impossible |
| SoT handover | **entity table becomes the SoT**; queue row remains as immutable provenance |
| Transitions | `* → approved` (terminal) |
| GAP | items with `target_collection IS NULL` return `{}` from the gate (they are stopped by the TS "укажите target_collection" check, but the gate itself is silent on them — one-line hardening pending); category text → `category_id` resolution can still demand manual pick (`needs_manual` note) |

### S7 — Post-publish enrichment (fill-empty, manual CLI, per type — see §2)

Common properties: never overwrites non-empty fields; sources restricted per
ENRICHMENT_RULES_V1 tiers; reports to `scripts/*/data/`; **GAP:** no per-field
provenance column — after the run you cannot prove which script wrote what.

### S8 — Live updates

Owners (post-claim) edit fields inline; admins edit/merge/status; reviews update the
rating projection via trigger; completeness backfills. All SoT writes go to the entity
table. **GAP:** enrichment does not check ownership before writing (convention only).

### S9 — End state

Per type below. Shared truth: **nothing archives automatically** — no expiry sweeps,
no past-date archiving, no retention policy (PLATFORM_LIFECYCLE_V1 §13).

---

## 2. Per-type traces

### 2.1 Business

| Stage | Type-specific reality |
|---|---|
| Source | TG/FB posts; directory scrapers (svoi/ROP/boston/echoru → `data/yellow_pages`, imported via `import_yellow_pages_cards.py`); admin manual create (`admin_upsert_business`) bypasses S1–S6 |
| Gate (S6) | category + contact (phone/site/IG/TG) + description + image — 950/1377 queue businesses pass today |
| Publish target | `businesses` row, `status='approved'` directly; extras update (instagram/telegram urls); **SoT: `public.businesses`** |
| Post-publish (S7) | the richest set: `enrich_from_import_sources` (queue payload), `enrich_places_fill_empty` (Google), `fill_yelp_ratings`, `geocode_all_addresses`, `enrich_published_businesses` (own website), media pipeline (auto image), `completeness_score --apply` |
| Live (S8) | claim → `business_owners` → owner inline edits; reviews → `rating/reviews_count` trigger; `admin_merge_businesses` (children re-pointed, loser archived, `business.merged` event) |
| End (S9) | `archived` via merge or `admin_set_business_status`; `deferred` = hidden hold; hard delete admin-only |
| State path | `[*] → approved ⇄ deferred → archived` (draft/pending enum values unused — GAP for future self-service) |
| GAPs | no unpublish-to-queue; no retention; external ratings frozen in time (no refresh process) |

### 2.2 Professional

| Stage | Type-specific reality |
|---|---|
| Source | two birth paths: import (TG/FB/directories, unowned) and **self-service** (`draft` by the person, `owner_profile_id` set, `can_publish()` gate) — the only card type with a live self-service path |
| Gate (S6) | contact required; `category='other'` demands `[human_confirmed]` in review_notes — 586/714 pass today |
| Publish target | `professionals` row `status='approved'`; `published_at` stamped once by trigger; registry mirror (`entities`) synced by trigger; **SoT: `public.professionals`** |
| Post-publish (S7) | card-first scripts (svoi/orange-pages matching), avatars, `card_summary` (AI tier C — synthesis from own text only), city/region from group fallback (county-level by design) |
| Live (S8) | owner edits (self-service cards); contacts revealed only via `get_professional_contacts` (auth-gated, anti-scrape) |
| End (S9) | `archived`/`rejected`/`deferred` by admin or owner; registry mirror follows |
| State path | `draft → approved ⇄ deferred/pending → archived \| rejected` |
| GAPs | imported cards have **no claim path** ("это я" impossible); `rating_avg`/`reviews_count` exposed publicly but never written (reviews are business-only — V-11); no affiliation link to Business (CORE_DOMAIN §9) |

### 2.3 Event

| Stage | Type-specific reality |
|---|---|
| Source | TG/FB posts classified `events` (122 tagged by the P1 keyword pass); second path: comment-recommendation mining → `publish_recommendation_events.py` |
| Gate (S6) | pipeline does not extract `starts_at`/`event_at_label` → a human must verify the date and put `[event_date_confirmed]` into review_notes; 0/260 queue events pass the gate today — the queue is fully blocked on human date confirmation |
| Publish target | `events` row inserted **directly as `'published'`** (no draft step), `state_code='US-CA'` hardcoded, source provenance columns filled; **SoT: `public.events`** |
| Post-publish (S7) | none — no enrichment script targets events |
| Live (S8) | admin edits only; no ownership/claim concept for events |
| End (S9) | `archived` by admin, manually |
| State path | `[*] → published → archived` (`draft` reachable only for future flows) |
| GAPs | past events stay published (no date sweep); undated events labeled "дата уточняется" at best; hardcoded region; slug built from title without uniqueness suffix (collision risk); two publish paths (queue + recommendations) with different field sets |

### 2.4 Marketplace item

| Stage | Type-specific reality |
|---|---|
| Source | TG/FB sale posts (`marketplace_listing`); user self-service listings exist as a parallel non-import path (owner-created draft in UI) |
| Gate (S6) | `price` required (queue publish always creates `transaction_type='sell'`); 59/364 pass today — price extraction is the bottleneck (S4 price fill ran 2026-07-27; ambiguous `$18.000` rows excluded) |
| Publish target | `listings` row born `draft/unlisted` **owned by the approving admin** + `marketplace_listing_details` (condition `'good'`, type `'sell'`) → activated via `admin_set_listing_status(…,'active','import_review_approved')`; DB trigger `listings_validate_publish` is a second, unbypassable gate (city/state, active category of right domain, price for sell, "looks like service" rejection); **SoT: `public.listings` + details table** |
| Post-publish (S7) | none for imported listings |
| Live (S8) | owner transitions via `transition_listing_status` (compare-and-swap) — but the owner is the admin who approved (provenance quirk); moderation via reports → `removed`/`rejected` |
| End (S9) | `completed`/`archived`/`removed`; `expired` enum value **never set by anything** |
| State path | `draft → active ⇄ reserved → completed`, `active → paused` (service-like only), any → `archived/removed/rejected` |
| GAPs | admin-as-owner blocks real-seller handover (no ownership transfer); no expiry sweep despite `expires_at` data; condition always defaults `'good'` (not extracted) |

### 2.5 Job

| Stage | Type-specific reality |
|---|---|
| Source | TG/FB hire posts (`JOB_HIRE_RE` classifier); user/business self-service path (business-linked or private employer) |
| Gate (S6) | **deliberately ungated** — `employment_type`/`compensation_*` sit at 0% fill (QUALITY_CARD_RULES: the gate would freeze the category until the pipeline extracts them); 115/115 queue jobs "pass" |
| Publish target | **as of 2026-07-27:** `jobs` row `status='published'`, slug = slugified title + item-id suffix (collision-safe), provenance columns (`source_type/source_url/imported_at`) filled; before this date the route went to `listings type='job'` where cards were invisible on `/jobs` — 0 rows ever took that path, so no legacy split exists; **SoT: `public.jobs`** |
| Post-publish (S7) | none |
| Live (S8) | `can_manage_job()` (owner/business-owner/admin) edits; `published_at` stamped by trigger; registry mirror synced |
| End (S9) | `archived` manually; `expired` enum value never set (no sweep despite `expires_at` column) |
| State path | `draft → published → archived`; `pending/rejected/expired` reachable in enum, no runtime path sets `pending` (no jobs moderation flow) |
| GAPs | compensation/employment_type extraction missing → quality gate off; no expiry; imported jobs owned by approving admin (same handover gap as marketplace) |

---

## 3. Source-of-Truth ledger across the lifecycle

| Phase | SoT | Everything else |
|---|---|---|
| Before ingest (S1–S2) | none — replayable artifacts | batch JSONs, checkpoints |
| Queue (S3–S5) | `import_review_items` (+`import_review_audit` for history) | media copies in storage, enrichment reports |
| After publish (S6+) | per type: `businesses` / `professionals` / `events` / `listings`+details / `jobs` | queue row = frozen provenance (never edited after `approved`); `entities` registry = trigger mirror (professionals, jobs only); rating columns = review projections |
| Reviews/reputation | `reviews` subsystem; entity rating fields are refresh-only caches | — |

Handover rule observed everywhere: the queue row is never the SoT after `approved`,
and the entity never back-writes into the queue.

---

## 4. Consolidated GAPs and ambiguities (documentation of absence, not proposals)

**Cross-type:**
1. No orchestration between S4 steps — correct ordering lives in operators' heads.
2. `approved` is terminal: no unpublish/restore path from a published card back to
   the queue (V-1/V-2).
3. No per-field provenance for any S7 write.
4. Nothing archives/expires automatically anywhere (S9 is 100% manual).
5. Analyzer/Reviewer model+prompt versions never recorded in the DB (only
   `ANALYZER_VERSION` string in batch files).
6. NULL-collection rows pass the DB gate silently (blocked only by the TS check).
7. Admin-as-owner for imported listings/jobs; no ownership transfer to the real
   seller/employer.

**Per type:** Business — no external-rating refresh, no retention; Professional — no
claim for imported cards, reviews/rating unwired, no Business affiliation;
Event — no date sweep, hardcoded `US-CA`, slug collisions possible, two publish paths;
Marketplace — price extraction bottleneck (59/364), `expired` dead, condition not
extracted; Job — compensation/employment_type not extracted so the gate is off,
`expired`/`pending` dead states.

**Ambiguities (two names, one thing / one name, two things):**
- "Reviewer" = collector AI pass **and** human review center (V-13).
- "approved" on a queue row means *published*; "approved" on a business means
  *publicly listed*; jobs/events say "published" for the same phase (V-3 — mapping
  table in ENTITY_BASE_MODEL §3).
- "owner" of an imported listing/job = approving admin, not the economic owner.
