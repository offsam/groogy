# Completeness Score — Full System Audit V1

**Date:** 2026-07-28  
**Type:** Audit only — no code, formula, or algorithm changes  
**Basis:** live code under `scripts/business-enrich/`, `lib/business/`, `lib/import-review/`, SQL RPCs, Admin Review UI

---

## Executive finding

There is **not one** Completeness Score. There are **at least six** independent implementations that share a name or purpose but **do not share a formula**. The only persisted “canonical” catalog score is `businesses.completeness_score` / `professionals.completeness_score` from Python CLI. Search ranking uses a **different** in-memory scorer. Review Queue uses a **third** SQL 0–7 counter (plus contact priority). Admin preview uses a **fourth** checklist (`readyCount/total`).

There is **no** `quality_score` product field or scorer in the codebase.

---

## 1. Inventory — everything related to completeness / readiness

| Path | Purpose | Used now? | Called by |
|---|---|---|---|
| `scripts/business-enrich/completeness_score.py` | **Canonical entity scorer** (Business + Professional weights); CLI `--dry-run`/`--apply` writes DB column | Yes (ops CLI) | Manual CLI; imported by `run_enrichment_pipeline.py`, `run_pre_publish_enrich.py` (via `score_queue_item`) |
| `supabase/migrations/20260727200000_completeness_score.sql` | Adds `completeness_score integer not null default 0` on `businesses` + `professionals` | Yes (schema) | Migration applied |
| `docs/audits/ENRICHMENT_INFRASTRUCTURE_V1.md` §3 | Documents weight tables + caveats (98 vs 100, missing facebook/whatsapp cols) | Docs | Humans |
| `lib/business/completeness.ts` | **Search ranking** score (different weights); `compareBusinessesByCompleteness` | Yes (runtime) | `lib/supabase/queries.ts` `searchBusinesses`; `app/api/search/ai/route.ts` `rankBusinesses` |
| `supabase/.../import_review_completeness_score` (from `20260725024912_…` and later list RPCs) | **Queue list** score: count of 7 flags (0–7) | Yes | `admin_list_import_review_items` |
| `supabase/.../import_review_contact_priority_score` | Contact priority (phone=100…); **not** completeness | Yes | Same list RPC; default sort `priority` |
| `lib/import-review/contacts.ts` | TS mirror of contact priority + `contact_level` (`full`/`has_contact`/…) | Yes | Import Review UI, inbox adapters |
| `lib/import-review/queries.ts` | Surfaces RPC `completeness_score` (0–7) on list items | Yes | Admin Import Review / Inbox |
| `lib/import-review/preview-completeness.ts` | Admin **checklist** `readyCount/total` (binary fields) | Yes | `ImportReviewPreviewModal`, `RecommendationPreviewModal`, `pre-publish-enrich.ts` → Review Workspace panel |
| `components/admin/ImportReviewPreviewModal.tsx` | Shows checklist “Чем наполнять” | Yes | Import Review preview |
| `components/admin/RecommendationPreviewModal.tsx` | Same checklist via `CompletenessPanel` | Yes | Recommendations preview |
| `components/admin/ReviewEnrichmentPanel.tsx` | Shows checklist + P5C tags | Yes | Review Workspace |
| `scripts/business-enrich/run_enrichment_pipeline.py` → `score_queue_item` | Maps queue → entity scorer (floor); **listing** uses separate `LISTING_WEIGHTS` (0–100) | Yes | Enrich pipeline CLI; pre-publish orchestrator |
| `scripts/import-review/run_pre_publish_enrich.py` | P5C: calls `score_queue_item`, tags `[enrich_p5c_done]` — does **not** write entity column | Yes (CLI, auto OFF) | Manual |
| `scripts/import-review/eligibility.py` → `completeness_score()` | Autopublish eligibility sort: **0–7** field count | Yes | `autopublish_strong_accepted.py` |
| `scripts/import-review/merge_pending_clusters.py` → `completeness_score()` | **Misnamed** ranking **tuple** (brand hits, contacts, desc len…) — not a % | Yes | Cluster survivor pick |
| `lib/admin/review-workspace/load-task.ts` | Sets `completeness_score: 0` hardcoded when adapting import item | Yes | Workspace load — **does not** call RPC/Python scorer |
| `lib/admin/inbox/priority.ts` | Inbox priority 0–100 from AI confidence + age + type | Yes | Inbox — **not** completeness |
| `types/database.ts` | RPC return type includes `completeness_score` | Types | Generated/hand |
| Architecture docs (`CARD_PROCESSING`, `PLATFORM_LIFECYCLE`, P5/P7 audits) | Reference entity score as P7/P5C metric | Docs | — |

