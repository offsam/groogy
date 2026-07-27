# Ownership / Source / Import / Claim

Entity Model v1 — **architecture only**. No SQL, RLS, UI, or migrations in this document.

Canonical product law: **owner, provenance, and import actor are three independent facts.** Never collapse them into one column.

Full package index: [`REPORT.md`](./REPORT.md).

---

## 1. Three independent concepts

| Concept | Answers | Changes on Claim? |
|---------|---------|-------------------|
| **Ownership** | Who controls the record *inside* the platform now? | Yes — NULL → Profile (or Business managers) |
| **Source** | Where did the data originally come from? | **Never** |
| **Import** | Who/what ran the import pipeline (if any)? | No (historical) |

Do **not** treat:

* importer as owner;
* admin as owner of imported cards;
* `source_type` as a stand-in for ownership;
* `created_by` as ownership (creator ≠ owner after claim / transfer).

---

## 2. Ownership

Every user-facing entity must be able to express platform ownership.

Canonical field name (target model):

```text
owner_profile_id uuid NULL
```

| State | Meaning |
|-------|---------|
| `owner_profile_id = profile_id` | Record has a platform owner (user-created or claimed) |
| `owner_profile_id = NULL` | **Unclaimed** — exists in catalog, no platform owner yet |

### Applies uniformly to

* Business  
* Professional  
* Listing (Marketplace and other listing types)  
* Job  
* Event  
* Vehicle  
* Real Estate  

### Business multi-admin (existing)

After a Business is owned, **management** may use `business_owners` (0..N admins). That is *access*, not provenance.

Rules:

* Unclaimed imported Business: `owner_profile_id = NULL` and **no** `business_owners` rows for admins/importers.
* Successful Claim: set `owner_profile_id` **and** grant the claimant in `business_owners` (and existing claim workflow can evolve later).
* **Never** insert the importing admin as owner «so something has an owner».

### Jobs (interaction with public attribution)

Jobs already distinguish **public author** via `business_id` (see Jobs model). Ownership is separate:

| Job kind | Public author | Platform ownership |
|----------|---------------|--------------------|
| Personal | Profile | `owner_profile_id` (usually same as creator after publish) |
| Business-attributed | Business | Managed via `owns_business(business_id)`; `owner_profile_id` may stay null — control is org-scoped |
| Imported, unclaimed | Display from source data | `owner_profile_id = NULL` |

`created_by_profile_id` (who clicked Create) remains a fourth audit fact when present — still not Source, still not Import actor unless they coincide.

---

## 3. Source (provenance)

Every record should carry immutable origin metadata.

Minimal shared shape:

```text
source_type          -- enum / constrained text
source_record_id     -- opaque external id string (nullable if N/A)
source_url           -- canonical URL when useful (nullable)
```

### Recommended `source_type` values

```text
USER
ADMIN
TELEGRAM
FACEBOOK
WEBSITE
GOOGLE
API
MANUAL_IMPORT
SYSTEM
```

Prefer a **Postgres enum** (or check-constrained text aligned with existing `import_review_items.source`) — one shared type across entities, not per-table forks.

### `source_record_id`

Opaque string; **do not** force one schema for all networks.

Examples:

| source_type | Typical `source_record_id` | Optional extras (only if needed) |
|-------------|----------------------------|----------------------------------|
| TELEGRAM | `message_id` or `chat_id:message_id` | chat/group id already on import pipeline |
| FACEBOOK | `post_id` | group_id |
| WEBSITE | hash or stable crawl id | use `source_url` |
| GOOGLE | `place_id` | |
| USER | null | |
| SYSTEM | batch/internal id | |

Rich Telegram/Facebook payloads can stay on the **import review / raw** tables; the published entity keeps the thin immutable triple above.

### Immutability

After insert:

```text
source_type
source_record_id
```

(and preferably `source_url`) are **write-once**. Claim, owner transfer, edits, and re-publish **must not** rewrite them.

### Naming collision warning

Registry table `entities.source_id` means «FK to domain row id» — **not** external provenance. Do not overload it. External provenance stays on the domain row (or a shared provenance columns convention), never as a rewrite of registry `source_id`.

---

## 4. Import information

Separate from Ownership and Source:

