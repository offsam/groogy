# NULL CLASSIFICATION ALGORITHM V1

**Date:** 2026-07-27
**Scope:** the `import_review_items` backlog where `entity_type IS NULL`
**Method:** live SQL against the production DB (via `scripts/sb_sql.py`) + reading the existing classifiers in `scripts/telegram-collector/reviewer.py`, `scripts/facebook-collector/facebook_decision_policy.py`, `scripts/import-review/merge_pending_clusters.py`, `scripts/import-review/category_map.py`
**Constraint honored:** analysis only. No script in this doc has been run in write mode; all SQL below is `SELECT`.

Companion: [DATA_CLEANUP_PLAN_V1.md](./DATA_CLEANUP_PLAN_V1.md)

---

## 1. Live shape of the backlog (verified 2026-07-27)

```sql
select entity_type, count(*) from public.import_review_items group by entity_type;
-- (null)  = 4521   -- confirmed live, matches audit docs
```

Breakdown of the 4,521 NULL rows by `review_status`:

| review_status | count |
|---|---:|
| pending | 3 916 |
| needs_more_info | 441 |
| duplicate | 164 |

None are `approved`, `rejected`, or `ready_to_publish` — **the NULL bucket has never reached a publish decision**, confirming this is purely a classification gap, not a review gap.

By source:

| source | NULL rows | has business_name | has person_name | has phone | has website | has instagram | has category text | has city |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `telegram:sacramento_adaptation` | 3 908 | 1 444 (37%) | 319 (8%) | 1 931 (49%) | 453 (12%) | 1 355 (35%) | 3 908 (100%) | 3 908 (100%) |
| `facebook` | 613 | 0 | 0 | 4 | 3 | 0 | 613 (100%) | 0 |

**Important finding:** `ai_decision` / `ai_confidence` / `ai_reason` are **100% filled** on every NULL row (avg confidence 0.86–0.94). Checked live: `ai_decision` here is a **queue-routing verdict** (`needs_review` 4 434 / `accepted` 81 / `rejected` 6), not an entity-type verdict — it answers "does this need a human?", not "what is this?". **Do not mistake AI-decision presence for classification having happened.** The category-text field, however, is 100% populated on both sources and is the strongest available signal (see §3).

`category` distribution on the Sacramento NULL rows (top values, live count):

| category | count | implies |
|---|---:|---|
| auto_services | 976 | business (usually) |
| other | 651 | unclassifiable by category alone |
| beauty | 485 | business or professional — ambiguous |
| health | 421 | business or professional — ambiguous |
| legal | 247 | business or professional — ambiguous |
| insurance | 236 | business |
| professional_services | 225 | business or professional — ambiguous |
| events | 122 | **event — clean signal** |
| food | 113 | business |
| pet_services | 104 | business or professional — ambiguous |
| education | 89 | business or professional — ambiguous |
| home_services | 46 | business or professional — ambiguous |
| travel | 43 | business |
| accounting | 29 | business or professional — ambiguous |
| real_estate_services | 24 | **real_estate — clean signal** |
| moving, car_rental, fitness, childcare, cleaning, photography_video | ≤21 each | business or professional — ambiguous |

**Reading:** roughly 3% of the Sacramento rows (`events` + `real_estate_services`) have an unambiguous category → entity_type mapping. The remaining ~97% carry a *business-domain* category slug regardless of whether the underlying post is a company or a solo person — category text alone cannot separate `business` from `private_specialist`. This matches the existing finding (`ENTITY_AUDIT_V1.md`) that professionals already FK into business-domain category rows.

The Facebook 613 NULL rows carry almost no structured signal (0% business/person name, ~0% contacts, 0% city) — classification there must fall back to `source_text` content or be handled as a disposition-only case (§5).

---

## 2. Do not build a second classifier — reuse what exists

