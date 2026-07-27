# DEAD FIELDS V1

**Date:** 2026-07-27
**Method:** live fill rates (confirmed against `PLATFORM_DATA_AUDIT_V1.md` / `FIELD_AUDIT_V1.md`) **plus** a codebase grep for every candidate column/table, to separate "0% filled and genuinely unreferenced" from "0% filled but actively wired into code that will break if dropped."
**Scope:** columns/tables at or near 0% fill. This doc only recommends actual deletion where the risk is genuinely low — see the correction note in §3.

Companion: [DATA_CLEANUP_PLAN_V1.md](./DATA_CLEANUP_PLAN_V1.md)

---

## 1. Safe-to-drop candidates (low risk)

| Column / table | Fill rate | Why remove | Risk |
|---|---:|---|---|
| `professional_portfolio_media` (whole table, 0 rows) | 0% | Grep confirms it is referenced **only** in the unapplied draft schema (`docs/architecture/entity-model-v1/001_additive_schema.sql`) and the migration that created it (`professionals_mvp.sql`). No `lib/`, `app/`, or `components/` code reads or writes it. Genuinely orphaned. | **Low** |

That is the only entry that is unambiguously safe by the "0% fill + zero code references" bar. Everything else below has at least one live code path touching it, which changes the risk profile even at 0% fill — see §2.

---

## 2. Low fill rate, but wired into code — treat as "freeze," not "drop"

These columns are near-zero filled, but a grep pass found active reads/writes. Deleting them requires a code change first, not just a `DROP COLUMN`.

| Column | Table | Fill rate | Referenced in | Risk |
|---|---|---:|---|---|
| `instagram_followers_count` | `businesses` | 0% | `lib/business/admin-queries.ts`, `lib/supabase/queries.ts`, `lib/supabase/mappers.ts` | **Medium** — vanity metric, safe to stop enriching, but the column is mapped into TS types/queries; removing it means touching 3 files, not just the DB |
| `city_geoid` | `businesses` | 0% | `types/database.ts`, `supabase/migrations/20260720120000_master_data_foundation.sql` and 8+ later migrations | **Medium** — this is an intended FK into the (already-populated) `platform_cities` master-data table, not orphaned schema. Product decision needed: wire the backfill, or formally deprecate — don't drop silently, it would sever a planned master-data link |
| `city_geoid`, `county_geoid` | `professionals` | 0% | Same master-data-foundation migration family as above | **Medium** — same reasoning |
| `service_radius_m`, `experience_years`, `availability_text` | `professionals` | 0% | `types/professional.ts` (typed, no active form path found writing them) | **Low-medium** — modeled in app types but no UI populates them yet; safe to drop *after* confirming no planned professional-profile-edit form depends on the type shape |
| `public_exact_address` | `professionals` | never `true` | Actively read/written by **6 enrichment scripts**: `catalog_cleanup.py`, `enrich_professionals_from_orange_pages.py`, `enrich_professionals_from_svoi.py`, `rebuild_professional_locations_from_groups.py`, `enrich_professionals_card_first.py`, `move_home_services_to_professionals.py` | **High** — this is a live flag consulted by running pipeline logic, not dead schema. It being always `false` today means the feature (opt-in exact address display) is simply unused by any professional yet, not that the column is safe to remove |
| `subcategory` | `import_review_items` | 0% | `types/import-review.ts`, `components/admin/ImportReviewDetailPanel.tsx` (real form field in the admin UI), `scripts/facebook-collector/map_review.py`, `scripts/business-seed/import-facebook-*.py` | **Medium** — fully wired end-to-end (collector → staging column → admin edit form) but nothing upstream ever populates it. Removing it means editing the admin panel form and multiple collector scripts, not just the column |

---

## 3. Correction to the existing audit docs — do not group these two tables together

`RECOMMENDATIONS_V1.md` §1 lists `professional_portfolio_media` and `business_offer_media` together as "empty media tables — freeze until product needs them." Live grep shows this is **not accurate for `business_offer_media`**:

| Table | Rows | Code reality |
|---|---:|---|
| `professional_portfolio_media` | 0 | No code references outside the unapplied draft schema — genuinely dead (§1) |
| `business_offer_media` | 0 | **Actively referenced in `lib/business-offers/actions.ts` and `lib/business-offers/queries.ts`** — this is a working upload path for offer photos that simply has zero uploads yet, not an unused/orphaned table |

