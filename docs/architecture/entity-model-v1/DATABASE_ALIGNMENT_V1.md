# Database Alignment V1 — audit

**Architecture audit only.** No SQL written. No migrations applied. No production changes.

Compares **approved Entity Model V1** (docs under this folder) with **current production schema** as reflected in `types/database.ts` / live migrations.

Canonical architecture references:

* [`ENTITY_BASE_MODEL.md`](./ENTITY_BASE_MODEL.md)
* [`OWNERSHIP_SOURCE_CLAIM.md`](./OWNERSHIP_SOURCE_CLAIM.md)
* [`ACCESS_MODEL_V1.md`](./ACCESS_MODEL_V1.md)
* [`ENTITY_ACL_V1.md`](./ENTITY_ACL_V1.md) — Variant A
* [`BUSINESS_ENTITY_V1.md`](./BUSINESS_ENTITY_V1.md)
* [`PROFESSIONAL_ENTITY_V1.md`](./PROFESSIONAL_ENTITY_V1.md)
* [`JOBS_ENTITY_V1.md`](./JOBS_ENTITY_V1.md)
* [`MARKETPLACE_ENTITY_V1.md`](./MARKETPLACE_ENTITY_V1.md)
* [`JOBS_AND_PUBLISH.md`](./JOBS_AND_PUBLISH.md)

Draft SQL under `001_additive_schema.sql` is **not production** and is cited only as “planned draft,” not as live state.

---

## 0. Production snapshot (relevant)

| Object | In production? |
|--------|----------------|
| `profiles` | Yes |
| `businesses` | Yes |
| `business_owners` | Yes |
| `business_claims` | Yes |
| `reviews` | Yes (Business-scoped) |
| `listings` + `marketplace_listing_details` | Yes |
| `import_review_items` | Yes (pipeline; not domain Base Source) |
| `professionals` / `professional_*` | **No** |
| `jobs` (dedicated) | **No** (`listings.listing_type` may include `job`) |
| `entities` / `platform_categories` | **No** |
| `can_publish()` / `profiles.account_status` | **No** |
| `owns_business()` / `is_admin()` | Yes |

---

## 1. Business

### Already matches

* Identity: `id`, `slug`, `name`, descriptions, `created_at`, `updated_at`
* Domain contacts / geo / hours / image (with anti-scrape patterns via views/APIs)
* Status column exists (`content_status`)
* Derived review caches: `rating_avg`, `reviews_count`, verified counts
* Entity ACL Variant A: `business_owners` present
* Claim workflow table: `business_claims` present
* Platform override via `is_admin()` / `owns_business()` (implementation blurs layers — see Access notes)

### Requires change

| Area | Production | Architecture |
|------|------------|--------------|
| Ownership | No `owner_profile_id` on `businesses` | Nullable `owner_profile_id` |
| Creator | No `created_by_profile_id` | Separate creator |
| Source | Absent on row | Immutable `source_type` (+ optional record/url) |
| Import | Absent on row (only import-review pipeline) | `imported_at` / `imported_by_profile_id` / `import_batch_id` |
| Status vocabulary | `approved`, `deferred`, … | Map to Base `published` / `hidden` (rename or mapping layer) |
| Visibility | **Missing** | `public` \| `unlisted` \| `private` |
| Lifecycle stamps | No `published_at` / `archived_at` | Optional Base stamps |
| ZIP | No `postal_code` on Business | Optional domain field (gap in Business Entity doc) |
| Category | Legacy `category_id` → `categories` | Platform categories / `entity_categories` (later) |
| Naming | — | Prefer `owner_profile_id` over any legacy `owner_id` docs |

### Requires new table

* None strictly for Business core (ACL/Claim already exist).  
* Later: registry/`entity_categories` if category unification ships (shared infra, not Business-only).

### Requires deletion

* Nothing mandatory.  
* Candidates to **stop treating as Owner**: any habit of using Admin as owner; legacy docs mentioning `businesses.owner_id` (column not in current TS Row).  
* Do not delete `business_owners` (Variant A locked).

---

## 2. Professional

### Already matches

* Product/architecture decision exists (independent page, no Biz link).  
* Nothing in production DB yet — no conflicting live columns.

### Requires change

* N/A on live table (table absent).

### Requires new table

