# Pipeline Coverage Audit V1 (P0→P8)

**Date:** 2026-07-28  
**Type:** Audit + roadmap only — no new pipeline, no code, no migrations, no deletes  
**Basis:** [`ENRICHMENT_PIPELINE_EXISTENCE_AUDIT_V1.md`](./ENRICHMENT_PIPELINE_EXISTENCE_AUDIT_V1.md), [`CARD_PROCESSING_ARCHITECTURE_V1.md`](./runtime/CARD_PROCESSING_ARCHITECTURE_V1.md), [`PIPELINE_AUDIT_V1.md`](../audits/PIPELINE_AUDIT_V1.md), [`ENRICHMENT_INFRASTRUCTURE_V1.md`](../audits/ENRICHMENT_INFRASTRUCTURE_V1.md)

**Goal:** Same lifecycle for all sources and entity types by **closing gaps in the existing P0→P8 spine**, not inventing a second pipeline.

Legend: **✓** full · **△** partial · **✗** absent / not wired

---

## 1. Coverage matrix — by source

| Source | P0 | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **Telegram** | ✓ | ✓ | △ | △ | ✓ | ✓ | ✓ | △ | ✓ | Collect+LLM/rules → `import_review_items`. P2 dual scripts; P3 backlog NULL types historically; P7 via published enrich + pro scripts, not automatic after every approve |
| **Facebook** | ✓ | ✓ | △ | △ | ✓ | ✓ | ✓ | △ | ✓ | Posts → queue; comments → `import_comment_recommendations` (parallel). Web enrich shared. Events often via recs/scripts |
| **Directories** | ✓ | △ | △ | △ | △ | ✓ | △ | △ | ✓ | P0 scrape→JSON ✓. P1 mostly → **recommendations**, not always `import_review_items`. P2/P7 rich only for svoi/orange (+4 dumps in `run_enrichment_pipeline`). Other 8 scrapers stop early |
| **Manual Admin** | ✗ | ✗ | ✗ | ✗ | ✗ | △ | ✓ | △ | ✓ | Skips P0–P4. Creates entity via forms (`AdminBusinessForm`, pro/event forms). P5 = form validation, not Inbox. P7 only if later CLI runs hit the row |
| **User publish** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | △ | ✓ | Owner/listing/event/pro forms → live tables. Not import pipeline. P7 optional CLI |
| **API Imports** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | No dedicated public/admin import API found |
| **CSV Imports** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Admin IA stub Coming Soon only |
| **Recommendations track** | ✓ | ✓ | △ | △ | △ | ✓ | ✓ | △ | ✓ | FB/TG comments → recs table. Classify buckets. Review Inbox/Community. Publish via recommendation-actions. Not full P0–P4 of import_review |
| **Professional cleanup handoff** | ✗ | ✓ | △ | △ | △ | ✓ | ✓ | △ | ✓ | Enqueues into import-review from live pros (side door into P1/P5) |

### Why cells are △ / ✗ (sources)

| Gap | Cause | Temp vs debt |
|---|---|---|
| Directories P1 into recs not queue | Product choice for YP cards | Debt if “one queue” is the goal |
| Directories P2/P7 uneven | Only svoi/orange (+4 JSON dumps) wired | Debt |
| TG/FB P3 NULL backlog | Classifier not always run on dumps | Debt (ops) |
| Manual/User skip P0–P4 | By design for first-party create | Acceptable fork — document as **Bypass path** |
| CSV/API | Not built | Product gap (IA stub) |
| P7 never auto on publish | CLI-only post-enrich | Debt for “same lifecycle” |

---

## 2. Coverage matrix — by entity type

Queue `entity_type` / collections from `types/import-review.ts`. “Place” is **not** a first-class type (lives as business / restore scripts).

