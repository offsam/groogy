"""Source fingerprint helpers for Facebook ingest.

Incremental sync is owned by КРУГИ (not by any Apify Actor flag):
unique index on import_review_items.source_fingerprint.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import parse_qs, urlparse, urlunparse


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
    # Drop tracking params; keep path + multi_permalinks / story ids when present.
    qs = parse_qs(parsed.query)
    keep: dict[str, list[str]] = {}
    for key in ("multi_permalinks", "story_fbid", "id"):
        if key in qs:
            keep[key] = qs[key]
    query = "&".join(f"{k}={v[0]}" for k, vals in keep.items() for v in [vals] if vals)
    clean = urlunparse(
        (
            "https",
            parsed.netloc.lower().removeprefix("www.") or "facebook.com",
            parsed.path.rstrip("/") or "",
            "",
            query,
            "",
        )
    )
    return clean


_POST_ID_RE = re.compile(
    r"(?:posts/|permalink/|multi_permalinks=|story_fbid=)(\d{5,})",
    re.I,
)


def extract_post_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = _POST_ID_RE.search(url)
    return m.group(1) if m else None


def extract_group_id(group_id: str | None, group_url: str | None) -> str:
    if group_id and str(group_id).strip():
        return str(group_id).strip()
    if group_url:
        m = re.search(r"groups/([^/?#]+)", group_url)
        if m:
            return m.group(1)
    return "unknown"


def facebook_source_fingerprint(
    *,
    group_id: str,
    facebook_post_id: str | None = None,
    source_url: str | None = None,
    published_at: str | None = None,
    text: str | None = None,
) -> str:
    """Prefer stable post id; fall back to URL; last resort content hash."""
    gid = extract_group_id(group_id, None)
    post_id = (facebook_post_id or "").strip() or extract_post_id_from_url(source_url)
    if post_id:
        return f"facebook:{gid}:{post_id}"
    url = normalize_facebook_url(source_url)
    if url:
        return f"facebook:{gid}:url:{hashlib.sha1(url.encode('utf-8')).hexdigest()[:16]}"
    blob = f"{published_at or ''}|{(text or '').strip()[:400]}"
    digest = hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]
    return f"facebook:{gid}:content:{digest}"


def attachment_dicts(attachments: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in attachments or []:
        if isinstance(item, dict):
            kind = str(item.get("kind") or item.get("type") or "unknown")
            url = item.get("url")
        else:
            kind = getattr(item, "kind", "unknown")
            url = getattr(item, "url", None)
        if url or kind != "unknown":
            out.append({"kind": kind, "url": url})
    return out
