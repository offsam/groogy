# PHASE PLAN V1

**Date:** 2026-07-27
**Status: PLAN ONLY.** No statement in this document has been executed. Every `UPDATE`/`INSERT`/`DELETE`/`DROP` below is a proposal for a future, separately-approved run — this audit task was analysis-only (read-only SQL via `scripts/sb_sql.py`, no code changes, no writes).
**Scope note:** `real_estate` and `vehicle` have **no dedicated tables in production** (confirmed live: `information_schema.tables` returns zero rows for `real_estate_listings`/`vehicles` in `public`). A draft, frozen-but-unapplied schema for both already exists at `docs/architecture/entity-model-v1/001_additive_schema.sql` (header: *"DRAFT — DO NOT APPLY without explicit approval"*) — Phase 3 references it rather than proposing a new schema from scratch.

Companions: [DATA_CLEANUP_PLAN_V1.md](./DATA_CLEANUP_PLAN_V1.md), [NULL_CLASSIFICATION_ALGORITHM_V1.md](./NULL_CLASSIFICATION_ALGORITHM_V1.md), [DEAD_FIELDS_V1.md](./DEAD_FIELDS_V1.md), [QUALITY_CARD_RULES_V1.md](./QUALITY_CARD_RULES_V1.md)

---

## Phase 1 — Automatic, no human review needed

Bar for inclusion here: **deterministic, reversible, touches only `import_review_items` staging fields (never a published table), and does not change what a human will ultimately decide.** Everything that involves judgment (even "obvious" judgment) is in Phase 2 instead.

### 1.1 — Tag the two unambiguous category signals in the NULL backlog

From `NULL_CLASSIFICATION_ALGORITHM_V1.md` §1/§3, Gate 0: `category = 'events'` and the real-estate category keyword set are clean, deterministic signals verified live (Sacramento source: 122 rows `category='events'`, 24 rows `category='real_estate_services'`). This only sets a label on a staging row — it does not publish, does not touch `businesses`/`listings`/`professionals`, and is trivially reversible (`entity_type` back to `NULL`).

```sql
-- 1.1a — clean "event" signal
update public.import_review_items
set entity_type = 'event',
    target_collection = 'events',
    review_notes = coalesce(review_notes || ' ', '') || '[auto-classified:high:category=events]'
where entity_type is null
  and category = 'events';

-- 1.1b — clean "real_estate" signal
update public.import_review_items
set entity_type = 'real_estate',
    target_collection = 'real_estate',
    review_notes = coalesce(review_notes || ' ', '') || '[auto-classified:high:category=' || category || ']'
where entity_type is null
  and category in ('real_estate_services', 'realtor', 'mortgage', 'property_management');
```

**Note on 1.1b:** this correctly labels the row `real_estate` even though the current publish path would mis-route it into `listings`/`marketplace_item` (see Phase 2.3). Labeling correctly now and fixing the publish path separately is intentional — do not skip labeling just because publish isn't ready yet (that was the original mistake this cleanup is fixing).

**Verify before running (read-only):**

```sql
select category, count(*) from public.import_review_items
where entity_type is null and category in ('events','real_estate_services','realtor','mortgage','property_management')
group by category;
```

### 1.2 — Nothing else qualifies as Phase 1

Every other candidate (business-vs-specialist name/regex gates, disposition of contact-less rows, category dump repair, Real Estate/Business re-splitting) involves a judgment call about content, not just a mechanical label — see Phase 2. Resist the temptation to also auto-run Gate 1 (lechu/transfer/job/marketplace regex) or Gate 2 (business vs. specialist) — those were not sized against live regex hit-rates in this pass, and Gate 2 in particular is the exact class of error (misrouting a person as a business or vice versa) this whole cleanup exists to reduce.

---

## Phase 2 — Requires human review

### 2.1 — Classify the ambiguous majority of the NULL backlog (Gate 1/2)

Run the existing classifiers (`infer_entity_type()` in `scripts/telegram-collector/reviewer.py`, `facebook_decision_policy.py`) as a **dry run** against the remaining NULL rows (≈4,375 after 1.1a/b), output `(id, proposed_entity_type, confidence, gate_reason)` **without writing**, then:

- **HIGH confidence** (regex/name-slot match + ≥1 contact): a human spot-checks a sample (suggest: first 50 of each proposed type) before bulk-applying the label to the rest of that bucket.
- **MEDIUM confidence**: applied individually as admins triage the normal queue — not bulk-applied.
- **NONE** (Gate 3): see 2.2.

Criteria for the human spot-check: does `source_text` actually match the proposed type when read by a person? Track a simple agree/disagree count per bucket; if disagreement is high for a given signal (e.g. `BUSINESS_SIGNAL_RE` matches but a human reading says "no, this is a solo person"), stop and revise the regex before bulk-applying, don't push through anyway.

### 2.2 — Dispose of the Gate-3 unclassifiable remainder

Per `NULL_CLASSIFICATION_ALGORITHM_V1.md` §5:

```sql
-- Read-only sizing query — run before deciding a bulk reject
select
  count(*) filter (where array_length(phone,1) is null and array_length(website,1) is null
                    and array_length(instagram,1) is null and telegram_username is null
                    and (email is null or array_length(email,1) is null)) as no_contact_at_all,
  count(*) as total
from public.import_review_items
where entity_type is null; -- run after 1.1a/b and after Gate-1/2 auto-tagging from 2.1
```

A human (not an automated job) makes the reject-vs-keep call for the no-contact remainder, applying the existing staleness thresholds already coded in `scripts/import-review/eligibility.py` — this is a product/business decision about how much of the Sacramento/Facebook backlog is worth keeping open, not a mechanical rule.

### 2.3 — Real Estate vs Business: identify what's already misrouted

Live-confirmed counts (query run this session):

```sql
select published_entity_type, count(*)
from public.import_review_items
where entity_type = 'real_estate' and review_status = 'approved'
group by published_entity_type;
-- business: 21, listing: 5   (confirmed live 2026-07-27)
```

A human reviews these **26 rows** individually against the role split already frozen in `docs/architecture/entity-model-v1/REAL_ESTATE_ENTITY_V1.md`:

| If the row is... | It belongs in |
|---|---|
| An agency/brokerage (the ad is about the company, not a specific unit) | **Business**, category `real_estate_agencies` — leave as-is |
| An individual realtor/agent (the ad is a person's services) | **Professional**, category `real_estate` — migrate out of `businesses` if currently there |
| A specific unit for rent/sale (the ad is about an apartment/house/room) | **`real_estate_listings`** (once Phase 3 applies it) — migrate out of `businesses`/`listings` |

Separately, the **128 approved businesses in category `real_estate`** (`PLATFORM_DATA_AUDIT_V1.md` §5) are **not** all miscategorized — per the role table above, agencies and individual agents both legitimately have a category-`real_estate` presence as a Business/Professional. Do not bulk-migrate all 128; only the subset that is actually a property listing (bedrooms/sqft/single-unit address in the copy, not agency branding) qualifies. This is exactly why it's Phase 2, not Phase 1 — the automatic detection heuristic (unit-attribute language vs. agency branding) is a starting shortlist for a human, not a final answer.

### 2.4 — Category dump repair

`services` (625 businesses) and `pro_other` (278 professionals) need a human-reviewed reclassification pass, not a bulk regex rewrite — `RECOMMENDATIONS_V1.md` §7 already scopes this correctly (re-run classifier with a review band for low-confidence results). Nothing new to add here beyond: do this **after** 2.1, since the same classifier infrastructure is being touched anyway.

### 2.5 — Quality-card retroactive flagging (informational, not removal)

Run the gates from `QUALITY_CARD_RULES_V1.md` against the existing published catalog as a **read-only report** (which rows would fail if the gate applied today), and let a human decide whether any already-published rows should be pulled back to `pending` for enrichment. Do not auto-unpublish anything — the gate is meant for new approvals going forward, per that doc's own framing.

---

## Phase 3 — Deletion / schema changes

**Order matters — always check dependents before dropping, never assume "0 rows" means "0 dependents."**

### 3.1 — The one confirmed-safe drop

```sql
-- Verify zero FK dependents first (read-only)
select conname, conrelid::regclass, confrelid::regclass
from pg_constraint
where confrelid = 'public.professional_portfolio_media'::regclass;
-- expect 0 rows before proceeding

-- Then drop (RLS policies + grants are dropped automatically with the table)
drop table if exists public.professional_portfolio_media;
```

Per `DEAD_FIELDS_V1.md` §1, this is the only column/table that clears both bars (near-zero data **and** zero code references). Nothing else should go in this phase without the product/engineering sign-off called out in `DEAD_FIELDS_V1.md` §2/§6.

### 3.2 — Conditional drops (do NOT run without an explicit product decision first)

These require a yes/no product decision recorded *before* they're eligible for a Phase 3 run — listed here so the SQL exists when that decision is made, not as something to execute now:

```sql
-- Only if product confirms professional experience/availability/radius won't ship soon:
-- alter table public.professionals
--   drop column experience_years,
--   drop column availability_text,
--   drop column service_radius_m;

-- Only if product confirms city_geoid/county_geoid master-data linking is abandoned
-- (NOT recommended today — platform_cities/platform_counties are populated and this
-- looks like an intended, just-never-backfilled FK, not dead schema):
-- alter table public.businesses drop column city_geoid;
-- alter table public.professionals drop column city_geoid, drop column county_geoid;
```

Do **not** drop `business_offer_media`, `ai_verified_reviews_count`/`transaction_verified_reviews_count`, `public_exact_address`, or `import_review_items.subcategory` — `DEAD_FIELDS_V1.md` §2/§3/§6 found live code paths and/or an RLS test suite depending on each of them.

### 3.3 — Real Estate entity build-out (the big one — separate workstream, not a quick migration)

This is intentionally sequenced last and treated as its own project, not a cleanup-script line item:

1. **Apply** (after its own review — it's a large multi-table draft, not just the RE piece) the relevant slice of `docs/architecture/entity-model-v1/001_additive_schema.sql`: the `real_estate_listings` table + its RLS policies (lines ~428 onward in that file). This is a schema change requiring the same explicit approval the file's own header demands — do not fold it into a routine migration silently.
2. **Fix the publish route** in `lib/import-review/actions.ts` (currently line ~542-547 sends `target_collection='real_estate'` into `listings` as `listing_type='marketplace_item'`) to insert into `real_estate_listings` instead. This is a code change — out of scope for this analysis-only task, listed here as a hard prerequisite so future `real_estate`-labeled queue items (including the ones tagged in Phase 1.1b) land correctly once approved.
3. **Backfill** the human-confirmed subset from 2.3 (up to 5 listings + however many of the 21 businesses a human confirms are actually unit listings, not agencies):
   ```sql
   -- Illustrative shape only — exact column mapping depends on the applied
   -- real_estate_listings DDL from step 1; do not run until that table exists.
   -- insert into public.real_estate_listings (title, slug, description, city, state_code, source_type, source_url, status, ...)
   -- select name, slug || '-re', description, city, state_code, 'MIGRATED', source_url, 'draft', ...
   -- from public.businesses where id in (<human-confirmed id list from 2.3>);
   ```
   Insert into the new table first and verify row counts/spot-check before removing anything from `businesses`/`listings` — never delete the source row until the migrated row is confirmed present and correct.
4. Only after 1–3 are live: consider whether any of the 128 `real_estate`-category businesses beyond the 21 need re-review under the same role split.

### 3.4 — Vehicles

No live rows, no import path even in principle today (`ImportReviewEntityType`/`ImportReviewTargetCollection` enums have no `vehicle` value at all). `ENTITY_AUDIT_V1.md` is correct: treat as full greenfield. Do not build until there's a product commitment — applying the draft `vehicles` table from the same architecture doc with no ingestion path would just create a second orphaned stub like `real_estate_listings`'s current state.

---

## Sequencing summary

| Phase | Depends on | Reversible? |
|---|---|---|
| 1.1 (category auto-tag) | Nothing — can run today | Yes, trivially (reset `entity_type` to null) |
| 2.1–2.5 (human review) | Phase 1 done, classifier dry-run reviewed | Mostly yes — nothing publishes without the existing separate approval gate |
| 3.1 (drop orphaned table) | Zero-dependent check passes | No — take a schema snapshot first |
| 3.2 (conditional drops) | Explicit product sign-off recorded | No |
| 3.3 (RE build-out) | Its own review + code change (`lib/import-review/actions.ts`) | Additive schema is reversible; migrated-row backfill should be, until source rows are deleted |