| Entity | P0 | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **Business** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Best-covered. P7 richest (`enrich_published_businesses`, Places, geocode, yelp, booking…) |
| **Professional** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Strong P7 cluster; LLM `card_summary`; cleanup/merge scripts. P2 via `--entity professional` |
| **Marketplace** (`marketplace_listing` → listings) | △ | ✓ | △ | ✓ | ✓ | ✓ | ✓ | △ | ✓ | Collect as ads; P2 `run_enrichment_pipeline --entity listing`; P7 thin vs business (few dedicated listing enrichers) |
| **Job** | △ | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | Publish path in approve action; almost **no** P7 job enricher |
| **Event** | △ | ✓ | △ | ✓ | ✓ | ✓ | ✓ | △ | ✓ | FB events / queue events / `publish_recommendation_events`; P7 mostly cover/media/scripts, not full business-style enrich |
| **Organization** | △ | ✓ | △ | ✓ | ✓ | ✓ | △ | △ | △ | Soft-maps toward business; limited dedicated path |
| **Service listing** (`services` collection) | △ | ✓ | △ | ✓ | ✓ | ✓ | ✓ | △ | ✓ | Overlaps marketplace/services publish |
| **Real estate** | △ | ✓ | △ | ✓ | ✓ | ✓ | △ | ✗ | △ | Type exists on queue; thin product path |
| **Lechu / Transfer** | △ | ✓ | △ | ✓ | ✓ | ✓ | △ | ✗ | ✓ | Live listings product; import reclass scripts; not full enrich |
| **Place** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | △ | △ | △ | No entity_type=place. `restore_place_businesses` / Places API treat “place-like” businesses |

---

## 3. Pipeline breaks (gaps)

| # | Stop | Why | Temp / debt | Workaround |
|---|---|---|---|---|
| G1 | After Directory scrape (P0) | JSON only; no auto P1 for 8 sources | Debt | Manual `import_yellow_pages_cards` / svoi enrich |
| G2 | After YP → recommendations | Parallel track ≠ import_review P2–P4 | Debt / design fork | Inbox Recommendations View + approve |
| G3 | P3 on large TG dumps | NULL `entity_type` backlog | Ops debt | `classify_null_queue.py` |
| G4 | Dual P2 | `enrich_queue` vs `run_enrichment_pipeline` | Debt | Prefer latter as canonical |
| G5 | P6 → P7 | No hook on approve to schedule enrich | Debt | Manual CLI batches |
| G6 | Job / Lechu / RE after P6 | No P7 scripts | Debt / low priority | Manual admin edit |
| G7 | Marketplace P7 | No business-parity enrich | Debt | Owner edit + sparse scripts |
| G8 | Manual/User create | Intentionally skips P0–P5 | Acceptable bypass | Document as Path B |
| G9 | CSV / API | Stages missing entirely | Product gap | Coming Soon stubs |
| G10 | Event hours/geo/contacts | Partial collectors; weak P7 | Debt | FB publish scripts + admin |
| G11 | Completeness | Score CLI not on write path | Debt | Nightly / on approve later |
| G12 | Autopublish | `autopublish_strong_accepted.py` bypasses human P5 for subset | Intentional fast path | Keep gated |

---

## 4. Stage P7 (Post-Enrich) — focus

### Who gets P7 today

| Entity | P7? | Typical jobs | Auto after P6? | In app? |
|---|---|---|---|---|
| Business | **Yes** | `enrich_published_businesses`, Places, geocode, addresses, yelp, booking, card copy, telegram OCR, blurbs | **No** — manual CLI | **No** (forms only fill fields) |
| Professional | **Yes** | locations, card-first, svoi/orange/sources, avatars, categories, `summarize_professional_cards`, geocode | **No** | **No** (except owner/admin edit) |
| Marketplace listing | **Sparse** | little dedicated | No | Owner/listing edit |
| Job | **No** | — | No | Owner manage |
| Event | **Sparse** | cover/media/scripts | No | User event forms |
| Recs pre-publish | **Partial** | `enrich_recommendation_cards`, `enrich_svoi_directory` | Manual | No |

### Enrichments that exist but rarely/never run at scale

- Full-catalog Places (`enrich_places_fill_empty`) — **quota/cost gated**  
- Deep website hours for all with websites — runnable, not continuous  
- Non-svoi directory → entity enrich — mostly missing  
- Completeness score `--apply` catalog-wide — tooling exists, not cron  

