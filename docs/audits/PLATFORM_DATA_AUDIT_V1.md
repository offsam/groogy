# PLATFORM DATA AUDIT V1

**Date:** 2026-07-27  
**Scope:** Live Supabase project `russian-business-ai` (`zmsbosigfmnmyavuhlyb`) + codebase  
**Method:** Read-only SQL via Management API + schema/code inspection  
**Constraints honored:** no code changes, no DB writes, no migrations, no data fixes

Related docs:
- [ENTITY_AUDIT_V1.md](./ENTITY_AUDIT_V1.md)
- [FIELD_AUDIT_V1.md](./FIELD_AUDIT_V1.md)
- [PIPELINE_AUDIT_V1.md](./PIPELINE_AUDIT_V1.md)
- [ENRICHMENT_AUDIT_V1.md](./ENRICHMENT_AUDIT_V1.md)
- [RECOMMENDATIONS_V1.md](./RECOMMENDATIONS_V1.md)

---

## Executive verdict

The platform has **~4,567 published catalog rows** across businesses, professionals, listings, jobs, and events — but quality is uneven. Schema has far more columns than live data uses. Enrichment and import pipelines fill contacts and text aggressively; geocodes, hours, prices, reviews, and master-data FKs (`city_geoid`) are almost empty. **Vehicle** and **Real Estate** exist as enum/queue labels only — no dedicated tables. Import Review has a **5.4k open backlog**, of which **4.3k+ have `entity_type = NULL`**.

---

## 1. Overall statistics

### 1.1 Published catalog (entity tables)

| Entity type | Table / discriminator | Total rows | Published | Awaiting review* | Rejected | Draft | Archived | Other |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| **Business** | `businesses` | 2 831 | 2 037 (`approved`) | 105 (`pending`) | 16 | 0 | 653 | 20 (`deferred`) |
| **Professional** | `professionals` | 988 | 964 (`approved`) | 0 | 0 | 0 | 24 | 0 |
| **MarketplaceItem** | `listings` where `listing_type='marketplace_item'` | 68 | 68 (`active`) | 0 | 0 | 0 | 0 | 0 |
| **Job** | `jobs` | 16 | 13 (`published`) | 0 | 0 | 0 | 3 | 0 |
| **Event** | `events` | 29 | 29 (`published`) | 0 | 0 | 0 | 0 | 0 |
| **Vehicle** | — | **0** | — | — | — | — | — | **No table** |
| **RealEstate** | — | **0** | — | — | — | — | — | **No table** (see §1.4) |
| **Lechu** | `listings` where `listing_type='transport_carry'` | 18 | 18 (`active`) | 0 | 0 | 0 | 0 | 0 |
| **Transfer** | `listings` where `listing_type='transfer'` | 28 | 28 (`active`) | 0 | 0 | 0 | 0 | 0 |

\*“Awaiting review” on entity tables = status `pending` / equivalent. Most moderation backlog sits in `import_review_items`, not on published tables.

**Extra (not in your entity list, but live):** 588 `listings` with `listing_type='service'` — all `active`. These overlap conceptually with Professionals.

**Published total (requested types only):**  
2 037 + 964 + 68 + 13 + 29 + 0 + 0 + 18 + 28 = **3 157**

**Including services listings:** **3 745** active/published catalog rows.

### 1.2 Status vocabulary mismatch (important)

| Domain | “Published” value | Draft | Review | Rejected | Archived | Extra |
|---|---|---|---|---|---|---|
| Business | `approved` | `draft` | `pending` | `rejected` | `archived` | `deferred` |
| Professional | `approved` (+ `visibility='public'`) | `draft` | `pending` | `rejected` | `archived` | `deferred` |
| Listings | `active` | `draft` | — | `rejected` | `archived` | `paused`, `removed`, `reserved`, `completed` |
| Jobs | `published` | `draft` | `pending` | `rejected` | `archived` | `expired` |
| Events | `published` | `draft` | — | — | `archived` | — |

