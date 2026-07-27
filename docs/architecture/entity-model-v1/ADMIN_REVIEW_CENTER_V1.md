# Admin Review Center V1 — Architecture

**Architecture only.** No SQL. No migrations. No production changes. No implementation.

Goal: one moderation surface for Facebook, Telegram, and all future importers (Google Business, Yelp, …).  
**Source must not change the UI** — only badges and provenance.

Depends on frozen Taxonomy / IA V2 ([`PLATFORM_INFORMATION_ARCHITECTURE_V2.md`](./PLATFORM_INFORMATION_ARCHITECTURE_V2.md) §13 · `READY_FOR_FREEZE`).

---

## 0. Scope

| In | Out |
|----|-----|
| Queue UX, moderation workspace, bulk actions, source-agnostic item model | SQL / RLS / migrations |
| Mapping to TAXONOMY_V1 entity + category | Shipping React code |
| Moderator scenarios | Autopublish policy rewrite |
| Field provenance / enrichment display | Claim / ownership UI (separate) |

**Route sketch (future):** `/admin/review` (canonical).  
Current `/admin/import-review` = legacy to migrate UX into Review Center (rename or redirect later).

---

## 1. Audit: current `/admin/import-review`

### What exists today

| Surface | Behavior |
|---------|----------|
| Queue `/admin/import-review` | Status chips · collection chips · search · sort · contact checkboxes · card grid · preview modal · link «Правки» |
| Detail `/admin/import-review/[id]` | Long edit form · preview · approve / reject / duplicate · save fields · next pending |
| Data | `import_review_items` · Telegram-heavy · `source` string · entity_type + target_collection |

Server already supports more filters than the queue UI exposes (`entity_type`, `category`, `city`, confidence, dates, `duplicate_status`) — **UI underuses the API**.

### Pain points

| Problem | Why it hurts |
|---------|----------------|
| **Two clicks to edit** | «Показать полную карточку» (modal) ≠ moderation; real work is «Правки» |
| **No bulk select** | Cannot publish/reject/remap 20 similar jobs or beauty cards |
| **No source filter in UI** | FB vs TG vs future sources invisible as first-class filter |
| **Entity type / category filters hidden** | Params exist server-side; chips only for `target_collection` |
| **Collection vs entity_type dual model** | Moderator must understand both; taxonomy hubs differ (`services` transitional) |
| **Save then Approve** | Extra step; primary path should be Publish (save+publish) |
| **Actions at bottom of long form** | Errors force scroll-to-top; slow loop |
| **Telegram-centric chrome** | «Дата Telegram», «TG фото» — breaks FB / Yelp mental model |
| **No field provenance** | Cannot see if phone came from post vs enrichment |
| **No enrichment panel** | FB profile / future enrichers not first-class |
| **No Merge action** | Only mark duplicate + link id; no guided merge into published entity |
| **Category dropdown = live `categories`** | Not TAXONOMY_V1 / RU freeze; Jobs/RE leaves incomplete |
| **Jobs practically orphaned** | Taxonomy needs Jobs; queue historically 0 jobs — Review Center must still be ready |
| **Classifier reasoning weak in UI** | `ai_reason` / confidence present in model, easy to miss in dense form |

### Missing for Review Center V1

1. Unified **workspace** (queue + card side-by-side or deep-link workspace).  
2. **Source-agnostic** labels and filters.  
3. **Bulk** select + actions.  
4. **Quick actions** bar (Publish / Reject / Merge / Edit / Duplicate / Change entity / Change category).  
5. **Provenance** per field + enrichment block.  
6. Category picker from **frozen taxonomy** by entity_type.  
7. Keyboard-friendly moderation loop (j/k, p, r — future; design for it).

---

## 2. Principles

1. **One queue item model** for every importer.  
2. **UI = ReviewItem**, not TelegramPost / FacebookPage.  
3. **Taxonomy-driven** entity_type + category (TAXONOMY_V1 + RU labels).  
4. **Post data wins**; enrichment only fills empty / confirms (never silent overwrite without showing both).  
5. **Moderator speed** > form completeness on the happy path.  
6. **Bulk = same actions as single**, with confirm summary.  
7. **Audit trail**: who changed entity/category/status when.

---

## 3. Screens

| # | Screen | Route (proposed) | Purpose |
|---|--------|------------------|---------|
| 1 | **Queue** | `/admin/review` | Filter, search, select, open items |
| 2 | **Workspace** | `/admin/review/[id]` | Primary moderation (fields + source + actions) |
| 3 | **Merge picker** | modal / `/admin/review/[id]/merge` | Choose target published entity or queue sibling |
| 4 | **Bulk confirm** | modal | Summary of N items + action + irreversible warning |
| 5 | **Duplicate resolve** | modal | Link to existing item/entity; optional keep-enrichment |

