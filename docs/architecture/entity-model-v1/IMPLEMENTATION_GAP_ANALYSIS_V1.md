# Implementation Gap Analysis V1

**Audit only.** No code. No SQL. No migrations. No production changes.

Compares the **implemented product** to approved architecture:

- Entity Model V1 (+ Ownership / Base / ACL / Jobs / Publish)
- Taxonomy Freeze + IA V2
- Admin Review Center V1
- Review Workflow V1

Status legend:

| Mark | Meaning |
|------|---------|
| ✅ | Fully implemented (usable in prod for intended scope) |
| 🟡 | Partially implemented |
| ❌ | Not implemented (docs/draft only or absent) |

Percentages are engineering judgment of “done toward architecture,” not code coverage.

---

## 1. Readiness table

| # | Module | Status | ~% |
|---|--------|:------:|---:|
| 1 | Entity Model | ❌ | 15 |
| 2 | Taxonomy | 🟡 | 40 |
| 3 | Import Pipeline | 🟡 | 70 |
| 4 | Review Center | 🟡 | 35 |
| 5 | Review Workflow | 🟡 | 40 |
| 6 | Business | ✅ | 90 |
| 7 | Professional | ❌ | 20 |
| 8 | Marketplace | ✅ | 85 |
| 9 | Jobs | ❌ | 5 |
| 10 | Real Estate | ❌ | 5 |
| 11 | User Profiles | 🟡 | 75 |
| 12 | Authentication | 🟡 | 75 |
| 13 | Search | 🟡 | 70 |
| 14 | Admin Panel | 🟡 | 65 |
| 15 | AI Classification | 🟡 | 80 |
| 16 | Enrichment | 🟡 | 50 |
| 17 | API | 🟡 | 60 |
| 18 | Frontend | 🟡 | 55 |
| 19 | Database | 🟡 | 45 |
| 20 | Permissions / RLS | ✅ | 85 |

**Weighted MVP view:** Business + Marketplace + Auth + RLS are strong; Professional / Jobs / RE / Taxonomy-in-app / Review Center V1 are the main gaps.

---

## 2. Per-module detail

### 1. Entity Model — ❌ ~15%

| Works | Missing | Blocker |
|-------|---------|---------|
| Spec pack complete (`ENTITY_BASE_MODEL`, ownership, ACL A, draft `001_additive_schema.sql`) | `entities` registry, shared Base columns (`owner_profile_id`, `source_type`, …), sync triggers | Draft SQL **not applied**; types absent |

Without applied Base + registry, new entities (Pro/Jobs/RE) risk one-off schemas and rework.

---

### 2. Taxonomy — 🟡 ~40%

| Works | Missing | Blocker |
|-------|---------|---------|
| TAXONOMY_V1 + RU freeze + IA V2 validated (`READY_FOR_FREEZE`) | `platform_categories` in DB; app/admin pickers still use legacy `categories`; home hubs not taxonomy-aligned | Taxonomy exists as **docs/JSON only** |

Publish + Review Center still map to live `categories` (restaurants/services/…), not frozen trees.

---

### 3. Import Pipeline — 🟡 ~70%

| Works | Missing | Blocker |
|-------|---------|---------|
| TG + FB collectors → `import_review_items`; analyzer; autopublish CLI; duplicate fingerprints | Jobs largely **not written** to queue (~783 TG vs 0 queue); enrichment buried in `raw_payload`; no UI-triggered autopublish | Jobs pipeline gap; source-agnostic ReviewItem model incomplete |

---

### 4. Review Center — 🟡 ~35%

| Works | Missing | Blocker |
|-------|---------|---------|
| `/admin/import-review` queue + detail; approve/reject/duplicate; filters (partial UI); preview cards | Bulk; source/entity chips; sticky Publish; Merge guided; provenance; enrichment panel; taxonomy picker; `/admin/review` workspace | Architecture doc only — **UI not built** |

RPC already supports more filters than the queue UI shows.

---

### 5. Review Workflow — 🟡 ~40%

| Works | Missing | Blocker |
|-------|---------|---------|
| Legacy statuses: pending, in_review, ready_to_publish, approved, rejected, duplicate, needs_more_info; audit table exists | States: imported, ai_classified, edited, merged, archived; full ReviewEvent timeline; Restore semantics | Enum + workflow code ≠ `REVIEW_WORKFLOW_V1` |

---

### 6. Business — ✅ ~90%

| Works | Missing | Blocker |
|-------|---------|---------|
| Profile, manage, offers, search, claims, admin CRUD, cards, hours/gallery/map pieces | Base ownership/source columns; category = frozen taxonomy | None for current Business MVP; taxonomy remap is soft dependency |

---

### 7. Professional — ❌ ~20%

| Works | Missing | Blocker |
|-------|---------|---------|
| Import type `private_specialist`; transitional `/services` listings; autopublish specialist→service hack | `professionals` table; `/professional/[slug]`; independent of Business; IA hub «Специалисты» | **No domain table / page** — largest queue mass (~2 300) |