There is **no single platform-wide status enum**. Comparing “published” across types requires mapping.

### 1.3 Import Review queue (`import_review_items`)

| Metric | Count |
|---|---:|
| Total items | 9 260 |
| Awaiting review (`pending` + `needs_more_info` + `in_review`) | **5 439** |
| — pending | 4 821 |
| — needs_more_info | 618 |
| — in_review | 0 |
| Approved | 1 773 |
| Rejected | 16 |
| Duplicate | 1 703 |

By `entity_type` (including NULL):

| entity_type | Total | Pending | Approved | Rejected | Duplicate | needs_more_info |
|---|---:|---:|---:|---:|---:|---:|
| *(null)* | 4 521 | 3 916 | 0 | 0 | 164 | 441 |
| private_specialist | 2 101 | 285 | 963 | 5 | 732 | 99 |
| business | 875 | 80 | 653 | 1 | 131 | 6 |
| real_estate | 623 | 208 | 26 | 0 | 291 | 1 |
| marketplace_listing | 549 | 152 | 67 | 0 | 121 | 7 |
| lechu_listing | 222 | 0 | 16 | 0 | 206 | 0 |
| event | 215 | 123 | 21 | 10 | 46 | 6 |
| job | 127 | 57 | 0 | 0 | 12 | 58 |
| transfer_listing | 27 | 0 | 27 | 0 | 0 | 0 |

**Source mix:**

| source | Total | Still open |
|---|---:|---:|
| `telegram:sacramento_adaptation` | 3 908 | 3 908 |
| `telegram:la_orange_county` | 2 309 | 417 |
| `facebook` | 1 658 | 999 |
| `telegram` | 1 385 | 444 |

### 1.4 Comment recommendations queue

| Status | Count |
|---|---:|
| pending | 7 195 |
| approved | 2 188 |
| rejected | 45 |
| merged | 0 |
| **Total** | **9 428** |

### 1.5 Real Estate / Vehicle reality check

- `import_review_entity_type` includes `real_estate`; queue has **623** RE items.
- Of 26 “approved” RE items: **21 published as `business`**, **5 as `listing`** — no RE entity table.
- `vehicle` exists in architecture/`entity_type` enum docs but **zero** vehicle rows and **no** detail table.
- Business category `real_estate` has **128 approved businesses** (agents/agencies stored as businesses, not listings).

---

## 2. Data quality snapshot (published rows)

### 2.1 Business (`approved`, n=2 037)

| Field group | Fill rate | Notes |
|---|---:|---|
| name / slug / short_description / description | 100% | Text always present (often from import) |
| category_id | 99.4% | 13 missing |
| phone | 95.6% | Strong |
| city | 95.9% | Strong |
| state_code | 99.9% | Strong |
| image_url | 93.5% | Strong |
| address_line | 83.8% | 329 missing |
| google_maps_url | 82.3% | Often directory-derived |
| source_url / source_kind | 97.7% / 100% | Provenance mostly set |
| postal_code | 59.1% | Partial |
| website | 26.8% | Weak |
| region | 6.3% | Weak / redundant with state |
| email | 5.7% | Weak |
| instagram_url | 8.3% | Weak |
| telegram_url | 3.3% | Weak |
| opening_hours | 3.4% | Critical gap |
| latitude/longitude | 3.4% | Critical gap for maps |
| city_geoid | **0%** | Never used |
| instagram_followers_count | **0%** non-null | Never used |
| rating_avg / reviews_count > 0 | **0%** | Platform reviews unused |
| google_rating | 1.1% | Column present; almost empty |
| google_reviews_count | column 100% non-null | **Almost all zeros** (default) — only 23 > 0 |
| yelp_rating | 0.4% | Nearly unused |
| booking_url | 0.5% | 11 rows |

**Quality card (strict):** name + category + address + phone + website + description + hours + photo → **60 / 2 037 (3.0%)**  
**Minimal usable:** name + category + city + phone + description → **1 917 / 2 037 (94.1%)**

