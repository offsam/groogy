# Professional Public Page — quick reference

Canonical product model (Entity Model v1):

```text
auth.users → profiles (always; account center)
                │
                ├── Professional 0..1   → /professional/[slug]
                └── Business 0..N       → /business/[slug]

/u/[username]   personal page of the same account
```

**Independent entities.** User does not become Professional/Business; Professional does not become Business.

**No required Professional ↔ Business link in v1.** Employment/contractor linking = future module (not in this migration).

Full detail: [`REPORT.md`](./REPORT.md) → **Canonical account model** + **Professional Public Page Architecture**.

Schema in [`001_additive_schema.sql`](./001_additive_schema.sql):

- `professionals` owned by `profile_id`
- `professional_services`, `professional_portfolio_media`, `professional_credentials`
- `professionals_public` (no contacts / private address)
- `owns_professional()` + RLS
- **no** `professional_business_links`

Publishing context:

| Action | Attribution |
|--------|-------------|
| Marketplace listing | User (`Иван Петров`) |
| Professional service | Professional (`Иван Петров — сантехник`) |
| Business job / offer / promo | Business (`Irvine Plumbing LLC`) |
| Personal job (`jobs.business_id` null) | Profile |

Create Professional requires `can_publish()` (see [`JOBS_AND_PUBLISH.md`](./JOBS_AND_PUBLISH.md)).

Alignment vs Base Entity: [`PROFESSIONAL_ENTITY_V1.md`](./PROFESSIONAL_ENTITY_V1.md).

One record, many surfaces — no data copies.

UI not built in this stage.
