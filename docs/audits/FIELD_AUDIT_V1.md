# FIELD AUDIT V1

**Date:** 2026-07-27  
**Method:** Live fill rates + code write paths (import publish, admin forms, enrichment scripts, user forms)  
**Companion:** [PLATFORM_DATA_AUDIT_V1.md](./PLATFORM_DATA_AUDIT_V1.md)

Legend for **Filled by**:
- **AI** — LLM classification / summarization / extraction
- **Import** — collector → import_review → publish RPC/actions
- **Admin** — admin UI / admin RPCs
- **User** — owner/publisher forms
- **Enrichment** — offline scripts under `scripts/business-enrich/`
- **System** — triggers, defaults, derived flags
- **Unused** — 0 meaningful live values and no active writer worth keeping for V1 enrichment

---

## 1. `businesses`

| Field | Used? | Fill (approved) | Filled by | Notes |
|---|---|---:|---|---|
| id, slug, created_at, updated_at | yes | 100% | System / Import / Admin | |
| name | yes | 100% | Import, Admin, Enrichment, User | Ground truth — do not invent |
| category_id | yes | 99.4% | Import, Admin, Enrichment | |
| short_description | yes | 100% | Import, Admin, Enrichment | Often = truncated description |
| description | yes | 100% | Import, Admin, Enrichment, AI-merge | Duplicate risk vs short_description |
| status | yes | 100% | Admin, Import publish | `approved` = public |
| phone | yes | 95.6% | Import, Enrichment, Admin | **Never AI-invent** |
| email | low | 5.7% | Enrichment, Import, Admin | |
| website | medium | 26.8% | Enrichment, Import, Admin | Official only |
| image_url | yes | 93.5% | Import, Enrichment, Admin | |
| address_line | yes | 83.8% | Import, Enrichment, Admin | Ground truth |
| city | yes | 95.9% | Import, Enrichment, Admin | |
| region | low | 6.3% | Enrichment / legacy | Overlaps state/hub |
| state_code | yes | 99.9% | Import, System, Enrichment | Prefer over free region |
| postal_code | medium | 59.1% | Enrichment, Admin | |
| city_geoid | **no** | 0% | *(intended master-data)* | **Unused** |
| latitude, longitude | low | 3.4% | Enrichment (Nominatim) | |
| location_precision | yes | 93.1% | System / Enrichment | Often set without real lat |
| instagram_url | low | 8.3% | Enrichment, Import | |
| telegram_url | low | 3.3% | Enrichment, Import | |
| google_maps_url | yes | 82.3% | Import/directories | Not always verified |
| google_rating | near-unused | 1.1% | Admin / scrape | |
| google_reviews_count | noise | ~100% non-null | Default 0 | Only 23 > 0 |
| yelp_url | low | 2.0% | Enrichment | |
| yelp_rating | near-unused | 0.4% | Enrichment scrape | |
| yelp_reviews_count | noise | default 0 | System | |
| instagram_followers_count | **no** | 0% | *(schema only)* | **Unused** |
| opening_hours | critical gap | 3.4% | Enrichment, Admin | High value |
| booking_url | near-unused | 0.5% | Enrichment scrape | |
| source_url / source_kind | yes | 97.7% / 100% | Import, Enrichment backfill | Provenance |
| rating_avg / reviews_count | dead | 0% >0 | Reviews system | Platform reviews unused |
| ai_verified_reviews_count | **no** | 0% >0 | Reviews MVP | **Unused** |
| transaction_verified_reviews_count | **no** | 0% >0 | Reviews MVP | **Unused** |

### Duplicate / overlapping business fields

| Pair | Issue |
|---|---|
| `short_description` ↔ `description` | Often identical or truncated copy |
| `region` ↔ `state_code` ↔ hub | Three location vocabularies |
| `google_maps_url` ↔ `address_line`+lat/lng | Maps URL filled without geocode |
| `rating_avg` ↔ `google_rating` ↔ `yelp_rating` | Three rating systems; platform one empty |
| contact fields ↔ text in description | Historical; partially cleaned by `migrate_contacts_from_copy.py` |

