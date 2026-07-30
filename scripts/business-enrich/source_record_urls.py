"""URLs kept on the origin rows of a published card.

A published card only carries the links a moderator saved. The rows it came
from (comment recommendations, import queue items) often hold more: booking
pages, sites, registration forms. Enrichment must crawl those too, otherwise a
Book link visible in «Источник» never reaches the card.
"""

from __future__ import annotations

from typing import Any


def _push(out: list[str], seen: set[str], raw: Any) -> None:
    if raw is None:
        return
    if isinstance(raw, (list, tuple, set)):
        for item in raw:
            _push(out, seen, item)
        return
    url = str(raw).strip()
    if not url or not url.lower().startswith(("http://", "https://", "www.")):
        return
    key = url.lower().rstrip("/")
    if key in seen:
        return
    seen.add(key)
    out.append(url[:500])


def source_record_urls(
    client: Any,
    entity_id: str | None,
    *,
    limit: int = 12,
) -> list[str]:
    """Links from recommendation / queue rows that produced this card."""
    if not client or not entity_id:
        return []

    out: list[str] = []
    seen: set[str] = set()

    queries: list[tuple[str, dict[str, str], tuple[str, ...]]] = [
        (
            "/import_comment_recommendations",
            {
                "select": "websites,registration_url",
                "or": (
                    f"(published_entity_id.eq.{entity_id},"
                    f"duplicate_of_entity_id.eq.{entity_id})"
                ),
                "limit": "10",
            },
            ("websites", "registration_url"),
        ),
        (
            "/import_review_items",
            {
                "select": "website",
                "published_entity_id": f"eq.{entity_id}",
                "limit": "10",
            },
            ("website",),
        ),
    ]

    for path, params, fields in queries:
        try:
            rows = client._request("GET", path, params=params) or []
        except Exception:  # noqa: BLE001 — enrichment must survive a missing table
            continue
        for row in rows:
            for field in fields:
                _push(out, seen, row.get(field))

    return out[:limit]