**Not found:** `quality_score` column or module; Job/Event/Marketplace **entity** completeness columns; readiness bands 0–20 / 20–40 / … for completeness; continuous trigger recompute of DB `completeness_score`.

**App catalog:** `Business` TS type / mappers do **not** expose DB `completeness_score`; search never reads that column.

---

## 2. Algorithms (each formula)

### 2.A Canonical entity scorer — `completeness_score.py`

**Output:** integer sum of weights present; returns `{score, breakdown, max_possible}`.  
**Not a true percentage** unless you divide by `max_possible` yourself. CLI prints `score/max_possible`.

#### Business — `BUSINESS_WEIGHTS` (sum **98**; reachable ~**96** without facebook/whatsapp columns)

| Key | Weight | Rule |
|---|---|---|
| name | 5 | non-empty |
| category_id | 5 | non-empty |
| city | 3 | non-empty |
| postal_code | 2 | non-empty |
| address_line | 5 | non-empty |
| geo | 3 | latitude **and** longitude set |
| opening_hours | 8 | non-empty |
| description | 8 | “real text”: ≥40 chars, ≥6 words, not placeholder set; **or** short_description same |
| image_url | 5 | non-empty |
| phone | 5 | non-empty |
| website | 5 | non-empty |
| instagram_url | 3 | non-empty |
| telegram_url | 2 | non-empty |
| facebook_url | 2 | non-empty **if key exists** (column missing → always 0) |
| whatsapp | 2 | same |
| email | 2 | non-empty |
| booking_url | 3 | non-empty |
| google_rating | 5 | non-empty |
| google_reviews_count_gt_10 | 3 | `google_reviews_count > 10` |
| yelp_rating | 3 | non-empty |
| offers_count_ge_3 | 5 | related `business_offers` count ≥ 3 |
| offers_with_price_ge_1 | 5 | ≥1 offer with price |
| promotions | 3 | proxy: featured offers ≥ 1 |
| jobs | 2 | related `jobs` count ≥ 1 |
| source_url | 2 | non-empty |
| short_description | 2 | real text with `min_len=15` |

**Required vs optional:** none are hard-required by the scorer. Every weight is optional add-on. Publish gate (G3 / QUALITY_CARD_RULES) is a **separate** system and does **not** use this score.

**Extras:** caller must merge `offers_count`, `offers_with_price_count`, `offers_featured_count`, `jobs_count` (CLI fetches them).

#### Professional — `PROFESSIONAL_WEIGHTS` (sum **100**)

| Key | Weight | Rule |
|---|---|---|
| display_name | 8 | non-empty |
| category_id_not_other | 10 | has category_id and slug ≠ `pro_other` (if slug provided) |
| city | 8 | city **or** service_area_text |
| postal_code | 3 | non-empty |
| any_contact | 15 | any of phone/website/instagram/telegram/email |
| phone | 5 | non-empty |
| website | 5 | non-empty |
| instagram_url | 4 | non-empty |
| telegram_url | 4 | non-empty |
| email | 3 | non-empty |
| headline | 5 | non-empty |
| description | 8 | real text heuristic |
| card_summary | 5 | non-empty |
| image_url | 8 | non-empty |
| opening_hours | 5 | non-empty |
| service_area_text | 4 | non-empty |

**Marketplace / Job / Event entities:** **no** formula in this file (`ValueError` for other types).

---

### 2.B Search ranking — `lib/business/completeness.ts`

