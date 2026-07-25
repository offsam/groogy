"""Adapter for local seed JSON (business-seed facebook_entities_*.json).

Useful for PoC without calling Apify — same pipeline as live dataset rows.
"""

from __future__ import annotations

from typing import Any

from adapters.base import coerce_text, first_str
from adapters.generic_apify import GenericApifyGroupAdapter
from canonical import CanonicalFacebookPost
from fingerprint import extract_group_id, normalize_facebook_url


class SeedEntitiesAdapter:
    """Maps historical entity-extraction rows that include original_text."""

    name = "seed_entities"

    def __init__(self) -> None:
        self._fallback = GenericApifyGroupAdapter()

    def parse_row(self, row: dict[str, Any]) -> CanonicalFacebookPost | None:
        text = coerce_text(row.get("original_text") or row.get("text"))
        if not text:
            return self._fallback.parse_row(row)

        source_url = normalize_facebook_url(
            first_str(row.get("source_post_url"), row.get("url"), row.get("postUrl"))
        )
        group_id = extract_group_id(None, source_url)
        post_id = first_str(
            row.get("facebook_post_id"),
            row.get("post_id"),
            row.get("source_post_number"),
        )
        if not post_id:
            return None

        group_url = None
        if source_url and "/groups/" in source_url:
            # Keep group root URL only (drop /posts/... if present).
            parts = source_url.split("/groups/", 1)[1]
            slug = parts.split("/", 1)[0]
            group_url = f"https://facebook.com/groups/{slug}"

        return CanonicalFacebookPost(
            facebook_post_id=str(post_id),
            group_id=group_id,
            group_name=first_str(row.get("group_name"), row.get("source_group")),
            group_url=group_url or source_url,
            source_url=source_url,
            published_at=first_str(row.get("source_post_date"), row.get("published_at")),
            text=text,
            attachments=[],
            author_display_name=first_str(row.get("source_author"), row.get("author")),
            adapter_name=self.name,
            raw={
                "source_post_number": row.get("source_post_number"),
                "entity_name": row.get("entity_name"),
                "category": row.get("category"),
            },
        )