### Integrated in application

- Field edit (admin/owner)  
- Publish-time contact/geo from queue payload  
- Search AI intent (**not** card P7)  
- **No** in-app “run enrichment job” for P7  

**Conclusion:** P7 is a **CLI toolbox**, not a stage that every entity automatically enters after P6.

---

## 5. Enrichment completeness by entity type

| Field | Business | Professional | Marketplace | Job | Event |
|---|---|---|---|---|---|
| Phone | ✓ | ✓ | △ | △ | △ |
| Email | ✓ | ✓ | △ | △ | △ |
| Website | ✓ | ✓ | △ | ✗ | △ |
| Instagram | ✓ | ✓ | △ | ✗ | △ |
| Facebook | △ | △ | ✗ | ✗ | △ |
| Telegram | ✓ | ✓ | △ | ✗ | △ |
| Address | ✓ | △ | ✗ | ✗ | △ |
| Coordinates | ✓ | △ | ✗ | ✗ | ✗ |
| Description | ✓ | ✓ | ✓ | ✓ | ✓ |
| Categories | ✓ | ✓ | △ | △ | △ |
| Services | △ | △ | △ | ✗ | ✗ |
| Images | ✓ | ✓ | △ | ✗ | △ |
| Hours | △ | △ | ✗ | ✗ | ✗ |
| AI Summary | ✗ | ✓ (`card_summary`) | ✗ | ✗ | ✗ |
| Quality Score | △ (`completeness_score`) | △ | ✗ | ✗ | ✗ |
| Places API | ✓ | △ | ✗ | ✗ | ✗ |
| Logo | ✗ | ✗ | ✗ | ✗ | ✗ |

---

## 6. CLI enrichment inventory (representative)

| CLI | Used? | Auto/Manual | Embed in P7? | Status |
|---|---|---|---|---|
| `run_enrichment_pipeline.py` | Yes | Manual | Yes — **canonical P2** | Keep |
| `enrich_queue.py` | Occasional | Manual | Duplicate of P2 | Deprecate later |
| `enrich_published_businesses.py` | Yes | Manual | Yes — **canonical business P7** | Keep |
| `enrich_places_fill_empty.py` / `google_places.py` | Yes, limited | Manual | Yes (cost-aware) | Keep |
| `geocode_all_addresses.py` | Yes | Manual | Yes | Keep |
| `fill_missing_addresses.py` | Yes | Manual | Yes | Keep |
| `enrich_professionals_*` family | Yes | Manual | Yes — pro P7 suite | Keep / document order |
| `summarize_professional_cards.py` | Yes | Manual | Yes (AI tier) | Keep |
| `enrich_svoi_directory.py` | Yes | Manual / shell loop | Directory P2/P6-ish | Keep; extend peers |
| `scrape_*.py` (YP) | Yes | Manual | P0 only | Keep |
| `import_yellow_pages_cards.py` | Yes | Manual | P1 for directories | Keep |
| `classify_null_queue.py` | Yes | Manual | P3 | Keep |
| `dedupe_open_queue.py` | Yes | Manual | P4 | Keep |
| `completeness_score.py` | Yes | Manual | P2/P7 metric | Keep; wire schedule later |
| `autopublish_strong_accepted.py` | Ops | Manual | P6 fast path | Keep gated |
| `hydrate_queue_media.py` | Yes | Manual | P2 media | Keep |
| `catalog_cleanup.py` / move_* / restore_* | Ops | Manual | P8 hygiene | Keep; not enrich |
| One-off merge/hardcoded lists | Rare | Manual | No as platform stage | Mark ops-only |
| `backfill_source_provenance.py` | Risky (always apply) | Manual | Careful | Ops-only |

---

## 7. Duplication — canonical vs later delete

