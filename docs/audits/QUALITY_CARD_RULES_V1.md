# QUALITY CARD RULES V1

**Date:** 2026-07-27
**Scope:** minimum field set required before a row is allowed to reach a public `status` (`approved`/`active`/`published`) per entity type.
**Rule applied:** max 5–6 fields per type, no soft "nice to have" mixed into the gate. Fields are named by exact DB column (or `table.column` for detail tables). Live fill rates are from the verified live-DB pass (matches `PLATFORM_DATA_AUDIT_V1.md` exactly, spot-checked 2026-07-27).
**This is a publish gate, not a schema change.** Enforce at the `approveImportReviewItemAction` / admin-publish layer (see `PHASE_PLAN_V1.md` §Phase 2), not as new `NOT NULL` constraints — tightening `NOT NULL` overnight would break the ~96–99% of already-published rows that predate this rule.

Companion: [DATA_CLEANUP_PLAN_V1.md](./DATA_CLEANUP_PLAN_V1.md), [ENTITY_AUDIT_V1.md](./ENTITY_AUDIT_V1.md)

---

## Business (`businesses`)

| # | Field | Rule | Live fill (approved, n=2 037) |
|---|---|---|---:|
| 1 | `name` | required | 100% |
| 2 | `category_id` | required, not empty | 99.4% |
| 3 | `city` | required (paired with `state_code`, already 99.9%) | 95.9% |
| 4 | `phone` **or** `website` **or** `telegram_url` **or** `instagram_url` | ≥1 contact path required | 95.6% have phone alone; ~97%+ have ≥1 of the four |
| 5 | `short_description` **or** `description` | required | 100% |
| 6 | `image_url` | required | 93.5% |

**Explicitly NOT in the gate:** `address_line` (83.8%, trust signal but not blocking — storefront-less businesses exist), `opening_hours` (3.4% — would fail 96% of the live catalog, tracked as a completeness/enrichment target, not a publish gate), `google_maps_url`/`lat`/`lng` (geocode is derived, not source data).

Result if applied retroactively: **~1,900+/2,037 already pass** (see `PLATFORM_DATA_AUDIT_V1.md` "Minimal usable" = 94.1%); the gate mainly stops *new* thin rows, it does not require re-auditing the existing catalog.

---

## Professional (`professionals`)

| # | Field | Rule | Live fill (approved, n=964) |
|---|---|---|---:|
| 1 | `display_name` | required | 100% |
| 2 | `category_id` | required, and **not** the `pro_other` dump slug unless a human confirmed no better fit exists | 100% filled, but 28.8% land in `pro_other` today — quality gate, not fill-rate gate |
| 3 | `city` **or** `service_area_text` | ≥1 required | 56.1% city; some overlap from `service_area_text` (11%) |
| 4 | `phone` **or** `website` **or** `telegram_url` **or** `instagram_url` | ≥1 contact path required | 57.3% phone; ~86% have ≥1 of the four; **14% (135 rows) currently have none** — these fail the gate as designed |
| 5 | `headline` **or** `short_description` **or** `description` **or** `card_summary` | ≥1 pitch text required | 95–98% combined |
| 6 | `image_url` | required unless an explicit "no-photo allowed" override is set by an admin (some categories/community norms may not have photos) | 71.1% |

**Explicitly NOT in the gate:** `experience_years`, `availability_text`, `service_radius_m` (0% fill, no UI surface yet — see `DEAD_FIELDS_V1.md`), `languages` (100% but only ever the default `['ru']` — not a real signal), geo lat/lng.

---

## Marketplace (`listings` where `listing_type='marketplace_item'` + `marketplace_listing_details`)

| # | Field | Rule | Live fill (active, n=68) |
|---|---|---|---:|
| 1 | `title` | required | 100% |
| 2 | `description` | required | 100% |
| 3 | `price_amount` | required **unless** `marketplace_listing_details.transaction_type = 'wanted'` (buyer post, no price to give) | **1.5%** — this is the field the gate is meant to fix |
| 4 | `city` (+ `state`) | required | 100% |
| 5 | `marketplace_listing_details.category_id` | required | 100% |
| 6 | ≥1 photo (`listing_media` row exists for the listing) | required | effectively 0% platform-wide (7 `listing_media` rows total) — this is the second field the gate is meant to fix |

**Explicitly NOT in the gate:** `condition` (98.5% but almost all default `good` — noise, not signal), `delivery_available`/`pickup_available` (mostly default), `quantity` (0%, unused).

