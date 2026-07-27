# RECOMMENDATIONS V1

**Date:** 2026-07-27  
**Based on:** live DB stats + pipeline/field/enrichment audits  
**Constraint:** recommendations only — no schema/code/data changes in this audit

Companions: [PLATFORM_DATA_AUDIT_V1.md](./PLATFORM_DATA_AUDIT_V1.md) · [ENTITY_AUDIT_V1.md](./ENTITY_AUDIT_V1.md) · [FIELD_AUDIT_V1.md](./FIELD_AUDIT_V1.md) · [PIPELINE_AUDIT_V1.md](./PIPELINE_AUDIT_V1.md) · [ENRICHMENT_AUDIT_V1.md](./ENRICHMENT_AUDIT_V1.md)

---

## 1. Fields to remove or freeze (do not feed enrichment)

Freeze = stop writing; decide delete later.

| Field / area | Why |
|---|---|
| `businesses.city_geoid` | 0% filled — wire properly or drop from enrichment scope |
| `businesses.instagram_followers_count` | 0% — vanity metric unused |
| `businesses.ai_verified_reviews_count`, `transaction_verified_reviews_count` | Always 0 |
| `professionals.city_geoid`, `county_geoid` | 0% |
| `professionals.service_radius_m`, `experience_years`, `availability_text` | 0% and unused in UI |
| `professionals.public_exact_address` | Never true |
| `import_review_items.subcategory`, `price` | 0% — or actually start using `price` instead of freezing |
| Empty media tables (`professional_portfolio_media`, `business_offer_media`) | Freeze until product needs them |
| Default noise fields as “signals” | `languages=['ru']`, `condition=good`, review counts=0 — don’t treat as data |

---

## 2. Fields to add (product gaps)

| Entity | Add | Why |
|---|---|---|
| All imported entities | per-field provenance (`source`, `confidence`, `captured_at`) | Prevent first-wrong lock-in |
| Professional | `card_summary_generated_at`, model/source | Staleness of AI pitch |
| Jobs | `apply_url` or contact channel | Cannot convert today |
| Real Estate | dedicated table/fields (or hard-stop publishing) | 623 queue items misrouted |
| Vehicle | dedicated table when product-ready | Enum-only today |
| Listings | reliable multi-image pipeline | 7 listing_media total |
| Business/Pro | claim/`owner_profile_id` activation | Pros 0% owned |

---

## 3. Fields to make required (publish gates)

Tighten **publish** (not schema NOT NULL overnight) via review checklist / autopublish rules:

### Business — required to approve

- name, category_id, city, state_code  
- phone **or** website **or** telegram/instagram  
- description or short_description  
- image_url  
- Soft-required for “complete”: address_line, opening_hours, website  

### Professional — required to approve

- display_name, category_id (not `pro_other` unless human OK)  
- ≥1 contact  
- city **or** service_area_text  
- image_url **or** explicit allow-without-photo  
- pitch text (description/headline/card_summary)  

### Marketplace — required

- title, description, city, category, transaction_type  
- **price_amount** unless transaction is free/wanted  
- ≥1 photo  

### Transfer — required

- from/to country, method  
- fee_percent **or** fee_fixed **or** explicit “по запросу” flag (add flag if needed)  

### Lechu — required

- route countries, carry_types, reward_type  
- **departure_date** (or explicit flexible flag)  

### Job — required

- title, description  
- city or work_mode=remote  
- employment_type  
- compensation range or `compensation_type='doe'`  

### Event — required

- title, city/format  
- starts_at **or** event_at_label  
- description  

### Vehicle / Real Estate

- Block publish until entity tables exist  

---

## 4. Fields to compute automatically

| Compute | From | Notes |
|---|---|---|
| slug | name/title | already |
| has_* contact flags | contact columns | already in views |
| location_precision | presence of street vs city vs county | only when geo evidence exists |
| lat/lng | address via Nominatim/Google | only if address trusted |
| card blurb | existing text fields | already client-side |
| duplicate clusters | phone / ig / website / name+city | expand auto-merge for exact phone |
| mention counts | import occurrences | already |
| postal_code | address parse / geocoder | partial today |
| source_kind | import source | already |

Do **not** auto-compute: phone, website, hours, prices, ratings.

---

## 5. Fields AI must never change

Absolute deny-list for generative models:

1. phone, email, whatsapp  
2. website, booking_url, registration_url, yelp_url, google_maps_url  
3. address_line, private_address_line, postal_code  
4. opening_hours  
5. price_amount, fees, compensation_*  
6. google_rating, yelp_rating, follower counts  
7. latitude, longitude  
8. source_url / source_fingerprint / raw_payload  

AI may **suggest** entity_type/category and **write** `card_summary` from existing text only.

---

## 6. Duplicate policy

| Type | Auto-merge? | Manual? |
|---|---|---|
| Exact same phone (normalized, ≥10 digits) same entity type | Yes (with audit log) | Spot-check |
| Exact same Instagram URL | Yes for professionals | Spot-check |
| Exact same website domain (business) | Yes if path-equivalent | Review if different names |
| Same name + city, no shared contact | **No** | Manual |
| Business ↔ Professional shared phone | **No** | Manual (may be same org) |
| Import fingerprint duplicate | Already marked | — |
| Reworded ads different fingerprint | Soft cluster | Manual / AI suggest |

Live priority: **professional name+city (38 groups)** and **15 phone groups**.

---

## 7. Category policy

| Action | Detail |
|---|---|
| Split dump `services` (625 businesses) | Map to finer business categories + professional when person |
| Reduce `pro_other` (278) | Re-run classifier with review band for low confidence |
| Stop mixing domains | Professionals should FK professional-domain categories; stop pointing at business rows for shared slugs without domain filter |
| Block RE category on business when item is a listing | Route to future RE entity |
| Keep `digital` etc. visible | Near-empty categories OK if taxonomy intentional |

---

## 8. Pipeline policy

1. **Classify before review UI** for Sacramento NULL `entity_type` backlog (4.3k).  
2. **Hard-fail publish** for `real_estate` / `vehicle` until tables exist.  
3. **Unify status vocabulary** in admin analytics (`published` mapping layer).  
4. **Decide Service listings vs Professionals** — one canonical public surface for specialists.  
5. **Turn on media pipeline** for marketplace/events before scaling those verticals.  
6. **Job publish path** — either approve from queue or stop classifying jobs into import.

---

## 9. Enrichment algorithm scope (what to build next)

### In scope for V1 enrichment engine

- Business hours + geo from official website/GBP  
- Extract prices for marketplace; fees for transfer; dates for lechu/events  
- Fill missing professional city/phone from source_text + directories with confidence  
- Category repair with confidence thresholds  
- Provenance columns before bulk writes  

### Out of scope / do later

- Inventing descriptions for thin cards  
- Fake ratings  
- Vehicle/RE enrichers  
- Overwriting owner-claimed fields  
- city_geoid backfill until platform_cities matching is proven  

---

## 10. Website / UX recommendations

| Issue | Recommendation |
|---|---|
| Cards look complete but lack hours/geo | Show completeness hints in admin, not fake public badges |
| Professional card hides contacts | OK for anti-scrape; ensure detail page CTA clear |
| Marketplace without price | Hide from public or badge “цена не указана” / block publish |
| Empty platform stars | Don’t render star UI when reviews_count=0 (business card already gates; keep consistent) |
| Fields displayed “for nothing” | Stop surfacing zeroed google/yelp counts as if real |
| Undated events | Filter or label “дата уточняется” |

---

## 11. Priority order (suggested)

| P0 | Classify NULL import backlog; stop RE mis-publish; publish gates for price/date/contact |
| P1 | Hours + geocode enrichment for businesses; professional city/phone fill |
| P2 | Category dump repair; duplicate auto-merge exact contacts |
| P3 | Jobs/events structured fields; media pipeline; claim/ownership |
| P4 | RE + Vehicle entity build **or** remove from classifiers |

---

## 12. Deliverables index

| File | Contents |
|---|---|
| [PLATFORM_DATA_AUDIT_V1.md](./PLATFORM_DATA_AUDIT_V1.md) | Counts, fill rates, risks |
| [ENTITY_AUDIT_V1.md](./ENTITY_AUDIT_V1.md) | Per-type required vs missing |
| [FIELD_AUDIT_V1.md](./FIELD_AUDIT_V1.md) | Per-field usage + who fills |
| [PIPELINE_AUDIT_V1.md](./PIPELINE_AUDIT_V1.md) | Source→publish→web field survival |
| [ENRICHMENT_AUDIT_V1.md](./ENRICHMENT_AUDIT_V1.md) | What enrichers do / AI boundaries |
| This file | Actions for enrichment algorithm planning |
