"""Register Facebook Actor adapters."""

from __future__ import annotations

from adapters.generic_apify import GenericApifyGroupAdapter
from adapters.seed_entities import SeedEntitiesAdapter

ADAPTERS: dict[str, type] = {
    GenericApifyGroupAdapter.name: GenericApifyGroupAdapter,
    SeedEntitiesAdapter.name: SeedEntitiesAdapter,
}


def get_adapter(name: str):
    try:
        cls = ADAPTERS[name]
    except KeyError as exc:
        known = ", ".join(sorted(ADAPTERS))
        raise SystemExit(f"Unknown adapter {name!r}. Known: {known}") from exc
    return cls()
