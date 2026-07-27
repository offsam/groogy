# Unified Entity Base Model

Entity Model v1 — **architecture only**. No SQL, no UI, no per-entity redesign.

Defines the **shared foundation** every major entity must share. Domain fields (title, price, hours, VIN, …) stay on each entity.

Index: [`REPORT.md`](./REPORT.md). Related: [`OWNERSHIP_SOURCE_CLAIM.md`](./OWNERSHIP_SOURCE_CLAIM.md), [`JOBS_AND_PUBLISH.md`](./JOBS_AND_PUBLISH.md).

---

## 1. Principle

```text
Entity
│
├── Identity        id, slug?
├── Ownership       owner_profile_id
├── Creator         created_by_profile_id
├── Source          source_type, source_record_id, source_url
├── Import          imported_at?, imported_by_profile_id, import_batch_id
├── Status          status  (lifecycle)
├── Visibility      visibility
└── Timestamps      created_at, updated_at, published_at?, archived_at?, deleted_at?
```

Specialized columns live **outside** this base. Do not reinvent Business / Jobs / Marketplace here.

Participating entities: Business, Professional, Listing, Job, Event, Vehicle, Real Estate.

---

## 2. Field matrix

| Field | Class | Rule |
|-------|--------|------|
| `id` | **Required** | UUID PK on every entity row. |
| `slug` | **Required if public page URL**; else optional | Needed for `/business|professional|…/[slug]`. Internal-only rows may omit until published. |
| `owner_profile_id` | **Required concept** (column may be null) | Platform owner; `NULL` = unclaimed. Canonical **name** for new work. |
| `created_by_profile_id` | **Required concept** | Who created the row **inside the platform**. Not owner / source / importer. `NULL` only for pure system/import inserts with no human actor. |
| `source_type` | **Required** | Provenance enum; immutable after insert. |
| `source_record_id` | **Optional** | Opaque external id; null for `USER` creates. |
| `source_url` | **Optional** | Permalink / place URL when useful. |
| `imported_by_profile_id` | **Optional** | Set only when an import ran; null for UI creates. Not owner. |
| `import_batch_id` | **Optional** | Batch / run id when imported. |
| `imported_at` | **Optional** | Timestamp of import; prefer over overloading `created_at`. |
| `status` | **Required** | Shared lifecycle (see §3). |
| `visibility` | **Required for catalog/search entities** | See §4. Profiles use their own visibility rules. |
| `created_at` | **Required** | Insert time. |
| `updated_at` | **Required** | Last mutation. |
| `published_at` | **Optional** | Set when entering public `published` (or mapped) state; keep history. |
| `archived_at` | **Optional** | When entering `archived`; soft lifecycle aid. |
| `deleted_at` | **Not required** | Prefer `status` (`archived` / `deleted`) over physical delete. Use `deleted_at` only if a tombstone column is later justified — **not** part of the minimal shared set. |

### Not part of the base (entity-specific)

Examples — keep on the owning table only:

* Business: legal name, branches, offers, hours, contacts  
* Professional: headline, credentials, service area  
* Listing: listing_type, price, publisher_type / publisher_business_id  
* Job: `business_id` (public attribution), compensation, employment_type  
* Event: starts_at / ends_at  
* Vehicle / Real Estate: inventory attributes  

Also **out of base**: categories, permissions, moderation queues, Claim *request* tables, `can_publish` (account gate, not a row field).

---

## 3. Status (unified lifecycle)

**Target shared vocabulary** (product / registry language):

```text
draft → pending → published ⇄ hidden
                      ↓
                 archived | expired | rejected
                      ↓
                   deleted   (soft; rare)
```

| Status | Meaning |
|--------|---------|
| `draft` | Owner/system editing; not public |
| `pending` | Awaiting moderation / review |
| `published` | Eligible for public surfaces (subject to visibility) |
| `hidden` | Withdrawn from discovery; may remain by direct link or admin-only |
| `archived` | Soft closed by owner/admin |
| `rejected` | Moderation denied |
| `expired` | Time-based end (listings/jobs) |
| `deleted` | Soft tombstone if ever needed; prefer archive first |

**Do not** invent parallel status enums per entity without mapping.

### Existing production / draft labels (map, don’t silently rename yet)

| Source today | Maps conceptually to |
|--------------|----------------------|
| Business `content_status`: `approved` | `published` |
| Business `deferred` | `hidden` (or pending-like hold) |
| Listing `active` | `published` |
| Listing `removed` | `deleted` / `archived` |
| Professional draft: `approved` | `published` |
| Registry `entity_registry_status` | already close (`published`, `hidden`, …) |
| Jobs draft statuses | already close to target |

Recommendation: converge **new** tables on the shared vocabulary; keep legacy enums until an explicit migration maps them. Public “is live?” checks should go through one helper concept (`is_publicly_listed(status, visibility)`), not ad-hoc per table forever.