**Risk of dropping `business_offer_media`: High.** It is live, functioning schema for a feature (photos on a business offer/property/product listing) that hasn't been used yet because `business_offers` itself is thin (399 rows, and offer photos are opt-in). Zero rows here means "nobody has uploaded an offer photo," not "this table is dead." Do not include it in any Phase 3 deletion batch.

---

## 4. Fields that look like "dead field" candidates by fill rate alone but are actually roadmap-blocked, not schema debt

These showed up at or near 0% in the live audit, but `QUALITY_CARD_RULES_V1.md` makes them **required** fields for their entity's publish gate — the fix is wiring the collector/enrichment pipeline to populate them, not deleting them.

| Column(s) | Table | Fill rate | Why it's not a delete candidate |
|---|---|---:|---|
| `price_amount` | `listings` (marketplace) | 1.5% | Required by the Marketplace quality card (§`QUALITY_CARD_RULES_V1.md`) |
| `fee_percent`, `fee_fixed_usd`, `min_amount_usd`, `max_amount_usd`, `processing_days` | `transfer_listing_details` | 0% | `fee_*` required by the Transfer quality card; min/max/processing_days are the next-tier completeness target |
| `departure_date`, `max_weight_kg`, `size_limit` | `lechu_listing_details` | 0% | `departure_date` required by the Lechu quality card |
| `employment_type`, `work_mode`, `compensation_min`, `compensation_max`, `compensation_type`, `postal_code`, `state_code`, `source_url` | `jobs` | 0% | `employment_type` + compensation required by the Job quality card |
| `price` | `import_review_items` | 0% | `RECOMMENDATIONS_V1.md` already flags this correctly: "start using it, don't freeze it" — it's the staging-side twin of the marketplace price gap above |
| `price_from`, `price_to`, `price_unit`, `license_info`, `insurance_status`, `availability_text`, `experience_years` | `service_listing_details` | 0% | **Actively rendered** on the public services detail page (`app/services/[id]/page.tsx` shows license info, experience years, availability, free-estimate/emergency flags) — the UI already consumes these; the gap is upstream data collection, not dead schema |

---

## 5. Default-noise, not empty schema (different problem, do not treat as a deletion candidate)

These columns are **not nullable/near-zero** — they're `NOT NULL` with a default that almost every row still carries, which makes them look like "signal" in a naive fill-rate scan but isn't:

| Column | Table | Reality |
|---|---|---|
| `google_reviews_count`, `yelp_reviews_count` | `businesses` | ~100% non-null, but only ~23 rows > 0 — it's the default `0`, not missing data |
| `languages` | `professionals` | 100% filled, always `['ru']` — a default, not a real per-professional signal |
| `condition` | `marketplace_listing_details` | 98.5%, almost all `good` (default) |
| `pricing_type` | `service_listing_details` | 100%, always `contact_for_price` (default) |

These are a **taxonomy/default-value problem**, not a "drop the column" problem — the column is doing its job (storing a real value with a sane default), the pipeline just never overrides the default with a real observation. Out of scope for this doc; tracked in `ENRICHMENT_AUDIT_V1.md` §6 and `RECOMMENDATIONS_V1.md` §1 last row.

---

## 6. Review-feature columns that are correctly empty, not dead

`ai_verified_reviews_count`, `transaction_verified_reviews_count` (`businesses`) are always 0 live. Grep shows these are wired across the Reviews MVP migrations (`20260718190000_reviews_mvp.sql` and 6+ follow-ups) **and** asserted against in `scripts/reviews-rls-checks.sql`, a live RLS regression-test suite. This is a shipped feature with zero verified reviews so far (platform reviews are unused overall — `rating_avg`/`reviews_count` are also 0% > 0 per `PLATFORM_DATA_AUDIT_V1.md`), not broken/dead schema. **Do not touch without first deciding whether the Reviews feature itself is being kept** — that's a product question one level up from "delete an unused column."

---

## Summary — what to actually put in a Phase 3 deletion migration

Out of everything scanned, exactly **one** item clears both bars (near-zero fill **and** zero code references): `professional_portfolio_media`. Everything else in this document is either (a) wired into running code and needs a code change first, (b) blocked on a product decision (master-data FK backfill, Reviews feature status), or (c) actually required by the quality-card gates defined in this same cleanup and should be *fixed upstream*, not deleted. See `PHASE_PLAN_V1.md` Phase 3 for the concrete, minimal drop list this implies.