**Note:** fields 3 and 6 are currently failing at platform scale (98.5% and ~100% respectively). Applying this gate today would block nearly all new marketplace publishes until the enrichment/collection side actually extracts price and at least one photo — that is the intended effect, not a bug in the rule.

---

## Job (`jobs`)

| # | Field | Rule | Live fill (published, n=13) |
|---|---|---|---:|
| 1 | `title` | required | 100% |
| 2 | `description` | required | 100% |
| 3 | `city` **or** `work_mode = 'remote'` | ≥1 required | 69.2% city; `work_mode` 0% filled today |
| 4 | `employment_type` | required | **0%** — gate target |
| 5 | `compensation_min`/`compensation_max` **or** `compensation_type = 'doe'` | required (numeric range or explicit "depends on experience" flag) | **0%** — gate target |

Only 5 fields — `business_id` is intentionally excluded from the hard gate because the public job page already renders a "Частный работодатель" (private employer) label when it's null (`app/jobs/[slug]/page.tsx`), so a poster identity always exists one way or another.

**Note:** fields 4 and 5 are at 0% live. This gate would currently block all 13 published jobs from re-publishing as-is — flagging that the jobs pipeline needs `employment_type`/`compensation_*` collection wired in before this gate is turned on, not just admin discipline.

---

## Event (`events`)

| # | Field | Rule | Live fill (published, n=29) |
|---|---|---|---:|
| 1 | `title` | required | 100% |
| 2 | `starts_at` **or** `event_at_label` | ≥1 required | 62.1% |
| 3 | `city` | required | 100% |
| 4 | `description` | required | 100% |
| 5 | `cover_image_url` | required | 86.2% |

**Explicitly NOT in the gate:** `registration_url` (31%, nice-to-have CTA, not blocking — plenty of events are info-only), `ends_at`/`provider_business_id` (0%, no product surface consuming them yet).

---

## Transfer (`listings` where `listing_type='transfer'` + `transfer_listing_details`)

| # | Field | Rule | Live fill (active, n=28) |
|---|---|---|---:|
| 1 | `transfer_listing_details.from_country` | required | 100% |
| 2 | `transfer_listing_details.to_country` | required | 100% |
| 3 | `transfer_listing_details.transfer_method` | required | 100% |
| 4 | `fee_percent` **or** `fee_fixed_usd` **or** an explicit "fee on request" flag | required | **0%** both fee columns — gate target. **Schema gap:** there is no existing boolean for "ask for price"; until one is added, treat this field as **blocking** (do not publish transfer listings with silently-empty fees) rather than inventing a flag value that doesn't exist in the schema. |
| 5 | `listings.description` | required | 100% |

Only 5 fields. `min_amount_usd`/`max_amount_usd`/`processing_days` are useful but not made hard-required (0% today, would zero out the whole category) — track as a completeness target, not a publish blocker, until the collector/enrichment side starts extracting them.

---

## Lechu (`listings` where `listing_type='transport_carry'` + `lechu_listing_details`)

| # | Field | Rule | Live fill (active, n=18) |
|---|---|---|---:|
| 1 | `lechu_listing_details.departure_country` | required | 100% |
| 2 | `lechu_listing_details.destination_country` | required | 100% |
| 3 | `lechu_listing_details.departure_date` **or** an explicit "flexible date" flag | required | **0%** `departure_date` — gate target. Same schema gap as Transfer fees: no existing "flexible" boolean, so treat as blocking until one is added. |
| 4 | `lechu_listing_details.carry_types` | required, non-empty array | 100% |
| 5 | `lechu_listing_details.reward_type` | required | 100% |

Only 5 fields. `max_weight_kg`/`size_limit` (0% today) stay as completeness targets, not blockers.

---

## Cross-type notes

1. **"Contact path" always means the same four-column OR-set where it appears** (`phone`, `website`, `telegram_url`/`instagram_url`) — do not invent a fifth path (e.g. email) as a substitute; email fill is too low (5.7%/4.8%) to be a reliable primary channel and isn't source-verified any more than the other three.
2. **Photos and prices are the two most-violated fields platform-wide** (marketplace price 1.5%, marketplace photos ~0%, transfer fees 0%, lechu dates 0%) — turning these gates on is a pipeline change (extraction), not just an admin-review change. See `PHASE_PLAN_V1.md` for sequencing so the gate doesn't just freeze these categories at zero new publishes.
3. **Real Estate and Vehicle are intentionally excluded from this document** — there is no live table for either (`real_estate_listings` and `vehicles` do not exist in the production schema; confirmed live via `information_schema.tables`), so there is no "publish gate" to define yet. See §3.5 in `DATA_CLEANUP_PLAN_V1.md`.
