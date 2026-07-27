# Jobs model + Publish Eligibility (Entity Model v1)

Draft only — **not applied**. Full detail in [`REPORT.md`](./REPORT.md). Schema: [`001_additive_schema.sql`](./001_additive_schema.sql).

---

## Jobs

One table `jobs`, one registry type `entity_type = job`. No `business_job` / `personal_job` split.

| Field | Rule |
|-------|------|
| `created_by_profile_id` | **NOT NULL** — always the human who created the row |
| `business_id` | **NULL** = personal Profile job; **NOT NULL** = Business job |

Public attribution (no `author_type`):

```text
business_id IS NOT NULL  →  public author = Business
business_id IS NULL      →  public author = Profile
```

Surfaces (same row, same id): Business page (only if `business_id` set), Jobs hub, search, filters, feed.

---

## Access levels

| Level | DB entity? | Can publish? |
|-------|------------|--------------|
| Guest | no | no |
| Light registration (auth, incomplete) | `profiles` | no |
| Publish-eligible | `profiles` + `can_publish()` | yes (+ entity-specific checks) |

---

## `can_publish`

```text
can_publish =
  authenticated
  AND profiles.account_status = 'active'
  AND display_name present
  AND postal_code (ZIP) present
  AND (auth.users.email_confirmed_at OR auth.users.phone_confirmed_at)
```

Helpers: `is_profile_completed`, `has_verified_contact`, `can_publish(uuid)`, `can_publish()`.

Entity extras: Job personal = `can_publish` + `business_id IS NULL`; Job business = `can_publish` + `owns_business(business_id)`; Marketplace / Professional / Business as in REPORT.

Full Jobs alignment vs Base Entity: [`JOBS_ENTITY_V1.md`](./JOBS_ENTITY_V1.md).

---

## Gaps vs product wording

| Product term | Actual field / source |
|--------------|------------------------|
| `zip_code` | `profiles.postal_code` |
| `email_verified` | `auth.users.email_confirmed_at` (not on profiles) |
| `phone_verified` | `auth.users.phone_confirmed_at` |
| `profile_completed` | computed by `is_profile_completed()` |
| `account_status` | **additive** column on `profiles` in this draft (was missing) |
