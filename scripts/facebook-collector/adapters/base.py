"""Adapter protocol helpers (optional typing)."""

from __future__ import annotations

from typing import Any, Protocol

from models import NormalizedFacebookPost


class FacebookActorAdapter(Protocol):
    name: str

    def parse_row(self, row: dict[str, Any]) -> NormalizedFacebookPost | None: ...
