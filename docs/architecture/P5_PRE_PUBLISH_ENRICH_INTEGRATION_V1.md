# P5 Pre-Publish Enrich — Integration V1

**Date:** 2026-07-28  
**Type:** Design + implementation (reuse only; auto launch OFF)  
**Basis:** [`P7_POST_ENRICH_CAPABILITIES_AUDIT_V1.md`](./P7_POST_ENRICH_CAPABILITIES_AUDIT_V1.md), [`CARD_PROCESSING_ARCHITECTURE_V1.md`](./runtime/CARD_PROCESSING_ARCHITECTURE_V1.md), [`ENRICHMENT_RULES_V1.md`](../audits/ENRICHMENT_RULES_V1.md)

**Non-goals:** new enrich algorithms, new AI models, DB enum migration, cron auto-run, writes to published entities.

---

## 1. Can P7 run before Publish?

| Module / capability | Pre-publish? | Needs published entity? | Changes needed | Re-run safe? |
|---|---|---|---|---|
| Queue text extract (`run_enrichment_pipeline` step 1) | **Yes** | No | None — already queue | Yes fill-empty |
| Website deep scrape (same + `web_enrichment`) | **Yes** | No | None | Yes fill-empty |
| Directory dumps match | **Yes** | No | None | Yes fill-empty |
| `enrich_queue.py` (TG/IG heuristics) | **Yes** | No | Optional compose | Yes fill-empty |
| Completeness score (queue mapping) | **Yes** | No | Score in report + tags; no entity column | Yes |
| Places / Nominatim / Yelp on `businesses` | **No** | Yes (lat/lng, hours, ratings cols) | Stay **P7 post-publish** | Fill-empty on entity |
| Pro avatars / locations / card_summary on `professionals` | **No** | Yes | Stay P7 | Fill-empty / `--force` |
| Booking URL overwrite / russian blurbs | **No** (unsafe) | Entity | Stay ops-only P7 | No |
| Mentions / provenance always-apply | **No** | Entity | Stay ops | No |

**Rule:** Anything that today writes only to `import_review_items` is P5A material. Anything that writes to entity tables remains P7 after P6.

---

## 2. Split of existing code → P5A / P5B / P5C

### Auto (P5A) — implemented via existing queue pipeline

| Field family | Code |
|---|---|
| Phone / email / website / IG / Telegram | `run_enrichment_pipeline.step_source_text` + `step_website` + `step_directories`; also `enrich_queue.py` |
| Address / city | Directory + text heuristics (queue has `city`/`state`, not full street/geo) |
| Hours / Places / geocode | **Not** in P5A — entity-only P7 |

### AI (P5B) — reuse existing AI *signals*, no new LLM enrich

| Signal | Code |
|---|---|
| `ai_decision` / `ai_confidence` / `ai_reason` | Collector / classify path already on queue |
| Generative `card_summary` / blurbs | **Not** pre-publish (entity / overwrite risk) → tag `p5b_skipped` |

### Quality (P5C)

| Signal | Code |
|---|---|
| Completeness | `completeness_score.calculate_*` via `score_queue_item` + Admin `preview-completeness.ts` |
| Quality score | **Absent** as separate model — completeness is the proxy |
| Confidence | Existing `ai_confidence` |

---

## 3. Integration moment

```text
P0 → P1 → P2 Extract (legacy ops) → P3 → P4
  → P5 Review Queue (pending)
  → P5A Auto Enrichment     ← same modules as P2 queue enrich
  → P5B AI Enrichment         ← record existing AI fields / skip generative
  → P5C Completeness+Quality
  → P5D Moderator Review      ← human sees enriched card
  → P6 Publish → P8 Live
  → P7 Post-Enrich (entity-only remainder)
```

**Auto launch:** OFF. Orchestrator CLI only (`scripts/import-review/run_pre_publish_enrich.py`).  
After P5A–C (even partial), tags include `[ready_for_moderator]`; optional `--promote-in-review` sets `review_status=in_review`.

---

## 4. Status mapping (no enum migration)

Live DB enum stays 7 values. UX phases map as follows:

| UX phase | Live `review_status` | Tags (review_notes) |
|---|---|---|
| Queued | `pending` | none / enrich not started |
| Enriching | `pending` (during CLI) | — |
| AI Processing | `pending` | P5B tags written with A |
| Needs Review | `in_review` or `needs_more_info` | partial enrich tags |
| Ready (for moderator) | `in_review` + `[ready_for_moderator]` **or** `ready_to_publish` | all stage tags |
| Approved | `approved` | — |
| Rejected | `rejected` | — |
| Publishing | `approved` (transient) | — |
| Published | `approved` + `published_entity_id` | — |

Designed 13-state names (`Enriching`, etc.) are **aliases only** — see `lib/import-review/pre-publish-enrich.ts`.

---

## 5. UI (Review Workspace)

For `import_review` tasks, sidebar shows:

- Workflow phase alias + live status  
- Completeness checklist (`preview-completeness`)  
- P5A / P5B / P5C stage outcomes from tags  
- Heuristic field sources (source_text / website / directory / AI / manual unknown)  
- AI confidence when present  
- Edit remains via existing Workspace Edit  

Provenance columns are still a platform gap (ENRICHMENT_RULES); UI uses heuristics until they exist.

---

## 6. Update policy

Pre-publish enrich **must**:

- Fill-empty only (existing pipeline contract)  
- Never touch `approved` / published entity ids  
- Never mutate `raw_payload`  
- Never overwrite non-empty queue fields  
- Leave human `save_fields` values alone (non-empty → skip)

---

## 7. Dry-run / test

```bash
# 3 cards, no writes
python3 scripts/import-review/run_pre_publish_enrich.py --ids <id1>,<id2>,<id3>

# apply fill-empty + tags; do not change status
python3 scripts/import-review/run_pre_publish_enrich.py --ids <id1> --apply

# apply + move to in_review for moderator
python3 scripts/import-review/run_pre_publish_enrich.py --ids <id1> --apply --promote-in-review
```

Env `PRE_PUBLISH_ENRICH_AUTO` must remain unset/`0` — no app/cron path reads it to auto-run.

---

## 8. Report (implementation answers)

### 8.1 Moved before Publish
Queue contact/social/city/image fill via existing `run_enrichment_pipeline` (+ optional `enrich_queue` later); completeness scoring; AI *signal* recording; moderator-ready tagging.

### 8.2 Cannot move
Places, geocode, Yelp ratings, entity hours, pro summary/avatars/locations, booking overwrite, blurbs — require entity tables or unsafe overwrite.

### 8.3–8.6
Schema §3–4; statuses §4; code: tags, orchestrator, TS mapping, Review Workspace panel; next test: pick ≤5 `pending` business/pro rows, dry-run then `--apply --promote-in-review`, open `/admin/review/...`.

*End.*
