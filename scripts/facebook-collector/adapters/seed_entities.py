"""Adapter for local business-seed facebook_entities_*.json (offline PoC)."""

from __future__ import annotations

from typing import Any

from adapters.generic_apify import GenericApifyGroupAdapter, coerce_text, first_str
from normalize_facebook import extract_group_id, from_adapter_fields, normalize_facebook_url


class SeedEntitiesAdapter:
    name = "seed_entities"

    def __init__(self) -> None:
        self._fallback = GenericApifyGroupAdapter()

    def parse_row(self, row: dict[str, Any]):
        text = coerce_text(row.get("original_text") or row.get("text"))
        if not text:
            return self._fallback.parse_row(row)

        source_url = normalize_facebook_url(
            first_str(row.get("source_post_url"), row.get("url"), row.get("postUrl"))
        )
        post_id = first_str(
            row.get("facebook_post_id"),
            row.get("post_id"),
            row.get("source_post_id"),
            row.get("source_post_number"),
        )
        if not post_id:
            return None

        group_id = extract_group_id(None, source_url)
        group_url = (
            f"https://facebook.com/groups/{group_id}" if group_id else source_url
        )

        return from_adapter_fields(
            source_post_id=str(post_id),
            source_group_url=group_url,
            source_group_name=first_str(row.get("group_name"), row.get("source_group")),
            source_url=source_url,
            author_name=first_str(row.get("source_author"), row.get("author")),
            published_at=first_str(row.get("source_post_date"), row.get("published_at")),
            text=text,
            media=[],
            adapter_name=self.name,
            raw_row={
                "source_post_number": row.get("source_post_number"),
                "entity_name": row.get("entity_name"),
                "category": row.get("category"),
            },
        )
