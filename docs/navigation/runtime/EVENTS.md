# Events

## Purpose

Event entity lifecycle (publish, admin, public pages).

## Source of Truth

- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Events
- Entity canon: [`EVENT_ENTITY_V1.md`](../../architecture/entity-model-v1/EVENT_ENTITY_V1.md)
- Mapping: [`ENTITY_TYPE_MAPPING_V1.md`](../../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md) (`event`)
- Data audit: [`ENTITY_AUDIT_V1.md`](../../audits/ENTITY_AUDIT_V1.md)

## Primary documents

- Entity: [`EVENT_ENTITY_V1.md`](../../architecture/entity-model-v1/EVENT_ENTITY_V1.md)
- Team plan (RU): [`../../plans/EVENTS_FULL_WORK_PLAN_V1.md`](../../plans/EVENTS_FULL_WORK_PLAN_V1.md) (+ PDF рядом)

## Primary code location

- Lib: [`../../../lib/events/`](../../../lib/events/)
- Public: [`../../../app/events/`](../../../app/events/)
- Admin: [`../../../app/admin/events/page.tsx`](../../../app/admin/events/page.tsx)
- FB publish helper: [`../../../scripts/facebook-collector/publish_recommendation_events.py`](../../../scripts/facebook-collector/publish_recommendation_events.py)
- Import publish path: [`../../../lib/import-review/actions.ts`](../../../lib/import-review/actions.ts)

## Main database objects

- `events`

## Entry points

- `/events`, `/events/new`, `/events/mine`, `/events/[slug]`, `/events/[slug]/edit`
- `/admin/catalog/events`, `/admin/catalog/events/[id]/edit`
- `/admin/events` → Inbox Events view
- Import-review approve → event

## Main RPC

- See migrations / lifecycle for event policies; no separate events RPC catalog found

## Main API

- None dedicated

## Related documents

- [`PUBLISH.md`](./PUBLISH.md), [`../entities/INDEX.md`](../entities/INDEX.md)
- Team plan (RU): [`../../plans/EVENTS_FULL_WORK_PLAN_V1.md`](../../plans/EVENTS_FULL_WORK_PLAN_V1.md) (+ PDF рядом)

## Deprecated paths

- Architecture stubs historically mentioned events as stub — prefer live `events` table + lifecycle
