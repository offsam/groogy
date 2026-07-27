# Professional Entity V1 — Freeze

**Status: FROZEN** with [`ARCHITECTURE_FREEZE_V1.md`](./ARCHITECTURE_FREEZE_V1.md).

Architecture + draft SQL. Not applied to production. UI notes: [`PROFESSIONAL_PAGE.md`](./PROFESSIONAL_PAGE.md).

---

## Role

```text
profiles ──(0..1 claimed)──► professionals  → /professional/[slug]
```

* Independent from Business (no required link).  
* Import may create **unclaimed** rows (`owner_profile_id` NULL).  
* Public author of specialist services = Professional (not Business, not raw Profile).

---

## Base Entity (required)

| Field | Rule |
|-------|------|
| `id`, `slug` | Required |
| `owner_profile_id` | Canonical owner; **NULL** until Claim; 0..1 non-null per profile |
| `created_by_profile_id` | Nullable for system import |
| `source_type` + optional record/url | Immutable Source |
| Import fields | Optional |
| `status` | Prefer Base `published` mapping; draft may use `professional_status` with `approved` ≡ published |
| `visibility` | Required for catalog |
| Timestamps | incl. `published_at`, `archived_at` |

---

## Domain fields

* `display_name`, `headline`, `short_description`, `description`, `image_url`
* `experience_years`, `languages`, `availability_text`, `opening_hours`
* Public geo + service area / radius
* Protected: `private_address_line`, `phone`, `email`, `website`, `instagram_url`
* Children: `professional_services`, `professional_portfolio_media`, `professional_credentials`
* Categories: `entity_categories` → taxonomy_professional_v1

---

## Links

| System | Rule |
|--------|------|
| User | `owner_profile_id` = Claimed account; Profile always exists separately |
| Business | **None required.** Same user may own both independently |
| Reviews | Aggregates on Professional (`rating_avg` / `reviews_count`) when review target supports Pro |
| Search | `entity_type=professional`, taxonomy category, geo, languages filters |
| Import | Alias `private_specialist` → `professional` ([ENTITY_TYPE_MAPPING_V1](./ENTITY_TYPE_MAPPING_V1.md)) |
| Publish | `can_publish()` + owner (or admin import with owner NULL) |

---

## Resolved contradictions

| Was | Freeze |
|-----|--------|
| Column `profile_id` | → **`owner_profile_id`** |
| Creator / Source missing | → required on draft SQL |
| `approved` vs `published` | → map; catalog uses published semantics |
| `professional_business_links` | → **absent** in v1 |
| Service listings as Professional | → **forbidden** auto-convert |

---

## Freeze status

**Ready for implementation** (draft SQL must match this doc).
