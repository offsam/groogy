# Entity Section Routing V1

Canonical rules for **where a card belongs** on ingest (P3) and **how a live card moves** between platform sections after publish.

**Status:** normative for import routing + admin section moves.  
**Does not replace:** [`ENTITY_TYPE_MAPPING_V1.md`](../entity-model-v1/ENTITY_TYPE_MAPPING_V1.md) (frozen type↔table map), [`CARD_PROCESSING_ARCHITECTURE_V1.md`](../runtime/CARD_PROCESSING_ARCHITECTURE_V1.md) (pipeline stages), [`NULL_CLASSIFICATION_ALGORITHM_V1.md`](../../audits/NULL_CLASSIFICATION_ALGORITHM_V1.md) (NULL backlog gates).

---

## Principle

One router on the way in. One move operation on the way out. No parallel section enums — use `entity_type` / `target_collection` from the mapping doc and UI keys from `PlatformSectionKey` (`lib/platform/sections.ts`).

```text
P0 collect → P3 route_card → P5 queue → G3 publish gate → P6 approve → P8 live
                                                      ↑
                              needs_manual_type when unsure
Live → moveEntitySection → entity_moves + domain event + 308 redirect
Live → audit view → confirmed move (no auto-move)
```

---

## Layer 1 — Ingress router (P3)

**SoT code:** `scripts/import-review/entity_routing.py`  
**TS mirror (hints only):** `lib/import-review/entity-routing.ts`

Returns an atomic pair `(entity_type, target_collection)` plus `confidence` and `reason`.  
If no rule fires → `None` + tag `[needs_manual_type]`. **Never** defaults to `private_specialist` or `business`.

Callers (must not re-implement patterns):

- `scripts/telegram-collector/reviewer.py`
- `scripts/import-review/classify_null_queue.py`
- `scripts/import-review/merge_pending_clusters.py`
- `scripts/telegram-collector/run_full.py` (goods-sale classification)

Notable rule added here: **commercial goods sale** (product + shipping / «продаю» without service verbs) → `marketplace_listing` / `marketplace`. Fixes the gap that routed «пиявочки с отправкой по США» into specialists.

---

## Layer 2 — Publish gate (G3)

`public.import_review_publish_gate_errors()` rejects:

1. NULL `entity_type` or `target_collection`
2. Inconsistent pairs (not in the mapping table)
3. Frozen `real_estate` until Phase 3

Migration: `supabase/migrations/20260729180000_entity_section_routing_and_moves.sql`

---

## Layer 3 — Admin UI

- Live cards: **Раздел** on every `AdminLensBar` kind → `AdminLiveSectionPreviewModal` lists all platform sections; `real_estate` disabled with freeze reason.
- Review Workspace: **Change Entity Type** (`ReviewChangeEntityTypePanel`) writes the pair via `saveImportReviewItemAction`, clears category, shows router hint.

---

## Layer 4 — Canonical move

**Code:** `lib/admin/move-entity-section.ts` → `moveEntitySectionAction`  
Legacy wrappers: `adminReclassifyBusinessToProfessionalAction` / `…ProfessionalToBusiness…`

Order (idempotent intent):

1. Build target payload (fail clearly if e.g. listing description &lt; 10 chars)
2. Insert target row
3. Retarget soft refs (`import_review_items`, recommendations, promotions, enrich runs)
4. Archive source (never hard-delete — listings may have RESTRICT FKs)
5. Insert `entity_moves` ledger row
6. Emit `entity.reclassified` domain event
7. Block business→non-business when `reviews_count > 0` (no silent review loss)

---

## Layer 5 — Redirects

`entity_moves.from_path` → `to_path`.  
`middleware.ts` issues **308** for known card path prefixes when a move exists.

---

## Layer 6 — Published audit

- Script: `scripts/business-enrich/audit_section_routing.py` (read-only → `docs/audits/data/section_routing_audit_*.json`)
- Review Center: `/admin/review/wrong-section` — list + confirm move button (no auto-move)

---

## Deferred (data cleanup, not system)

Existing junk (mis-routed goods cards, phone-as-price ranges, raw dumps in `professional_services`) is cleaned **after** this path is live, through `moveEntitySectionAction` / queue tools — not one-off SQL.

---

## Related

- Mapping freeze: [`ENTITY_TYPE_MAPPING_V1.md`](../entity-model-v1/ENTITY_TYPE_MAPPING_V1.md)
- NULL algorithm: [`NULL_CLASSIFICATION_ALGORITHM_V1.md`](../../audits/NULL_CLASSIFICATION_ALGORITHM_V1.md)
- Review Center IA: admin Review Workspace docs under `docs/architecture/`