The codebase already has working rule-based classifiers that were simply **never run against these specific rows** (or ran and produced no confident answer, which is why they're still NULL). Reuse them as the single source of truth instead of writing new keyword lists:

| Existing classifier | Location | What it does |
|---|---|---|
| `infer_entity_type()` | `scripts/telegram-collector/reviewer.py:238-260` | Regex for lechu/transfer (`LECHU_RE`/`TRANSFER_RE`), then business-vs-specialist fallback on name presence |
| `facebook_decision_policy.py` | `scripts/facebook-collector/facebook_decision_policy.py:13-72` | Regex decision tree: `REAL_ESTATE_OFFER_RE`, `JOB_HIRE_RE`, `MARKETPLACE_RE`, `EVENT_RE`, `BUSINESS_SIGNAL_RE` vs `SPECIALIST_SIGNAL_RE` |
| `pick_entity_routing()` | `scripts/import-review/merge_pending_clusters.py:255-279` | Majority-vote across duplicate cluster + `BUSINESS_HINT_RE` fallback |
| `category_map.py` | `scripts/import-review/category_map.py:69-74` | Keyword → category slug, including `real_estate_services`/`realtor`/`mortgage`/`property_management` → `real_estate` |

**Recommendation:** any classification pass on the NULL backlog should call these functions (or a thin wrapper around them), not a fresh implementation — two parallel classifiers producing different verdicts for the same text is a worse outcome than the current gap.

---

## 3. Decision tree (words + pseudocode)

Applies per `import_review_items` row where `entity_type IS NULL`. Each rule is a **gate**: if it fires, stop and assign; if not, fall through.

```
classify(item):

  # --- Gate 0: hard route by explicit keyword category (highest confidence, cheap) ---
  if item.category in {"events"}:
        return (entity_type="event", target_collection="events", confidence=HIGH)

  if item.category in {"real_estate_services", "realtor", "mortgage", "property_management"}
     or REAL_ESTATE_OFFER_RE.search(item.source_text):
        return (entity_type="real_estate", target_collection="real_estate", confidence=HIGH)
        # NOTE: publish path for "real_estate" is currently broken (see §3.5 of
        # DATA_CLEANUP_PLAN_V1) — classify it correctly here regardless; fix the
        # publish target separately. Do not down-route to "business" just because
        # the publish path isn't ready.

  # --- Gate 1: route-shaped listings (lechu / transfer / marketplace / job) ---
  if LECHU_RE.search(item.source_text):
        return (entity_type="lechu_listing", target_collection="lechu", confidence=HIGH)

  if TRANSFER_RE.search(item.source_text):
        return (entity_type="transfer_listing", target_collection="transfers", confidence=HIGH)

  if JOB_HIRE_RE.search(item.source_text):
        return (entity_type="job", target_collection="jobs", confidence=MEDIUM)

  if MARKETPLACE_RE.search(item.source_text) and not item.business_name:
        return (entity_type="marketplace_listing", target_collection="marketplace", confidence=MEDIUM)

  # --- Gate 2: business vs private_specialist (the ambiguous majority case) ---
  if item.business_name and not item.person_name:
        signal = "business"
  elif item.person_name and not item.business_name:
        signal = "private_specialist"
  elif BUSINESS_SIGNAL_RE.search(item.source_text)   # LLC/Inc/"компания"/"салон"/"клиника"/multi-employee wording
       and not SPECIALIST_SIGNAL_RE.search(item.source_text):
        signal = "business"
  elif SPECIALIST_SIGNAL_RE.search(item.source_text)  # first-person "я", solo pronoun, personal name pattern
       and not BUSINESS_SIGNAL_RE.search(item.source_text):
        signal = "private_specialist"
  else:
        signal = None   # both or neither fired — genuinely ambiguous

  if signal is not None:
        confidence = HIGH if (item.phone or item.website or item.instagram) else MEDIUM
        return (entity_type=signal,
                target_collection=("businesses" if signal=="business" else "private_specialists"),
                confidence=confidence)

  # --- Gate 3: nothing fired — cannot classify from structured fields or regex ---
  return (entity_type=None, confidence=NONE, reason="no_signal")
```

### Field inputs used, in priority order

1. `category` (text, 100% filled on both open sources) — cheapest, highest-precision for the two clean buckets (`events`, `real_estate_services`/realtor/mortgage/property_management).
2. `source_text` regex hints — already-built patterns, see §2.
3. `business_name` / `person_name` presence — direct signal when the collector already extracted a name into the right slot.
4. Contact presence (`phone[]`, `website[]`, `instagram[]`, `telegram_username`) — used only to set **confidence**, not to decide type (a contact doesn't tell you business vs. person).
5. `source` (which collector) — used only to route disposition for the unclassifiable remainder (§5), since the two open sources have very different signal density (Sacramento: 49% have phone; Facebook: <1% have phone).

### What NOT to use as a classification signal

- `ai_decision` / `ai_confidence` — this is a review-routing verdict, not a type verdict (see §1). Do not equate "AI already decided" with "AI already classified."
- `duplicate_status` / `recurring_cluster_id` — useful for merge/dedupe, irrelevant to type.
- `photos_count` — no correlation with entity type found in code or schema.

---

## 4. Confidence thresholds and what happens at each

| Confidence | Trigger | Action |
|---|---|---|
| **HIGH** | Gate 0/1 keyword match, or Gate 2 with a clean name-slot signal + ≥1 contact | Auto-set `entity_type` (and `target_collection`) on the row. **This does not publish anything** — it only unblocks the row from the NULL bucket into the normal `pending` review queue for that type, where the existing human-approval gate in `lib/import-review/actions.ts` still applies before anything reaches `businesses`/`professionals`/`listings`. |
| **MEDIUM** | Gate 1/2 regex match without a contact signal, or name-slot signal without regex corroboration | Auto-set `entity_type`, but flag the row (e.g. `review_notes` prefix `[auto-classified:medium]`) so admin triage sees it was inferred, not extracted. Still gated by the same human-approval step. |
| **NONE** | Gate 3 — nothing fired | Do **not** force a guess into `entity_type`. See §5 for disposition. |

Auto-classification (HIGH/MEDIUM) only ever *sets a label on a staging row*. It must never be wired to bypass `approveImportReviewItemAction`'s existing checks (title resolvable, ≥1 contact, no unresolved duplicate) — those stay the publish gate regardless of how `entity_type` got filled in.

---

## 5. Records that cannot be classified

Live estimate: roughly all 613 Facebook NULL rows (near-zero structured signal) plus a meaningful slice of the ~2,100 Sacramento rows with an ambiguous business-domain category, no business/person name, and no regex match — this needs an actual dry run of the decision tree to size precisely (not estimated further here per the "don't invent numbers" constraint).

For rows where Gate 3 is reached, apply a disposition rule instead of leaving them silently `pending` forever:

1. **Stale + contact-less → reject.** If the row has no phone/website/instagram/email/telegram AND `source_posted_at` (or `first_seen`) is older than a defined staleness window (reuse the existing per-collection staleness constants already in `scripts/import-review/eligibility.py`, e.g. `MARKETPLACE_MAX_AGE_DAYS`/`JOB_EVENT_MAX_AGE_DAYS` — do not invent a new number here), set `review_status='rejected'` with `reject_reason='no_signal_stale'`. This is the bulk of the thin Facebook rows.
2. **Has ≥1 contact but no type signal → human review, lowest priority.** Leave `review_status='pending'`, `entity_type=NULL`, but tag `review_notes` with `[needs_manual_type]` so the admin queue can filter/sort these separately from the (much larger) already-typed backlog instead of admins hitting them at random.
3. **Never force a default.** The existing `resolveImportPreviewKind()` fallback (`lib/import-review/preview-section.ts:85`) already defaults unclassified items to `"business"` for *preview rendering only* — that UI convenience must not leak into what gets written to `entity_type` on the row. Writing a guessed `entity_type` for Gate-3 rows would quietly recreate the same RE-into-Business misclassification problem this whole cleanup is trying to fix.

---

## 6. Sizing this work before running it

Before any batch update, run (read-only) the decision tree as a **dry run** that outputs `(id, proposed_entity_type, confidence, gate_reason)` per row without writing anything, then tally:

```sql
-- shape check only, not the classifier itself (that's Python/regex logic, not SQL) —
-- use this to confirm the dry-run output distribution before touching the table
select proposed_entity_type, confidence, count(*)
from <dry_run_temp_table>
group by 1, 2
order by 1, 2;
```

Do not run Phase 1 SQL (see `PHASE_PLAN_V1.md`) until this tally is reviewed by a human — the two clean-category gates (§3 Gate 0) are safe to automate; the name/regex gates (§3 Gate 2) should have their first batch spot-checked before trusting them at 3,900-row scale.