Optional later: Saved views (e.g. «FB beauty pending», «Jobs TG other»).

---

## 4. Main queue screen (Stage 2)

### Layout

```text
┌─────────────────────────────────────────────────────────────┐
│ Review Center                          [counts by status]   │
├──────────────┬──────────────────────────────────────────────┤
│ Filters      │ Toolbar: search · sort · Select all · Bulk ▾ │
│              ├──────────────────────────────────────────────┤
│ Source       │ □ Card · □ Card · □ Card …                   │
│ Entity       │ (checkbox + thumbnail + title + badges)      │
│ Category     │                                              │
│ Status       │                                              │
│ Confidence   │                                              │
│ Has contact  │                                              │
│ Has media    │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

### Required controls

| Control | Values / notes |
|---------|----------------|
| Search | title, text, phone, @handles, ids |
| Source | `telegram` · `facebook` · `google_business` · `yelp` · `manual` · `other` (+ raw `source` string facet) |
| Entity type | TAXONOMY hubs: business · professional · marketplace · jobs · real_estate · (+ events/lechu/transfers later) |
| Category | Options depend on entity_type (frozen tree) |
| Status | pending · ready_to_publish · in_review · approved · rejected · duplicate · needs_more_info |

> **Freeze:** canonical review states = [`REVIEW_WORKFLOW_V1.md`](./REVIEW_WORKFLOW_V1.md). Legacy names above are **aliases** (`pending`↔`needs_review`, `approved`↔`published`). See [`ENTITY_TYPE_MAPPING_V1.md`](./ENTITY_TYPE_MAPPING_V1.md).

| Sort | priority · newest · oldest · confidence · posted_at · updated |
| Mass select | checkbox per row + select page / select matching filter (capped) |

### Queue row badges (source-agnostic)

- Source chip (TG / FB / …)  
- Entity type  
- Category (RU label)  
- Status  
- Confidence  
- Contact level  
- Media count  
- Duplicate / cluster hint  
- Enrichment present? (yes/no)

**Remove from primary chrome:** “TG фото”, “Дата Telegram” as exclusive wording → **Posted** / **Media**.

---

## 5. Moderation card / Workspace (Stage 3)

### Layout

```text
┌──────────────────────────┬──────────────────────────────────┐
│ Sticky action bar        │ Publish · Reject · Merge · …     │
├────────────┬─────────────┼──────────────────────────────────┤
│ Source pane│ Fields pane │ Preview pane                     │
│ original   │ editable    │ public card mock                 │
│ text+media │ +provenance │                                  │
│ AI reason  │ enrichment  │                                  │
└────────────┴─────────────┴──────────────────────────────────┘
```

### Show always

| Block | Content |
|-------|---------|
| **Fields** | All ReviewItem fields (name, description, contacts, geo, price, hours, links, category, subcategory, …) |
| **Original text** | Immutable `source_text` |
| **Media** | Gallery from `source_media` + enrichment photos (tagged) |
| **Source** | channel, author, url, posted_at, fingerprint |
| **Confidence** | `ai_confidence` + visual band |
| **Classifier reasoning** | `ai_reason` / decision / evidence snippets |
| **Enrichment** | e.g. `facebook_profile` block: name, about, phone, site, email, address, hours, photos, categories, links |
| **Field provenance** | Per field: `source_post` \| `classifier` \| `enrichment:facebook_profile` \| `moderator` \| `merge` |

### Provenance rule (display)

```text
phone: +1…     [post] [enrichment:facebook_profile]
website: …     [enrichment:facebook_profile]  (empty in post)
title: …       [moderator]  (edited)
```

If post and enrichment disagree → show **both** values; moderator picks (default = post).

### Preview

Entity-aware preview (Business / Professional / Marketplace / Jobs / RE) — not Business-only mock.

---

## 6. Quick actions (Stage 4) — one click / one shortcut later

| Action | Effect |
|--------|--------|
| **Publish** | Validate required fields → write published entity → status `approved` → next item |
| **Reject** | Require reason → `rejected` → next |
| **Merge** | Open merge picker → absorb into target → mark duplicate/merged |
| **Edit** | Focus fields pane (no navigation) |
| **Mark Duplicate** | Link `duplicate_of_*` → status `duplicate` → next |
| **Change Entity Type** | Popover: TAXONOMY entity → resets category options → stays on card |
| **Change Category** | Popover: categories for current entity (RU labels) |

**Publish** implies persist edits (no separate Save on happy path).  
Explicit **Save draft** remains for `in_review` / `needs_more_info`.

---

## 7. Bulk actions (Stage 5)

| Bulk action | Guardrails |
|-------------|------------|
| Publish | Skip invalid; report failures; max N per request |
| Reject | Same reason for all (or per-item override later) |
| Merge | Only into **one** target; items must be same entity_type |
| Change category | Same entity_type required |
| Change entity_type | Then category cleared → moderator must set category (or map via rules) |

Confirm modal: counts by entity/source, irreversible note, sample titles.

---

## 8. Source-agnostic architecture (Stage 6)

### ReviewItem (logical)

```text
ReviewItem
  id
  source_system          # telegram | facebook | google_business | yelp | …
  source_ref             # opaque: chat+message / post url / place_id
  source_payload         # raw
  posted_at, author, url
  media[]
  classifier             # decision, confidence, reason, evidence
  entity_type            # taxonomy entity
  category, subcategory  # taxonomy slugs
  fields{}               # normalized domain fields
  field_provenance{}     # field → [{origin, value, at}]
  enrichment[]           # [{provider, payload, fetched_at}]
  review_status
  duplicate_of
  published_ref
  moderator_meta
