# P7 Post-Enrich — Capabilities Audit V1

**Date:** 2026-07-28  
**Type:** Audit only — no implementation  
**Basis:** [`PIPELINE_COVERAGE_AUDIT_V1.md`](./PIPELINE_COVERAGE_AUDIT_V1.md), [`ENRICHMENT_PIPELINE_EXISTENCE_AUDIT_V1.md`](./ENRICHMENT_PIPELINE_EXISTENCE_AUDIT_V1.md), [`ENRICHMENT_INFRASTRUCTURE_V1.md`](../audits/ENRICHMENT_INFRASTRUCTURE_V1.md), [`ENRICHMENT_RULES_V1.md`](../audits/ENRICHMENT_RULES_V1.md)

**Scope:** Capabilities of existing **P7 Post-Enrich** (live/published entities and closely related post-publish jobs). Pre-publish queue enrich (P2) is referenced only when it feeds the same field toolbox.

---

## 1. Catalog of P7 modules

| Module | Path | Used now? | Trigger | State |
|---|---|---|---|---|
| Published business enrich | `scripts/business-enrich/enrich_published_businesses.py` | Yes (ops) | Manual CLI `--dry-run`/`--apply` | **Ready** — fill-empty; deep website scrape |
| Website profile lib | `scripts/facebook-collector/web_enrichment.py` | Yes | Called by business enrich + others | **Ready** (hours/address fixes landed) |
| Site scrape probe | `scripts/business-enrich/scrape_business_site.py` | Yes (debug) | Manual, no DB | Ready |
| Google Places fill | `scripts/business-enrich/enrich_places_fill_empty.py` + `google_places.py` | Yes, limited | Manual; **quota/cost** | **Ready but scale-gated** |
| Geocode | `scripts/business-enrich/geocode_all_addresses.py` | Yes | Manual | Ready (Nominatim) |
| Address fill | `scripts/business-enrich/fill_missing_addresses.py` | Yes | Manual | Ready (multi-source + Gemini OCR option) |
| City/zip backfill | `scripts/business-enrich/backfill_city_zip.py` | Yes | Manual | Ready |
| Yelp ratings | `scripts/business-enrich/fill_yelp_ratings.py` | Yes | Manual | Partial (DataDome blocks common) |
| Booking URL | `scripts/business-enrich/scrape_booking_urls.py` | Yes | Manual | Ready; **can overwrite** if URL differs |
| From card copy / import sources | `enrich_from_card_copy.py`, `enrich_from_import_sources.py` | Yes | Manual | Ready, fill-empty |
| From Telegram source + OCR | `enrich_from_telegram_source.py` | Yes | Manual (+ telethon) | Ready, lower-trust OCR |
| Russian blurbs | `russian_card_blurbs.py` | Ops | Manual | Ready; **overwrites** short_description; may defer non-RU |
| Contacts from copy (redact) | `migrate_contacts_from_copy.py` | Ops | Manual | Ready; **rewrites** descriptions |
| Pro card-first | `enrich_professionals_card_first.py` | Yes | Manual | Ready; can overwrite junk website/city |
| Pro from svoi / orange / sources | `enrich_professionals_from_*.py` | Yes | Manual | Ready |
| Pro locations | `enrich_professional_locations.py`, `rebuild_professional_locations_from_groups.py`, `fill_professional_city_from_groups.py` | Yes | Manual | Ready; rebuild may null lat/lng without street |
| Pro avatars | `enrich_professional_avatars.py` | Yes | Manual (+ telethon for apply) | Ready, fill-empty image |
| Pro categories | `backfill_professional_categories.py` | Yes | Manual | Ready (regex; `--force` overwrites) |
| Pro AI summary | `summarize_professional_cards.py` | Yes | Manual OpenRouter | Ready; fill-empty unless `--force` |
| Mentions backfill | `backfill_community_mentions.py` | Yes | Manual | Ready |
| Completeness score | `completeness_score.py` | Yes | Manual | Ready calculator; not continuous |
| Media pipeline | `scripts/media-pipeline/` | Ops | Manual | Partial |
| Directory→entity (svoi) | `enrich_svoi_directory.py` | Yes | Manual / shell | Borderline P6/P7; publishes or fill-empty merge |
| Hub location fix | `fix_source_hub_locations.py` | Ops | Manual | Overwrites bad geo |
| Provenance backfill | `backfill_source_provenance.py` | Risky | Manual, **always applies** | Ops-only |