---

### 8. Marketplace — ✅ ~85%

| Works | Missing | Blocker |
|-------|---------|---------|
| `/marketplace`, details table, CRUD, admin, filters | Frozen MP categories in UI; hub title still «Marketplace» not «Купи-продай»; weak import leaf tagging | Soft: taxonomy + rename |

---

### 9. Jobs — ❌ ~5%

| Works | Missing | Blocker |
|-------|---------|---------|
| Enum/import hints; TG intent volume | `jobs` table; routes/UI; import_review writes; home hub | **Schema + pipeline + UI** all missing |

---

### 10. Real Estate — ❌ ~5%

| Works | Missing | Blocker |
|-------|---------|---------|
| Import entity_type + queue volume; taxonomy JSON | `real_estate_listings` (or equivalent); inventory UI; leaf categories in publish | Domain entity missing (agencies today ≈ Business category only) |

---

### 11. User Profiles — 🟡 ~75%

| Works | Missing | Blocker |
|-------|---------|---------|
| `profiles`; public `/u/[username]`; manage basics | `can_publish` / `account_status`; avatar upload UX; ZIP as publish gate wired | Soft for browse; hard when guest publish expands |

---

### 12. Authentication — 🟡 ~75%

| Works | Missing | Blocker |
|-------|---------|---------|
| Email/password; OAuth buttons in UI | Confirm OAuth providers enabled in Supabase project; publish eligibility helpers | Ops checklist, not architecture rewrite |

---

### 13. Search — 🟡 ~70%

| Works | Missing | Blocker |
|-------|---------|---------|
| `/search` businesses; `/api/search/ai` intent; synonyms/spellcheck | Multi-entity search (Pro/Jobs/RE/MP); taxonomy facets | Search stays Business-centric until entities exist |

---

### 14. Admin Panel — 🟡 ~65%

| Works | Missing | Blocker |
|-------|---------|---------|
| businesses, listings, reviews, users, claims, master-data, analytics, import-review | Review Center V1; taxonomy admin; Jobs/RE moderation surfaces | Import queue UX is the main admin gap |

---

### 15. AI Classification — 🟡 ~80%

| Works | Missing | Blocker |
|-------|---------|---------|
| TG/FB LLM+rules → import fields; search intent AI (server allowlist) | Goods/RE/Jobs leaf vocab improvements; evidence UI pane | Classifier quality ≠ missing feature; improve after taxonomy wired |

---

### 16. Enrichment — 🟡 ~50%

| Works | Missing | Blocker |
|-------|---------|---------|
| FB `profile_enrichment.py` + `field_sources` in payload | Dedicated enrichment storage/UI; post-vs-enrichment conflict picker; non-FB enrichers | UI + ReviewItem contract |

---

### 17. API — 🟡 ~60%

| Works | Missing | Blocker |
|-------|---------|---------|
| Platform stats, hub counts, search AI, listing/business queries, import RPCs | Public APIs for Pro/Jobs/RE; Review Center bulk APIs | Follows entity shipping |

---

### 18. Frontend — 🟡 ~55%

| Works | Missing | Blocker |
|-------|---------|---------|
| Home, business profile redesign pieces, marketplace, services, admin | IA V2 nav (5 hubs); Professional pages; Jobs/RE; Review workspace | Home `PLATFORM_SECTIONS` still Services/Lechu/Transfers |

---

### 19. Database — 🟡 ~45%

| Works | Missing | Blocker |
|-------|---------|---------|
| businesses, listings + detail tables, reviews, claims, owners, import_review, media, cities | Entity Model additive pack; platform_categories; jobs; professionals; RE | **Applying draft SQL is the structural gate** (must be careful, additive) |

---

### 20. Permissions / RLS — ✅ ~85%

| Works | Missing | Blocker |
|-------|---------|---------|
| RLS on core tables; `owns_business`; admin gates; anti-scrape posture | RLS for future Pro/Jobs/RE; `can_publish` enforcement | None for current tables; new entities need RLS from day one |

---

## 3. Blockers (ordered)

| Priority | Blocker | Blocks |
|----------|---------|--------|
| P0 | Entity Model additive schema **unapplied** (professionals, jobs, RE, platform_categories, Base fields) | Pro/Jobs/RE MVP, taxonomy-in-DB |
| P0 | Professional domain missing while queue ≈2 300 specialists | Catalog truth vs IA |
| P0 | Jobs absent from import_review + no `jobs` entity | IA hub «Работа» |
| P1 | Taxonomy freeze not wired into publish/admin pickers | Consistent categories / Review quality |
| P1 | Review Center V1 not built (bulk/merge/provenance) | Clearing 5 585 queue efficiently |
| P1 | Home nav ≠ IA V2 hubs | Product IA mismatch |
| P2 | Workflow states incomplete vs REVIEW_WORKFLOW_V1 | Audit/restore/merge clarity |
| P2 | Enrichment not surfaced in UI | FB quality left on table |
| P2 | Search Business-only | Multi-hub discovery |

