# ENRICHMENT AUDIT V1

**Date:** 2026-07-27  
**Code root:** `scripts/business-enrich/`  
**Policy observed in scripts:** fill-empty-only (do not overwrite non-empty) unless merge/special script  
**Companion:** [FIELD_AUDIT_V1.md](./FIELD_AUDIT_V1.md)

---

## 1. What enrichment tries to fill today

### Businesses

| Field | Scripts / mechanisms | Source types |
|---|---|---|
| website, email, phone, instagram_url, telegram_url | `enrich_published_businesses.py`, `enrich_from_import_sources.py`, `enrich_from_card_copy.py`, `migrate_contacts_from_copy.py` | Website scrape, import payload, text extraction |
| address_line, city, postal_code | website / Nominatim / `backfill_city_zip.py` | Scrape + geocoder |
| latitude, longitude, location_precision | `geocode_all_addresses.py`, catalog_cleanup | Nominatim |
| yelp_url, yelp_rating, yelp_reviews_count | enrich + `fill_yelp_ratings.py` | Yelp pages |
| booking_url | `scrape_booking_urls.py` | Link discovery on site |
| image_url | import sources / media | TG/FB/directories |
| short_description / description | import merge RPCs, card copy | Source text |
| source_url / source_kind | `backfill_source_provenance.py` | import_review linkage |
| business_offers | website price-line scrape | Website |

### Professionals

| Field | Scripts | Sources |
|---|---|---|
| phone, email, website, instagram_url, telegram_url | `enrich_professionals_from_sources.py`, `*_svoi.py`, `*_orange_pages.py`, `enrich_professionals_card_first.py` | Import, Svoi.us, Orange Pages, card/website |
| city, region, state_code, lat/lng | `enrich_professional_locations.py`, `rebuild_professional_locations_from_groups.py` | TG group signals, directories |
| private_address_line, postal_code | directory scrapes | Svoi / Orange Pages |
| image_url | `enrich_professional_avatars.py` | Telegram photos, OG images |
| display_name / headline / description | card-first enrich | Card text / website |
| **card_summary** | `summarize_professional_cards.py` | **LLM (OpenRouter)** |
| category_id | `backfill_professional_categories.py` | Regex/keyword rules |
| mention counts | `backfill_community_mentions.py` | Import occurrences |
| create/merge from recommendations | `publish_recommendation_catalog.py`, `merge_professional_duplicates.py` | Recommendations queue |

### Listings / Jobs / Events

| Entity | Enrichment today |
|---|---|
| Marketplace / Transfer / Lechu | Minimal — mostly publish-time only; `move_pros_to_lechu_transfers.py` for moves |
| Jobs | No dedicated enricher filling compensation/employment |
| Events | Occasional geocode via catalog_cleanup; no systematic hours/date enricher |
| Vehicles / RE | None (no tables) |

---

## 2. Sources used

| Source | Used for | Trust level |
|---|---|---|
| Telegram post / profile photo | contacts, images, city hints | Medium — self-reported |
| Facebook post / comments | same + recommendations | Medium |
| Svoi.us | professional directory cards | Medium-high for contacts |
| Orange Pages / Yellow Pages | contacts, addresses | Medium |
| Business website HTML | website fields, offers, booking links, emails | High if domain matches |
| Yelp page | yelp_url + ratings | High for those metrics |
| Nominatim / OpenStreetMap | geocode | Medium — address quality dependent |
| Google fields on business | google_maps_url / rare ratings | Mixed — maps URL often directory-built |
| OpenRouter LLMs | `card_summary`; import classification elsewhere | Synthetic |

---

## 3. What AI invents (vs extracts)

### Explicitly generative today

| Output | Model path | Risk |
|---|---|---|
| `professionals.card_summary` | `summarize_professional_cards.py` (gpt-4.1-nano / gemini-flash-lite / nova-micro via OpenRouter) | Hallucinated services if prompt weak; **95% filled** already |
| Import `entity_type` / `category` / `ai_reason` | Import classification | Mis-route (RE→business, NULL type) |
| Possibly merged description text | `enrich_business_merge_description` RPC / import AI | Can blend sources |

### Extractive (not invent — but can mis-parse)

- Phones, emails, URLs from text  
- Cities from group names / address strings  
- Booking provider URLs from anchors  
- Categories from keyword lists (not LLM) — still error-prone → `pro_other` / `services` dumps  

---

## 4. Fields that must never be AI-generated

| Field class | Examples | Allowed origin |
|---|---|---|
| Contact endpoints | phone, email, telegram, whatsapp, instagram handle | Source post, directory, official site, owner |
| Web properties | website, booking_url, registration_url, yelp_url | Verified URL scrape / owner |
| Physical location | address_line, postal_code, private_address_line | Official / owner / trusted directory |
| Hours | opening_hours | Official site / GBP / owner |
| Money | price_amount, fees, compensation_* | Source post numbers or owner |
| Third-party scores | google_rating, yelp_rating, follower counts | Official APIs/pages only |
| Coordinates | lat/lng | Geocoder from trusted address — never LLM |
| Legal identity | licenses, insurance_status | Owner / verified docs |

**Normalization OK:** formatting phone to E.164, title-casing city, slugify — without changing meaning.

---

## 5. Official-source-only fields

Prefer these sources exclusively:

| Field | Official source |
|---|---|
| opening_hours | Business website or Google Business Profile |
| google_rating / google_reviews_count | Google only |
| yelp_rating / yelp_reviews_count | Yelp only |
| booking_url | Link on official website (or owner) |
| website | Claimed/official domain |
| licenses / insurance (future) | Owner upload / regulator |

Do **not** invent hours from “Mon–Fri” guesses in Telegram ads without storing provenance and confidence.

---

## 6. Effectiveness vs live gaps

| Enrichment goal | Live outcome |
|---|---|
| Business phones | Strong (95.6%) |
| Business websites | Still weak (26.8%) |
| Business hours | Failed so far (3.4%) |
| Business geocode | Failed so far (3.4% lat) |
| Business city_geoid | Never attempted successfully (0%) |
| Pro card_summary | Strong (95.4%) — AI path works |
| Pro phone/city | Partial (57% / 56%) |
| Pro categories | Complete FK but **quality poor** (29% other) |
| Marketplace prices | Not enriched (1.5%) |
| Transfer fees / Lechu dates | Not enriched (0%) |
| Job compensation | Not enriched (0%) |

**Conclusion:** Contact/text enrichment is mature; **structured commercial fields and geo/hours are not.** Building a new enrichment algorithm should prioritize hours, geo, prices/fees/dates, and taxonomy repair — not more description rewriting.

---

## 7. Provenance gaps (blocking safe enrichment)

Missing on entities today:

- Per-field `source` / `confidence` / `updated_by`  
- `card_summary_generated_at` / model id  
- Distinction between owner-verified vs scraped vs inferred  

Without this, fill-empty-only still locks in **first wrong value**.

---

## 8. Recommended enrichment priority (no implementation)

1. Business `opening_hours` + lat/lng from official site / GBP  
2. Marketplace `price_amount` extraction from source_text  
3. Transfer fees + Lechu `departure_date` from source_text  
4. Professional city + phone for the 40%+ missing  
5. Reclassify `services` / `pro_other` with confidence + human review band  
6. Stop RE→business enrichment expansion  

Details in [RECOMMENDATIONS_V1.md](./RECOMMENDATIONS_V1.md).
