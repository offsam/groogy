# Business Entity v1

Architecture only — **no SQL, no migrations, no UI**.

Builds Business on already approved:

* [`ENTITY_BASE_MODEL.md`](./ENTITY_BASE_MODEL.md)
* [`OWNERSHIP_SOURCE_CLAIM.md`](./OWNERSHIP_SOURCE_CLAIM.md)
* [`JOBS_AND_PUBLISH.md`](./JOBS_AND_PUBLISH.md) (Publish Eligibility)
* Account model in [`REPORT.md`](./REPORT.md)

Does **not** invent a parallel architecture.

---

## 1. Role of Business

```text
profiles ──(0..N via claim / business_owners)──► Business
                                                      │
                                                      ├── /business/[slug]
                                                      ├── business_offers (same ids in catalogs)
                                                      └── jobs where jobs.business_id = this id
```

Independent from Professional. Public attribution for company content is the Business itself.

---

## 2. Field groups

### A. Base Entity (unchanged concepts)

Business **must** carry the shared foundation. Canonical names below; production may still use aliases (listed in §6) — do not rename in this stage.

| Concept | Canonical field | Business rule |
|---------|-----------------|---------------|
| Identity | `id`, `slug` | Required; public URL `/business/[slug]` |
| Ownership | `owner_profile_id` | Nullable — `NULL` = unclaimed import |
| Creator | `created_by_profile_id` | Who created the row in-platform; null for pure system import |
| Source | `source_type`, `source_record_id?`, `source_url?` | Immutable after create |
| Import | `imported_at?`, `imported_by_profile_id?`, `import_batch_id?` | Importer ≠ owner |
| Status | `status` | Lifecycle (map legacy `approved` → conceptual `published`) |
| Visibility | `visibility` | `public` \| `unlisted` \| `private` |
| Timestamps | `created_at`, `updated_at` | Required |
| Lifecycle stamps | `published_at?`, `archived_at?` | Optional |

**Claim** changes only platform ownership (`owner_profile_id` NULL → profile). Source / Creator / Import unchanged.  
**Business-specific access:** after Claim (or owner invite), managers live in `business_owners` — access table, not provenance.

**Publish:** creating/claiming/editing Business content requires `can_publish()` on the acting profile, plus `owns_business` where applicable.

---

### B. Business-specific (minimal domain)

Stored on the Business row (or one primary location — see notes). Keep lean.

| Field | Required? | Notes |
|-------|-----------|--------|
| `name` | **yes** | Public title |
| `short_description` | no | Card blurb |
| `description` | no | Full profile text |
| Primary category | **yes for catalog** | Today: `category_id` → legacy `categories`; target: platform category leaf via registry / `entity_categories` |
| Subcategory | no | Prefer secondary `entity_categories` (≤3), not a second hard FK unless already needed |
| `phone` | no | Protected (anti-scrape: not in public list payloads) |
| `email` | no | Protected |
| `website` | no | Protected value; presence flag public |
| `instagram_url` | no | Social; protected value / presence flag |
| `yelp_url` | no | Optional presence link |
| `google_maps_url` | no | Maps link |
| `address_line` | no | Street address; protected on lists when precise |
| `city` | no | Public-ish locality |
| `state_code` | no | Prefer over free-text region when both exist |
| `region` | no | Display label (e.g. county hub text) — keep if used for hubs |
| ZIP / `postal_code` | **gap** | Not on Business today; recommend optional add later — do not invent silently |
| `latitude`, `longitude` | no | Map / distance |
| `location_precision` | no | `street` \| `county` — public geo policy |
| `opening_hours` | no | Structured hours JSON |
| Primary image | no | Today: `image_url` (also used as cover in storage `business-images/covers/…`) |
| Logo vs cover | — | **v1 minimal:** one `image_url` is enough; split `logo_url` / `cover_image_url` only if product requires both on page |

**Out of minimal Business row (related entities, not duplicates):**

* Offers → `business_offers`
* Jobs → `jobs.business_id`
* Reviews → `reviews`
* Gallery extras → media tables / storage (optional later)
* Branches / multi-location → future; single address on row is v1

Contacts remain on the Business row but are **not** exposed via anon base SELECT / list APIs (existing anti-scrape).

---

### C. Derived (compute or carefully denormalize)

| Field | Source of truth | Store on row? |
|-------|-----------------|---------------|
| Platform `rating_avg` | Aggregate of published reviews | Denormalized cache OK (already); refresh via trigger |
| `reviews_count` | Count of published reviews | Same |
| `ai_verified_reviews_count` | Filtered review count | Same |
| `transaction_verified_reviews_count` | Filtered review count | Same |
| Offer count | `count(business_offers …)` | **Prefer live count / view** — do not require a column |
| Job count | `count(jobs where business_id=…)` | Prefer live count |
| Listing count (published as business) | listings / offers as product defines | Prefer live count |
| `google_rating`, `google_reviews_count` | External snapshot | Optional **imported** cache, not platform-derived; label as external |
| Presence flags (`has_phone`, …) | Derived from contact columns | View (`businesses_public`) — do not store flags as source of truth |
| `has_facebook` today | Derived from `website` matching facebook | Fragile; optional real `facebook_url` later |

