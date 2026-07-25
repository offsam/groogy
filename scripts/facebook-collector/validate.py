"""PoC validation + statistics for Facebook collector runs."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse


CDN_HINTS = (
    "fbcdn.net",
    "scontent.",
    "facebook.com/photo",
    "lookaside.fbsbx.com",
    "external.",
)


def is_likely_ephemeral_cdn(url: str | None) -> bool:
    if not url:
        return False
    host = urlparse(url).netloc.lower()
    path = urlparse(url).path.lower()
    blob = f"{host}{path}"
    return any(h in host or h in blob for h in CDN_HINTS)


def analyze_media_urls(rows: list[dict[str, Any]]) -> dict[str, Any]:
    urls: list[str] = []
    for row in rows:
        for m in row.get("source_media") or row.get("media") or []:
            if isinstance(m, dict) and m.get("url"):
                urls.append(str(m["url"]))
            elif isinstance(m, str):
                urls.append(m)
    ephemeral = sum(1 for u in urls if is_likely_ephemeral_cdn(u))
    hosts: dict[str, int] = {}
    for u in urls:
        host = urlparse(u).netloc.lower() or "unknown"
        hosts[host] = hosts.get(host, 0) + 1
    return {
        "media_url_count": len(urls),
        "likely_ephemeral_cdn_count": ephemeral,
        "hosts": dict(sorted(hosts.items(), key=lambda kv: (-kv[1], kv[0]))[:20]),
        "notes": [
            "Facebook/CDN image URLs are typically signed or session-bound and expire.",
            "Do not publish these URLs as permanent business card photos.",
            "Server download may require cookies/session for private groups; PoC does not download.",
            "Future step: fetch bytes with authenticated session → Supabase Storage.",
        ],
    }


def build_stats(
    *,
    raw_count: int,
    skipped_adapter: int,
    normalized: list[dict[str, Any]],
    empty_count: int,
    fingerprint_dupes_dropped: int,
    analyzed: list[dict[str, Any]],
    review_rows: list[dict[str, Any]],
    insert_attempted: int = 0,
    insert_skipped_existing: int = 0,
    inserted: int = 0,
) -> dict[str, Any]:
    decisions: dict[str, int] = {}
    with_phone = with_ig = with_web = with_photos = 0
    accepted = rejected = needs_review = 0

    for row in review_rows:
        d = str(row.get("ai_decision") or "none")
        decisions[d] = decisions.get(d, 0) + 1
        if d == "accepted":
            accepted += 1
        elif d == "rejected":
            rejected += 1
        elif d == "needs_review":
            needs_review += 1
        if row.get("phone"):
            with_phone += 1
        if row.get("instagram"):
            with_ig += 1
        if row.get("website"):
            with_web += 1
        if int(row.get("photos_count") or 0) > 0 or (
            isinstance(row.get("source_media"), list) and len(row["source_media"]) > 0
        ):
            with_photos += 1

    entity_dupes = sum(
        1
        for p in analyzed
        if (p.get("duplicate_status") or "unique") != "unique"
    )

    return {
        "apify_or_input_rows": raw_count,
        "skipped_by_adapter": skipped_adapter,
        "normalized": len(normalized),
        "empty": empty_count,
        "fingerprint_duplicates_dropped": fingerprint_dupes_dropped,
        "analyzed": len(analyzed),
        "entity_level_duplicates": entity_dupes,
        "analyzer_accepted": accepted,
        "analyzer_needs_review": needs_review,
        "analyzer_rejected": rejected,
        "sent_to_review_rows": len(review_rows),
        "with_phone": with_phone,
        "with_instagram": with_ig,
        "with_website": with_web,
        "with_photos": with_photos,
        "decisions": decisions,
        "apply": {
            "attempted": insert_attempted,
            "inserted": inserted,
            "skipped_existing_fingerprint": insert_skipped_existing,
        },
        "media": analyze_media_urls(review_rows or analyzed or normalized),
    }


def example_normalized_redacted(post: dict[str, Any] | None) -> dict[str, Any] | None:
    """One sample post for the report — strip author and contact-looking text snippets."""
    if not post:
        return None
    text = (post.get("text") or post.get("merged_text") or "")[:180]
    return {
        "source": post.get("source", "facebook"),
        "source_platform": post.get("source_platform", "facebook_group"),
        "source_group_url": post.get("source_group_url") or post.get("group_url"),
        "source_group_name": post.get("source_group_name") or post.get("chat_title"),
        "source_post_id": post.get("source_post_id") or post.get("facebook_post_id"),
        "source_url": post.get("source_url"),
        "source_fingerprint": post.get("source_fingerprint"),
        "author_name": "[redacted]",
        "published_at": post.get("published_at") or post.get("message_date"),
        "text_preview": text + ("…" if len(text) == 180 else ""),
        "media_count": len(post.get("media") or post.get("source_media") or []),
    }
