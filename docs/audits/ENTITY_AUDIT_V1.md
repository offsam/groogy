# ENTITY AUDIT V1

**Date:** 2026-07-27  
**Sources:** Live DB + schema migrations + architecture docs under `docs/architecture/entity-model-v1/`  
**Companion:** [PLATFORM_DATA_AUDIT_V1.md](./PLATFORM_DATA_AUDIT_V1.md)

---

## How to read this doc

For each entity type:
1. **Required (product)** — what a quality public card should have
2. **Present live** — what published rows actually have
3. **Missing / gap** — delta
4. **Schema status** — table exists? status model?

---

## Business

### Required (quality card)

| Field | Why |
|---|---|
| name | Identity |
| category_id | Browse / filter |
| city (+ state_code) | Local discovery |
| phone **or** website **or** booking | Contact path |
| address_line (for storefront) | Trust / maps |
| description or short_description | Understanding |
| opening_hours | Intent conversion |
| image_url | Click-through |
| lat/lng (if street address) | Map |

### Present live (`approved` n=2 037)

| Signal | Reality |
|---|---|
| name / descriptions | 100% |
| category | 99.4% |
| phone | 95.6% |
| city / state | 95.9% / 99.9% |
| image | 93.5% |
| address | 83.8% |
| website | 26.8% |
| hours | **3.4%** |
| lat/lng | **3.4%** |
| Full quality card (all strict fields) | **3.0% (60)** |

### Missing / gaps

- Hours, geo, website, email, social metrics largely absent
- Platform reviews unused (all zeros)
- `city_geoid` never populated — master-data link dead
- 13 without category; 90 without phone; 132 without image
- Ownership/claim model: businesses largely import-sourced (`source_kind=platform` 1 905) without claimed owners in practice

### Schema status

Table `businesses` mature. Status = `content_status` (`approved` = public). Public view strips raw contacts → presence flags + RPC.

---

## Professional

### Required (quality card)

| Field | Why |
|---|---|
| display_name | Identity |
| category_id (professional taxonomy) | Browse |
| city or service area | Local discovery |
| ≥1 contact (phone / tg / ig / website) | Conversion |
| card_summary or headline or description | Pitch |
| image_url | Trust |
| languages (real, not default) | Community fit |

### Present live (`approved` n=964)

| Signal | Reality |
|---|---|
| name / category | 100% |
| descriptions / card_summary | ~95–98% |
| image | 71.1% |
| phone | 57.3% |
| city | 56.1% |
| any contact | ~86% (14% have none) |
| Quality card (name+cat+city+phone+text+photo) | **34.9% (336)** |
| owner_profile_id | **0%** — all unclaimed |
| experience_years / availability / service_radius | **0%** |

### Missing / gaps

- Nearly half lack city and/or phone
- 28.8% dumped in `pro_other`
- Many `category_id` point at **business-domain** category rows
- Geo coordinates essentially unused
- Portfolio media table empty (0 rows)

### Schema status

Table `professionals` exists and is the strongest new entity after businesses. Registry `entities` mirrors professionals. Public contacts gated.

---

## MarketplaceItem

### Required

| Field | Why |
|---|---|
| title | Identity |
| description | Trust |
| price_amount (+ currency) **or** explicit free/wanted | Decision |
| city / state | Local meetup |
| category | Browse |
| condition | Expectation |
| transaction_type | Intent |
| ≥1 photo | Conversion |
| contact path via listing owner | Reply |

### Present live (n=68 active)

| Signal | Reality |
|---|---|
| title / description / city / state / category / transaction | ~100% |
| condition | 98.5% (mostly default `good`) |
| price | **1.5%** |
| photos (`listing_media` platform-wide = 7 total) | Effectively missing |
| lat/lng | 0% |

### Missing / gaps

- Marketplace is **not sellable as a product** without prices and photos
- Almost all sourced from Telegram/Facebook text posts
- `quantity` unused

### Schema status

`listings` + `marketplace_listing_details`. Status `active` = public.

---

## Job

### Required

| Field | Why |
|---|---|
| title | Identity |
| description | Role clarity |
| city or remote flag (`work_mode`) | Location |
| employment_type | Filter |
| compensation_min/max + type **or** explicit DOE | Decision |
| offer_kind (hire/seek) | Side of market |
| business_id or poster identity | Trust |
| how to apply (missing column today) | Conversion |

### Present live (n=13 published)

| Signal | Reality |
|---|---|
| title / description / business_id / offer_kind | 100% |
| city | 69.2% |
| employment_type / work_mode / compensation / state / postal / source_url | **0%** |

### Missing / gaps

