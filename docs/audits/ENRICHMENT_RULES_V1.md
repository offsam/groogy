# ENRICHMENT RULES V1 — AI Stop-List

**Date:** 2026-07-27
**Scope:** what AI/LLM steps are allowed to write, per field, across `businesses`, `professionals`, `listings`+detail tables, `jobs`, `events`.
**Method:** read `scripts/business-enrich/*`, `lib/business-offers/validation.ts`, `lib/business/presence.ts`, cross-checked against `ENRICHMENT_AUDIT_V1.md` and `FIELD_AUDIT_V1.md`.
**Policy already in place, confirmed in code:** nearly every enrichment script is "fill-empty-only" (never overwrites a non-empty field) — this doc adds a **field-class** rule on top of that: some fields must never be AI-written even when empty, regardless of the fill-empty policy.

Companion: [DATA_CLEANUP_PLAN_V1.md](./DATA_CLEANUP_PLAN_V1.md), [ENRICHMENT_AUDIT_V1.md](./ENRICHMENT_AUDIT_V1.md)

---

## A) Never AI-generated — value must come from a source, not a model

These are ground-truth / identity / legal fields. A model may **extract** a value that already exists verbatim in source text, but must never **invent** or **infer** one that isn't literally present.

| Field | Table(s) | Why |
|---|---|---|
| `phone` | `businesses`, `professionals`; `phone[]` on `import_review_items` | Contact ground truth — a wrong invented number is actively harmful |
| `email` | `businesses`, `professionals` | Same |
| `whatsapp` | `import_review_items` (not yet a first-class column on published entities) | Same |
| `website` | `businesses`, `professionals` | Must be the entity's actual domain, not a guess |
| `address_line`, `private_address_line`, `postal_code` | `businesses`, `professionals` | Physical location — legal/trust-sensitive |
| `telegram_username`, `telegram_user_id`, `instagram_url`, `telegram_url` | various | Identity handles — must match the source, not be guessed from a name |
| `opening_hours` | `businesses`, `professionals` (jsonb) | See tier B — allowed only from an official source, never invented from "typical hours for this category" |
| `price_amount`, `fee_percent`, `fee_fixed_usd`, `min_amount_usd`, `max_amount_usd`, `processing_days`, `compensation_min`, `compensation_max` | `listings`, `transfer_listing_details`, `jobs` | Money — never estimate |
| `google_rating`, `google_reviews_count`, `yelp_rating`, `yelp_reviews_count`, `instagram_followers_count` | `businesses` | Third-party metrics — copy from the official page verbatim or leave null |
| `latitude`, `longitude` | all geocoded tables | Geocoder-derived from a *trusted* address only, never an LLM guess at coordinates |
| `source_url`, `source_fingerprint`, `raw_payload`, `source_text` | `import_review_items` | Already enforced immutable at the DB trigger level (`protect_import_review_raw_payload`) — confirms this tier is already a hard rule for at least one field, extend the same posture to the fields above |
| `mls_number`, `year_built`, `bedrooms`, `bathrooms`, `sqft`, `vin`, `license_info`, `insurance_status` | `business_offers` (property/vehicle attrs), `service_listing_details` | Structured facts about a specific physical thing — extract or leave empty |

**Normalization is allowed and is not "generation":** E.164 phone formatting, city title-casing, slugify, trimming whitespace — these preserve meaning, they don't add facts.

---

## B) Official-source-only — AI may write these, but only when sourced from a named, verifiable origin

Model-assisted **extraction** is fine here; the constraint is the *source*, not the presence of a model in the loop.

| Field | Allowed source | Forbidden source |
|---|---|---|
| `opening_hours` | Business's own website, or Google Business Profile | "Typical hours for a restaurant" inference, Telegram ad guesswork |
| `google_rating`, `google_reviews_count` | Google only | Yelp, estimated, or copied from a directory aggregator |
| `yelp_rating`, `yelp_reviews_count` | Yelp only | Same as above, reversed |
| `booking_url` | A link found on the business's own official website | A generic booking-platform search result guessed to be theirs |
| `website` | The claimed/official domain | Any URL a scraper found — `enrich_published_businesses.py` already maintains a `JUNK_HOST_PARTS` denylist (etsy, turo, instagram.com, facebook.com, t.me, openai.com, …) to reject non-official hosts; **this denylist should stay as code, not be treated as "AI enrichment" of the website field** |
| `latitude`/`longitude` | Nominatim/Google geocoder, called on a trusted `address_line` | Any coordinate not derived from an address string that itself passed extraction rules |
| licenses / insurance (future fields) | Owner upload or regulator verification | Any inferred/scraped claim |

**Special case — Gemini vision OCR on Telegram flyer photos** (`scripts/business-enrich/enrich_from_telegram_source.py`): this is a real, currently-running AI step that reads an image and extracts text, which can then feed into tier-A fields (phone/address/hours printed on a flyer). Treat OCR output as **lower-trust extraction, not tier-C generation**: it must still only fill empty tier-A/B fields, and any field filled this way should be tagged with a distinguishable source (`sources` dict pattern already used in `google_places.py` — extend it to this script) so a bad OCR read can be identified and re-checked later, rather than looking identical to a Google Places–sourced value.

---

## C) AI may generate freely — synthesis from already-present source text

| Field | Model path | Constraint |
|---|---|---|
| `professionals.card_summary` | `summarize_professional_cards.py` (gpt-4.1-nano / gemini-flash-lite / nova-micro via OpenRouter) | Must summarize the entity's **own** existing description/services text — not invent services or credentials not present in source. Already 95.4% filled; keep the same constraint going forward. |
| Blurb/description merge (`enrich_business_merge_description` RPC) | Import-time merge | Combines existing source snippets; must not fabricate new claims |
| Template blurbs (`russian_card_blurbs.py`) | Deterministic keyword→template, not an LLM | Not true "AI," but flagged here because it fills `description`/`short_description` with **generic templated copy** (e.g., category "restaurants" → "Русский ресторан") rather than anything entity-specific — acceptable as a last-resort filler, but should be distinguishable from real extracted copy so it isn't mistaken for verified content later |
| `entity_type` / `category` suggestions (with confidence) | Import classification, `ai_decision`/`ai_confidence`/`ai_reason` | Suggestion only — a human approval step (existing `admin_import_review_set_status` / `approveImportReviewItemAction`) remains the actual publish gate; AI confidence never auto-publishes |
| `needs_more_info` reasons, duplicate-match hints | Import review scoring | Advisory text for the admin UI, never written to a public-facing field |

---

## Why this three-way split, not a flat allow/deny

The existing code already implicitly follows something like this split (fill-empty-only, `JUNK_HOST_PARTS` denylist, `ALLOWED_ATTRS` per offer type in `lib/business-offers/validation.ts`) but there is **no single policy file enforcing it, and no per-field provenance column** to prove after the fact which tier a value came from (`ENRICHMENT_AUDIT_V1.md` §7). Concretely missing today:

- A `source` / `confidence` / `captured_at` column (or a shared `field_provenance` side table) per entity, so a tier-A field can be audited later — "who/what wrote this phone number, and when."
- Enforcement that lives in code (a shared validator both the Python enrichment scripts and the TS admin-save path call), not just script docstrings that say "fill empty only."

Until provenance columns exist, the practical rule for anyone running enrichment is: **if you can't say which named source (owner, official site, Google, Yelp, geocoder) a tier-A/B value came from, don't write it.**
