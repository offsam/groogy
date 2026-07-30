# Enrichment Pipeline — Existence Audit V1

**Date:** 2026-07-28  
**Type:** Read-only audit — no new code, no runs against production  
**Question answered:** What enrichment / analyzer / import / review pipelines already exist, which work, which overlap, what’s missing — before designing a unified pipeline.

**Canonical SoT (already in repo):**
- Lifecycle stages: [`CARD_PROCESSING_ARCHITECTURE_V1.md`](./runtime/CARD_PROCESSING_ARCHITECTURE_V1.md) (P0–P8)
- Nav hub: [`docs/navigation/runtime/ENRICHMENT.md`](../navigation/runtime/ENRICHMENT.md)
- Infra inventory: [`docs/audits/ENRICHMENT_INFRASTRUCTURE_V1.md`](../audits/ENRICHMENT_INFRASTRUCTURE_V1.md)
- Extract/classify contract: [`pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md`](./pipeline/EXTRACTION_CLASSIFICATION_CONTRACT_V1.md)
- Earlier E2E map: [`docs/audits/PIPELINE_AUDIT_V1.md`](../audits/PIPELINE_AUDIT_V1.md)

This document **consolidates and re-cuts** those sources for a “design unified pipeline next” decision — it does not invent a new architecture.

---

## 1. Canonical pipeline that actually exists

There is **one declared card-processing spine** (CARD_PROCESSING), plus **many offline scripts** that implement slices of it. Production Next.js owns **P5 Review + P6 Publish**; almost all enrichment is **CLI**.

```text
P0 COLLECT          Telegram / Facebook collectors (+ LLM analyze)
        ↓
P1 INGEST           → import_review_items (fingerprint)
        ↓           (+ parallel: yellow-pages JSON → import_comment_recommendations)
P2 EXTRACT          contacts / media / website / directory fill-empty on QUEUE
        ↓
P3 CLASSIFY         entity_type + target_collection (NULL-only rules)
        ↓
P4 DEDUPE           queue clusters → status duplicate
        ↓
P5 REVIEW           Admin Inbox / Workspace / legacy import-review  [HUMAN]
        ↓
P6 PUBLISH          approve*Action → businesses | professionals | listings | jobs | events
        ↓
P7 POST-ENRICH      fill-empty on LIVE entities (business-enrich / Places / media / LLM summary)
        ↓
P8 LIVE/RETIRE      owner edits, merge, archive
```

**Parallel track (recommendations):** Facebook/Telegram comments → `import_comment_recommendations` → classify buckets → Admin/Inbox approve → entities (then same P7 family).

**Not a single runnable binary.** Closest “orchestrators”:
- Queue enrich: `scripts/business-enrich/run_enrichment_pipeline.py` (P2-ish, 3 steps)
- Queue enrich (older): `scripts/import-review/enrich_queue.py`
- Published enrich: `scripts/business-enrich/enrich_published_businesses.py`
- Collect: `scripts/telegram-collector/*`, `scripts/facebook-collector/*`

---

## 2. Pipelines / modules inventory

Status: **Complete** = used and has clear I/O · **Partial** = works for subset / dry-run heavy / gaps · **Offline** = CLI only · **App** = Next.js runtime

