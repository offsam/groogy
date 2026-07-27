# PIPELINE AUDIT V1

**Date:** 2026-07-27  
**Method:** Code paths (`scripts/telegram-collector`, `scripts/facebook-collector`, `lib/import-review`, publish actions, enrichment scripts, public queries) + live queue stats  
**Companion:** [PLATFORM_DATA_AUDIT_V1.md](./PLATFORM_DATA_AUDIT_V1.md)

---

## End-to-end map

```text
Telegram / Facebook / Website directories / Manual admin
        ↓
   Collectors / scrapers
        ↓
   import_review_items  (+ import_comment_recommendations)
        ↓
   Classification (AI + rules)
        ↓
   Admin Review (approve / reject / duplicate / needs_more_info)
        ↓
   Publish → businesses | professionals | listings(+details) | jobs | events
        ↓
   Enrichment scripts (fill-empty)
        ↓
   Public website (views + RLS + contact RPCs)
```

---

## Stage 1 — Sources

### Telegram

| | |
|---|---|
| **Input** | Channel/group messages: text, media, author, message ids, chat id, permalink |
| **Output** | Rows in `import_review_items` with `source` like `telegram`, `telegram:sacramento_adaptation`, `telegram:la_orange_county` |
| **Fields set** | `source_*`, `source_text`, `source_media`, `source_fingerprint`, `raw_payload` |
| **Computed** | Fingerprint hash; sometimes preliminary title |
| **Lost** | Full thread context beyond stored message ids; reaction counts; edit history; some media if download fails |

**Live:** largest backlog is `telegram:sacramento_adaptation` (3 908 open).

### Facebook

| | |
|---|---|
| **Input** | Post text, permalink, media, group/page context |
| **Output** | `import_review_items` with `source='facebook'` |
| **Fields set** | Same staging columns |
| **Lost** | Comments (partially captured elsewhere as recommendations), private group nuances |

**Live:** 1 658 items; 999 still open.

### Website / directories

| | |
|---|---|
| **Input** | Scraped cards from Svoi.us, Orange Pages, Yellow Pages, EchoRu, etc. (`scripts/business-enrich/scrape_*.py`, directory admin panels) |
| **Output** | Often directly into `import_review_items` **or** enrichment writes onto existing `businesses`/`professionals` |
| **Fields set** | name, phone, address, website, city, images |
| **Lost** | Structured hours often not parsed; category taxonomy mismatch |

### Manual / Admin

| | |
|---|---|
| **Input** | Admin forms (`AdminBusinessForm`, professional/event forms) |
| **Output** | Direct table writes with status control |
| **Fields set** | Whatever admin enters |
| **Lost** | Nothing from a source post (no source) unless manually linked |

### User publish

| | |
|---|---|
| **Input** | Authenticated publisher forms for listings / events / professionals |
| **Output** | Direct entity rows |
| **Live reality** | Professionals `owner_profile_id` = **0%** — user-owned catalog not yet populated; listings mostly import-sourced |

---

## Stage 2 — Collector

| | |
|---|---|
| **Input** | Raw channel APIs / scrapes |
| **Output** | Normalized staging insert (fingerprint-unique) |
| **Changed** | Dedup on `source_fingerprint` prevents exact re-insert |
| **Computed** | Fingerprint, `first_seen`/`last_seen`, `occurrence_count` on renew |
| **Lost** | Soft duplicates with different fingerprints (reworded ads) survive as separate items → later `duplicate` status |

---

## Stage 3 — Import (staging)

Table: `import_review_items`

| | |
|---|---|
| **Input** | Collector payload |
| **Output** | Reviewable card: contacts arrays, title, category text, AI fields |
| **Changed** | Extraction into `phone[]`, `website[]`, `instagram[]`, `email[]`, `telegram_username`, `city`, `title`, `description` |
| **Computed** | `photos_count`, preview image (partial — 8.3% have `preview_image_url`) |
| **Lost** | Nuance of multi-offer posts; prices rarely extracted (`price` 0%); subcategory 0% |

Parallel track: **`import_comment_recommendations`** (9 428 rows) from Facebook/Telegram comments recommending specialists — separate approve → professional/business publish path.

---

## Stage 4 — Classification

| | |
|---|---|
| **Input** | `source_text` + extracted contacts |
| **Output** | `entity_type`, `target_collection`, `category`, `ai_decision`, `ai_confidence`, `ai_reason` |
| **Changed** | Queue routing for admin UI |
| **Computed** | Confidence score; sometimes `needs_more_info` |
| **Lost / failure mode** | **4 521 items with `entity_type` NULL** (mostly Sacramento dump) — classification never completed or not run |

Also: keyword `backfill_professional_categories.py` after publish — no confidence stored.

---

## Stage 5 — Review

| | |
|---|---|
| **Input** | Classified (or unclassified) staging rows |
| **Output** | `review_status`: pending → approved / rejected / duplicate / needs_more_info |
| **Changed** | Admin notes, reject_reason, duplicate_of_*, approved_by |
| **Computed** | Priority/scoring RPCs for queue order |
| **Lost** | When marked duplicate without merge, source text not folded into survivor entity automatically in all paths |

