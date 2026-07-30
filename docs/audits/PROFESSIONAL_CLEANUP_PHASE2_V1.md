# Professional Cleanup Phase 2 — Execution Report

**Date:** 2026-07-28  
**Source of truth:** [`PROFESSIONAL_CLEANUP_PHASE1_V1.md`](./PROFESSIONAL_CLEANUP_PHASE1_V1.md) + [`data/professional_cleanup_phase1_classifications.json`](./data/professional_cleanup_phase1_classifications.json)  
**Executor:** `scripts/business-enrich/professional_cleanup_phase2.py` (`batch_id=professional_cleanup_phase2_v1`)  
**Constraint honored:** no schema / RLS / API / runtime changes. Archive only (no deletes). Enrichment fill-empty from own text + existing source pipelines.  

**Machine artifacts:**

- [`data/professional_cleanup_phase2_apply_20260728T002531Z.json`](./data/professional_cleanup_phase2_apply_20260728T002531Z.json) (latest apply report)
- [`data/professional_cleanup_phase2_apply_latest.json`](./data/professional_cleanup_phase2_apply_latest.json)
- Duplicate/business/marketplace actions embedded in that JSON
- Source enrich: `scripts/business-enrich/data/professional_source_enrich/apply_20260728T002526Z.json`

---

## 1. Executive summary

Phase 2 executed the Phase 1 plan with **conservative** migration gates (uncertain marketplace/job hits were not force-moved).

| Outcome | Count |
|---|---:|
| Duplicate groups merged | **46** |
| Professionals archived by Phase 2 batch | **85** |
| Migrated → Business | **21** |
| Migrated → Marketplace | **9** |
| Migrated → Job | **0** (Phase1 job hit reclassified as self-offer) |
| Junk archived | **2** |
| Review queue contact/category touch | **169** enriched · **171** keep-worthy · **201** still manual |
| Source-pipeline enrich applied | **21** field updates |

**Professionals approved:** 964 → **879** (−85)  
**Professionals archived:** 24 → **109** (+85)  
**Businesses approved:** ~2038 → **2058** (+20 net)  
**Marketplace active:** 68 → **77** (+9)  
**Jobs published:** unchanged (13)

---

## 2. Step 1 — Duplicates merged

- **46** strong-identity groups (Phase1 `DUPLICATE` → canonical slug from reason string).
- Canonical kept; non-canonical **archived** (`status=archived`, `visibility=private`).
- Unique contacts / socials / longer descriptions / better category (non-`pro_other`) / geo **merged onto canonical** (fill-empty + longer-text wins).
- Audit trail: each group in apply JSON `duplicates.items[]` with `canonical_slug`, `archived_slugs`, `patch_keys`.

Examples:

| Canonical | Archived siblings |
|---|---|
| `anastasiia-150705` | `anastasiia` |
| `anastasiya-breslavska-205430-8625` | `anastasiya-posashenko`, `anastasiya-posashenko-150711` |
| `anastasiya-zai-180857` | `anastasiya-zai` |

Name+city-only weak groups from Phase1 were **not** auto-merged (per Phase1 guidance).

---

## 3. Step 2 — Entity migrations

### 3.1 Professional → Business (21)

| Action | Count |
|---|---:|
| Restored existing archived business (same slug) + sync empty fields | 10 |
| Inserted new business | 11 |

Includes Phase1 hard list + soft businesses (`Worldwide Employment Agency`, `ENDO Studio`) + Amash Law Firm (was false marketplace).

Post-migration name corrections from source card text:

- `svoi-biz-4` → **Адвокатское бюро Питера Сварта**
- `business-7867507987-172159` → **Amash Law Firm**

Source professionals archived after successful business write.

### 3.2 Professional → Marketplace (9 high-confidence only)

Verified rentals/classifieds only:

| Kind | Examples |
|---|---|
| Vehicle rental | Jeep Gladiator, Kia Sportage, Prius, Camry |
| Housing | Carmichael home, Roseville room |
| Beauty space rental | Elmira beauty rooms, Glendale salon chairs |

