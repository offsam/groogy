# Entity ACL V1 — decision

Architecture only. No SQL, migrations, or production changes.

**Question:** Keep Business-only `business_owners`, or introduce a universal Entity ACL for all entity types?

Must stay consistent with already locked:

* [`ACCESS_MODEL_V1.md`](./ACCESS_MODEL_V1.md) — Platform ≠ Entity; Business Manager optional later; no managers for Pro / Marketplace / Jobs in V1  
* [`OWNERSHIP_SOURCE_CLAIM.md`](./OWNERSHIP_SOURCE_CLAIM.md) — `owner_profile_id`; Claim; Admin ≠ Owner  
* [`ENTITY_BASE_MODEL.md`](./ENTITY_BASE_MODEL.md) — shared owner field on every entity  

Index: [`REPORT.md`](./REPORT.md).

---

## 1. Shared facts (both variants)

| Fact | Rule |
|------|------|
| Platform Access | Admin / Moderator — override, never entity Owner by role |
| Primary Owner | Always `owner_profile_id` (nullable = unclaimed) |
| Claim | Sets `owner_profile_id`; does not invent Platform roles; Admin not auto-inserted into ACL |
| Creator / Source / Import | Not ACL roles |

ACL (any shape) answers only: **which profiles may manage this entity beyond (or including) the primary Owner.**

---

## 2. Variant A — Business ACL table only

```text
All entities:     owner_profile_id
Business only:    business_owners (profile + role)
Other entities:   Owner via owner_profile_id only
```

Matches current production pattern (`business_owners` + `owns_business`).

### Pros

* Already exists; Claim / manage flows known.  
* Matches Access Model V1 (managers only contemplated for Business).  
* Pro, Marketplace, Jobs stay simple (personal or org-via-`business_id` / publisher).  
* No empty universal table with one role forever.  
* RLS helpers stay focused (`owns_business`, `owns_professional`).

### Cons

* Second Business with team features ≠ automatic team on Jobs/Listings/Events.  
* If agencies later need co-editors on many types → N special tables or a late migration to B.  
* Role vocabulary (`owner`/`manager`) lives only on Business.

### Limits

* Cannot express listing co-editor or Professional “assistant” without a new table or jumping to B.  
* Business-job manage stays “via Business ACL”, not job-level ACL (acceptable in V1).

### Evolution cost

* Low now.  
* Medium–high later if many entity types need multi-member ACL → deliberate move to B (one migration story).

---

## 3. Variant B — Universal Entity ACL

Conceptual (not SQL):

```text
entity_acl
  entity_type    -- business | professional | marketplace_item | job | …
  entity_id
  profile_id
  role           -- owner | manager | editor | viewer | …
```

Plus still keep `owner_profile_id` as the **primary Owner identity** for Claim / unclaimed / public rules (ACL does not replace Ownership).

### Pros

* One pattern for Business, Pro, Marketplace, Jobs, Event, RE, Vehicle, future types.  
* Roles Owner / Manager / Editor / Viewer can grow without new tables.  
* Better fit for teams, agencies, co-management, Enterprise, multi-entity API later.  
* Aligns with thin `entities` registry thinking (ACL keyed by type+id).

### Cons

* Over-built for V1 where only Business needs multi-member access.  
* Contradicts Access Model V1 “no managers” on Pro / Marketplace / Jobs if we populate ACL early “just in case”.  
* Dual source of truth risk: `owner_profile_id` vs ACL row `role=owner` — needs strict rule (Owner field wins; ACL mirrors Owner for Business).  
* Every RLS path becomes polymorphic; harder debugging until tooling exists.  
* Migrating today’s `business_owners` → universal ACL is real work; doing it before product need is waste.

### Can one ACL cover Owner / Manager / Editor / Viewer / future roles?

**Yes, conceptually** — one membership table + role enum/extensible roles, no per-entity ACL tables required.

It does **not** remove:

* Platform Access (still separate).  
* `owner_profile_id` (Claim / unclaimed still need a first-class Owner field).  
* Attribution fields (`jobs.business_id`, `publisher_*`) — not ACL.

---

## 4. Scale (30–50 types, teams, agencies, API, Enterprise)

| Horizon | Better fit |
|---------|------------|
| Now–V1 (single Owner everywhere; Business multi-admin only) | **A** |
| Multi-year (teams, agencies, co-edit many types, Enterprise API) | **B** |

A scales poorly as *product* demand for shared management spreads across types.  
B scales well then — but adopting B **before** that demand fights locked V1 Access Model and adds cost without benefit.

---

## 5. Recommendation (final for Entity Model V1)

### Choose **Variant A**

**Business keeps `business_owners`. All other entities use `owner_profile_id` only (no universal Entity ACL in V1).**

### Why

1. **Already locked** in Access Model V1: Manager optional and Business-only; Pro / Marketplace / Jobs have no Entity Manager roster.  
2. **Ownership / Claim** already center on `owner_profile_id`; Admin must not land in ACL — A preserves that with the table we already have.  
3. **Jobs / Marketplace org control** already routes through Business (`business_id` / `publisher_business_id` + `owns_business`) — no second ACL needed.  
4. **Universal ACL now** would be speculative architecture for roles we explicitly deferred.  
5. Production already runs on A; V1 docs should not invent a parallel ACL system.

### Explicit non-choice

Variant B is **not** rejected forever. It is the **right upgrade** when product requires multi-member roles on several entity types (agencies, co-editors, Enterprise). Until then, do not introduce it.

### Upgrade trigger → B (future phase, not V1)

Introduce universal Entity ACL when **any** of these become committed product:

* Manager/Editor on Professional or Marketplace without going through Business;  
* Agency operating many entity types under one team;  
* Cross-entity permission API for partners;  
* More than Business needs a shared role model.

Migration story later: map `business_owners` → `entity_acl` where `entity_type=business`; keep `owner_profile_id` as canonical Owner.

---

## 6. What this decision unlocks

**Now (A):**

* Ship Claim + Owner + Business multi-admin without ACL redesign.  
* Keep RLS helpers simple.  
* Finish Base / Source / Import alignment without a second access subsystem.

**Later (path to B):**

* One ACL vocabulary for 30–50 types when teams exist.  
* Owner / Manager / Editor / Viewer without N `*_owners` tables.  
* Cleaner Enterprise/API story — as a **named next architecture phase**, not a silent V1 requirement.

---

## 7. Locked decisions

1. V1 Entity ACL strategy = **Variant A**.  
2. No universal `entity_acl` in Entity Model V1.  
3. `business_owners` remains Business-only.  
4. Primary Owner everywhere = `owner_profile_id`.  
5. Variant B = future phase when multi-entity team ACL is a real product need.

---

## 8. Out of scope

SQL for either variant, role matrices for Editor/Viewer, UI for invites, changing `owns_business`, production migrations.