---

## 2. `professionals`

| Field | Used? | Fill (approved) | Filled by | Notes |
|---|---|---:|---|---|
| display_name, slug | yes | 100% | Import, Enrichment, Admin | |
| category_id | yes | 100% | Enrichment backfill, Import, Admin | Quality of value poor (`pro_other` 29%) |
| headline | yes | 77% | Import, Enrichment | |
| short_description / description | yes | 98% | Import, Enrichment | |
| card_summary | yes | 95.4% | **AI** (`summarize_professional_cards.py`) | Synthetic OK if labeled |
| image_url | yes | 71% | Enrichment (TG avatars), Import | |
| phone / email / website / ig / tg | partial | 57/5/18/21/35% | Import, Enrichment | Never invent |
| city / region / state_code | partial | 56/76/98% | Enrichment, Import | city weakest |
| postal_code | low | 17% | Enrichment | |
| private_address_line | low | 24% | Enrichment (directories) | Private |
| lat/lng | almost no | 0.1% | Enrichment | |
| location_precision | yes | 98% | System | Often without coords |
| city_geoid / county_geoid | **no** | 0% | — | **Unused** |
| service_area_text | low | 11% | Enrichment / Import | |
| service_radius_m | **no** | 0% | — | **Unused** |
| experience_years | **no** | 0% | User form exists conceptually | **Unused** |
| availability_text | **no** | 0% | — | **Unused** |
| opening_hours | almost no | 0.1% | — | |
| languages | noise | 100% | Default `['ru']` | Not real signal |
| source_type / source_url / source_record_id | yes | 100/88/100% | Import | |
| owner_profile_id | **no** | 0% | Claim flow unused | **Unused in practice** |
| third_party / self_ad mention counts | yes | 16%/47% >0 | Enrichment audit | Useful social proof |
| rating/reviews | dead | 0% | — | |
| visibility | yes | 100% public | System | |
| public_exact_address | **no** | never true | — | **Unused** |

### Duplicate / overlapping professional fields

| Pair | Issue |
|---|---|
| `headline` ↔ `short_description` ↔ `card_summary` ↔ `description` | Four text surfaces; UI blurb picks among them |
| `region` ↔ `city` ↔ `service_area_text` | Location ambiguity |
| `source_url` ↔ telegram/facebook identity | Provenance vs contact |

---

## 3. `listings` + detail tables

### Shared `listings` columns

| Field | Marketplace | Service | Transfer | Lechu | Filled by |
|---|---:|---:|---:|---:|---|
| title / description | 100% | 100% | 100% | 100% | Import publish |
| price_amount | 1.5% | 0% | 0% | 0% | Rarely extracted |
| city | 100% | 100% | 0% | 22% | Import |
| state | 100% | 100% | 0% | 0% | Import |
| lat/lng | 0% | ~0% | 0% | 0% | Unused |
| source_url / source_kind | ~99% | 100% | 100% | 94% | Import |
| publisher_* | mostly profile/system | | | | Import / System |

### `marketplace_listing_details`

| Field | Fill | Filled by | Notes |
|---|---:|---|---|
| category_id | 100% | Import | |
| condition | 98.5% | Import default `good` | Weak signal |
| transaction_type | 100% | Import | sell/wanted |
| delivery_available | rarely true | Import | |
| pickup_available | 100% true | Default | Noise |
| quantity | 0% | — | **Unused** |

### `service_listing_details`

| Field | Fill | Notes |
|---|---:|---|
| service_category_id / pricing_type / service_modes / service_area / languages | 100% | Defaults; pricing always `contact_for_price` |
| price_from/to, price_unit, experience_years, license_info, insurance_status, availability_text, free_estimate, emergency | **0%** | **Unused** |

### `transfer_listing_details`

| Field | Fill | Notes |
|---|---:|---|
| from/to country, method, category | 100% | Import |
| fee_*, min/max, processing_days | **0%** | **Unused though critical** |

