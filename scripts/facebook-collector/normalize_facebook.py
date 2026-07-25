"""Normalize Actor/dataset rows → NormalizedFacebookPost + analyzer logical posts."""

from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import parse_qs, urlparse, urlunparse

from models import MediaItem, NormalizedFacebookPost, media_from_dicts, utc_now_iso

_POST_ID_RE = re.compile(
    r"(?:posts/|permalink/|multi_permalinks=|story_fbid=)(\d{5,})",
    re.I,
)
_WS_RE = re.compile(r"\s+")


def normalize_facebook_url(url: str | None) -> str | None:
    if not url:
        return None
    raw = url.strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = "https://" + raw
    try:
        parsed = urlparse(raw)
    except ValueError:
        return raw.split("?")[0].rstrip("/")
    qs = parse_qs(parsed.query)
    keep: dict[str, list[str]] = {}
    for key in ("multi_permalinks", "story_fbid", "id"):
        if key in qs:
            keep[key] = qs[key]
    query = "&".join(
        f"{k}={v[0]}" for k, vals in keep.items() for v in [vals] if vals
    )
    host = (parsed.netloc or "facebook.com").lower().removeprefix("www.")
    return urlunparse(("https", host, parsed.path.rstrip("/") or "", "", query, ""))


def extract_post_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = _POST_ID_RE.search(url)
    return m.group(1) if m else None


def extract_group_id(group_id: str | None, group_url: str | None) -> str | None:
    if group_id and str(group_id).strip():
        return str(group_id).strip()
    if group_url:
        m = re.search(r"groups/([^/?#]+)", group_url)
        if m:
            return m.group(1)
    return None


def normalize_text(text: str | None) -> str:
    return _WS_RE.sub(" ", (text or "").strip().lower())


def _sha256(material: str) -> str:
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def build_source_fingerprint(
    *,
    source_post_id: str | None,
    source_url: str | None,
    source_group_url: str | None,
    text: str | None,
    published_at: str | None,
    media_urls: list[str] | None = None,
) -> str:
    """Stable SHA-256 fingerprint with identifier priority from the PoC spec."""
    post_id = (source_post_id or "").strip() or extract_post_id_from_url(source_url)
    if post_id:
        group = extract_group_id(None, source_group_url) or "unknown"
        material = f"facebook|post_id|{group}|{post_id}"
        return f"facebook:{_sha256(material)}"

    url = normalize_facebook_url(source_url)
    if url:
        material = f"facebook|url|{url}"
        return f"facebook:{_sha256(material)}"

    media_part = "|".join(sorted({u for u in (media_urls or []) if u}))
    material = "|".join(
        [
            "facebook|content",
            normalize_facebook_url(source_group_url) or "",
            normalize_text(text),
            (published_at or "").strip(),
            media_part,
        ]
    )
    return f"facebook:{_sha256(material)}"


def slim_raw_payload(row: dict[str, Any]) -> dict[str, Any]:
    """Drop comments/members/profiles/reactions and obvious secret-looking keys."""
    drop_exact = {
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
        "cookies",
        "cookie",
        "cookieString",
        "facebookCookieHeader",
        "session",
        "token",
        "authorization",
    }
    slim: dict[str, Any] = {}
    for key, value in row.items():
        lk = str(key).lower()
        if key in drop_exact or any(
            s in lk for s in ("cookie", "session", "token", "password", "secret", "auth")
        ):
            continue
        if isinstance(value, (dict, list)) and len(str(value)) > 4000:
            continue
        slim[key] = value
    return slim


def from_adapter_fields(
    *,
    source_post_id: str,
    source_group_url: str | None,
    source_group_name: str | None,
    source_url: str | None,
    author_name: str | None,
    published_at: str | None,
    text: str,
    media: list[MediaItem],
    adapter_name: str,
    raw_row: dict[str, Any],
) -> NormalizedFacebookPost:
    source_url_n = normalize_facebook_url(source_url)
    group_url_n = normalize_facebook_url(source_group_url)
    media_urls = [m.url for m in media]
    fingerprint = build_source_fingerprint(
        source_post_id=source_post_id,
        source_url=source_url_n,
        source_group_url=group_url_n,
        text=text,
        published_at=published_at,
        media_urls=media_urls,
    )
    empty = not (text or "").strip() and not media
    return NormalizedFacebookPost(
        source="facebook",
        source_platform="facebook_group",
        source_group_url=group_url_n,
        source_group_name=source_group_name,
        source_post_id=str(source_post_id),
        source_url=source_url_n,
        source_fingerprint=fingerprint,
        author_name=author_name,
        published_at=published_at,
        collected_at=utc_now_iso(),
        text=(text or "").strip(),
        media=media,
        raw_payload=slim_raw_payload(raw_row),
        adapter_name=adapter_name,
        empty=empty,
    )


def to_logical_post(post: NormalizedFacebookPost) -> dict[str, Any]:
    """Shape compatible with telegram-collector analyzers + dedupe."""
    media = [m.to_dict() for m in post.media]
    image_count = sum(1 for m in post.media if m.type == "image")
    group_id = extract_group_id(None, post.source_group_url) or "unknown"

    return {
        "source": "facebook",
        "source_platform": post.source_platform,
        "internal_post_id": f"fb_{group_id}_{post.source_post_id}",
        "facebook_post_id": post.source_post_id,
        "source_post_id": post.source_post_id,
        "source_fingerprint": post.source_fingerprint,
        "source_chat_id": group_id,
        "chat_title": post.source_group_name,
        "group_url": post.source_group_url,
        "source_group_url": post.source_group_url,
        "primary_message_id": None,
        "message_id": None,
        "source_message_ids": [],
        "merged_text": post.text,
        "text": post.text,
        "merge_reason": "facebook_single",
        "sender_id": None,
        "sender_name": post.author_name,
        "message_date": post.published_at,
        "message_date_start": post.published_at,
        "message_date_end": post.published_at,
        "has_media": bool(post.media),
        "media_type": post.media[0].type if post.media else None,
        "media_count": image_count,
        "source_media": [
            {
                "type": m["type"],
                "url": m["url"],
                "thumbnail_url": m.get("thumbnail_url"),
                "download_status": "external_cdn",
                "ephemeral": True,
            }
            for m in media
        ],
        "source_url": post.source_url,
        "facebook_post_link": post.source_url,
        "adapter_name": post.adapter_name,
        "collected_at": post.collected_at,
        "normalized": post.to_dict(include_raw=False),
        # Local debug only — map_review stores a slim review raw_payload
        "adapter_raw_slim": post.raw_payload,
        "empty": post.empty,
    }


def parse_since(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip()


def published_at_passes_since(published_at: str | None, since: str | None) -> bool:
    if not since:
        return True
    if not published_at:
        return True  # keep undated posts in PoC (filter only when comparable)
    return published_at[: len(since)] >= since[: len(published_at)]
