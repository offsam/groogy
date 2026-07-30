"""USA source-group → location catalog (mirror of lib/geo/source-location-groups.ts)."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[2]
_CATALOG_PATH = _ROOT / "data" / "geo" / "source_location_groups.json"


@lru_cache(maxsize=1)
def _load_catalog() -> list[dict[str, Any]]:
    with _CATALOG_PATH.open(encoding="utf-8") as fh:
        return list(json.load(fh))


def _to_hit(entry: dict[str, Any]) -> dict[str, Any]:
    scope = entry.get("scope") or "city"
    city = None if scope == "county" else entry.get("city")
    return {
        "city": city,
        "region": entry.get("region"),
        "county_geoid": entry.get("county_geoid"),
        "state": (entry.get("state_code") or "").replace("US-", "") or None,
        "state_code": entry.get("state_code"),
        "hub_id": entry.get("hub_id"),
        "scope": scope,
        "catalog_id": entry.get("id"),
    }


def location_from_group(*parts: str | None) -> dict[str, Any] | None:
    """Resolve location from chat id and/or group title / source key."""
    catalog = _load_catalog()
    by_chat: dict[str, dict[str, Any]] = {}
    for entry in catalog:
        for chat_id in entry.get("chat_ids") or []:
            if chat_id:
                by_chat[str(chat_id)] = entry

    for part in parts:
        key = str(part or "").strip()
        if key and key in by_chat:
            return _to_hit(by_chat[key])

    blob = " ".join(p for p in parts if p).strip()
    if not blob:
        return None
    for entry in catalog:
        pattern = entry.get("match")
        if not pattern:
            continue
        if re.search(pattern, blob, re.I):
            return _to_hit(entry)
    return None
