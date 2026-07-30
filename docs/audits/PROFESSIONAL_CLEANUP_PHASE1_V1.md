# Professional Data Cleanup & Canonicalization — Phase 1

**Date:** 2026-07-27  
**Constraint:** read-only analysis. No schema changes, no runtime changes, no migrations, no merges, no enrichment writes.  
**Method:** live `SELECT` via `scripts/sb_sql.py` + heuristic classifier `heuristic_v2` (tightened after v1 over-flagged marketplace via service `$` prices).  
**Machine artifacts:**

- [`data/professional_cleanup_phase1_classifications.json`](./data/professional_cleanup_phase1_classifications.json) — every row + decision + reason  
- [`data/professional_cleanup_phase1_queues.json`](./data/professional_cleanup_phase1_queues.json) — migration / review / enrich / soft-business summaries  

---

## 1. Executive summary

The `professionals` table has **988** rows (**964 approved**, **24 already archived**). Roughly **half of approved rows** look like real person/service professionals worth keeping; the rest need review or relocation.

| Verdict (approved only) | Count | Share of 964 |
|---|---:|---:|
| **KEEP_PROFESSIONAL** | 507 | 52.6% |
| **NEEDS_REVIEW** | 370 | 38.4% |
| **DUPLICATE** (non-canonical) | 53 | 5.5% |
| **MOVE_TO_BUSINESS** | 18 | 1.9% |
| **MOVE_TO_MARKETPLACE** | 14 | 1.5% |
| **MOVE_TO_JOB** | 1 | 0.1% |
| **MOVE_TO_EVENT** | 0 | 0% |
| **ARCHIVE** | 1 | 0.1% |

**Biggest structural problems (not “bad people”, bad typing):**

1. **`pro_other` dump category** — **278 / 964** approved (28.8%). Almost all of these land in `NEEDS_REVIEW`.  
2. **Missing contact** — **135** approved have no phone/email/website/IG/Telegram.  
3. **Identity duplicates** — **58** strong groups (shared phone/email/website/IG) → **53** non-canonical rows marked `DUPLICATE`; plus **38** same-name(+city) fuzzy groups for manual check.  
4. **Enrichment is thin on contacts/social**, thick on pitch text: KEEP rows almost all have description/card_summary, but email/website/IG are sparse; `languages` is default `{ru}` for **100%** of KEEP; `opening_hours` / `experience_years` unused.  
5. **Facebook has no column** on `professionals` (schema gap vs. enrichment checklist — note only; no schema change in this phase).

**What Phase 1 does *not* claim:** perfect classification. Marketplace/job/event rules are **strong-pattern only** (to avoid v1’s ~274 false marketplace hits). Soft business-like names still sitting in KEEP/REVIEW should be human-checked in Phase 2.

---

## 2. Step 1 — Full audit (statistics)

### 2.1 Population

| Metric | Count |
|---|---:|
| Total Professional records | 988 |
| Approved | 964 |
| Archived (DB status) | 24 |
| Source mix (approved) | TELEGRAM 434 · IMPORT 350 · FACEBOOK 180 |

### 2.2 Audit buckets (approved)

| Bucket | Count | Notes |
|---|---:|---|
| Correct / keep-as-professional (classifier) | 507 | `KEEP_PROFESSIONAL` |
| Likely businesses | 18 hard + 2 soft-name | See §3 / §8 |
| Marketplace / classifieds | 14 | Vehicle rent, room rent, goods ads |
| Events | 0 strong | Heuristic conservative; promo/workshop copy may still hide in KEEP/REVIEW |
| Jobs / hiring ads | 1 | Vacancy language |
| Empty / junk (approved) | 1 | Display name `, ,` → ARCHIVE |
| Already archived (DB) | 24 | Counted as ARCHIVE disposition |
| Strong duplicates (non-canonical) | 53 | Shared phone/email/web/IG |
| Missing any contact | 135 | |
| Missing category_id | 0 | All approved have a category |
| `pro_other` (weak category) | 278 | Treat as “missing real category” |
| Missing location (city + service_area + region empty) | 19 | Among all approved |
| Missing image | 279 | |
| Quality gate fail (no contact **or** no location **or** no pitch) | 144 | |
| Cannot confidently classify | 370 | `NEEDS_REVIEW` |

### 2.3 Representative examples (by audit theme)

**Correct professional (KEEP)**  
- `1touch-massage-150700` — massage service, real pitch  
- `360-tint-wrap` — auto service pro, missing image only  

**Business-shaped**  
- `arvian-law-firm-llc-172214` — Arvian Law Firm LLC  
- `acrossers-dance-studio-150610` — Acrossers Dance Studio  

**Marketplace / ad**  
- `aleksandr-172200` — Jeep rental `$900 / месяц`  
- `alena-181533-6d9d` — car rental classified  
- `fbpack-elmira-sibagatova-beauty-room-rental` — beauty room rental  

**Job**  
- `anna-a-a-190937` — hiring/vacancy language (childcare)  

**Empty / junk**  
- `pro-43ec4e5f88` — display_name `, ,`  