| Area | Canonical | Secondary | Unify later? |
|---|---|---|---|
| Queue enrich (P2) | `run_enrichment_pipeline.py` | `enrich_queue.py` | Yes — retire secondary after soak |
| Category / type | `classify_null_queue.py` + EXTRACTION contract | Collector LLM categories; `classify_recommendation_buckets`; `backfill_professional_categories` | Keep staged; don’t merge into one blob |
| Dedupe | P4 `dedupe_open_queue` + publish `findDuplicateMatches` + admin merge | Multiple merge_*.py with same exact keys | Shared **key lib** later; keep stages |
| Completeness | `completeness_score.py` | Contact priority scores; ai_confidence | Completeness = P7 quality; ai_confidence = collect |
| Business P7 | `enrich_published_businesses` + Places + geocode | Overlapping fill scripts | Document ordered playbook, don’t delete yet |
| Web parse | `facebook-collector/web_enrichment.py` | Callers only | Already shared |

---

## 8. Roadmap (to ~100% coverage of **existing** P0→P8)

No new architecture — close gaps on the spine.

### Phase 1 — Close critical pipeline breaks
1. Declare Path A (import P0→P8) vs Path B (manual/user bypass).  
2. Make `run_enrichment_pipeline.py` the only documented P2; stop promoting `enrich_queue.py`.  
3. Ops: run `classify_null_queue` until NULL backlog cleared (G3).  
4. Document approve → “P7 expected next” checklist for moderators.  

**Done when:** Operators know one P2 command; NULL classify backlog under control.

### Phase 2 — Wire all directory sources through P1→P2→P5
1. Ensure every `scrape_*.py` JSON can enter recommendations **and** optional import_review.  
2. Extend `DIRECTORY_DUMPS` / enrich runners beyond svoi/orange + 4 dumps.  
3. Batch runners peer to `run_svoi_enrich_all.sh` for other directories.  

**Done when:** No directory source dies at JSON-only.

### Phase 3 — Automatic / scheduled P7 after P6
1. Define job: on approve (or nightly) enqueue entity for P7 playbook by type.  
2. Business playbook: published enrich → Places (budget) → geocode → completeness.  
3. Professional playbook: card-first → locations → summary → completeness.  
4. Still CLI/worker first — **no** requirement for in-app UI in this phase.  

**Done when:** Most new publishes receive at least one P7 pass without manual remember.

### Phase 4 — Entity parity (thin types)
1. Marketplace / Job / Event / Lechu: minimal P7 field packs (contacts, image, geo where relevant).  
2. Explicit “no P7” only where product says so.  
3. Completeness scores for types that have columns.  

**Done when:** Matrix §2 has no accidental ✗ on P7 for MVP entities (Business, Professional, Marketplace, Job, Event).

### Phase 5 — Unify libraries & retire duplicates
1. Shared contact/dedupe key helpers (Python + mirrored TS where needed).  
2. Retire/archive `enrich_queue.py` and obsolete one-offs.  
3. Single operator runbook: P0→P8 with commands per stage.  
4. Optional: in-app “Enrichment status” read-only (still not a new pipeline).  

**Done when:** One documented entry per stage; duplicates marked removable per Dependency Audit rules.

### Phase 6 — Mass enrichment + CSV/API (product)
1. Cost-controlled catalog P7 campaigns (Places/hours).  
2. CSV/API imports enter **P1** of the same spine (when product builds them — still not a second pipeline).  

**Done when:** Coverage matrices show ✓/conscious △ only; ✗ only for explicit non-goals (logo, language until prioritized).

---

## 9. Report checklist

| # | Deliverable | Section |
|---|---|---|
| 1 | Source × P0–P8 matrix | §1 |
| 2 | Entity × P0–P8 matrix | §2 |
| 3 | Breaks | §3 |
| 4 | P7 state | §4 |
| 5 | Field completeness | §5 |
| 6 | CLI list | §6 |
| 7 | Duplication | §7 |
| 8 | Roadmap | §8 |

### Executive verdict

- **Unified process already named:** P0→P8.  
- **Not unified in practice:** Directories short-circuit; Manual/User bypass; P7 is optional CLI; Jobs/Events/Marketplace under-enriched; CSV/API missing.  
- **Do not build a new pipeline** — execute Phases 1–5 on this spine.

*End of Pipeline Coverage Audit.*