- Jobs are thin shells — text + employer link only
- No apply URL / contact fields on `jobs`
- Import queue has 127 job items, **0 approved into jobs table** (publish path weak)
- entities registry has 16 job rows matching table

### Schema status

Table exists; status is text CHECK not enum. Tiny catalog.

---

## Event

### Required

| Field | Why |
|---|---|
| title | Identity |
| starts_at **or** event_at_label | When |
| city / format | Where / how |
| description | What |
| cover_image_url | Discovery |
| registration_url or contact | RSVP |
| ends_at (optional) | Duration |

### Present live (n=29)

| Signal | Reality |
|---|---|
| title / description / city / source_* | 100% |
| cover | 86.2% |
| starts_at / label | 62.1% — **~38% have no date** |
| registration_url | 31% |
| format unknown | 18/29 |
| provider_business_id / ends_at | 0% |

### Missing / gaps

- Undated events hurt trust
- No organizer business linkage
- Import has 215 event items vs 29 published

### Schema status

Table exists; simple `draft|published|archived`. Full row public when published (including source_url).

---

## Vehicle

### Required (target product — not implemented)

Typical: title, price, year/make/model, mileage, condition, city, photos, seller contact, VIN optional.

### Present live

**Nothing.** No `vehicle_*` table. No published vehicle entities. Enum slot only in architecture / `entity_type`.

### Gap

Full greenfield. Do not run enrichment for vehicles until schema + publish path exist.

---

## Real Estate

### Required (target product — not implemented as entity)

Typical: title, price, property type, beds/baths, sqft, address/city, listing type (rent/sale), photos, agent contact.

### Present live

| Reality | Count |
|---|---:|
| Dedicated RE table | **0** |
| Import queue `entity_type=real_estate` | 623 |
| Approved RE → published as `business` | 21 |
| Approved RE → published as `listing` | 5 |
| Businesses in category `real_estate` | 128 (agencies/agents as businesses) |

### Gap

RE is **misclassified into Business/Marketplace**. Architecture docs exist (`REAL_ESTATE_ENTITY_V1.md`) but DB not built. Enrichment must not invent RE listing attributes onto businesses.

---

## Lechu (carry / попутчики)

### Required

| Field | Why |
|---|---|
| departure_country → destination_country | Route |
| departure_date | Timing |
| carry_types | What can carry |
| reward_type | Free/paid |
| city (hub) | Local discovery |
| contact via listing | Coordination |
| max_weight / size (nice) | Fit |

### Present live (n=18, `listing_type=transport_carry`)

| Signal | Reality |
|---|---|
| countries / carry_types / reward / category | 100% |
| departure_date / weight / size | **0%** |
| city on listing | 22.2% |

### Gap

Dates missing — core UX field empty. Naming mismatch: product “Lechu” vs DB `transport_carry`.

### Schema status

`lechu_listing_details` exists and is used.

---

## Transfer

### Required

| Field | Why |
|---|---|
| from_country → to_country | Corridor |
| transfer_method | Bank/crypto/cash |
| fee_percent and/or fee_fixed | Price |
| min/max amounts | Constraints |
| processing_days | Expectation |
| city/hub | Local trust |
| contact | Conversion |

### Present live (n=28)

| Signal | Reality |
|---|---|
| countries / method / category | 100% |
| fees / amounts / processing_days | **0%** |
| listing city/state | **0%** |

### Gap

Transfers publish route+method only — commercially incomplete without fee data.

### Schema status

`transfer_listing_details` exists and is used.

---

## Cross-entity issues

1. **Service listings (588)** compete with Professionals — same community ads, different tables.
2. **Status naming** differs everywhere (`approved` vs `active` vs `published`).
3. **entities registry** only tracks professionals + jobs — not businesses/listings/events.
4. **RE / Vehicle** enum debt creates false confidence in import classification.
5. **Unclaimed imports dominate** — `owner_profile_id` null on all professionals; businesses mostly platform-sourced directory rows.

---

## Minimal quality card definitions (summary)

| Entity | Minimum quality card |
|---|---|
| Business | name, category, city, phone, description, photo; **plus** address+hours+website for “complete” |
| Professional | display_name, category, city, ≥1 contact, pitch text, photo |
| Marketplace | title, price (or free), city, category, condition, photo, description |
| Job | title, description, city or remote, employment_type, compensation or DOE, employer |
| Event | title, date, city/format, description, cover, registration/contact |
| Vehicle | *(not implementable yet)* |
| Real Estate | *(not implementable yet — stop publishing into Business)* |
| Lechu | route, date, carry_types, reward, contact, city |
| Transfer | corridor, method, fee, amounts or “ask”, contact, city |