| # | Location | Does | Input | Output | Used now? | By whom | Done? |
|---|---|---|---|---|---|---|---|
| 1 | `scripts/telegram-collector/analyzers.py` + `analyze_business_posts.py` | Rule + LLM analysis of posts (contacts, category, reject heuristics) | TG post JSON | `extracted_entity` / analysis JSON | Yes (collect runs) | Operators / CLI | Complete (offline) |
| 2 | `scripts/telegram-collector/contacts.py` | Phone/email/IG/web/TG extract + normalize | Free text | Canonical contact fields | Yes | Collectors + enrichment scripts + contract tests | Complete |
| 3 | `scripts/telegram-collector/dedupe.py` | Batch-level dedupe | Collector batch | Deduped batch | Yes | Collector | Complete |
| 4 | `scripts/telegram-collector/reviewer.py` / `import_needs_review.py` | Ingest to queue | Batch artifacts | `import_review_items` | Yes | CLI | Complete |
| 5 | `scripts/facebook-collector/*` (+ `normalize_facebook.py`, `web_enrichment.py`, `profile_enrichment.py`, `geo_price_enrichment.py`) | FB collect, normalize, site/profile/geo enrich | FB posts / URLs | Queue rows + enrich patches | Yes | CLI | Partial–Complete (hours scrape fixed recently) |
| 6 | `scripts/business-enrich/scrape_*.py` (10 directories) | Scrape YP-style sites | External HTML | Local `data/yellow_pages/*.json` only | Yes (2026-07-27 scrapes) | CLI | Complete scrape; **Partial** downstream |
| 7 | `scripts/business-enrich/import_yellow_pages_cards.py` | JSON → recommendation queue | Directory JSON | `import_comment_recommendations` | Yes | CLI | Complete |
| 8 | `scripts/business-enrich/enrich_svoi_directory.py` (+ `run_svoi_enrich_all.sh`) | Enrich+optional publish svoi/orange | Recs + Places | Recs + optionally entities | Yes | CLI | Partial (only 2 of ~10 sources have batch runner) |
| 9 | `scripts/business-enrich/run_enrichment_pipeline.py` | **Canonical queue enrich:** text → website → 4 directory dumps | Open `import_review_items` | Fill-empty queue fields + completeness report | Runnable | CLI | Complete for wired dumps; Partial coverage of directories |
| 10 | `scripts/import-review/enrich_queue.py` | Older queue enrich (TG profile + site + heuristics) | Open queue | Fill-empty queue | Runnable (overlap with #9) | CLI | Partial / **duplicate of #9** |
| 11 | `scripts/import-review/classify_null_queue.py` | P3 NULL classifier | Untyped queue rows | `entity_type` + collection | Yes | CLI + admin edits | Complete (rules) |
| 12 | `scripts/import-review/dedupe_open_queue.py` (+ merge clusters) | P4 queue dedupe | Open queue | `duplicate` status | Yes | CLI | Complete (exact keys) |
| 13 | `scripts/import-review/reclassify_*.py` | One-off / section reclass | Queue subsets | Retyped rows | Occasional | CLI | Partial (ad-hoc) |
| 14 | `lib/import-review/actions.ts` + recommendation-actions | P6 publish + field save | Admin actions | Entities + queue approved | **Yes — production** | Admin Workspace/Inbox | Complete |
| 15 | Admin Inbox / Workspace / Import Review UI | P5 human review | Queue / recs | Status decisions | **Yes — production** | Moderators | Complete (product) |
| 16 | `scripts/business-enrich/enrich_published_businesses.py` | P7 site/IG/Nominatim/Yelp/price | Approved businesses | Fill-empty business fields | Runnable | CLI | Complete path; coverage Partial |
| 17 | `google_places.py` / `enrich_places_fill_empty.py` | P7 Places hours/geo/phone | Approved businesses | Fill-empty | Runnable (quota/cost gated) | CLI | Partial at catalog scale |
| 18 | Professional enrich cluster (`enrich_professionals_*`, locations, avatars, categories, `summarize_professional_cards.py`) | P7 for professionals | Pros + sources | Fill-empty / card_summary LLM | Yes (recent apply JSON) | CLI | Partial |
| 19 | Dedup merge scripts (`find_business_duplicates`, `merge_*_duplicates`, professional cleanup) | P8 / cleanup | Live entities | Merges / archives / reports | Yes | CLI + admin merge action | Partial (exact-key; cleanup handoff to Admin Review) |
| 20 | `completeness_score.py` | Quality score calc + optional write | Entity/queue rows | `completeness_score` | Runnable | CLI | Complete scorer; **not** auto on every field change |
| 21 | `scripts/media-pipeline/` | Image hydrate / store | Queue/entity media | Storage URLs | Runnable | CLI | Partial |
| 22 | `lib/search` / `/api/search/ai` | Search intent LLM | User query | Intent JSON | **Production** | Public search | **Not** card enrichment |
| 23 | `lib/address/normalize.ts` | Address normalize (app) | Structured address | Normalized fields | Production forms | Admin/owner UI | Complete (forms only) |

---

## 3. Capability map

| Capability | Status | Evidence |
|---|---|---|
| Website Discovery | **△** | Website URLs extracted from text (`contacts.py`); deep fetch if URL known (`web_enrichment` / pipeline step 2). **No** general “find website from name-only” searcher as a product stage. |
| Social Discovery | **△** | IG/TG/FB handles from text + profile/page scrapers; Instagram/Yelp fill scripts. Not a unified social graph discovery. |
| Contact Extraction | **✓** | `contacts.py` + contract tests; used in collect, P2, enrich scripts, publish. |
| AI Description | **△** | `summarize_professional_cards.py` → `card_summary` (LLM). **No** general AI long-description generator for businesses as a standard P7 step. `russian_card_blurbs.py` = template, not LLM. |
| AI Categories | **△** | Collector LLM/rule category; `backfill_professional_categories.py` regex; queue classify is **rule** tree not LLM. No single AI category service for all entities. |
| Services Extraction | **△** | Prices/offers sometimes scraped; import fields `services`; not a dedicated services-list extractor pipeline. |
| Language Detection | **✗** | No dedicated language-detect module found. Heuristics like “has Cyrillic” in blurbs only. |
| Geo Enrichment | **✓ / △** | Nominatim, Places, group fallbacks, location rebuild scripts — **✓** tools exist; catalog fill **△** (hours/geo historically low %). |
| Logo Discovery | **✗** | No logo-specific discovery pipeline. Brand assets ≠ entity logos. |
| Image Discovery | **△** | Media pipeline, TG avatars, OG images from sites, flyer OCR paths — exists; not unified “image discovery” stage. |
| Hours Detection | **△** | Website hours extract (recently fixed in `web_enrichment.py`) + Google Places `opening_hours`. Still sparse on live catalog without Places scale runs. |
| Deduplication | **✓ / △** | Multi-layer: collector batch, queue dedupe, publish `findDuplicateMatches`, business/pro merge scripts, admin `mergeBusinessesAction`. **△** fuzzy matching limited (mostly exact keys). |
| Quality Score | **△** | `completeness_score` column + `completeness_score.py`; import contacts priority scores; `ai_confidence` on queue from collectors. **Not** continuously recomputed on every edit in app. |

Legend: **✓** implemented · **△** partial · **✗** absent

---

## 4. Duplication (do not merge blindly — document only)

| Area | Copies | Difference | Unify later? |
|---|---|---|---|
| Queue enrich | `run_enrichment_pipeline.py` vs `enrich_queue.py` | Newer 3-step + directories + completeness vs older TG-profile/site heuristics | Prefer one P2 entrypoint (`run_enrichment_pipeline`) |
| Contact normalize | `contacts.py` vs `eligibility.py` helpers vs TS side | Same intent, different modules | Contract already pins Python patterns |
| Website scrape | `web_enrichment.py` shared by FB + published enrich | Good shared module — keep | Already partially unified |
| Directory → live | Scrapers → JSON → recs; only svoi/orange richly enriched/published | 8 scrapers stop at JSON/recs | Wire more dumps into `DIRECTORY_DUMPS` / enrich runners — **don’t** invent parallel scrapers |
| Category classify | Collector LLM, NULL queue classifier, `classify_recommendation_buckets`, pro category backfill | Different tables/stages | Keep staged; document which runs when |
| Dedup | 4+ layers (batch/queue/publish/live merge) | Correct layering, overlapping keys | Unify **matching rules**, not into one script |
| AI | Collector LLM vs pro `card_summary` vs search intent | Different products | Search intent ≠ enrichment |

---

## 5. Report answers (requested)

### 5.1 Full scheme of what exists

See §1 (P0–P8). That is the real spine.

### 5.2 Which pipelines already exist

- Collect+analyze (TG/FB)  
- Ingest to `import_review_items`  
- Directory scrape → recommendations  
- Queue extract/enrich (two scripts)  
- NULL classify + rec bucket classify  
- Queue dedupe  
- Human review (Admin V2)  
- Publish actions  
- Post-publish business/pro/Places/media/LLM-summary enrich  
- Completeness scoring CLI  
- Multi-layer dedupe/merge  

### 5.3 What duplicates

Primarily **two queue enrichers**, **multiple category classifiers**, **multiple dedupe layers with similar exact-key logic**, **directory scrapers without equal enrich/publish wiring**.

### 5.4 What is really absent

- Language detection as a stage  
- Logo discovery  
- Unified “website discovery from name”  
- Unified AI business description generator (beyond pro `card_summary`)  
- Auto recompute of `completeness_score` on every write path  
- Fuzzy cross-entity dedupe as a first-class shared library  
- Single CLI that runs P0→P7 end-to-end  

### 5.5 What to finish instead of inventing a new pipeline

1. **Adopt CARD_PROCESSING P0–P8 as the unified design** — it already exists in docs.  
2. **Collapse P2 to one entrypoint** (`run_enrichment_pipeline.py`); deprecate/document `enrich_queue.py` as legacy.  
3. **Extend directory dumps** in that pipeline beyond 4 JSON files; batch runners for non-svoi sources.  
4. **Scale P7 Places/hours** deliberately (cost) + keep website deep scrape.  
5. **Wire completeness_score** into publish/approve or nightly job — don’t rebuild scoring.  
6. **Shared dedupe key library** for queue + publish + merge — don’t add a fifth ad-hoc matcher.  
7. **AI description/categories** — extend existing OpenRouter patterns (`summarize_professional_cards`, collector analyzers), don’t fork a third LLM stack.  
8. **Admin Review** is already the P5 product — enrichment should feed the queue/entities, not a parallel UI.

---

## 6. Problems noted (document only)

| Issue | Severity | Note |
|---|---|---|
| Dual queue enrich scripts | Medium | Operator confusion |
| Most yellow-pages scrapers never reach rich P7 | High | Hours/geo gap root cause for directories |
| Places enrichment quota/cost | Medium | Explains low hours/geo % |
| Completeness not live-updated | Low–Medium | Score drifts |
| Exact-only dedupe | Medium | False negatives |
| No language detection | Low until multi-lang push | — |
| Many one-off `data/*.json` apply artifacts | Low | Not SoT |

---

## 7. Suggested next design step (out of scope here)

When designing the “единый pipeline”, start from **CARD_PROCESSING P0–P8**, inventory scripts mapped to stages (this doc §2), and write a **thin orchestrator** that calls existing modules in order — not a greenfield enrichment product.

*End of audit. No code was written or executed against production as part of this document.*
