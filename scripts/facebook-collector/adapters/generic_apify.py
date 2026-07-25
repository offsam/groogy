"""Generic Apify-ish Facebook group row adapter."""

from __future__ import annotations

from typing import Any

from models import MediaItem
from normalize_facebook import (
    extract_group_id,
    extract_post_id_from_url,
    from_adapter_fields,
    normalize_facebook_url,
)


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


class GenericApifyGroupAdapter:
    name = "generic_apify_group"

    def parse_row(self, row: dict[str, Any]):
        if not isinstance(row, dict):
            return None

        row_type = str(
            row.get("type") or row.get("rowType") or row.get("kind") or ""
        ).lower()
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
            row.get("source_post_id"),
            row.get("postIdStr"),
            extract_post_id_from_url(source_url),
            row.get("id") if _looks_like_post_id(row.get("id")) else None,
            row.get("source_post_number"),
        )
        if not post_id and not text and not source_url:
            return None
        if not post_id:
            return None

        group_url = normalize_facebook_url(
            first_str(
                row.get("groupUrl"),
                row.get("group_url"),
                row.get("inputUrl"),
                row.get("source_group_url"),
            )
        )
        if not group_url and source_url and "/groups/" in source_url:
            slug = extract_group_id(None, source_url)
            if slug:
                group_url = f"https://facebook.com/groups/{slug}"

        group_name = first_str(
            row.get("groupTitle"),
            row.get("groupName"),
            row.get("group_name"),
            row.get("source_group_name"),
        )
        if group_name and str(group_name).startswith("http"):
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
            (row.get("user") or {}).get("name")
            if isinstance(row.get("user"), dict)
            else None,
            row.get("authorName"),
            row.get("author_name"),
            row.get("author"),
            row.get("source_author"),
        )

        media = _attachments_from_row(row)
        return from_adapter_fields(
            source_post_id=str(post_id),
            source_group_url=group_url,
            source_group_name=group_name,
            source_url=source_url,
            author_name=author_name,
            published_at=published_at,
            text=text,
            media=media,
            adapter_name=self.name,
            raw_row=row,
        )


def _looks_like_post_id(value: Any) -> bool:
    if value is None:
        return False
    s = str(value).strip()
    return s.isdigit() and len(s) >= 5


def _attachments_from_row(row: dict[str, Any]) -> list[MediaItem]:
    out: list[MediaItem] = []
    for key, kind in (
        ("image", "image"),
        ("images", "image"),
        ("photo", "image"),
        ("photos", "image"),
        ("video", "video"),
        ("videos", "video"),
        ("link", "link"),
        ("attachments", "image"),
        ("media", "image"),
    ):
        val = row.get(key)
        if not val:
            continue
        items = val if isinstance(val, list) else [val]
        for item in items:
            if isinstance(item, str) and item.startswith("http"):
                out.append(MediaItem(type=kind if kind in {"image", "video", "link"} else "image", url=item))
            elif isinstance(item, dict):
                url = item.get("url") or item.get("image") or item.get("src")
                if not url:
                    continue
                item_kind = str(item.get("type") or item.get("kind") or kind).lower()
                if item_kind in {"photo", "img"}:
                    item_kind = "image"
                if item_kind not in {"image", "video", "link"}:
                    item_kind = "image"
                out.append(
                    MediaItem(
                        type=item_kind,  # type: ignore[arg-type]
                        url=str(url),
                        thumbnail_url=item.get("thumbnail_url") or item.get("thumbnail"),
                    )
                )
    seen: set[str] = set()
    unique: list[MediaItem] = []
    for att in out:
        if att.url in seen:
            continue
        seen.add(att.url)
        unique.append(att)
    return unique[:20]