**Not P7 (exclude from mass catalog enrich):** scrapers-only, queue P2 (`run_enrichment_pipeline`), classify/dedupe, catalog_cleanup / move_* / merge_* (P8 hygiene).

**In application:** none of the above run automatically after approve. App only does human/owner field edits.

---

## 2. Capability matrix (what P7 can enrich)

| Capability | Status | Primary modules |
|---|---|---|
| **Contacts** | | |
| Phone | ✓ | Website, Places, card/import text, directories, OCR |
| Email | ✓ | Website, directories, text |
| Website | ✓ | Text extract, directories; junk denylist |
| **Social** | | |
| Instagram | ✓ | Website links, IG og, directories, text |
| Facebook | △ | Sometimes URL on card; no dedicated FB-profile enricher for all businesses |
| Telegram | ✓ | Username/url from text/sources; avatar from TG |
| WhatsApp | △ | Extracted on **queue**; **no** first-class published business column (ENRICHMENT_RULES) |
| YouTube | ✗ | Only filtered as non-website junk host |
| TikTok | ✗ | Same |
| LinkedIn | ✗ | Same |
| **Business content** | | |
| Categories | △ | Pro regex backfill; business mainly at publish/admin — little P7 AI category |
| Services | △ | Price lines → `business_offers` from site; not full services ontology |
| Description | △ | Merge/fill from site; template blurbs; OCR — not free AI rewrite for businesses |
| AI Summary | △ | **Professionals only** (`card_summary`); businesses ✗ |
| Keywords | ✗ | — |
| Tags | ✗ | — |
| **Location** | | |
| Address | ✓ | Website, Places, OCR, Yelp/social paths |
| Coordinates | ✓ | Nominatim / Places from trusted address |
| Google Places | ✓ | Dedicated script |
| Service Area | △ | Pro `service_area_text` / city heuristics — not a rich service-area engine |
| **Media** | | |
| Logo | ✗ / △ | OG/logo discovery exists in pro sources path for **image_url**, not dedicated logo field |
| Cover | △ | Directory cover → `image_url` on publish/enrich; not gallery cover system |
| Gallery | ✗ | No multi-image gallery enricher for catalog entities |
| Photos | △ | Single `image_url` / media pipeline / TG photo |
| **Extra** | | |
| Hours | △ | Website deep scrape + Places; catalog fill still sparse without mass Places |
| Reviews (text) | ✗ | No review-text scrape into product reviews |
| Rating | ✓ | Google / Yelp ratings fill-empty |
| Review count | ✓ | Google / Yelp counts |
| Languages | ✗ | Column may exist on pros; no P7 language enricher |
| Certifications | ✗ | — |
| Licenses | ✗ | Policy: never invent (tier A) |
| Brands | ✗ | — |
| Price Range | △ | Offers with prices from site; not `price_range` enum enrich |
| Attributes | ✗ | Offer attrs are product-specific, not P7 mass |
| Completeness Score | ✓ | CLI scorer + DB columns |
| Quality Score | △ | Completeness used as proxy; no separate “quality” model |

---

## 3. Per-capability detail (source · service · AI · re-run · fields)