**Duplicate**  
- `anastasiia` → canonical `anastasiia-150705` (shared contact)  
- Multiple `Anastasiya Posashenko` → canonical `anastasiya-breslavska-205430-8625`  

**Needs review**  
- `svoi-abdulian-misak-h-md-physicians-thoracic-cardiova` — MD listing in `pro_other`  
- `adgar-180959` — finance pitch, **no contact channels**  

**Already archived**  
- `anna-ahmatova-150616`, `dr-modarres-150637`, etc.

---

## 3. Step 2 — Classification (every record)

Every row in `professional_cleanup_phase1_classifications.json` has:

- `decision` ∈ `KEEP_PROFESSIONAL` | `MOVE_TO_BUSINESS` | `MOVE_TO_MARKETPLACE` | `MOVE_TO_EVENT` | `MOVE_TO_JOB` | `NEEDS_REVIEW` | `DUPLICATE` | `ARCHIVE`  
- `reason` (short)  

### All statuses (988)

| Decision | Count |
|---|---:|
| KEEP_PROFESSIONAL | 507 |
| NEEDS_REVIEW | 370 |
| DUPLICATE | 53 |
| ARCHIVE | 25 |
| MOVE_TO_BUSINESS | 18 |
| MOVE_TO_MARKETPLACE | 14 |
| MOVE_TO_JOB | 1 |
| MOVE_TO_EVENT | 0 |

### Decision rules (v2)

| Decision | Rule (summary) |
|---|---|
| MOVE_TO_MARKETPLACE | Strong goods/vehicle/housing classified patterns (sell/buy car/furniture, `сдам машину/квартиру`, `$N/month` vehicle, etc.) — **not** bare `$` service prices |
| MOVE_TO_JOB | Hiring/vacancy language (`вакансия`, `ищем мастера`, `hiring nail tech`, …) |
| MOVE_TO_EVENT | Strong one-time event promo (Eventbrite, “tonight at…”, invite-to-event phrasing) |
| MOVE_TO_BUSINESS | Business-name + text/hours/address/web signals, score ≥ 3 |
| ARCHIVE | Junk name, empty shell, or already `status=archived` |
| DUPLICATE | Non-canonical member of strong identity group (phone/email/website/IG) |
| NEEDS_REVIEW | `pro_other`, no contacts, or ambiguous person vs business |
| KEEP_PROFESSIONAL | Passes above; person/service-shaped |

---

## 4. Step 3 — Business detection (migration candidates — not migrated)

### Hard `MOVE_TO_BUSINESS` (18 approved)

Examples:

| Name | Slug | Why |
|---|---|---|
| Arvian Law Firm LLC | `arvian-law-firm-llc-172214` | LLC + firm language |
| Acrossers Dance Studio | `acrossers-dance-studio-150610` | Studio name + business domain category |
| Advocate Medical Group… | `svoi-advocate-medical-group-…` | Medical Group + street |
| Enigma Day Spa & Welness | `svoi-enigma-day-spa-welness` | Spa brand + website |
| Enigma Spa / Euro Spa Resort / Le Cachet Spa | (see JSON) | Spa/resort branding |
| Metro Tech Academy | (see JSON) | Academy |
| Notary Consulting Group | (see JSON) | Group + street |
| Dovbenko Agency | `dovbenko-truck-insurance-234041` | Agency |

Full list: `queues.migration_business` in the queues JSON.

### Soft business-like names still not hard-moved (2)

Human review before any Business insert:

- `Worldwide Employment Agency`  
- `открыла свою уютную студию ENDO Studio`  

### Prep for Phase 2 (Business migration) — plan only

1. Manual confirm each hard candidate vs. solo practitioner (e.g. “Dental studio by Anna” may stay Professional).  
2. Deduplicate against existing `businesses` (name/phone/web/IG).  
3. Map category domain → Business category.  
4. Preserve provenance (`source_type`, `source_url`, import batch).  
5. Archive or redirect Professional slug after Business publish — **do not auto-delete**.

---

## 5. Step 4 — Advertisement detection

### `MOVE_TO_MARKETPLACE` (14)

| Name | Pattern |
|---|---|
| Aleksandr | Jeep rental ad |
| Alena | Kia Sportage rental |
| Ivanka / Roman / Rita Torikashvili | Vehicle/housing-style classified language |
| Elmira Sibagatova — Beauty Room Rental | Room rental |
| Realtor Valeriia (×2) | Matched housing/rent language — **re-check**; may be agent pitch not listing |

Treat realtor hits as **verify before move**. Prefer `NEEDS_REVIEW` if Phase 2 disagrees.

### Jobs

- Only **1** strong hit (`Anna A A`). Hiring blurbs embedded in spa/salon pitches may still sit in KEEP/REVIEW — expand job patterns carefully in Phase 2.

### Events

- **0** strong hits. Enrollment/workshop posts (dance “новый набор”, Valentine’s promo) were **not** force-moved (would inflate false positives). Optional Phase 2: soft event queue for human skim.

---

## 6. Step 5 — Enrichment audit (KEEP approved = 507)