**Output:** unbounded integer (typical ~0–40+), **not** aligned with DB column or 2.A weights.

Points for presenceFlags (phone 4, website 3, IG 3, email 2, yelp 2, maps 2, telegram 1), coords 4, street precision 3 / county 1, category 2, short/desc length tiers, real image 2, reviews/rating/google signals.

Used only as **tie-break / sort** after distance or AI hints — never persisted.

---

### 2.C Queue SQL — `import_review_completeness_score`

**Output:** integer **0–7** (count of true flags):

1. title non-empty  
2. description non-empty  
3. city non-empty  
4. category non-empty  
5. price not null  
6. photos_count > 0  
7. contact_priority_score > 0  

Equal weight (1 each). Used in Admin list RPC; secondary sort after `contact_priority_score` when `p_sort='priority'`.

---

### 2.D Autopublish eligibility — `eligibility.py` `completeness_score`

Same idea as 2.C: +1 for title, description, city, category, price, photos, any direct contact → **0–7**. Feeds `publish_rank` with contact bucket + AI confidence. **Does not** write DB columns.

---

### 2.E Queue listing weights — `run_enrichment_pipeline.LISTING_WEIGHTS`

For `entity=listing` only: title 20 + price 20 + description 20 + image 15 + city 10 + contact 15 = **100**. Business/pro queue rows map into 2.A with sparse fields (floor score).

---

### 2.F Admin checklist — `preview-completeness.ts`

**Not a score %.** Binary checklist → `readyCount/total` (business 7 fields, professional 6, listing 6). Used for moderator UX (“Чем наполнять”).

---

### 2.G Cluster merge ranking — `merge_pending_clusters.completeness_score`

Returns a **tuple** for `sorted(..., reverse=True)` survivor pick. Name collision only — not comparable to 2.A–2.F.

---

## 3. System impact

| Use case | Uses completeness? | Which formula? |
|---|---|---|
| Catalog search sort | **Yes** | 2.B `lib/business/completeness.ts` |
| AI search ranking | **Yes** (after hints / distance) | 2.B |
| Review Queue default sort | **Partially** | Contact priority primary; SQL **2.C** secondary |
| Review Queue display | **Yes** | 2.C on list; 2.F in preview/workspace |
| Publish gate G3 | **No** | QUALITY_CARD_RULES field checks only |
| Approve action | **No** | — |
| Autopublish ranking | **Yes** | 2.D (0–7) |
| Recommendations product ranking | **No** (preview checklist only) | 2.F UI |
| AI generation / OpenRouter | **No** | — |
| Catalog public API ordering by DB column | **No** | DB `completeness_score` unused in TS mappers |
| Internal metrics / dashboards | **Weak** | CLI reports; PLATFORM_LIFECYCLE claims backfill 2026-07-27; no live product dashboard found |
| Inbox priority | **No** | Separate `computeInboxPriorityScore` |

---

## 4. Enrichment → Completeness impact

Assumes **canonical 2.A** after publish (entity column), and **queue floor** via `score_queue_item` before publish.

| Enrichment | Affects score? | Fields improved | Typical lift (order of magnitude) |
|---|---|---|---|
| Queue text extract (P2/P5A) | Yes (queue floor + later entity) | phone, email, website, IG, telegram | +5–15 biz / +5–20 pro if contacts were empty (`any_contact` 15 alone) |
| Website deep scrape | Yes | phone, email, IG; site path may later feed hours/address on entity | +5–15 contacts; hours only after entity Places/scrape |
| Directory match | Yes | phone, email, IG, city, image | +3–15 |
| Places fill (P7) | Yes (entity) | address, geo, phone, website, hours, google_rating/count | **Large:** hours 8 + geo 3 + address 5 + ratings up to 8 |
| Nominatim geocode | Yes | geo (+3) | +3 |
| Yelp ratings | Yes | yelp_rating (+3) | +3 |
| Offers from site scrape | Yes | offers≥3 (+5), priced offer (+5), featured promo (+3) | +5–13 |
| Booking URL scrape | Yes | booking_url (+3) | +3 |
| Pro card_summary AI | Yes (pro) | card_summary (+5) | +5 |
| Pro avatars / image | Yes | image_url (+5 biz / +8 pro) | +5–8 |
| Pro categories backfill | Yes | category_not_other (+10) | +10 if was other/empty |
| Russian blurbs | Partial | short_description (+2) if “real” | +0–2 (may fail length heuristic) |
| Mentions / provenance | No | — | 0 |
| Completeness CLI `--apply` | Writes column | — | Recompute only |

