# Public Website

## Purpose

Public Next.js surfaces: home, catalogs, profiles, map, search.

## Source of Truth

- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Public Website
- IA design: [`PLATFORM_INFORMATION_ARCHITECTURE_V2.md`](../../architecture/entity-model-v1/PLATFORM_INFORMATION_ARCHITECTURE_V2.md)
- Sections config: [`../../../lib/platform/sections.ts`](../../../lib/platform/sections.ts)

## Primary documents

- Gap (nav transitional): [`IMPLEMENTATION_GAP_ANALYSIS_V1.md`](../../architecture/entity-model-v1/IMPLEMENTATION_GAP_ANALYSIS_V1.md)

## Primary code location

- App routes: [`../../../app/`](../../../app/) (`page.tsx`, `business/`, `professionals/`, `marketplace/`, `jobs/`, `events/`, `transfers/`, `lechu/`, `services/`, `vehicles/`, `real-estate/`, `map/`, `search/`, …)
- Components: [`../../../components/`](../../../components/)
- Regions/hubs: [`../../../lib/regions/`](../../../lib/regions/)

## Main database objects

- Public views / RLS-filtered tables (see database index + lifecycle)

## Entry points

- `/` home
- Catalog routes under `app/*`
- Contact reveal APIs — [`../api/INDEX.md`](../api/INDEX.md)

## Main RPC

- Contact helpers e.g. `get_professional_contacts` / business contacts (lifecycle + `app/api/**/contacts`)

## Main API

- [`../api/INDEX.md`](../api/INDEX.md)

## Related documents

- [`SEARCH.md`](./SEARCH.md), [`LISTINGS.md`](./LISTINGS.md), [`../entities/INDEX.md`](../entities/INDEX.md)

## Deprecated paths

- IA V1: [`PLATFORM_INFORMATION_ARCHITECTURE_V1.md`](../../architecture/entity-model-v1/PLATFORM_INFORMATION_ARCHITECTURE_V1.md) — secondary to V2 per freeze