```text
imported_at              timestamptz NULL
imported_by_profile_id   uuid NULL
import_batch_id          uuid/text NULL
```

| Case | Values |
|------|--------|
| User-created in UI | all NULL (or `imported_at` null); `source_type = USER` |
| System import | `imported_at` set; `imported_by_profile_id = NULL`; `source_type` = TELEGRAM / … |
| Admin-triggered import | `imported_by_profile_id = admin profile`; **still** `owner_profile_id = NULL` |

**Importer ≠ owner.** Admin who pressed «approve/publish» is not the Business/Listing owner.

Existing today: `import_review_items` already stores Telegram-oriented source fields and `approved_by` / `reviewed_by`. Those remain pipeline audit. On **publish to domain**, copy thin Source + Import fields onto the entity; do not set admin as `owner_profile_id`.

---

## 5. User-created content

```text
owner_profile_id         = profile_id
source_type              = USER
source_record_id         = NULL
imported_by_profile_id   = NULL
imported_at              = NULL
```

---

## 6. Imported content (example: Telegram)

```text
owner_profile_id         = NULL
source_type              = TELEGRAM
source_record_id         = <message identity>
source_url               = optional permalink
imported_at              = now()
imported_by_profile_id   = NULL | admin if human-triggered
import_batch_id          = batch id
```

The card is live / pending in the catalog with **no platform owner**.

---

## 7. Claim

Future product flow (not implemented here):

```text
User: «This is my business / listing / job.»
  → claim request + verification (later)
  → on success:
       owner_profile_id: NULL → profile_id
       (+ business_owners for Business)
  → source_type / source_record_id unchanged forever
```

Lifecycle:

```text
Telegram
   ↓
Import pipeline
   ↓
Business (or Listing / Job / …)
   ↓
owner_profile_id = NULL
   ↓
Claim (approved)
   ↓
owner_profile_id = Profile
source_type still TELEGRAM
```

Existing `business_claims` is the Business-shaped seed of this idea; generalize the **semantics** to all claimable entities later, without inventing UI now.

---

## 8. Anti-patterns (forbidden)

| Forbidden | Why |
|-----------|-----|
| `owner_profile_id = admin` on import | Admin is not the merchant/author |
| Setting `business_owners` to importer «for RLS convenience» | Fakes ownership; breaks Claim |
| Changing `source_type` on Claim | Erases provenance |
| Using `source_type = USER` for Telegram cards | Lies about origin |
| Treating `entities.source_id` as Telegram message id | Different concept |
| Requiring a fake owner so «every row has an owner» | Unclaimed is a valid state |

---

## 9. Mapping to current production (gaps — no silent rewrite)

| Area today | Gap vs this model |
|------------|-------------------|
| `businesses.owner_id` | Close to `owner_profile_id`; often null — good. Confirm imports never set admin. |
| `business_owners` | Access after ownership; must stay empty for unclaimed imports. |
| `business_claims` | Claim workflow exists for Business only. |
| `businesses.created_by` | Closer to creator/importer audit — **not** owner; align naming with Import vs Creator later. |
| `listings.owner_id` NOT NULL | Conflicts with unclaimed imports; needs nullable ownership (+ Claim) in a future migration. |
| `jobs.created_by_profile_id` NOT NULL | Creator audit; add separate nullable `owner_profile_id` when Jobs ship Claim/import. |
| `professionals.profile_id` | Today acts as owner; imported Professional needs nullable owner + Source fields. |
| `import_review_items.source*` | Rich pipeline provenance; project into thin entity Source on publish. |
| `entities.source_id` | Registry pointer only — keep name; do not reuse for external ids. |

No SQL in this stage — gaps are for the **next** schema design pass.

---

## 10. Uniformity checklist

Same concepts for Business, Professional, Listing, Job, Event, Vehicle, Real Estate:

1. Nullable platform owner (`owner_profile_id` or agreed alias).  
2. Immutable Source triple.  
3. Optional Import triple.  
4. Claim only mutates Ownership (and Business access rows).  
5. Creator / public attribution (e.g. Job `business_id`) remain separate where already defined.

---

## 11. Out of scope (this stage)

* Claim UI / moderation / documents / notifications  
* SQL / RLS / API / migrations / production changes  
* Professional ↔ Business memberships  
