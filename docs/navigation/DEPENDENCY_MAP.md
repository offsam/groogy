# DEPENDENCY_MAP.md

High-level subsystem dependencies only.  
No implementation detail.  
Derived from existing navigation + [`PLATFORM_LIFECYCLE_V1.md`](../architecture/runtime/PLATFORM_LIFECYCLE_V1.md).

Arrow meaning: **A → B** = A depends on B (needs B to function as documented).

---

## Overview

```text
Collectors / Directories
        ↓
      Import
        ↓
   Classification (AI)
        ↓
      Review ─────────────→ Recommendations (parallel track)
        ↓                         ↓
      Publish ←─────────────── Publish (recs)
        ↓
   Enrichment / Duplicates
        ↓
  Public Website ← Search
        ↑
   Ownership / Claims
        ↑
    Reviews / Moderation
        ↑
     Database (all)
```

---

## Per subsystem

### Import

Depends on:

- Collectors (Telegram / Facebook / directories)
- Database (`import_review_items`)
- AI classifiers (optional path)

### Review

Depends on:

- Import
- Database
- Admin

### Publish

Depends on:

- Import
- Review (human path) **or** Autopublish eligibility (automated path)
- Ownership rules (owner stays null until Claim — design)
- Database (target entity tables)
- Entity model / type mapping

### Recommendations

Depends on:

- Collectors (comment/chat mining)
- Database (`import_comment_recommendations`)
- Admin
- Publish (when approving into catalog)

### Enrichment

Depends on:

- Publish (typically fill-empty on published rows) **and/or** Import queue enrich
- Database
- Integrations (websites, directories, geocoders, LLM)

### Duplicates

Depends on:

- Import (queue fingerprints / clusters)
- Publish / Enrichment (entity merge)
- Database
- Admin (merge RPCs)

### Ownership

Depends on:

- Entity Model / ACL docs
- Database (`business_claims`, `business_owners`, owner columns)
- Public Website / user auth (claim flows)

### Claims

Depends on:

- Ownership
- Admin
- Database

### Moderation

Depends on:

- Admin
- Database
- Reviews (report paths) / Listings / Businesses

### Reviews (reputation)

Depends on:

- Database
- Public Website (business surfaces)
- Moderation (admin)

### Search

Depends on:

- Database / query layer
- Public Website routes
- AI (intent route only)
- Security (guards / rate limits)

### Events

Depends on:

- Publish / Import Review
- Database (`events`)
- Public Website / Admin
- Recommendations (optional FB event publish path)

### Listings (Marketplace / Services / Transfer / Lechu)

Depends on:

- Database (`listings` + detail tables)
- Publish / Import
- Public Website
- Admin listings moderation

### Public Website

Depends on:

- Database (views / RLS)
- Search
- Entity catalogs
- API (contacts / stats / popular)

### Admin

Depends on:

- Database / RPC
- Review / Claims / Moderation / Recommendations / Master data
- Auth (admin role)

### AI (collectors + LLM app)

Depends on:

- Security / allowlists
- Import / Enrichment / Search intent consumers
- External providers (OpenRouter, etc. — env, not documented as architecture here)

### Database

Depends on:

- Migrations / Supabase
- (foundation for nearly all subsystems)

### Entity Model (design)

Depends on:

- Freeze / mapping docs
- Informs Publish, Ownership, Taxonomy — not a runtime dependency edge

### Taxonomy / IA

Depends on:

- Freeze taxonomy docs + JSON assets
- Used by Admin master data / Import category mapping / Public nav sections

---

## Notes

- Edges are navigational aids for agents, not an executable graph.
- If lifecycle and freeze disagree, follow the documented SoT for the task type (live vs design) — see [`AI_AGENT_START_HERE.md`](./AI_AGENT_START_HERE.md).
