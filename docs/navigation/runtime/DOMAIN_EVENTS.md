# Domain Events

## Purpose

Consume / observe platform domain events (outbox / event log) emitted by stabilized runtime.

## Source of Truth

- Stabilization: [`ARCHITECTURE_STABILIZATION_V1.md`](../../architecture/runtime/ARCHITECTURE_STABILIZATION_V1.md)
- Live map: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md)
- Alignment roadmap (Stage B): [`ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md`](../../architecture/ARCHITECTURE_ALIGNMENT_ROADMAP_V1.md)

## Primary documents

- Migrations mentioning `domain_events` (see `supabase/migrations/*architecture_stabilization*`, `*full_entity_registry*`)

## Primary code location

- Consumer CLI: [`../../../scripts/runtime/consume_domain_events.py`](../../../scripts/runtime/consume_domain_events.py)
- Local run artifact dir: [`../../../scripts/runtime/data/`](../../../scripts/runtime/data/) (not SoT)

## Main database objects

- Domain events / outbox tables as defined in stabilization migrations (see SoT docs + migrations — do not invent column lists here)

## Entry points

- Manual: `python3 scripts/runtime/consume_domain_events.py`
- Emitters: DB triggers / RPCs described in stabilization + lifecycle

## Main RPC

- See stabilization migrations / lifecycle — no separate RPC catalog in navigation

## Main API

- None dedicated

## Related documents

- [`../database/INDEX.md`](../database/INDEX.md)
- [`ENRICHMENT.md`](./ENRICHMENT.md), [`PUBLISH.md`](./PUBLISH.md)

## Deprecated paths

- Unknown / none listed
