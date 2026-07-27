# Search

## Purpose

Catalog search (SQL) and AI search-intent endpoint.

## Source of Truth

- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Search
- Note in lifecycle: no separate search index table; live SQL

## Primary documents

- Security/AI wiring: [`../ai/INDEX.md`](../ai/INDEX.md)

## Primary code location

- Page: [`../../../app/search/page.tsx`](../../../app/search/page.tsx)
- Components: [`../../../components/search/`](../../../components/search/)
- Queries: [`../../../lib/supabase/queries.ts`](../../../lib/supabase/queries.ts), [`../../../lib/listings/queries.ts`](../../../lib/listings/queries.ts)
- AI: [`../../../lib/ai/search-intent.ts`](../../../lib/ai/search-intent.ts), [`../../../lib/search/`](../../../lib/search/)
- API: [`../../../app/api/search/ai/route.ts`](../../../app/api/search/ai/route.ts), [`../../../app/api/search/businesses/route.ts`](../../../app/api/search/businesses/route.ts)

## Main database objects

- Entity tables / public views used by query helpers
- Lifecycle notes absence of `search_logs` table despite older mentions

## Entry points

- `/search`
- `/api/search/ai`, `/api/search/businesses`

## Main RPC

- Platform stats RPCs may feed hubs; search itself is query-layer — see migrations if needed

## Main API

- [`../api/INDEX.md`](../api/INDEX.md) § Search

## Related documents

- [`PUBLIC_WEBSITE.md`](./PUBLIC_WEBSITE.md), [`../api/INDEX.md`](../api/INDEX.md)

## Deprecated paths

- Unknown