Non-blockers for “ship Business+Marketplace today”: current RLS, business profile, marketplace CRUD, TG/FB import into queue, search AI for businesses.

---

## 4. Development priority (minimize rework)

1. **Schema first (additive)** — Base fields + `platform_categories` + `professionals` + `jobs` + RE inventory (+ RLS). Avoid building more `/services` as fake Professional.  
2. **Taxonomy bind** — Seed frozen categories; legacy map; switch Review + publish pickers.  
3. **Import alignment** — Write Jobs to queue; map categories to taxonomy leaves; surface enrichment in payload contract.  
4. **Review Center V1** — Bulk, filters, Publish, Merge, provenance on existing queue.  
5. **Workflow enum expand** — Align statuses/events (can ship incrementally with Review Center).  
6. **Public surfaces** — Professional page; Jobs; RE; home nav 5 hubs.  
7. **Search expand** — Facets across entities.  
8. **Polish** — Enrichment UX, OAuth ops, autopublish scheduling.

Do **not** first: redesign Business cards again; invent more taxonomy; build Lechu/Transfers nav depth.

---

## 5. Roadmap

### Этап 1 — Foundation (critical path start)
- Apply additive Entity Model slice (or phased migration pack) for: Base columns on businesses/listings, `platform_categories` + legacy map, `professionals`, `jobs`, `real_estate_listings` stubs with RLS.  
- Regenerate `types/database.ts`.  
- **Exit:** schema matches architecture; no UI required yet.

### Этап 2 — Taxonomy in product
- Seed TAXONOMY_V1 / RU labels.  
- Remap publish + import-review category pickers.  
- Backfill plan for legacy `categories` (dry-run already exists).  
- **Exit:** moderators pick frozen categories.

### Этап 3 — Import + Jobs path
- Ensure Jobs land in `import_review_items`.  
- Map RE leaves / MP goods leaves in classifier rules.  
- Normalize enrichment into ReviewItem contract (`field_sources` readable).  
- **Exit:** queue reflects IA mix (incl. Jobs).

### Этап 4 — Review Center V1
- Implement queue/workspace from `ADMIN_REVIEW_CENTER_V1` (bulk, source/entity filters, Publish, Merge, provenance).  
- Wire workflow transitions gradually (`REVIEW_WORKFLOW_V1`).  
- **Exit:** moderators clear queue without rework of entity model.

### Этап 5 — Public MVP hubs
- `/professional/[slug]` + list hub.  
- Jobs list + detail.  
- RE inventory list + detail.  
- Home nav → Бизнесы · Специалисты · Купи-продай · Работа · Недвижимость.  
- Deprecate «Услуги» as primary Professional story (migrate service listings carefully).  
- **Exit:** IA V2 MVP nav live.

### Этап 6 — Discovery
- Multi-entity search + AI intent across hubs.  
- Category facets from taxonomy.

### Этап 7 — Hardening
- Autopublish scheduling/UI; enrichment providers; Restore/Archive; analytics on review throughput.  
- Events / Lechu / Transfers after MVP.

---

## 6. Critical path to first full MVP

```text
[1] Additive schema (Pro + Jobs + RE + platform_categories + Base)
        ↓
[2] Taxonomy bind (pickers + legacy map)
        ↓
[3] Jobs into import queue + classifier leaf maps
        ↓
[4] Review Center V1 (bulk Publish / entity / category)
        ↓
[5] Public hubs: Professional + Jobs + RE + home nav rename
        ↓
MVP: 5 hubs with real cards from published + moderated import
```

**Already on the path (keep):** Business catalog, Marketplace, Auth/RLS, TG/FB → import_review, search AI for businesses.

**MVP definition (architecture):** five hubs with domain entities + taxonomy + workable Review Center — not Lechu/Transfers/Events.

---

## 7. Confirmations

- Code **not** changed  
- SQL / migrations **not** written or applied  
- Production **not** changed  
- Documents only: this file + `REPORT.md`  

---

## 8. Related docs

| Doc | Role |
|-----|------|
| [`DATABASE_ALIGNMENT_V1.md`](./DATABASE_ALIGNMENT_V1.md) | Prod vs Entity Model gaps |
| [`ADMIN_REVIEW_CENTER_V1.md`](./ADMIN_REVIEW_CENTER_V1.md) | Target Review UI |
| [`REVIEW_WORKFLOW_V1.md`](./REVIEW_WORKFLOW_V1.md) | Target states |
| [`TAXONOMY_FREEZE_V1.md`](./TAXONOMY_FREEZE_V1.md) / IA V2 §13 | Frozen taxonomy |
| [`001_additive_schema.sql`](./001_additive_schema.sql) | Unapplied draft |
