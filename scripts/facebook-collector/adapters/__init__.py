"""Register adapters by name."""

from __future__ import annotations

from adapters.base import FacebookActorAdapter
from adapters.generic_apify import GenericApifyGroupAdapter
from adapters.seed_entities import SeedEntitiesAdapter

ADAPTERS: dict[str, type] = {
    GenericApifyGroupAdapter.name: GenericApifyGroupAdapter,
    SeedEntitiesAdapter.name: SeedEntitiesAdapter,
}


def get_adapter(name: str) -> FacebookActorAdapter:
    try:
        cls = ADAPTERS[name]
    except KeyError as exc:
        known = ", ".join(sorted(ADAPTERS))
        raise SystemExit(f"Unknown adapter {name!r}. Known: {known}") from exc
    return cls()
