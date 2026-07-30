# Professional Cleanup → Admin Review Handoff

**Date:** 2026-07-28  
**Status:** **CLOSED** — Professional Cleanup V1 fully complete. Remaining disputes live only in Admin Import Review Center.

## What was done

1. Loaded Phase 2 `still_review` list: **201** rows (115 `still_pro_other`, 86 `no_contact`) — matches Phase 2 report.
2. Enqueued **201** `import_review_items` with `source=professional_cleanup_v1`, `review_status=pending`.
3. No professionals modified, published, enriched, or deleted during enqueue.
4. Extended existing Import Review approve/reject paths so cleanup items:
   - **Approve as specialists** → confirm existing Professional (no duplicate insert)
   - **Approve as business/marketplace/job/event** → create target entity, archive linked Professional
   - **Reject / Duplicate** → archive linked Professional
5. UI: cleanup banner + action hints on detail; queue filter chip “Professional Cleanup”; badge on cards.

## Counts

| Metric | Value |
|---|---:|
| Phase 2 manual review | 201 |
| Inserted into Admin Review | **201** |
| Already in queue (skipped) | 0 |
| Impossible to transfer | **0** |
| Cleanup-owned Manual Review remaining | **0** |

### Review reasons (frequency)

| Reason | Count |
|---|---:|
| `still_pro_other` (ambiguous / weak category) | 115 |
| `no_contact` (insufficient contacts) | 86 |

Problems stamped on items: `ambiguous_classification`, `multiple_possible_categories`, `low_confidence`, `insufficient_contacts`, `missing_required_fields`.

Suggested entity types on insert: 198 `private_specialist`, 3 `marketplace_listing` (name/text heuristics only — moderator must confirm).

## How moderators work now

Admin → Import Review → filter **Professional Cleanup** (or search `professional_cleanup_v1`).

| Desired action | How |
|---|---|
| Publish as Professional | target=`private_specialists` → Одобрить |
| Publish as Business | target=`businesses` → Одобрить |
| Publish as Marketplace | target=`marketplace` → Одобрить |
| Publish as Job | target=`jobs` → Одобрить |
| Publish as Event | target=`events` → Одобрить |
| Merge | статус Дубликат (+ linked Professional archives) |
| Archive | Отклонить / Archive |
| Edit before publish | Сохранить, затем Одобрить |

## Artifacts

- Script: `scripts/business-enrich/enqueue_professional_cleanup_review.py`
- Apply report: `docs/audits/data/enqueue_professional_cleanup_review_apply_latest.json`
- Helper: `lib/import-review/professional-cleanup.ts`
- Prior phases: [`PROFESSIONAL_CLEANUP_PHASE1_V1.md`](./PROFESSIONAL_CLEANUP_PHASE1_V1.md), [`PROFESSIONAL_CLEANUP_PHASE2_V1.md`](./PROFESSIONAL_CLEANUP_PHASE2_V1.md)

## Manual actions after this handoff

Only normal Admin Review moderation of the 201 pending items. No further Professional Cleanup pipeline steps.

## Explicit non-actions

- No schema migration
- No enrichment run
- No new classifiers
- No auto-publish
- No entity deletes
