"""Actor adapter protocol — swap scrapers without changing КРУГИ core."""

from __future__ import annotations

from typing import Any, Protocol

from canonical import CanonicalFacebookPost


class FacebookActorAdapter(Protocol):
    """Convert one vendor dataset row into CanonicalFacebookPost."""

    name: str

    def parse_row(self, row: dict[str, Any]) -> CanonicalFacebookPost | None:
        """Return None to skip blocked / empty / non-post rows."""
        ...


def first_str(*values: Any) -> str | None:
    for value in values:
        if value is None:
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            s = str(value).strip()
            if s:
                return s
        if isinstance(value, str):
            s = value.strip()
            if s:
                return s
        if isinstance(value, dict):
            nested = first_str(
                value.get("id"),
                value.get("postId"),
                value.get("post_id"),
                value.get("url"),
                value.get("text"),
                value.get("name"),
            )
            if nested:
                return nested
    return None


def coerce_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = [coerce_text(v) for v in value]
        return "\n".join(p for p in parts if p)
    if isinstance(value, dict):
        return coerce_text(
            value.get("text")
            or value.get("message")
            or value.get("content")
            or value.get("body")
        )
    return str(value).strip()
