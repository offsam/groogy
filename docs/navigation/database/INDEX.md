# Database Index

Navigation only. **Live schema SoT = applied migrations**, not prose proposals.

---

## Tables / schema

- Migrations (live history): [`../../../supabase/migrations/`](../../../supabase/migrations/)
- Generated client types: [`../../../types/database.ts`](../../../types/database.ts) — hand-maintained; after schema migrations follow [`DB_TYPES_RITUAL_V1.md`](../../architecture/runtime/DB_TYPES_RITUAL_V1.md)
- Alignment notes: [`../../architecture/entity-model-v1/DATABASE_ALIGNMENT_V1.md`](../../architecture/entity-model-v1/DATABASE_ALIGNMENT_V1.md)
- Draft additive SQL (architecture; **not** auto-applied): [`../../architecture/entity-model-v1/001_additive_schema.sql`](../../architecture/entity-model-v1/001_additive_schema.sql), [`002_seed_platform_categories.sql`](../../architecture/entity-model-v1/002_seed_platform_categories.sql)
- ⚠️ Proposal doc (not live SoT): [`../../database-schema.md`](../../database-schema.md)
- Migration report: [`../../migration-0001-report.md`](../../migration-0001-report.md)

---

## RPC

- Listed throughout live runtime map: [`../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md)
- Typed in: [`../../../types/database.ts`](../../../types/database.ts) (`Functions`)
- Defined in: `supabase/migrations/*.sql` (`create or replace function`)

No separate RPC catalog document found.

---

## Triggers

- Described in lifecycle (entity registry sync, listing publish validation, review rating refresh, etc.): [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md)
- Definitions: `supabase/migrations/*.sql`

No separate triggers index document found.

---

## Views

- Public / catalog views mentioned in lifecycle and migrations (e.g. `businesses_public`, `professionals_public`, listing catalogs)
- Definitions: `supabase/migrations/*.sql`
- Types: [`../../../types/database.ts`](../../../types/database.ts) (`Views`)

No separate views catalog document found.

---

## Enums

- Live enums: migrations + [`../../../types/database.ts`](../../../types/database.ts) (`Enums`)
- Domain aliases: [`../../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md`](../../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md)

---

## Migrations

- Directory: [`../../../supabase/migrations/`](../../../supabase/migrations/)
- Count as of navigation authoring: see folder listing (~100+ SQL files)
- Local SQL checks (RLS smoke): `scripts/*-rls-checks.sql`
- Read-only SQL helper: [`../../../scripts/sb_sql.py`](../../../scripts/sb_sql.py)

---

## Related

- Master data admin: [`../admin/INDEX.md`](../admin/INDEX.md)
- Entity tables map: [`../entities/INDEX.md`](../entities/INDEX.md)
- Types ritual: [`../../architecture/runtime/DB_TYPES_RITUAL_V1.md`](../../architecture/runtime/DB_TYPES_RITUAL_V1.md)
- Domain events: [`../runtime/DOMAIN_EVENTS.md`](../runtime/DOMAIN_EVENTS.md)
- CI: [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)