### 2.2 Professional (`approved`, n=964)

| Field | Fill % | Notes |
|---|---:|---|
| display_name / slug / category_id | 100% | |
| languages | 100% | Virtually all `['ru']` — default, not signal |
| short_description / description | 98% | |
| card_summary | 95.4% | LLM-generated |
| state_code | 98.1% | |
| source_type / source_record_id | 100% | |
| headline | 77.0% | |
| image_url | 71.1% | 279 without photo |
| region | 75.6% | Often county/hub text |
| phone | 57.3% | 412 without phone |
| city | 56.1% | 423 without city |
| telegram_url | 34.6% | |
| private_address_line | 24.4% | Private only |
| instagram_url | 20.6% | |
| website | 18.5% | |
| postal_code | 17.4% | |
| third_party_mention_count > 0 | 16.1% | |
| self_ad_mention_count > 0 | 46.6% | |
| email | 4.8% | |
| lat/lng | 0.1% | |
| city_geoid / county_geoid | **0%** | Never used |
| experience_years | **0%** | Never used |
| availability_text | **0%** | Never used |
| service_radius_m | **0%** | Never used |
| owner_profile_id | **0%** | All unclaimed imports |
| opening_hours | 0.1% | 2 rows |
| rating/reviews > 0 | **0%** | |

**Quality card:** name + category + city + phone + (description|card_summary) + photo → **336 / 964 (34.9%)**  
**No contact at all** (no phone/email/web/ig/tg): **135 / 964 (14.0%)**

### 2.3 Marketplace (`active`, n=68)

| Field | Fill % |
|---|---:|
| title / description / city / state | 100% |
| category / transaction_type | 100% |
| condition | 98.5% (mostly `good`) |
| pickup_available | 100% true |
| source_url | 98.5% |
| price_amount | **1.5%** |
| latitude | **0%** |
| quantity | **0%** |
| delivery_available true | 1.5% |

### 2.4 Transfer (`active`, n=28)

| Field | Fill % |
|---|---:|
| from_country / to_country / transfer_method / category | 100% |
| fee_percent / fee_fixed / min/max / processing_days | **0%** |
| listing city / state / price | **0%** |

### 2.5 Lechu (`transport_carry`, n=18)

| Field | Fill % |
|---|---:|
| departure/destination country / carry_types / reward_type / category | 100% |
| departure_date / max_weight / size_limit | **0%** |
| listing city | 22.2% |

### 2.6 Jobs (`published`, n=13)

| Field | Fill % |
|---|---:|
| title / description / business_id / offer_kind / source_type | 100% |
| city | 69.2% |
| employment_type / work_mode / compensation_* / postal / state / source_url | **0%** |

### 2.7 Events (`published`, n=29)

| Field | Fill % |
|---|---:|
| title / description / city / source_url / source_channel / format / source_body | 100% |
| cover_image_url | 86.2% |
| source_posted_at | 79.3% |
| starts_at / event_at_label | 62.1% |
| registration_url | 31.0% |
| state_code | 20.7% |
| lat/lng | 3.4% |
| ends_at / provider_business_id | **0%** |
| format=`unknown` | 18 / 29 |

### 2.8 Services listings (extra, n=588)

All `pricing_type = contact_for_price`.  
`price_from` / `price_to` / `license_info` / `insurance_status` / `availability_text` / `experience_years` = **0%**.  
`service_modes` / `service_area` / `languages` / `city` / `source_url` = 100% (defaults).

---

## 3. Fields never / almost never used (schema ≠ reality)

### Never filled (0 non-null / 0 meaningful across whole table)

| Table | Fields |
|---|---|
| `businesses` | `city_geoid`, `instagram_followers_count`, platform `rating_avg`/`reviews_count` (always 0), `ai_verified_reviews_count` (>0), `transaction_verified_reviews_count` (>0) |
| `professionals` | `city_geoid`, `county_geoid`, `service_radius_m`, `experience_years`, `availability_text`, `owner_profile_id`, `public_exact_address=true` |
| `import_review_items` | `subcategory` (0%), `price` (0%) |
| Media | `professional_portfolio_media` = 0 rows; `business_offer_media` = 0 |

