"""Generic Apify-ish row adapter.

Maps common field aliases used by Facebook group actors. Actor-specific quirks
belong in a dedicated adapter module — this one stays intentionally loose.
"""

from __future__ import annotations

from typing import Any

from adapters.base import coerce_text, first_str
from canonical import CanonicalFacebookPost, FacebookAttachment
from fingerprint import extract_group_id, extract_post_id_from_url, normalize_facebook_url


class GenericApifyGroupAdapter:
    name = "generic_apify_group"

    def parse_row(self, row: dict[str, Any]) -> CanonicalFacebookPost | None:
        if not isinstance(row, dict):
            return None

        # Skip non-post / notice rows some actors emit.
        row_type = str(row.get("type") or row.get("rowType") or row.get("kind") or "").lower()
        if row_type in {"notice", "error", "group_profile", "profile", "member"}:
            return None

        text = coerce_text(
            row.get("text")
            or row.get("postText")
            or row.get("message")
            or row.get("content")
            or row.get("post_text")
            or row.get("original_text")
        )
        source_url = normalize_facebook_url(
            first_str(
                row.get("url"),
                row.get("postUrl"),
                row.get("post_url"),
                row.get("source_post_url"),
                row.get("facebookUrl"),
                row.get("permalink"),
            )
        )
        post_id = first_str(
            row.get("postId"),
            row.get("post_id"),
            row.get("facebook_post_id"),
            row.get("id"),
            row.get("postIdStr"),
            extract_post_id_from_url(source_url),
        )
        if not text and not post_id and not source_url:
            return None
        if not text:
            # Empty body (media-only) — still useful if URL exists.
            text = ""

        group_url = normalize_facebook_url(
            first_str(
                row.get("groupUrl"),
                row.get("group_url"),
                row.get("inputUrl"),
                row.get("group"),
            )
        )
        group_id = extract_group_id(
            first_str(
                row.get("groupId"),
                row.get("group_id"),
                row.get("facebookGroupId"),
            ),
            group_url,
        )
        group_name = first_str(
            row.get("groupTitle"),
            row.get("groupName"),
            row.get("group_name"),
            row.get("group"),
        )
        if group_name and group_name.startswith("http"):
            group_name = None

        published_at = first_str(
            row.get("timestamp"),
            row.get("time"),
            row.get("date"),
            row.get("publishedAt"),
            row.get("published_at"),
            row.get("createdAt"),
            row.get("source_post_date"),
        )

        author_name = first_str(
            row.get("userName") if isinstance(row.get("user"), str) else None,
            (row.get("user") or {}).get("name") if isinstance(row.get("user"), dict) else None,
            row.get("authorName"),
            row.get("author_name"),
            row.get("author"),
            row.get("source_author"),
        )

        if not post_id:
            # Last resort: stable id from URL or text — still better than dropping.
            post_id = extract_post_id_from_url(source_url) or first_str(row.get("source_post_number"))
        if not post_id:
            return None

        attachments = _attachments_from_row(row)

        return CanonicalFacebookPost(
            facebook_post_id=str(post_id),
            group_id=group_id,
            group_name=group_name,
            group_url=group_url,
            source_url=source_url,
            published_at=published_at,
            text=text,
            attachments=attachments,
            author_display_name=author_name,
            adapter_name=self.name,
            raw=_slim_raw(row),
        )


def _attachments_from_row(row: dict[str, Any]) -> list[FacebookAttachment]:
    out: list[FacebookAttachment] = []
    for key, kind in (
        ("image", "image"),
        ("images", "image"),
        ("photo", "image"),
        ("photos", "image"),
        ("video", "video"),
        ("videos", "video"),
        ("link", "link"),
        ("attachments", "unknown"),
        ("media", "unknown"),
    ):
        val = row.get(key)
        if not val:
            continue
        if isinstance(val, str):
            out.append(FacebookAttachment(kind=kind, url=val))
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, str):
                    out.append(FacebookAttachment(kind=kind, url=item))
                elif isinstance(item, dict):
                    url = item.get("url") or item.get("image") or item.get("src")
                    item_kind = str(item.get("type") or item.get("kind") or kind)
                    out.append(FacebookAttachment(kind=item_kind, url=url))
    # Dedupe by url
    seen: set[str] = set()
    unique: list[FacebookAttachment] = []
    for att in out:
        key = att.url or f"{att.kind}:{len(unique)}"
        if key in seen:
            continue
        seen.add(key)
        unique.append(att)
    return unique[:20]


def _slim_raw(row: dict[str, Any]) -> dict[str, Any]:
    """Keep a small debug slice — drop comments / members / heavy blobs."""
    drop = {
        "comments",
        "topComments",
        "commentList",
        "members",
        "memberList",
        "reactions",
        "reactionBreakdown",
        "likes",
        "authorProfile",
        "userProfile",
        "profile",
    }
    slim: dict[str, Any] = {}
    for k, v in row.items():
        if k in drop:
            continue
        if isinstance(v, (dict, list)) and len(str(v)) > 4000:
            continue
        slim[k] = v
    return slim