Queue SQL **2.C** only moves when title/description/city/category/price/photos/any-contact-priority flip from empty→present (max +7 total).

---

## 5. Thresholds / bands

**Completeness 0–20 / 20–40 / 40–60 / 60–80 / 80–100 bands: do not exist** for any scorer.

Related thresholds elsewhere (not completeness bands):

| Threshold | Where | Meaning |
|---|---|---|
| contact_priority ≥ 180 | SQL / `contacts.ts` | `contact_level = full` |
| Inbox priority ≥ 70 / ≥ 40 | `inbox/priority.ts` | high / medium inbox priority |
| Description ≥ 40 chars / ≥ 6 words | `completeness_score.py` | “real” description |
| Google reviews > 10 | Business weights | +3 points |
| Offers ≥ 3 / priced ≥ 1 | Business weights | +5 / +5 |
| Autopublish confidence mins | `eligibility` / contract tests | Separate from completeness |

---

## 6. Can Completeness Score be the main Pipeline KPI?

### Verdict

**Yes as the primary catalog quality KPI for Business + Professional — using existing 2.A — without inventing a new scoring system.**  
**No as a single end-to-end Pipeline KPI today** without wiring and clarifying which score is “the” one.

### Sufficient today
- Documented weights, breakdown dict, CLI apply, DB columns, enrichment delta measurement (`score_before` → `score_after` in pipeline reports).
- Professional max 100 is clean; Business is usable with known 96/98 caveats.

### Missing for Pipeline KPI
1. **Multiple competing definitions** (search 2.B vs entity 2.A vs queue 0–7 vs checklist) — operators will confuse them.  
2. **DB column not used** in app search/catalog (search reimplements 2.B).  
3. **Not auto-refreshed** on edit/enrich (manual CLI).  
4. **No Marketplace/Job/Event entity scorer** (listing has only queue `LISTING_WEIGHTS`).  
5. **No band/SLA thresholds** for “ready for moderator” / “ready to publish”.  
6. **Queue floor ≠ published score** (hours/offers/ratings mostly post-P6).  
7. **Publish gate ignores score** (by design — gate is hard fields).

### Change algorithm?
**Not required** to start using 2.A as the Pipeline KPI for business/pro. Prefer:
- designate 2.A as SoT;
- schedule `--apply` after enrich batches;
- optionally later align search to DB score or drop 2.B;
- add listing/job/event scorers only when those pipelines need the same KPI.

---

## 7. Report answers (requested)

1. **Where implemented:** primary SoT `scripts/business-enrich/completeness_score.py` + DB columns; parallel: `lib/business/completeness.ts`, SQL `import_review_completeness_score`, `eligibility.py`, `preview-completeness.ts`, listing weights in `run_enrichment_pipeline.py`.  
2. **Full formulas:** §2.A–2.G.  
3. **Fields:** §2 tables.  
4. **Weights:** Business §2.A (98), Professional §2.A (100), Listing LISTING_WEIGHTS (100), Search 2.B (ad hoc), Queue SQL 2.C (1 each → 7).  
5. **Where used:** search ranking (2.B); Review list secondary sort + UI (2.C/2.F); autopublish rank (2.D); enrich reports (2.A/2.E); **not** publish gate; **not** DB column in public catalog UI.  
6. **Enrichment impact:** §4 table.  
7. **Pipeline KPI without new system:** **Yes for Business/Professional entity quality**, if you standardize on 2.A and wire recompute; **not yet** as the sole Review/Publish decision metric without status/threshold policy and without resolving the multi-formula confusion.

*End of Completeness Score Audit.*
