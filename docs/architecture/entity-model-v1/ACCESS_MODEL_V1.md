# Access Model V1 — Platform vs Entity

Architecture only. No SQL, migrations, UI, or full RBAC redesign.

Separates **who runs the platform** from **who owns/manages a specific entity**.

Related: [`OWNERSHIP_SOURCE_CLAIM.md`](./OWNERSHIP_SOURCE_CLAIM.md), [`ENTITY_BASE_MODEL.md`](./ENTITY_BASE_MODEL.md), entity v1 docs, [`REPORT.md`](./REPORT.md).

---

## 1. Two layers (non-negotiable)

```text
┌─────────────────────────────────────────────┐
│  Platform Access  (profiles.role / staff)   │
│  Admin · Moderator · (optional Support)     │
│  Scope: whole platform · not entity owners  │
└─────────────────────────────────────────────┘
                      ≠
┌─────────────────────────────────────────────┐
│  Entity Access  (per Business / Pro / …)    │
│  Owner · (Manager later, Business only)     │
│  Scope: one entity · via ownership + ACL    │
└─────────────────────────────────────────────┘
```

| Layer | Answers | Stored as | Becomes Owner of Business? |
|-------|---------|-----------|----------------------------|
| **Platform Access** | May this staff user moderate/import/override anywhere? | Platform role on account (today: `profiles.role`) | **Never** by virtue of the role alone |
| **Entity Access** | May this user manage *this* Business / Pro / listing / job? | `owner_profile_id` (+ `business_owners` for Business) | Only if they Claimed / created / were granted |

Platform staff keep **system** access after Claim. They are not written into entity ownership tables as a side effect of being admin.

---

## 2. Platform Access (V1)

Independent of any Business / Professional / Listing / Job.

### Roles in V1 (final for this model)

| Role | Exists today | Responsibility |
|------|--------------|----------------|
| **Platform Admin** | `profiles.role = admin` + `is_admin()` | Full platform: moderation, import review, user roles, override edits, see non-public rows as staff |
| **Moderator** | `profiles.role = moderator` | Content moderation / review queues; narrower than Admin (exact matrix later — not full RBAC here) |
| **User** (default) | `user` | No platform staff powers; may own entities if Claim/create |

### Deferred (not designed now)

* **Support** — optional future staff role (read-heavy help); do not invent permissions matrix yet.
* Fine-grained RBAC, permission catalogs, department ACLs.

### Rules

1. Platform roles **do not** make the account `owner_profile_id` of imported cards.  
2. Platform roles **must not** be inserted into `business_owners` because someone is Admin.  
3. Staff may still **act on** any entity via Platform Access (moderation RPCs / `is_admin()` overrides). That is **override**, not ownership.  
4. Legacy `profiles.role = business_owner` is **not** Entity Access — treat as outdated platform flag; real Business control is Entity Access (`owner_profile_id` + `business_owners`).

---

## 3. Entity Access (V1)

Per-entity control for the account that owns or manages that card.

### Canonical Owner

```text
owner_profile_id = profile who owns this entity on the platform
NULL             = unclaimed (no Entity Owner yet)
```

### Business

| Entity role | V1? | Meaning |
|-------------|-----|---------|
| **Owner** | **Yes** | `owner_profile_id` set; primary claimant/creator; full manage of that Business |
| **Manager** | **Later (optional)** | Extra `business_owners` row with non-owner role — **not required in V1** |

**Access table:** `business_owners` = who may manage the Business (Entity Access ACL).  
V1 minimum after Claim/create: Owner appears as Owner in Entity Access (`business_owners.role = owner` or equivalent).  
Additional Managers = future; do not block V1.

`owns_business()` today ORs `is_admin()` — implementation convenience. **Conceptually:** Admin path = Platform Access; membership path = Entity Access. Do not document Admin as “Business Owner”.

### Professional

| | V1 |
|--|-----|
| Owner | `owner_profile_id` (draft: `profile_id`) — at most one claimed Pro per profile |
| Managers | **No** — personal page; no staff roster |
| Platform | Admin/Moderator override only |

### Marketplace listing

| | V1 |
|--|-----|
| Owner | `owner_profile_id` (today: `owner_id`) when claimed/user-created |
| Org manage | If `publisher_type = business`, Business Entity Owners/Managers manage via `owns_business(publisher_business_id)` — still not Platform ownership |
| Managers on listing | **No** separate listing managers |
| Platform | Staff override |

### Jobs

| | V1 |
|--|-----|
| Personal job Owner | `owner_profile_id` (when aligned); manage = owner |
| Business job | Entity Access via **Business** (`owns_business(business_id)`); job row may have null personal owner |
| Job Managers | **No** — use Business Owner/Manager |
| Creator | Audit only (`created_by_profile_id`) — not a second Owner role |
| Platform | Staff override |

---

## 4. Claim (final rule)

On successful Claim of an unclaimed entity:

| May change | Must not change |
|------------|-----------------|
| `owner_profile_id` NULL → claimant profile | `source_*`, Creator, Import fields |
| Entity Access grant for Business: claimant becomes **Entity Owner** (e.g. row in `business_owners`) | Platform Admin / Moderator roles |
| | Inserting **Platform Admin** into `business_owners` «because admin» |
| | Treating Admin as the new Owner of the card |

```text
Claim success
  → owner_profile_id = claimant
  → claimant gets Entity Owner rights (Business: business_owners)
  → Platform Admin set unchanged
  → Platform Admins keep full Platform Access (override), still not Owners
```

**Base-field Claim** mutates ownership identity. **Business ACL insert** is Entity Access bookkeeping for that Business only — not Platform Access, not Source.

---

## 5. Publish Eligibility vs Access

Orthogonal:

| Gate | Meaning |
|------|---------|
| `can_publish()` | Account may create public user content (eligibility) |
| Entity Access | Account may manage **this** existing entity |
| Platform Access | Staff may moderate/override **any** entity |

Guest / Light registration: no publish, no entity manage (except viewing public). Staff may still use Platform Access.

---

## 6. Entity checklist

| Entity | Who is Owner? | Who manages via Platform? | Entity Managers in V1? |
|--------|---------------|---------------------------|-------------------------|
| **Business** | `owner_profile_id` (+ Owner in `business_owners`) | Admin / Moderator override | **Owner only**; Manager optional later |
| **Professional** | `owner_profile_id` | same | **No** |
| **Marketplace** | `owner_profile_id`; business-published also managed by Business Entity Access | same | **No** (use Business managers later if needed) |
| **Jobs** | Personal: owner profile; Business job: via Business Entity Access | same | **No** |

---

## 7. Decisions locked (V1)

1. Platform Access ≠ Entity Access; Admin is never Owner by role alone.  
2. Claim sets `owner_profile_id`; does not alter Source/Creator/Import; does not assign Platform roles.  
3. Platform Admin is never written to `business_owners` as a Claim/import side effect.  
4. Business V1 Entity Access = **Owner**; Manager is optional future.  
5. Professional / Marketplace / Jobs: **no** Entity Manager roster in V1.  
6. Creator ≠ Owner ≠ Importer ≠ Platform Admin.  
7. `owns_*` helpers may short-circuit for Admin for implementation — product meaning remains Platform override.

---

## 8. Out of scope

UI, full RBAC matrices, Support role design, SQL/RLS rewrites, renaming `owner_id` / `profile_id`, changing `owns_business` implementation.