### `lechu_listing_details`

| Field | Fill | Notes |
|---|---:|---|
| countries, carry_types, reward_type, category | 100% | Import |
| departure_date, max_weight_kg, size_limit | **0%** | **Unused though critical** |

---

## 4. `jobs`

| Field | Fill (published) | Filled by | Notes |
|---|---:|---|---|
| title, description, slug | 100% | Import / Admin | |
| business_id | 100% | Import | |
| offer_kind | 100% | Import | all `hire` |
| source_type | 100% | Import | |
| city | 69% | Import | |
| employment_type, work_mode, compensation_*, postal_code, state_code, source_url | **0%** | — | Schema ready, pipeline empty |
| owner_profile_id | low/unused | — | |

---

## 5. `events`

| Field | Fill | Filled by | Notes |
|---|---:|---|---|
| title, description, city, source_*, format, source_body | 100% | Import | |
| cover_image_url | 86% | Import | |
| starts_at, event_at_label | 62% | Import / AI extract | |
| registration_url | 31% | Import | |
| state_code | 21% | Import | |
| lat/lng | 3% | Enrichment rare | |
| ends_at, provider_business_id | **0%** | — | **Unused** |

---

## 6. `import_review_items` (staging fields)

| Field | Fill (all items) | Filled by | Notes |
|---|---:|---|---|
| source_text / fingerprint / raw_payload | ~100% | Collector | Immutable core |
| ai_decision / ai_confidence | 100% on open unclassified | AI | |
| title | high | AI / extract | |
| category | high (text) | AI | Not FK |
| entity_type | **51% null overall**; 0% on largest open bucket | AI / Admin | Biggest hole |
| phone / ig / website arrays | 44/31/10% on unclassified open | AI extract | |
| subcategory | **0%** | — | **Unused** |
| price | **0%** | — | **Unused** |
| services[] | 0.9% | AI | Near unused |
| whatsapp | 1% | AI | Near unused |
| email | 2.2% | AI | |
| preview_image_url | 8.3% | Media pipeline | Weak |
| business_name / person_name | 24% / 44% | AI | Overlap with title |

---

## 7. Who fills what (summary matrix)

| Capability | Business | Professional | Listings family | Jobs | Events |
|---|---|---|---|---|---|
| AI invents text/summary | merge desc; not primary | **card_summary** | classify only | classify | date/label extract |
| AI classifies type/category | via import | via import + keyword backfill | via import | via import | via import |
| Import writes core | yes | yes | yes | thin | yes |
| Enrichment fills contacts/geo | yes (heavy) | yes (heavy) | rare | no | rare |
| Admin edits | yes | yes | yes | yes | yes |
| End-user owner edits | limited / claim immature | forms exist; owners=0 | publisher forms | limited | forms exist |

---

## 8. Fields that should never be AI-generated

Ground truth / legal / contact — extract or leave empty:

- phone, email, whatsapp
- website, booking_url, registration_url
- address_line, private_address_line, postal_code
- opening_hours (unless scraped from official site / GBP)
- prices, fees, compensation
- ratings / review counts from third parties (scrape only)
- lat/lng (geocoder only)
- identity names when already present from source (normalize OK, invent not OK)

AI-appropriate:

- entity_type / category suggestions (with confidence)
- card_summary / short marketing blurb from existing source text
- duplicate hints
- needs_more_info reasons

---

## 9. Dead schema candidates (for later cleanup — not doing now)

Do not delete yet; flag for product decision:

1. `businesses.city_geoid`, `instagram_followers_count`, review verification counters  
2. `professionals.city_geoid`, `county_geoid`, `service_radius_m`, `experience_years`, `availability_text`, `public_exact_address`  
3. `service_listing_details` price/license/insurance/availability cluster  
4. `import_review_items.subcategory`, `price`  
5. `professional_portfolio_media`, `business_offer_media` empty tables  

See [RECOMMENDATIONS_V1.md](./RECOMMENDATIONS_V1.md).
