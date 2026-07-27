# Architecture Freeze Report V1

Audit + freeze consolidation. **No production / apply / UI code.**

---

## 1. Documents created / updated

### Created
| File | Purpose |
|------|---------|
| [`ARCHITECTURE_FREEZE_V1.md`](./ARCHITECTURE_FREEZE_V1.md) | Canonical freeze + contradiction resolutions + ER |
| [`ENTITY_TYPE_MAPPING_V1.md`](./ENTITY_TYPE_MAPPING_V1.md) | `private_specialist`→`professional`, review status aliases |
| [`REAL_ESTATE_ENTITY_V1.md`](./REAL_ESTATE_ENTITY_V1.md) | RE inventory freeze |
| [`ARCHITECTURE_FREEZE_REPORT_V1.md`](./ARCHITECTURE_FREEZE_REPORT_V1.md) | This report |

### Updated
| File | Change |
|------|--------|
| [`PROFESSIONAL_ENTITY_V1.md`](./PROFESSIONAL_ENTITY_V1.md) | Rewrite → Freeze |
| [`JOBS_ENTITY_V1.md`](./JOBS_ENTITY_V1.md) | Rewrite → Freeze |
| [`001_additive_schema.sql`](./001_additive_schema.sql) | Base fields on Pro/Jobs/RE; `owner_profile_id`; Jobs creator nullable |
| [`REPORT.md`](./REPORT.md) | Index + §0.27 freeze |

### Marked secondary (not deleted)
- `PLATFORM_INFORMATION_ARCHITECTURE_V1.md` — Telegram deep-dive only  
- `PROFESSIONAL_PAGE.md` — UI notes under Professional freeze  
- Live `/admin/import-review` — transitional vs Review Center V1  

---

## 2. Schemas updated (draft only)

`001_additive_schema.sql`:

- **professionals:** `owner_profile_id` (was `profile_id`), Creator, Source, Import, `visibility`, `published_at`/`archived_at`
- **jobs:** `owner_profile_id`, nullable `created_by_profile_id`, Source, Import, `visibility`, `archived_at`; manage via owner or creator
- **real_estate_listings:** Creator, Source, Import, `visibility`, `published_at`/`archived_at`
- RLS helpers updated for Pro owner column + Jobs personal manage

`002_seed_platform_categories.sql` — unchanged (still draft seed).

---

## 3. Entities added / frozen

| Entity | Freeze doc | Draft table |
|--------|------------|-------------|
| Business | existing + freeze rules | production + additive Base later |
| Professional | PROFESSIONAL_ENTITY_V1 Freeze | `professionals` |
| Jobs | JOBS_ENTITY_V1 Freeze | `jobs` |
| Real Estate inventory | REAL_ESTATE_ENTITY_V1 | `real_estate_listings` |
| Marketplace | existing MARKETPLACE_ENTITY_V1 | `listings` (existing) |
| Registry | ENTITY_BASE + freeze | `entities`, `platform_categories` |

---

## 4. Contradictions eliminated

See [`ARCHITECTURE_FREEZE_V1.md`](./ARCHITECTURE_FREEZE_V1.md) §2 (C1–C13): Pro↔Business independence, Jobs creator nullability, owner naming, taxonomy hubs, review status aliases, RE three-way split, ACL A, listing-job dual-register ban, import publish leaves owner NULL.

Duplicates: IA V1 vs V2, TAXONOMY_V1 `name_ru` vs RU final, legacy review statuses — **canonical pointers set**, old files retained as history.

---

## 5. Taxonomy ↔ Entity

All five MVP taxonomy trees map to domain entities. No orphan MVP category trees. Events/Lechu/Transfers explicitly **out of MVP freeze**.

---

## 6. What remains before MVP (implementation — not architecture)

1. **Apply** draft SQL (dedicated task + review).  
2. Wire taxonomy into publish/Review pickers.  
3. Jobs into import queue.  
4. Review Center V1 UI.  
5. Public hubs: Professional, Jobs, RE + home nav.  
6. Expand search.  

Architecture does **not** include shipping UI/code in this pack.

---

## 7. Updated readiness (architecture vs product)

| Module | Architecture freeze | Product code (gap analysis) |
|--------|---------------------|----------------------------|
| Entity Model | ✅ Frozen | ❌ ~15% applied |
| Taxonomy | ✅ Frozen | 🟡 ~40% in app |
| Professional | ✅ Frozen | ❌ ~20% |
| Jobs | ✅ Frozen | ❌ ~5% |
| Real Estate | ✅ Frozen | ❌ ~5% |
| Review Center / Workflow | ✅ Spec frozen | 🟡 partial legacy |
| Business / Marketplace / RLS | ✅ Aligned | ✅ strong |

---

## 8. Архитектура готова к реализации?

# **Да**

С оговорками (не блокеры архитектуры, а следующий инженерный этап):

1. Draft SQL ещё **не применён** — нужен отдельный implementation task с ревью миграции.  
2. Live nav / `import_review` enum — transitional aliases до cutover.  
3. `services` target_collection остаётся transitional до миграции на Professional.  

**Если «Нет» значило бы:** нерешённые продуктовые противоречия в доках — их больше нет в freeze-слое.

---

## 9. Confirmations

- Production **not** changed  
- Migrations **not** applied / no `db push`  
- App/UI code **not** written  
- Only docs + draft SQL under `docs/architecture/entity-model-v1/`