**Live funnel:** 9 260 → 1 773 approved, 1 703 duplicate, 16 rejected, 5 439 still open.

---

## Stage 6 — Publish

Implemented in `lib/import-review/actions.ts` + SQL RPCs (`enrich_business_from_queue`, lechu/transfer publish, etc.).

| entity_type (staging) | Lands in | Fields mapped | Common losses |
|---|---|---|---|
| business | `businesses` | name, desc, phone, city, category, source_*, image | hours, geo, email |
| private_specialist | `professionals` | display_name, contacts, city, source_*, image | experience, availability, owner |
| marketplace_listing | `listings` + marketplace details | title, desc, city, condition defaults | **price**, photos |
| lechu_listing | `listings` (`transport_carry`) + lechu details | route, carry_types, reward | **departure_date**, weight |
| transfer_listing | `listings` + transfer details | corridor, method | **fees**, amounts |
| event | `events` | title, desc, city, source_*, cover | date often fuzzy; ends_at never |
| job | `jobs` | thin title/desc/business | compensation, employment_type; **0 approved jobs from queue** |
| real_estate | **business or listing** (no RE table) | misrouted | All RE-specific structure |

**Computed on publish:** slug, status=`approved`/`active`/`published`, `published_at`, presence flags via views.

**Lost on publish:** array contacts → single phone/website; alternate phones; raw AI reason; full `source_media` set (often → one `image_url`); `whatsapp` rarely preserved as first-class field on entities.

---

## Stage 7 — Enrichment

See [ENRICHMENT_AUDIT_V1.md](./ENRICHMENT_AUDIT_V1.md).

| | |
|---|---|
| **Input** | Published entities + source pages + directories |
| **Output** | Fill-empty updates to contacts, geo, images, card_summary, categories, booking_url, yelp metrics |
| **Changed** | Only empty fields (by policy in scripts) |
| **Computed** | `card_summary` (LLM); geocode; mention counts; category_id |
| **Lost / risk** | Overwrite avoided, but **wrong empty fills** (bad city, wrong category) persist; no provenance per-field |

---

## Stage 8 — Public website

| | |
|---|---|
| **Input** | `*_public` views / RLS-filtered tables |
| **Output** | Cards + detail pages |
| **Changed** | Contacts become `has_*` flags; exact phone hidden until RPC |
| **Computed** | Blurbs (`businessCardBlurb`, `professionalCardBlurb`), location labels (city+ZIP) |
| **Lost to user** | Many filled admin fields never shown (see below) |

### Shown on public cards (high level)

- Business: name, category, blurb, city+ZIP, photo, contact icons, ratings if >0  
- Professional: name, blurb, city+ZIP, photo, origin badges  
- Marketplace / Transfer / Lechu: title, key detail fields, city when present  
- Events: title, date, city, cover  

### Present in DB but not usefully shown

- Empty ratings still stored  
- `opening_hours` rare → hours UI empty  
- Professional experience/availability columns unused → UI has nothing to show  
- Service listing rich fields unused  
- Transfer fees unused → card cannot show price  

---

## Field survival matrix (typical Telegram business ad)

| Concept in post | Staging | After publish | After enrichment | On website |
|---|---|---|---|---|
| Business name | title/business_name | name | maybe cleaned | yes |
| Phone | phone[] | phone (first) | fill if empty | icon / RPC |
| Multi phones | phone[] | **extras dropped** | — | lost |
| Instagram | instagram[] | instagram_url | fill | icon |
| Address free text | in source_text / city | address_line / city partial | geocode rare | city+ZIP only on card |
| Hours | rarely extracted | usually empty | scrape rare | missing |
| Price list | in text | sometimes business_offers | website scrape → offers | offers if created |
| Photos album | source_media | one image_url | avatar enrich | one photo |
| Category guess | category text | category_id | backfill | yes (often too broad) |

---

## Pipeline failure modes observed in live data

1. **Classification debt:** 4.3k open items with NULL `entity_type`.  
2. **RE publish without RE entity:** approved into business/listing.  
3. **Default pollution:** languages=`ru`, condition=`good`, pricing=`contact_for_price`, review counts=0.  
4. **Service vs Professional split:** same ad type → two catalogs (588 services + 964 pros).  
5. **Job publish path cold:** 127 job queue items, 0 approved → jobs table filled another way (only 13).  
6. **Media pipeline thin:** 7 `listing_media`, 0 portfolios.  
7. **Sacramento collector flood:** entire source still open.

---

## Stage ownership (code map)

| Stage | Primary locations |
|---|---|
| Telegram collector | `scripts/telegram-collector/` |
| Facebook collector | `scripts/facebook-collector/` |
| Import review UI | `app/admin/import-review/`, `components/admin/ImportReview*` |
| Publish actions | `lib/import-review/actions.ts`, SQL RPCs in migrations |
| Recommendations | `lib/import-review/recommendation-*`, admin recommendations pages |
| Enrichment | `scripts/business-enrich/*.py` |
| Public read | `businesses_public`, `professionals_public`, listing RLS, event RLS |
| Contact reveal | `get_business_contacts`, `get_professional_contacts` |