| Enrichment | Data source | Service | AI? | Re-run safe? | Fields updated |
|---|---|---|---|---|---|
| Website deep scrape | Entity `website` | HTTP + `web_enrichment` | No (parse) | Yes if fill-empty | phone, email, IG, address parts, hours, description snippets, offers |
| Instagram OG | IG URL | HTTP og: | No | Yes fill-empty | followers/meta where used; image hints |
| Nominatim geocode | `address_line` | Nominatim | No | Yes fill-empty lat/lng | latitude, longitude, maps URL |
| Google Places | Name+city (+phone/web score) | Places API | No | Yes fill-empty; **$** | address, geo, phone, website, hours, google_rating/count |
| Yelp search/ratings | Name+city / yelp_url | HTML / JSON-LD | No | Partial (blocks) | yelp_url, yelp_rating, count |
| Booking link crawl | Own website | HTTP | No | **Careful** — may overwrite booking_url | booking_url |
| Card/import text mine | description / import payload | Regex | No | Yes fill-empty | contacts, city, address bits |
| TG flyer OCR | Source TG media | Telethon + Gemini Vision | **Yes OCR** | Yes fill-empty; lower trust | phone, address, hours candidates |
| Russian blurbs | Category keywords | Templates | No | **No mass** — overwrites short_description | short_description; may defer |
| Pro card-first | Card → site → directory | HTTP + parsers | No | Mostly fill-empty; junk overwrite OK | website, contacts, city, image |
| Pro directory pages | svoi / orange HTML | HTTP | No | Fill-empty + junk overwrite | contacts, city, description thin cases |
| Pro locations | Text + imports + groups | Rules | No | Fill-empty; rebuild overwrites location policy | city, region, address, clears bad geo |
| Pro avatars | TG profile / OG | Telethon / HTTP | No | Fill-empty image_url | image_url |
| Pro categories | Keywords | Regex | No | Fill-empty unless `--force` | category_id |
| Pro card_summary | Own description text | OpenRouter LLM | **Yes** | Fill-empty unless `--force` | card_summary |
| Completeness | Entity row | Local scorer | No | Yes | completeness_score |
| Community mentions | Comment/rec clusters | Matching | No | Insert-if-missing | business_community_mentions |

---

## 4. Coverage by entity type

| Enrichment family | Business | Professional | Marketplace | Job | Event |
|---|---|---|---|---|---|
| Contacts (phone/email/web) | ✓ | ✓ | ✗ P7 | ✗ | ✗ P7 |
| Instagram / Telegram | ✓ | ✓ | ✗ | ✗ | ✗ |
| Facebook / YT / TikTok / LI | △/✗ | △/✗ | ✗ | ✗ | ✗ |
| Address / geo / Places | ✓ | △ | ✗ | ✗ | ✗ |
| Hours | △ | △ | ✗ | ✗ | ✗ |
| Description / blurbs | △ | △ | ✗ | ✗ | ✗ |
| AI Summary | ✗ | ✓ | ✗ | ✗ | ✗ |
| Categories | △ | ✓ | ✗ | ✗ | ✗ |
| Services / offers | △ | △ | ✗ | ✗ | ✗ |
| Image / cover | △ | ✓ | ✗ | ✗ | △ scripts |
| Ratings | ✓ | ✗ | ✗ | ✗ | ✗ |
| Completeness score | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Overall P7 readiness** | **Strong** | **Strong** | **None** | **None** | **Weak** |

---

## 5. Safety

| Module | Overwrites manual? | Idempotent re-run? | Degradation guard | Mass-run safe? |
|---|---|---|---|---|
| `enrich_published_businesses` | No (fill-empty) | Yes | Junk website denylist; empty-only | **Yes** (start with `--limit`) |
| Places fill | No (fill-empty) | Yes | Match scoring; franchise ambiguity skip; stops on quota | **Yes with budget/quota** |
| Geocode | No (fill-empty) | Yes | Needs street address | **Yes** (rate-limit Nominatim) |
| `fill_missing_addresses` | No (fill-empty) | Yes | Multi-source | Yes with care on OCR |
| `fill_yelp_ratings` | No | Partial | Failures common | Limited |
| `scrape_booking_urls` | **Yes if differs** | Re-run changes URL | Weak | **No unrestricted mass** |
| `russian_card_blurbs` | **Yes** short_description | Dangerous | Defers non-RU | **No** as default mass |
| `migrate_contacts_from_copy` | **Rewrites** copy | Destructive | — | **No** without review |
| Pro card-first / directory | Junk fields only overwrite | Mostly yes | Junk detectors | **Yes** with dry-run first |
| Location rebuild | **Can null geo** | Policy-driven | Explicit no-pin-without-street | Ops with understanding |
| `summarize_professional_cards` | Only with `--force` | Yes empty | Summarize own text (policy) | **Yes** without `--force` |
| Completeness apply | Overwrites score only | Yes | N/A | **Yes** |
| `backfill_source_provenance` | Overwrites | Always apply | None | **No** |
| `fix_source_hub_locations` | Overwrites geo | Yes | Metro correction | Ops-only |