| Table / object | Purpose |
|----------------|---------|
| `professionals` | Core entity + Base fields |
| `professional_services` | Domain services |
| `professional_portfolio_media` | Portfolio |
| `professional_credentials` | Credentials |
| `professionals_public` (view) | Anti-scrape public projection |
| `owns_professional()` | Entity Access helper |

Must include Base: nullable owner, creator, source, import, status, visibility, timestamps.

### Requires deletion

* None in production.  
* Product rule: do **not** keep treating imported specialists as `businesses` long-term (data migration later — Phase 3).

---

## 3. Marketplace (`listings` where `listing_type = marketplace_item`)

### Already matches

* `id`, `title`, `description`, price fields, geo
* `status`, `visibility` (`public` \| `unlisted` \| `private` in TS)
* Lifecycle stamps: `published_at`, `archived_at`, `expires_at`, …
* Attribution: `publisher_type`, `publisher_business_id` (domain-specific, allowed)
* `author_visibility` (author privacy ≠ entity visibility — keep)
* Details table `marketplace_listing_details`
* `favorites_count` (derived cache)

### Requires change

| Area | Production | Architecture |
|------|------------|--------------|
| Ownership | `owner_id` **NOT NULL** | Nullable `owner_profile_id` (unclaimed import / Claim) |
| Creator | Missing; triggers force owner = session | Separate `created_by_profile_id` |
| Source / Import | Not on listing; live on `import_review_items` | Thin Source/Import on domain row |
| Status names | `active` / `removed` / … | Map to Base `published` / … (keep marketplace-specific `reserved`/`completed` as domain extras) |
| Publish gate | No shared `can_publish()` | Wire eligibility for create/publish |
| Slug | Often absent | Optional unless public SEO URLs require it |
| Naming | `owner_id` | Align to `owner_profile_id` (rename or alias later) |

### Requires new table

* None for Marketplace core.  
* Optional later: generic Claim requests beyond Business (if Claim expands).

### Requires deletion

* Nothing required.  
* Long-term: stop using `listings.listing_type = job` as canonical Jobs (see Jobs) — data move, not drop of marketplace.

---

## 4. Jobs

### Already matches

* Architecture + draft model exist.  
* No dedicated production table → no column-level conflict yet.  
* `listing_type` enum includes `job` — **legacy path**, not the approved dedicated Job entity.

### Requires change

* If any rows use `listings.listing_type = job`: plan migration to `jobs` (Phase 3).  
* Stop dual-registering listing jobs into future `entities` as `job` (already decided in draft).

### Requires new table

| Object | Purpose |
|--------|---------|
| `jobs` | Dedicated Job entity with Base + domain (`business_id`, compensation, …) |
| Registry sync | `entity_type = job` → `entities` when registry ships |
| Helpers | e.g. `can_manage_job` (Entity Access via owner or `owns_business`) |

Must include: nullable `owner_profile_id`, creator (nullable for system import), source, import, status, visibility.

### Requires deletion

* Not immediately. Deprecate job-as-listing after backfill (Phase 3).

---

## 5. Shared / related tables

### `business_owners`

| | |
|--|--|
| Match | Yes for **Entity ACL Variant A** (Business-only multi-member ACL) |
| Gaps | Ensure import/Claim never inserts Platform Admin «as owner»; role values (`owner` vs future `manager`) undocumented in Base |
| Change | Process/RLS policy alignment more than schema; optional role check constraints later |

### `business_claims`

| | |
|--|--|
| Match | Yes as Business Claim workflow seed |
| Gaps | On approve: must set `owner_profile_id` (when column exists) **and** Entity Owner ACL; must not alter Source; must not write Admin into ACL |
| Change | Claim RPC semantics when Ownership columns land; generalize Claim to other entities = Phase 3 |

### `reviews`

| | |
|--|--|
| Match | Business-scoped reviews + aggregates on `businesses` fit Business derived fields |
| Gaps | No Professional (or Job) review target yet; not Base Entity |
| Change | Extend when Professional reviews ship — not a Base alignment blocker |

### `profiles`

| | |
|--|--|
| Match | Account center; `display_name`, `postal_code` exist for Publish Eligibility inputs |
| Gaps | No `account_status`; no first-class email/phone verified flags (use `auth.users`); `role = business_owner` legacy vs Entity Access |
| Change | Additive `account_status` for `can_publish`; treat `business_owner` role as non-ACL |

