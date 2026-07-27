# DATA CLEANUP PLAN V1

**Date:** 2026-07-27
**Scope:** turn the six existing audit docs into an actionable cleanup plan for the NULL `entity_type` backlog, per-type quality gates, an AI enrichment stop-list, dead-field cleanup, and the Real Estate/Business split.
**Constraint honored:** analysis and documents only. No code was changed, no migration was applied, no data was written. All SQL run this session was `SELECT`; every `UPDATE`/`INSERT`/`DELETE`/`DROP` in this plan family is a proposal, marked as such, living only in `PHASE_PLAN_V1.md`.
**Method:** (1) read `supabase/` (schema/migrations/RLS), `lib/` (enrichment, classification, import logic), `scripts/` (collectors, enrichment, import-review), `.cursor/rules/`, and `app/` (what's actually rendered) directly; (2) ran live read-only SQL against the production DB via the repo's own `scripts/sb_sql.py`; (3) read the six existing audit docs and cross-checked their numbers against the live queries.

---

## Verification result: live DB vs. existing audits

Every number spot-checked this session (import_review_items totals/by entity_type/by review_status, businesses/professionals/jobs/events status breakdowns, phone/address/geo/hours fill rates, marketplace price fill, `real_estate_listings`/`vehicles` table existence) **matched `PLATFORM_DATA_AUDIT_V1.md` / `FIELD_AUDIT_V1.md` exactly**. The existing audits are current and accurate as of today. Two refinements surfaced during this pass, not contradictions of the numbers but corrections to how two findings were framed:

1. **`real_estate_listings` and `vehicles` do not exist as tables or views at all** in the live schema (confirmed via `information_schema.tables`) — not "exist but orphaned," as a first read of the app code (`app/real-estate/page.tsx`, `app/vehicles/page.tsx`) could suggest, since those routes query the table names directly wrapped in a try/catch that silently swallows the resulting error. The audits' "no dedicated table" claim is correct; worth stating precisely because the app code alone would mislead someone into thinking the table exists.
2. **`business_offer_media` should not be grouped with `professional_portfolio_media`** as "empty, freeze until needed" (as `RECOMMENDATIONS_V1.md` §1 does). `professional_portfolio_media` has zero code references anywhere outside an unapplied draft schema — genuinely dead. `business_offer_media` is actively wired into `lib/business-offers/actions.ts`/`queries.ts` — it's a working, empty-because-unused feature, not dead schema. See `DEAD_FIELDS_V1.md` §3 for detail. This changes its deletion risk from "low" to "high."

No other discrepancies found. The rest of this plan builds directly on the existing audits' numbers.

---

## 3.1 — NULL-queue classification

Full detail: [NULL_CLASSIFICATION_ALGORITHM_V1.md](./NULL_CLASSIFICATION_ALGORITHM_V1.md)

Headline finding: all 4,521 NULL rows already have `ai_decision`/`ai_confidence`/`ai_reason` populated — but that field is a **queue-routing verdict** ("does this need a human"), not an entity-type verdict. No script anywhere in the repo has ever run a type-classifier against this specific backlog; the classifiers that exist (`scripts/telegram-collector/reviewer.py`, `scripts/facebook-collector/facebook_decision_policy.py`) should be reused as-is rather than reimplemented. `category` text is 100% filled and is the strongest signal, but only ~3% of rows (events, real-estate keywords) have a category that unambiguously implies entity_type — the rest require the existing name-presence/regex classifiers, and a meaningful remainder (especially the 613 Facebook rows, which carry almost no structured signal) cannot be classified at all and needs an explicit disposition rule (stale-reject vs. manual-review-lowest-priority), not a forced guess.

## 3.2 — Minimum Quality Card per type

Full detail: [QUALITY_CARD_RULES_V1.md](./QUALITY_CARD_RULES_V1.md)

5–6 hard-required fields per type (Business, Professional, Marketplace, Job, Event, Transfer, Lechu), named by exact column, with the live fill rate for each so it's clear which gates are "mostly already met" (Business, Event) vs. "would currently block nearly everything" (Marketplace price/photos, Job compensation, Transfer fees, Lechu departure date) — the latter group needs a pipeline fix, not just an admin-discipline change, before the gate can be turned on without freezing the category.

## 3.3 — AI Enrichment stop-list

Full detail: [ENRICHMENT_RULES_V1.md](./ENRICHMENT_RULES_V1.md)

Three tiers: (A) never AI-generated — contacts, address, money, ratings, coordinates, identity, must come from source or be left empty; (B) AI-assisted extraction allowed only from a named official source (Google/Yelp/official site/geocoder) — includes a specific carve-out for the Gemini vision OCR step already running on Telegram flyer photos, which should be treated as lower-trust extraction with provenance tagging, not free generation; (C) AI may generate freely only when synthesizing from the entity's own existing text (`card_summary`, description merges) — never inventing new facts. The gap found: none of this is enforced in code today beyond script-docstring convention (fill-empty-only) and a couple of ad hoc denylists/allowlists (`JUNK_HOST_PARTS`, `ALLOWED_ATTRS`); there's no per-field provenance column to audit after the fact.

## 3.4 — Dead fields

Full detail: [DEAD_FIELDS_V1.md](./DEAD_FIELDS_V1.md)

Only **one** column/table clears both "near-zero fill" and "zero code references": `professional_portfolio_media`. Everything else that looked dead by fill-rate alone turned out to be either (a) wired into running enrichment scripts or TS query/admin code (`public_exact_address`, `instagram_followers_count`, `city_geoid`, `subcategory`), (b) required by the quality-card gates defined in 3.2 and therefore a pipeline gap, not schema debt (marketplace price, transfer fees, lechu departure date, job compensation, service-listing pricing/license fields — the last of which is actively rendered on the public services page), or (c) tied to a shipped-but-unused feature with its own RLS test suite (Reviews verification counters).

## 3.5 — Real Estate vs Business

Full detail: [PHASE_PLAN_V1.md](./PHASE_PLAN_V1.md) §2.3, §3.3

There is no dedicated `real_estate_listings` table live — confirmed. There **is** a fully-designed, frozen, unapplied draft for one (`docs/architecture/entity-model-v1/REAL_ESTATE_ENTITY_V1.md` + `001_additive_schema.sql`), with a role split already specified: **agency → Business**, **individual realtor → Professional**, **specific unit for rent/sale → `real_estate_listings`** (new). The 128 approved businesses in category `real_estate` are not automatically wrong under this split — agencies and agents legitimately live there. The concrete misroute is narrower: 21 businesses + 5 listings that came from `import_review_items` rows explicitly tagged `entity_type='real_estate'` and approved — these need a human pass against the role-split criteria (unit-attribute language vs. agency branding) to see which actually belong in the future `real_estate_listings` table. Building that table and fixing the publish-route bug in `lib/import-review/actions.ts` (which currently forces any `real_estate` approval into a generic `marketplace_item` listing) is scoped as its own workstream in Phase 3, not folded into the routine cleanup.

## 3.6 — Three-phase plan

Full detail: [PHASE_PLAN_V1.md](./PHASE_PLAN_V1.md)

- **Phase 1 (automatic):** exactly two `UPDATE`s — tag `category='events'` and the real-estate category keywords in the NULL backlog. Deterministic, reversible, touches only staging fields. Everything else was deliberately excluded from "automatic" because it involves a judgment call.
- **Phase 2 (human review):** classify the ambiguous majority of the NULL backlog using the existing regex/name classifiers with human spot-checks before bulk-applying; decide disposition (reject vs. keep) for the genuinely unclassifiable remainder; review the 26 misrouted real-estate rows against the role split; repair the `services`/`pro_other` category dumps; run the quality-card gates as a read-only report against the existing catalog (no auto-unpublish).
- **Phase 3 (deletion/schema):** drop `professional_portfolio_media` (the one confirmed-safe case, after a zero-FK-dependents check); a short list of conditional drops that require an explicit product sign-off first (professional experience/availability/radius fields, `city_geoid`/`county_geoid` master-data linkage); and the Real Estate entity build-out as its own sequenced sub-project (apply the draft schema → fix the publish route → backfill the human-confirmed subset → never delete a source row before its migrated counterpart is verified).

---

## What's missing / not knowable from this pass

- Exact size of the "genuinely unclassifiable" NULL remainder (Gate 3 in the classification algorithm) — this requires actually running the dry-run classifier, which wasn't executed as part of this analysis-only task. Sizing it is the first step of Phase 2.1.
- Regex hit-rates for `LECHU_RE`/`TRANSFER_RE`/`JOB_HIRE_RE`/`MARKETPLACE_RE`/`BUSINESS_SIGNAL_RE`/`SPECIALIST_SIGNAL_RE` against the current NULL backlog specifically — not measured live this session; needed before trusting Gate 1/2 auto-tagging at scale.
- Whether the Reviews feature (`rating_avg`/`reviews_count`/verification counters, all 0 live) is still an active roadmap item — without that answer, `DEAD_FIELDS_V1.md` §6 can't be resolved either way.
- Whether any planned professional-profile-edit form depends on `experience_years`/`availability_text`/`service_radius_m` existing — needed before treating those as safe to drop in Phase 3.2.

These are flagged rather than guessed, per the instruction not to invent data that wasn't verified.