---

## 3. Ownership / Import / Claim (compatibility)

| Scenario | Base fields | Access |
|----------|-------------|--------|
| User creates Business | `owner_profile_id = profile`, `source_type = USER`, import null, creator = profile | Insert `business_owners` for creator |
| Telegram/system import | `owner_profile_id = NULL`, `source_type = TELEGRAM`, import stamped, creator null or system | **No** `business_owners` for admin/importer |
| Claim approved | `owner_profile_id` set; Source unchanged | Add claimant to `business_owners` (Business side effect — product already has `business_claims`) |
| Extra admins | owner unchanged | More rows in `business_owners` |

**Forbidden:** `owner_profile_id = admin` on import; fake owners «for RLS».

---

## 4. Status & visibility (Business mapping)

| Conceptual (Base) | Current `content_status` |
|-------------------|---------------------------|
| `draft` | `draft` |
| `pending` | `pending` |
| `published` | `approved` |
| `hidden` | `deferred` (closest) |
| `archived` | `archived` |
| `rejected` | `rejected` |

Visibility: Base wants `public|unlisted|private`. **Production Business row has no `visibility` column today** — gap; catalog currently gates mainly on `status = approved`.

Publish Eligibility (`can_publish`) gates *who may create/claim*; `status`+`visibility` gate *what guests see*.

---

## 5. Final structure (logical)

```text
Business
│
├── Base Entity
│     id, slug
│     owner_profile_id          -- NULL allowed
│     created_by_profile_id
│     source_type, source_record_id?, source_url?
│     imported_at?, imported_by_profile_id?, import_batch_id?
│     status, visibility
│     created_at, updated_at, published_at?, archived_at?
│
├── Business domain
│     name, short_description?, description?
│     category (primary; secondaries via entity_categories)
│     phone?, email?, website?, instagram_url?, yelp_url?, google_maps_url?
│     address_line?, city?, state_code?, region?, postal_code?
│     latitude?, longitude?, location_precision?
│     opening_hours?
│     image_url?                -- primary visual (logo/cover until split)
│
├── Access (not provenance)
│     business_owners (0..N)
│     business_claims (request workflow)
│
└── Derived / related (not core identity)
      rating_avg, reviews_count, *_verified_reviews_count  (review cache)
      google_rating, google_reviews_count                  (external cache)
      offers, jobs, listings counts                        (query-time)
      presence flags                                       (view)
```

---

## 6. Current model vs v1 — duplicates / gaps / contradictions

**Do not fix here — inventory only.**

| Issue | Detail |
|-------|--------|
| Missing Base columns | No `owner_profile_id`, Source, Import, Creator, `visibility`, `published_at` on `businesses` in current TS types |
| Ownership today | Access via `business_owners` only; older docs mention `businesses.owner_id` — **not** in current generated `businesses` Row |
| Status vocabulary | `approved` ≠ Base `published`; `deferred` ≠ clear `hidden` |
| Category | Single `category_id` to legacy `categories`; Entity Model wants `platform_categories` + `entity_categories` |
| Subcategory | Not on Business; offers have `subcategory_id` |
| ZIP | Not on Business; ZIP lives on `profiles.postal_code` |
| Logo vs cover | Single `image_url`; storage path `covers/` implies cover semantics without a second column |
| Facebook | Flag derived from website string; no first-class `facebook_url` |
| Google rating | External denormalized fields alongside platform review aggregates — easy to confuse in UI |
| `region` vs `state_code` | Overlap risk |
| Anti-scrape | Contacts on base table but revoked for anon — correct pattern; keep |
| Docs drift | `docs/database-schema.md` still describes older owner_id / locations split |

---

## 7. Required vs optional (product checklist)

**Must have to be a valid Business card in catalog:**

* Base: `id`, `slug`, `status`, `created_at`, `updated_at`, `source_type` (when Base is applied)
* Domain: `name`
* Catalog: primary category (nullable only as temporary data debt — 31 nulls already noted in entity pack)

**Should have for a useful public page:** locality and/or coordinates, at least one contact channel or clear «no contacts», `image_url` optional.

**Owner:** `owner_profile_id` may be NULL until Claim.

---

## 8. Compatibility with Base Entity

**Yes — conceptually compatible.** Business is a specialization of Base Entity + domain fields + `business_owners` / `business_claims`.

**Not yet physically aligned** with production columns (aliases, missing Source/Import/visibility, status labels). Alignment is a future migration task — out of scope here.

---

## 9. Out of scope

SQL, RLS changes, Claim UI, moderation redesign, category migration, anti-scrape changes, Professional links, multi-branch model.