```

Importers **normalize into ReviewItem**. UI never branches on `source_system` except badge + deep link to original.

### Importer adapter (conceptual)

| Adapter | Produces ReviewItem |
|---------|---------------------|
| Telegram collector | ✓ today |
| Facebook seed / collector | ✓ map posts + optional `facebook_profile` enrichment |
| Google Business | future |
| Yelp | future |
| Manual admin create | future |

### Taxonomy binding

- Entity type options = MVP hubs (+ later).  
- Category options = `taxonomy_*_v1` + `taxonomy_ru_v1_final` labels.  
- Legacy live `categories.slug` → `legacy_slug_map` when publishing.

---

## 9. Components (implementation checklist — not built now)

| Component | Role |
|-----------|------|
| `ReviewCenterLayout` | Shell + nav |
| `ReviewQueuePage` | Filters + list |
| `ReviewFilterSidebar` | Source / entity / category / status |
| `ReviewSearchBar` | q + sort |
| `ReviewBulkToolbar` | selection + bulk actions |
| `ReviewQueueRow` / `ReviewQueueCard` | Row with checkbox + badges |
| `ReviewWorkspace` | 3-pane moderation |
| `ReviewActionBar` | Sticky Publish/Reject/… |
| `ReviewSourcePane` | text, media, AI, source meta |
| `ReviewFieldsForm` | editable fields |
| `ReviewFieldProvenance` | chips per field |
| `ReviewEnrichmentPanel` | provider blocks |
| `ReviewPreviewPane` | entity preview |
| `ReviewCategoryPicker` | taxonomy-aware |
| `ReviewEntityTypePicker` | |
| `ReviewMergeModal` | |
| `ReviewDuplicateModal` | |
| `ReviewBulkConfirmModal` | |
| `ReviewRejectReasonSelect` | |

---

## 10. Moderator scenario (happy path)

1. Open **Queue** → filter `status=pending`, `source=facebook` (or all).  
2. Sort by priority.  
3. Open first item → **Workspace**.  
4. Skim original text + media; check AI reason + confidence.  
5. Glance enrichment; accept phone from enrichment if post empty.  
6. Fix entity_type if Business↔Pro wrong (one click).  
7. Fix category from taxonomy list.  
8. **Publish** → auto-advance to next.  
9. For 15 similar «Водители» jobs: select all on page → bulk **Change category** if needed → bulk **Publish**.  
10. For clear dupes: **Mark Duplicate** or **Merge** into published Business.

### Slow path

- `needs_more_info` + notes when contact missing.  
- Reject spam with reason.  
- Merge booth rental into Real Estate when classifier said Business.

---

## 11. Mapping from current import-review

| Current | Review Center V1 |
|---------|------------------|
| `/admin/import-review` | Queue |
| `/admin/import-review/[id]` | Workspace |
| `target_collection` | Derive from `entity_type` (hide dual control or keep advanced) |
| Preview modal | Optional; Workspace preview pane primary |
| `save` + `approve` | **Publish** |
| Duplicate id field | Duplicate / Merge modals |
| Live categories select | Taxonomy picker |
| TG-only labels | Neutral labels |

---

## 12. Non-goals / later

- Full keyboard map (design hooks only).  
- Auto-remediation of 70% marketplace `other` without human.  
- Claiming / ownership UI.  
- Replacing collector pipelines.  
- SQL for new tables (may need `field_provenance` JSON later — **out of this doc’s apply scope**).

---

## 13. Success metrics (after build)

- Median time-to-decision per item ↓  
- Clicks to Publish ≤ 2 from queue open  
- % bulk-handled items ↑  
- Same UI used for ≥2 sources (TG + FB) without layout fork  

---

## 14. Confirmations

- Code **not** implemented  
- SQL / migrations **not** written or applied  
- Production **not** changed  
- Document only: this file + `REPORT.md` index  

**Next after approval:** implementation task (UI + actions) against frozen Taxonomy — separate from this architecture pack.