Created `listings` (`marketplace_item` / `active` / `public`) + `marketplace_listing_details` (`transaction_type=sell` — schema has no `rent` enum), then archived the Professional.

### 3.3 Skipped / sent to review (uncertain)

| Slug | Why not migrated |
|---|---|
| `realtor-valeriia`, `realtor-valeriia-180843` | Realtor marketing, not a listing |
| `rita-torikashvili-205809-48fa` | Insurance anecdote |
| `anna-a-a-190937` | Offers nanny services (not a job vacancy) |

### 3.4 Before / after counts

| Metric | Before Phase2 | After Phase2 | Δ |
|---|---:|---:|---:|
| Professionals approved | 964 | 879 | −85 |
| Professionals archived | 24 | 109 | +85 |
| Businesses approved | ~2038 | 2058 | +20 |
| Marketplace active | 68 | 77 | +9 |
| Jobs published | 13 | 13 | 0 |

---

## 4. Step 3 — Review queue

Processed Phase1 `NEEDS_REVIEW` (approved) plus demoted marketplace/job skips.

| Result | Count |
|---|---:|
| Records reviewed | ~370 scope |
| Contact fields filled from **own** card text | **169** |
| Reclassified as keep-worthy (contact + real category + pitch) | **171** |
| Still requiring manual review | **201** |
| Promoted review→business in-pass | 0 (soft names already in business migrate set) |
| Archived from review as junk | 0 |

Never force-classified low-confidence rows: remaining **201** stay approved Professionals but are listed in apply JSON `review.still_review` (mostly stubborn `pro_other` and/or no contact).

**`pro_other`:** 278 → **115** (category guesses from card text during review).

---

## 5. Step 4 — Archive junk

| Slug | Reason |
|---|---|
| `pro-43ec4e5f88` | Empty/junk display_name `, ,` |
| `pro-ca48a2fb58-1` | Spam / unrelated AI promo under wrong title |

No permanent deletes.

---

## 6. Step 5 — Enrich remaining Professionals

Order respected: ran only after dupes / migrations / review / archive.

1. **Text extract (fill-empty):** phones/IG/Telegram/email/website + simple `City, ST` from own description — **5** additional after review pass (most needy already touched in Step 3).  
2. **`enrich_professionals_from_sources.py --apply`:** **21** updates from import_review / recommendations (website 11, phone 5, description 5, IG 1, image 1). Telegram photo re-download skipped this run (`--skip-telegram-photos`) for speed/session safety.  
3. **Category backfill script:** 0 further updates (remaining `pro_other` did not match high-confidence rules).

**Not invented:** no fabricated emails/addresses; Facebook still has **no column** on `professionals` (schema unchanged).

---

## 7. Remaining data-quality issues

On **879** approved Professionals:

| Issue | Count |
|---|---:|
| Still `pro_other` | 115 |
| No contact channel | 94 |
| No city and no service_area | 318 |
| No image | 255 |
| Manual review queue | 201 |
| Languages still default `{ru}` / hours / experience unused | near-universal |
| Weak name+city duplicate groups | not merged (need human) |
| Some marketplace titles truncated from first description line | cosmetic |

---

## 8. Records still requiring manual review

**Superseded.** The Phase 2 `still_review` set (**201**) was moved into Admin Import Review Center (`source=professional_cleanup_v1`). See [`PROFESSIONAL_CLEANUP_HANDOFF_ADMIN_REVIEW_V1.md`](./PROFESSIONAL_CLEANUP_HANDOFF_ADMIN_REVIEW_V1.md).

Professional Cleanup no longer owns a separate Manual Review queue.

---

## 9. Recommended follow-ups (not done)

1. Human pass on the **201** review rows (archive vs category vs business).  
2. Optional Telegram photo enrich for image gaps (`enrich_professionals_from_sources` without `--skip-telegram-photos`).  
3. Human merge of **name+city** weak duplicate groups.  
4. Marketplace title cleanup / consider product support for rental transaction type (schema change — out of scope).  
5. Only then: product quality gates for Professional publish.

---

## 10. Explicit non-actions

- No DB schema / RLS / API / UI changes  
- No hard deletes  
- No forced Job migration  
- No LLM-invented biography or contacts
