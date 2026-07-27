# Marketplace Entity v1 — alignment

Architecture only. No SQL / migrations / UI.

Checked against: Base Entity, Ownership, Source, Claim, Publish, Business Entity.  
Scope: **Marketplace listings** (`listings` where `listing_type = marketplace_item` + `marketplace_listing_details`).  
Other listing types (service, transfer, lechu, …) share the `listings` table but are **not** redesigned here.

---

## Role

```text
Profile (publisher_type=profile)  → Marketplace listing → author «Иван Петров»
Business (publisher_type=business) → same listings row   → author Business name
```

Personal marketplace posts are attributed to User (account), not Professional.  
One listing id → profile/business surfaces, marketplace hub, search — no copies.

---

## Base Entity

| Concept | Required | Production today | Gap |
|---------|----------|------------------|-----|
| `id` | yes | yes | OK |
| `slug` | if public URL | **often absent** on listings | Product URL strategy TBD |
| `owner_profile_id` | nullable | **`owner_id` NOT NULL** | Blocks unclaimed import / Claim |
| `created_by_profile_id` | yes | **missing** (trigger forces `owner_id = auth.uid()`) | Creator folded into owner |
| Source / Import | yes / optional | **not on listings**; rich fields on `import_review_items` only | Must project onto listing at publish |
| `status` | yes | `listing_status` (`active` ≠ `published`, plus `reserved`/`completed`/`removed`) | Marketplace-specific extras + naming drift |
| `visibility` | yes | `public` \| `unlisted` (no `private`) | Close to Base |
| Timestamps | yes | `created_at`, `updated_at`, `published_at`, `archived_at`, … | Stronger than Base minimum |

**Publish:** UI create should require `can_publish()` (not wired as shared helper in production yet).  
**Import:** Pipeline can create review items; publishing to `listings` today assumes an owner — **conflicts** with `owner = NULL`.  
**Claim:** Not supported until `owner_id` is nullable and Claim flow exists for listings.

---

## Own fields (domain)

On `listings` (shared shell):

* `title`, `description`
* `price_amount`, `price_currency`, `is_negotiable`
* Geo: `city`, `state`, `state_code`, `city_geoid`, lat/lng
* `contact_preference`
* **Attribution (specific, not Base Ownership):** `publisher_type`, `publisher_business_id`
* **Author privacy (specific):** `author_visibility` — not entity `visibility`
* Lifecycle extras: `reserved_at`, `completed_at`, `paused_at`, `expires_at`, `moderation_reason`

On `marketplace_listing_details`:

* `category_id`, `condition`, `transaction_type`, delivery/pickup, `quantity`

Media / favorites — related tables (counts may be denormalized).

---

## Derived

* `favorites_count` — denormalized cache  
* Publisher display label — RPC/`resolve_listing_publisher` (must not leak owner to guests incorrectly)  
* Search catalog views — projections without contacts as policy requires

---

## Extra / do not treat as Base

* `publisher_type` / `publisher_business_id` — public attribution (like Jobs `business_id`)  
* `author_visibility` — author label privacy, not catalog visibility  
* `listing_type` — discriminator for polymorphic `listings` table  
* Service listings ≠ Professional (no auto-convert)  
* Using Business as owner of marketplace row via `owner_id = admin` — forbidden for imports

---

## Imported marketplace listings

Target after alignment:

```text
owner_profile_id = NULL
source_type = TELEGRAM | …
import_* stamped
publisher_type = profile   -- or business only if source clearly is a company card
created_by_profile_id = NULL | admin actor as creator only (not owner)
status = pending|published per moderation
```

Today: import → often Business autopublish or owned listing paths; **owner forced**; Source not copied onto `listings`. Contradiction with Ownership/Source/Claim.

---

## Contradictions (do not fix here)

1. `owner_id` required vs Base nullable owner.  
2. No separate Creator; insert trigger overwrites owner to session user.  
3. No Source/Import on listing row.  
4. Status vocabulary (`active`/`removed`/…) vs Base `published`/`deleted`.  
5. `can_publish` not applied to listings RLS yet.  
6. Polymorphic `listings` mixes Marketplace with other hubs — Base applies, but entity docs must not pretend one domain model fits all listing_types without care.  
7. Business-published marketplace (`publisher_type=business`) vs platform Ownership — owner profile vs org manage needs explicit rule (likely: owner_profile = acting user or null + manage via `owns_business(publisher_business_id)`).

---

## Fit vs Business Entity

Business can appear as **publisher** of a listing; that is attribution/access, not replacing Base Ownership/Source. Unclaimed imports must not put admin into `owner_id` or `business_owners`.