**Policy reference:** ENRICHMENT_RULES tiers A/B/C — contacts/geo/hours never LLM-invented; `card_summary` is the main allowed generative P7 field today.

---

## 6. Gap analysis (missing / weak)

| Gap | Importance | Difficulty | External API? | Via existing OpenRouter? |
|---|---|---|---|---|
| Mass hours fill | **High** | Low–Med (run Places + website) | Places $; website free | No (extraction not gen) |
| Auto P7 after publish | **High** | Med (scheduler/queue) | No | N/A |
| Marketplace / Job / Event P7 packs | **High** | Med | Optional Places | Optional summaries only |
| Business AI summary (like pro) | Med | Low | OpenRouter | **Yes** — clone pro summarizer pattern |
| WhatsApp on published entities | Med | Med (schema) | No | No |
| YouTube / TikTok / LinkedIn | Low–Med | Med | Scrape/API | Extract URLs only |
| Logo + gallery | Med | Med–High (storage UX) | Optional | No |
| Languages / certs / licenses | Med | High (trust) | Regulator/owner | Extract only, never invent |
| Keywords / tags | Low | Low | No | Optional assist |
| Review text ingest | Low | High | Google/Yelp ToS | No |
| Continuous completeness | Med | Low | No | No |
| Field provenance columns | High (safety) | Med (DB — out of this audit’s “no migration” scope for *implementation*) | No | No |

---

## 7. Report answers

### 7.1 Full capability catalog
§1 modules + §2 matrix.

### 7.2 Supported enrichments matrix
§2 (✓ / △ / ✗).

### 7.3 Entity coverage
§4 — Business & Professional ready; Marketplace/Job/Event essentially without P7.

### 7.4 Ready for mass run **today** (with dry-run → capped apply)
1. `enrich_published_businesses.py`  
2. `geocode_all_addresses.py`  
3. `enrich_professionals_card_first.py` (+ directory/source variants carefully)  
4. `summarize_professional_cards.py` (**without** `--force`)  
5. `completeness_score.py --apply`  
6. Places fill — **only with explicit quota/budget**

### 7.5 Needs work before mass
- Hours at catalog scale (ops + Places budget)  
- Yelp reliability  
- Booking URL overwrite policy  
- Pro location rebuild education / guardrails  
- Wire P7 into post-approve schedule (process, not new enrich tech)

### 7.6 Fully absent (as P7 product)
YouTube/TikTok/LinkedIn enrich · Logo/gallery system · Keywords/tags · Languages/certs/licenses enrich · Business AI summary · Marketplace/Job/Event enrich suites · App-triggered P7 · WhatsApp on live business rows

### 7.7 Priority by catalog quality impact

| Priority | Item | Why |
|---|---|---|
| P0 | Mass safe business+pro contact/geo/image fill (existing CLIs) | Immediate card completeness |
| P0 | Places + website hours campaign (budgeted) | Hours/geo gap |
| P1 | Post-approve / nightly P7 playbook (ops automation) | Stops “forgotten enrich” |
| P1 | Completeness score apply + monitor | Measures progress |
| P2 | Business `card_summary`-style AI blurb (OpenRouter, tier C) | UX parity with pros |
| P2 | Minimal Marketplace/Event contact+image P7 | Uneven catalog |
| P3 | Social extras (FB/YT/TikTok) | Nice-to-have |
| P3 | Logo/gallery | Design + storage |
| P3 | Licenses/certs/languages | Trust-sensitive; owner-first |
| Later | Provenance schema | Enables safer mass + AI |

---

## 8. Bottom line

P7 is **not empty**: Business and Professional have a **production-grade CLI toolbox** that is mostly fill-empty and mass-capable. What blocks “полноценное массовое обогащение” is (1) **no automatic stage after P6**, (2) **Places cost for hours/geo**, (3) **zero P7 for Marketplace/Job/Event**, (4) **missing media/social/AI-summary parity**, not missing contact extractors.

*Do not invent a new enrichment stack — schedule and extend the modules in §1.*

*End of P7 Capabilities Audit.*