---

## 4. Visibility

**Target shared set** (already used by listings / businesses):

```text
public | unlisted | private
```

| Value | Meaning |
|-------|---------|
| `public` | In search, hubs, feeds (if status allows) |
| `unlisted` | Reachable by URL; not in general discovery |
| `private` | Owner/admin (and allowed managers) only |

Listings today: `public` | `unlisted` (no `private` yet — gap).  
Businesses: `public` | `unlisted`.  
Author display privacy (`author_visibility`) is **not** entity visibility — keep separate (Listing-specific).

---

## 5. Ownership / Creator / Source / Import / Claim

Aligned with [`OWNERSHIP_SOURCE_CLAIM.md`](./OWNERSHIP_SOURCE_CLAIM.md):

| Concept | Field(s) | Claim may change? |
|---------|----------|-------------------|
| Ownership | `owner_profile_id` | **Yes** (NULL → profile) |
| Creator | `created_by_profile_id` | **No** |
| Source | `source_type`, `source_record_id`, `source_url` | **No** |
| Import | `imported_*`, `import_batch_id` | **No** |

Naming standard (**recommendation only — do not rename columns in this stage**):

```text
owner_profile_id
created_by_profile_id
imported_by_profile_id
```

Avoid new aliases: `owner`, `owner_id`, `profile_owner`, `business_owner` as the *platform owner* field.  
`business_owners` remains a **manager access** table for Business after ownership exists — not a substitute for `owner_profile_id`.

---

## 6. Fit check vs current docs / schema

| Entity | Fits base? | Notes (do not auto-fix) |
|--------|------------|---------------------------|
| Business | Partial | Has `owner_id`, `created_by`, status=`approved`, visibility; missing unified Source/Import on row; multi-admin via `business_owners`. |
| Professional | Partial | Draft uses `profile_id` as owner; status=`approved`; no visibility / Source / Import / creator split yet. |
| Listing | Partial | `owner_id` NOT NULL; `visibility`; rich statuses (`active`…); no Source/Import; `publisher_*` is attribution (specific). |
| Job | Partial (draft) | Strong Creator + `business_id` attribution; statuses near target; **no** `owner_profile_id` / Source / Import / visibility in stub. |
| Event / Vehicle / Real Estate | Stub only | Draft has `owner_profile_id`-like fields inconsistently; incomplete Source/Import/visibility. |

---

## 7. Contradictions found (listed, not fixed)

1. **Owner field names:** REPORT §0.2/0.5 uses `professionals.profile_id` and `business_owners`; OWNERSHIP canonical is `owner_profile_id`; production Business uses `owner_id`; Listings use `owner_id`.  
2. **Claim scope:** OWNERSHIP §7 says Claim may also grant `business_owners`; Base Model / task §10 say Claim changes **only** `owner_profile_id`. Access grant is a **Business-specific side effect**, not a Source/Creator change — needs an explicit product decision.  
3. **Jobs Creator NOT NULL:** JOBS model requires `created_by_profile_id` always; Base Model allows NULL for system import — conflict for imported jobs.  
4. **Jobs vs Ownership:** Business jobs managed via `owns_business` with `owner_profile_id` possibly null — correct specialization, but then “every entity has owner_profile_id concept” allows permanent NULL when org-owned.  
5. **Status vocabulary:** `approved` / `active` / `published` / `deferred` coexist across Business, Listing, Professional, registry, Jobs.  
6. **Publish gate vs Status:** `can_publish()` gates *who may create*; `status`/`visibility` gate *what is shown* — related but different; docs sometimes blur “publish”.  
7. **`entities.source_id`:** registry FK vs provenance `source_*` naming collision (already noted).  
8. **Import doc vs Jobs SQL draft:** Ownership architecture forbids admin-as-owner; Jobs SQL draft has no Source/Import columns yet — incomplete relative to Base Model.

---

## 8. Recommendations before designing concrete entities

1. Adopt this base as the checklist for every new/altered entity table.  
2. Decide Claim side effect for Business: owner only vs owner + `business_owners` insert.  
3. Decide imported rows: nullable `created_by_profile_id` vs synthetic SYSTEM user (prefer null + Import fields).  
4. Plan a status mapping table (`approved`→`published`, `active`→`published`) before any rename migration.  
5. Add `private` to listing visibility only if product needs it; otherwise document listings as `public|unlisted`.  
6. Keep public attribution (`jobs.business_id`, `listings.publisher_*`) **outside** Ownership/Source.  
7. Do not put provenance into `entities.source_id`.

---

## 9. Out of scope

Marketplace/Business/Jobs/Events field design, categories, permissions, moderation workflows, SQL, RLS, API, UI.
