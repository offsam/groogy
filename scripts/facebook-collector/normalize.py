"""Canonical Facebook post → analyzer-compatible logical post."""

from __future__ import annotations

from typing import Any

from canonical import CanonicalFacebookPost
from fingerprint import (
    attachment_dicts,
    facebook_source_fingerprint,
    normalize_facebook_url,
)


def to_logical_post(post: CanonicalFacebookPost) -> dict[str, Any]:
    """Shape compatible with telegram-collector analyzers + dedupe."""
    source_url = normalize_facebook_url(post.source_url)
    fingerprint = facebook_source_fingerprint(
        group_id=post.group_id,
        facebook_post_id=post.facebook_post_id,
        source_url=source_url,
        published_at=post.published_at,
        text=post.text,
    )
    attachments = attachment_dicts(post.attachments)
    media_count = sum(1 for a in attachments if a.get("kind") in {"image", "video", "photo"})
    internal_post_id = f"fb_{post.group_id}_{post.facebook_post_id}"

    return {
        "source": "facebook",
        "internal_post_id": internal_post_id,
        "facebook_post_id": post.facebook_post_id,
        "source_fingerprint": fingerprint,
        "source_chat_id": post.group_id,
        "chat_title": post.group_name,
        "group_url": post.group_url,
        # Analyzer-compatible aliases (telegram-shaped)
        "primary_message_id": None,
        "message_id": None,
        "source_message_ids": [],
        "merged_text": post.text,
        "text": post.text,
        "merge_reason": "facebook_single",
        "sender_id": None,
        "sender_name": post.author_display_name,
        "message_date": post.published_at,
        "message_date_start": post.published_at,
        "message_date_end": post.published_at,
        "has_media": media_count > 0,
        "media_type": attachments[0]["kind"] if attachments else None,
        "media_count": media_count,
        "source_media": [
            {
                "kind": a.get("kind"),
                "url": a.get("url"),
                "download_status": "external",
            }
            for a in attachments
        ],
        "source_url": source_url,
        "facebook_post_link": source_url,
        "adapter_name": post.adapter_name,
        # Keep slim raw for debugging; never publish as catalog content
        "adapter_raw_slim": post.raw,
    }