### `import_review_items`

| | |
|--|--|
| Match | Rich pipeline provenance for Telegram/etc. |
| Gaps | Not a substitute for domain Source/Import columns after publish |
| Change | On publish: copy thin Source/Import onto Business/Listing/Job/Pro; leave `owner_profile_id` NULL |

### Publish helpers

| | |
|--|--|
| Match | None in production |
| Need | `can_publish` / `is_profile_completed` / `has_verified_contact` (+ optional `account_status`) |

---

## 6. Cross-cutting gap matrix

| Capability | Business | Professional | Marketplace | Jobs |
|------------|----------|--------------|-------------|------|
| Table exists | Yes | **No** | Yes | **No** (listing job only) |
| `owner_profile_id` nullable | **No** | n/a | **No** (`owner_id` required) | n/a |
| Creator field | **No** | n/a | **No** | n/a |
| Source / Import on row | **No** | n/a | **No** | n/a |
| Status ≈ Base | Partial (`approved`) | n/a | Partial (`active`) | n/a |
| Visibility | **No** | n/a | Yes | n/a |
| `can_publish` | **No** | **No** | **No** | **No** |
| Claim | Business only | Missing | Missing | Missing |
| Entity ACL | `business_owners` | Owner-only planned | Owner-only (+ Biz publisher) | Via owner / Business |

---

## 7. Change map by phase

### Phase 1 — Safe (additive, low risk)

Can land without rewriting core product paths if carefully gated / unused until app wired.

1. `profiles.account_status` (default `active`) + `can_publish` / completion helpers (read-only use until enforced).  
2. Additive Business columns: `owner_profile_id` (nullable, backfill null), `created_by_profile_id`, `source_*`, import fields, `visibility` (default `public`), optional `published_at`/`archived_at`/`postal_code`.  
3. Additive Listing columns: `created_by_profile_id`, `source_*`, import fields (keep `owner_id` NOT NULL until Phase 2).  
4. Document status mapping helpers in app (no enum rename yet): `approved`↔`published`, `active`↔`published`.  
5. Import publish checklist: never set Admin as owner / `business_owners`.

### Phase 2 — Medium (migrations + behavior)

Requires careful backfill and RLS/trigger updates.

1. Enforce `can_publish` on create/publish paths (Business create, listings, future Pro/Jobs).  
2. Make Marketplace `owner_id` nullable (or add `owner_profile_id` and migrate); split Creator from Owner in triggers.  
3. Claim approve: set Business `owner_profile_id` + `business_owners` for claimant only.  
4. Project Source/Import from `import_review_items` onto published domain rows.  
5. Create `professionals` (+ children, public view, RLS) — empty inventory OK.  
6. Create dedicated `jobs` table (+ RLS); do not auto-migrate listing jobs yet.  
7. Optional: Business status/visibility used by search consistently.

### Phase 3 — Large (high caution)

1. Status enum convergence (`content_status` / `listing_status` → shared vocabulary or stable mapping views).  
2. Rename `owner_id` → `owner_profile_id` (listings) / align Professional `profile_id`.  
3. Category unification (`platform_categories`, `entities`, `entity_categories`) + backfill.  
4. Migrate `listings.listing_type = job` → `jobs`; retire dual model.  
5. Migrate mis-classified imported specialists from `businesses` → `professionals` where product requires.  
6. Expand Claim beyond Business; Professional reviews; any move toward universal Entity ACL (**only if** product triggers per ENTITY_ACL_V1 — not default).  
7. Revisit `owns_business` Admin OR — keep Platform override but avoid documenting Admin as Owner.

---

## 8. What must not be deleted in alignment

* `business_owners` (Variant A)  
* `business_claims`  
* Anti-scrape views / contact reveal patterns  
* `import_review_items` pipeline tables  

---

## 9. Audit conclusions

1. **Closest to architecture today:** Marketplace shell (status/visibility/timestamps) + Business domain content + Business Claim/ACL tables.  
2. **Largest gaps:** no Professional/Jobs tables; no Base Ownership/Source/Import on Business/Listings; no `can_publish`; Owner required on listings; status vocabulary drift; job-as-listing.  
3. **Do not fix in this document** — inventory only.

---

## 10. Out of scope

Writing SQL, applying migrations, UI, RLS rewrites, data backfills.
