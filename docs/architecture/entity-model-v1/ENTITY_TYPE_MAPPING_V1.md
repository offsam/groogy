# Entity Type Mapping V1

Canonical domain types vs import / taxonomy / registry aliases.

**Frozen** with [`ARCHITECTURE_FREEZE_V1.md`](./ARCHITECTURE_FREEZE_V1.md).

---

## Domain entity_type (registry / search)

| Canonical | Table | Taxonomy JSON |
|-----------|-------|---------------|
| `business` | `businesses` | taxonomy_business_v1 |
| `professional` | `professionals` | taxonomy_professional_v1 |
| `marketplace` | `listings` + marketplace details | taxonomy_marketplace_v1 |
| `job` | `jobs` | taxonomy_jobs_v1 |
| `real_estate` | `real_estate_listings` | taxonomy_real_estate_v1 |
| `event` | `events` (stub) | later |
| `vehicle` | `vehicles` (stub) | later |

---

## Import pipeline aliases → canonical

| Import / analyzer value | Canonical | Notes |
|-------------------------|-----------|-------|
| `private_specialist` | `professional` | Legacy queue enum |
| `business` | `business` | |
| `organization` | `business` | Soft org → Business unless proven otherwise |
| `marketplace_listing` | `marketplace` | |
| `job` | `job` | |
| `real_estate` | `real_estate` | Inventory listing |
| `event` | `event` | Post-MVP |
| `lechu_listing` | *(later)* | Not MVP freeze |
| `transfer_listing` | *(later)* | Not MVP freeze |

---

## Target collection aliases → canonical

| `target_collection` | Canonical entity |
|---------------------|------------------|
| `businesses` / `organizations` | business |
| `private_specialists` | professional |
| `services` | **transitional** — do not treat as Professional; migrate to professional or keep as listing service until cutover |
| `marketplace` | marketplace |
| `jobs` | job |
| `real_estate` | real_estate |
| `events` / `lechu` / `transfers` | later |

---

## Review Workflow status aliases

| Legacy `import_review_status` | Canonical REVIEW_WORKFLOW_V1 |
|-------------------------------|------------------------------|
| *(insert)* | `imported` → quickly `ai_classified` |
| `pending` | `needs_review` |
| `in_review` | `in_review` |
| `ready_to_publish` | `ready_to_publish` |
| `approved` | `published` |
| `rejected` | `rejected` |
| `duplicate` | `duplicate` |
| `needs_more_info` | `needs_more_info` |
| — | `edited`, `merged`, `archived` (new) |

Until DB enum expands, UI/docs may show canonical labels while storing legacy values.
