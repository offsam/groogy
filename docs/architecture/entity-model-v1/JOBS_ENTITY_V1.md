# Jobs Entity V1 — Freeze

**Status: FROZEN** with [`ARCHITECTURE_FREEZE_V1.md`](./ARCHITECTURE_FREEZE_V1.md).

Related: [`JOBS_AND_PUBLISH.md`](./JOBS_AND_PUBLISH.md). Draft table `jobs` in `001_additive_schema.sql` (not in production).

---

## Role

One table, registry type **`job`**. Public attribution:

```text
business_id IS NOT NULL  →  shown as Business job
business_id IS NULL      →  shown as personal Profile job
```

No `author_type`. No dual `listings.listing_type=job` registration into `entities`.

---

## Scenarios

| Scenario | Owner | Creator | business_id | Source |
|----------|-------|---------|-------------|--------|
| Personal UI | profile | profile | NULL | USER |
| Business UI | null or org policy | acting user | set | USER |
| Import unclaimed | NULL | NULL (system) | optional from text | TELEGRAM/… |
| Claim personal | NULL→profile | unchanged | NULL | unchanged |

---

## Base Entity (required)

| Field | Rule |
|-------|------|
| `id`, `slug` | Required |
| `owner_profile_id` | Nullable; Claim target for personal jobs |
| `created_by_profile_id` | **Nullable** for system import; immutable once set (except admin) |
| Source / Import | Required Source; import fields optional |
| `status` | Base-compatible (`draft`/`pending`/`published`/`archived`/`rejected`/`expired`) |
| `visibility` | Required for catalog |
| Timestamps | + `published_at`, `expires_at`, `archived_at` |

---

## Domain fields

* `title`, `description`
* `business_id` — attribution / manage scope via `owns_business`, **not** Source
* `employment_type`, `work_mode`
* `city`, `state_code`, `postal_code`
* `compensation_min` / `max` / `type`
* `offer_kind`: `hire` | `seek`
* Categories: taxonomy_jobs_v1

---

## Links

| System | Rule |
|--------|------|
| Import | Must write Jobs into review queue (close TG→queue gap) |
| Review Workflow | Same states as all ReviewItems |
| Search | `entity_type=job`, category, city, employment_type, offer_kind |
| API / UI requirements | List + detail + create/edit gated by `can_publish` / `can_manage_job`; hub «Работа» |
| Professional | No nest; person seeking work may be Profile or later Pro — Job stays independent |

---

## Resolved contradictions

| Was | Freeze |
|-----|--------|
| Creator NOT NULL | → **NULL allowed** for system import |
| No owner_profile_id | → **required column** |
| Manage = creator only | → personal manage follows **owner** after Claim; business jobs → `owns_business` |

---

## Freeze status

**Ready for implementation.**