### Structurally present but functionally dead defaults

- `businesses.google_reviews_count` / `yelp_reviews_count` — non-null but ~99% zeros
- `professionals.languages` — 100% filled with `ru` default
- `service_listing_details.pricing_type` — 100% `contact_for_price`
- `marketplace_listing_details.condition` — almost all `good`

---

## 4. Duplicate signals (live)

| Signal | Businesses (approved) | Professionals (approved) |
|---|---:|---:|
| Same normalized phone (groups / rows) | 1 group / 2 rows | 15 groups / 32 rows |
| Same website | 5 groups | — |
| Same Instagram | — | 13 groups |
| Same name+city | 3 groups | 38 groups |
| Shared phone across Business ↔ Professional | 14 pairs | |

Import Review already marked **1 703** items as `duplicate`. Professional name+city collisions are the largest live duplicate risk among published entities.

---

## 5. Category health (live)

### Business approved distribution (top)

| slug | Count | Share of 2 037 |
|---|---:|---:|
| `services` (Мастера / быт) | 625 | **30.7%** |
| medical | 258 | 12.7% |
| auto | 229 | 11.2% |
| restaurants | 209 | 10.3% |
| beauty | 150 | 7.4% |
| education | 136 | 6.7% |
| real_estate | 128 | 6.3% |
| groceries | 103 | 5.1% |
| finance | 86 | 4.2% |
| others | <50 each | |

`services` is a **dump category** — too general.

### Professional category issues

- **278 / 964 (28.8%)** in `pro_other`
- Many professionals FK into **business-domain** category rows (`beauty`, `education`, `auto`, `legal`, `real_estate`, …) instead of professional-domain taxonomy — shared slugs / mixed domains
- `digital` almost unused (3)

---

## 6. Website / public UX gaps (from live + UI code)

What users typically see on cards:
- **Business card:** name, category, blurb, city+ZIP, contact *presence icons*, photo
- **Professional card:** name, blurb (`card_summary`/headline), city+ZIP, origin badges, photo — **no contact icons on card**
- Contacts for business/pro are gated behind auth RPC

Gaps vs user expectations:
1. Hours almost never present (business 3.4%)
2. Map pins sparse (business lat 3.4%, pro ~0%)
3. Marketplace without prices (98.5% missing)
4. Transfers without fees
5. Jobs without compensation / employment type
6. Platform ratings always empty — Google/Yelp ratings almost empty
7. 135 professionals with zero contact channels
8. RE / Vehicles not browsable as first-class catalogs

Fields present in DB but barely/never shown usefully: see FIELD_AUDIT + §3.

---

## 7. Supporting object counts

| Object | Count |
|---|---:|
| `business_offers` | 399 |
| `media_assets` | 184 |
| `listing_media` | 7 |
| `entities` registry | 1 004 (professionals + jobs only today) |
| `professional_portfolio_media` | 0 |
| `business_offer_media` | 0 |

---

## 8. Method notes

- Counts from live SQL on 2026-07-27; they will drift as imports/enrichment run.
- “Published” mapped per-table as in §1.2.
- Lechu product name maps to DB `listing_type = 'transport_carry'`.
- Fill rates treat empty string as empty; numeric defaults of `0` called out separately when they inflate “non-null” rates.

---

## 9. Top risks before enrichment algorithm work

1. **Do not enrich all schema columns** — ~40%+ of columns are unused or default-noise.
2. **Classify the 4.3k NULL `entity_type` queue** before more publishing.
3. **Stop mis-publishing Real Estate into Business.**
4. **Fix dump categories** (`services`, `pro_other`) or enrichment will amplify bad taxonomy.
5. **Protect ground-truth fields** (phone, address, website, hours from official sources) from LLM invention — see ENRICHMENT + RECOMMENDATIONS.