**Do not enrich in this phase.** Field gaps on KEEP rows:

| Field | Missing | % of KEEP |
|---|---:|---:|
| phone | 167 | 32.9% |
| email | 478 | 94.3% |
| website | 414 | 81.7% |
| instagram_url | 387 | 76.3% |
| telegram_url | 297 | 58.6% |
| headline | 110 | 21.7% |
| short_description | 12 | 2.4% |
| description | 12 | 2.4% |
| card_summary | 9 | 1.8% |
| image_url | 136 | 26.8% |
| city | 179 | 35.3% |
| service_area_text | 445 | 87.8% |
| languages (real / non-default) | 507 | 100% (`{ru}` only) |
| opening_hours | 507 | 100% |
| experience_years | 507 | 100% |
| facebook | N/A | **no column** on `professionals` |

Composite:

- Profession/pitch present (headline **or** short_description): essentially all KEEP  
- Location (city **or** service_area **or** region): **5** KEEP missing all three  

Priority enrich queue (worst first): top 40 in `queues.enrich_top_40`. Typical missing sets: phone + socials + image + city + category_quality.

**Enrichment policy reminder (from platform rules):** contacts/address must come from source or stay empty — do not invent.

---

## 7. Step 6 — Duplicate detection

### Strong identity groups (shared contact)

| Key type | Groups with ≥2 approved rows |
|---|---:|
| phone | 15 |
| email | 5 |
| website | 20 |
| instagram | 18 |
| **name + city** (fuzzy / weak) | 38 |

- **Strong non-canonical rows marked `DUPLICATE`:** 53  
- Canonical pick = highest fill-score (contacts + description length + image)  
- Full groups: `dupes` array in classifications JSON; top groups in `queues.strong_dup_groups_top`

### Example canonical recommendations

| Group signal | Canonical | Non-canonical (examples) |
|---|---|---|
| Shared contact | `anastasiia-150705` | `anastasiia` |
| Shared contact | `anastasiya-breslavska-205430-8625` | `anastasiya-posashenko`, `anastasiya-posashenko-150711` |
| Shared contact | `anastasiya-zai-180857` | `anastasiya-zai` |
| Name+city weak | `aiza-m-205715-2ce1` | `aiza-m-181528-e5d8`, `aiza-m-205644-4aee` — **confirm before merge** |

**Do not merge in Phase 1.** Phase 2 should: (1) confirm same person, (2) union non-conflicting fields onto canonical, (3) archive duplicates with redirect note.

---

## 8. Deliverable queues

### 8.1 Migration candidates

| Target | Count | Artifact |
|---|---:|---|
| Business | 18 hard (+2 soft) | `migration_business`, `soft_business_review` |
| Marketplace | 14 | `migration_marketplace` |
| Job | 1 | `migration_job` |
| Event | 0 | — |

### 8.2 Duplicate candidates

- 53 `DUPLICATE` decisions + 58 strong groups + 38 name_city groups  

### 8.3 Review queue

- **370** approved `NEEDS_REVIEW`  
  - 258 — `pro_other` dump category  
  - 111 — no contact channels  
  - 1 — ambiguous person vs business  

### 8.4 Enrichment queue

- **507** KEEP approved (all need at least language/hours/experience hygiene; ~⅓ missing phone; ~¼ missing image)  

### 8.5 Archive queue

- **25** total: 24 already archived in DB + 1 junk approved name  

---

## 9. Recommended execution order (Phase 2+)

Safe order — still **no** schema/runtime work until explicitly approved:

1. **Freeze new Professional imports** that land in `pro_other` without a real category (process rule, not schema).  
2. **Duplicate pass** — merge/archive strong phone/email/web/IG groups; leave name_city as human-only.  
3. **Marketplace moves** — 14 rows; re-verify realtor-shaped hits.  
4. **Business moves** — 18 hard + soft names; dedupe against `businesses` first.  
5. **Job move** — 1 row; skim KEEP beauty/salon text for more vacancies if desired.  
6. **Review queue** — split `pro_other` into real categories vs archive vs business; require contact for publish.  
7. **Archive junk** — empty names / empty shells.  
8. **Enrichment** — only KEEP survivors; fill from source posts (phone/IG/Telegram/city/image); never invent email/address.  
9. **Event soft pass** (optional) — human skim of promo language.  
10. Only after data is clean: consider product gates / schema (Facebook field, etc.) as separate projects.

---

## 10. Method caveats

- Classifier is **regex + light name heuristics**, not LLM judgment.  
- v1 marketplace filter was discarded (~274 FPs from `$` service prices and “аренда” in document help).  
- Event/job recall is intentionally low.  
- Some KEEP rows still look corporate (`Cosmetic Dentists`, branded auto names) — below hard business score; soft review recommended.  
- Counts are live as of **2026-07-27**; re-run the JSON generator before Phase 2 execution.

---

## 11. Explicit non-actions this phase

- No `UPDATE` / `INSERT` / `DELETE`  
- No merges  
- No enrichment writes  
- No schema / RLS / API / UI changes  
- No destructive archive beyond documenting the queue
