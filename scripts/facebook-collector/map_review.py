"""Map analyzed Facebook logical posts → import_review_items rows.

Uses existing table columns only. Extra FB identifiers live in raw_payload.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
IMPORT_REVIEW = ROOT / "scripts" / "import-review"
if str(IMPORT_REVIEW) not in sys.path:
    sys.path.insert(0, str(IMPORT_REVIEW))

from common import as_list, first_price  # noqa: E402
from facebook_decision_policy import choose_facebook_title  # noqa: E402
from ready_to_publish_gate import status_after_ready_gate  # noqa: E402

ENTITY_TYPES = {
    "business",
    "private_specialist",
    "marketplace_listing",
    "organization",
    "event",
    "job",
    "real_estate",
}
TARGET_COLLECTIONS = {
    "businesses",
    "private_specialists",
    "services",
    "marketplace",
    "jobs",
    "events",
    "organizations",
    "real_estate",
}


def map_facebook_post(
    post: dict[str, Any], *, review_status: str = "pending"
) -> dict[str, Any]:
    entity = post.get("extracted_entity") or {}
    marketplace = (
        entity.get("marketplace") if isinstance(entity.get("marketplace"), dict) else {}
    )

    entity_type = entity.get("entity_type")
    if entity_type not in ENTITY_TYPES:
        entity_type = None
    target = entity.get("target_collection")
    if target not in TARGET_COLLECTIONS:
        target = None

    price, currency = first_price(entity, marketplace)
    title = choose_facebook_title(post)
    description = entity.get("description") or post.get("merged_text") or post.get("text")
    photos_count = int(post.get("media_count") or marketplace.get("photos_count") or 0)
    posted_at = (
        post.get("message_date_start")
        or post.get("message_date")
        or entity.get("source_date")
    )
    fingerprint = post.get("source_fingerprint")
    if not fingerprint:
        raise ValueError("facebook post missing source_fingerprint")

    tg = as_list(entity.get("telegram"))
    telegram_username = tg[0].lstrip("@") if tg else None

    # Review-queue raw_payload: normalized + classification — not full Apify/session blob.
    raw_payload = {
        "source": "facebook",
        "source_platform": post.get("source_platform") or "facebook_group",
        "source_post_id": post.get("source_post_id") or post.get("facebook_post_id"),
        "source_group_url": post.get("source_group_url") or post.get("group_url"),
        "source_fingerprint": fingerprint,
        "source_url": post.get("source_url"),
        "published_at": posted_at,
        "collected_at": post.get("collected_at"),
        "raw_text": post.get("merged_text") or post.get("text"),
        "normalized_payload": post.get("normalized")
        or {
            "text": post.get("merged_text"),
            "media": post.get("source_media"),
        },
        "classification": post.get("classification"),
        "confidence": post.get("confidence"),
        "decision": post.get("decision"),
        "decision_reason": post.get("decision_reason"),
        "extracted_entity": entity,
        "adapter_name": post.get("adapter_name"),
        "duplicate_status": post.get("duplicate_status"),
        "facebook_policy_applied": bool(post.get("facebook_policy_applied")),
        "facebook_policy_lifted": bool(post.get("facebook_policy_lifted")),
        "analyzer_fallback": bool(post.get("analyzer_fallback")),
        "analyzer": post.get("analyzer"),
        "enrichments": post.get("enrichments") or [],
        # Media CDN URLs are ephemeral — never treat as permanent card photos.
        "media_note": "facebook_cdn_urls_ephemeral_do_not_publish",
    }

    row = {
        "source": "facebook",
        "source_group": post.get("chat_title") or post.get("source_group_name"),
        "source_chat_id": str(post.get("source_chat_id") or "") or None,
        "source_message_ids": [],
        "source_fingerprint": fingerprint,
        "source_author_id": None,
        "source_author_username": None,
        "source_author_display_name": post.get("sender_name") or post.get("author_name"),
        "source_posted_at": posted_at,
        "source_text": post.get("merged_text") or post.get("text"),
        "source_url": post.get("source_url") or post.get("facebook_post_link"),
        "source_media": post.get("source_media") or [],
        "ai_decision": post.get("decision") or post.get("reviewer_action"),
        "ai_confidence": post.get("confidence") or post.get("reviewer_confidence"),
        "ai_reason": post.get("reviewer_reason")
        or post.get("decision_reason")
        or (
            post.get("missing_fields")
            and f"missing:{post.get('missing_fields')}"
        ),
        "entity_type": entity_type,
        "target_collection": target,
        "category": entity.get("category"),
        "subcategory": entity.get("subcategory"),
        "title": title,
        "business_name": entity.get("business_name"),
        "person_name": entity.get("person_name"),
        "description": description,
        "services": as_list(entity.get("services")),
        "price": price,
        "currency": currency,
        "city": entity.get("city") or marketplace.get("city"),
        "state": entity.get("state"),
        "phone": as_list(entity.get("phone")),
        "whatsapp": as_list(entity.get("whatsapp")),
        "telegram_username": telegram_username,
        "telegram_user_id": None,
        "instagram": as_list(entity.get("instagram")),
        "website": as_list(entity.get("website")),
        "email": as_list(entity.get("email")),
        "photos_count": photos_count,
        "duplicate_status": post.get("duplicate_status"),
        "recurring_cluster_id": post.get("duplicate_of_internal_post_id")
        or post.get("internal_post_id"),
        "occurrence_count": post.get("occurrence_count"),
        "first_seen": post.get("first_seen_at"),
        "last_seen": post.get("last_seen_at"),
        "raw_payload": raw_payload,
        "review_status": review_status,
    }
    decision = str(row.get("ai_decision") or "").lower()
    row["review_status"] = status_after_ready_gate(
        row,
        review_status,
        prefer_ready=decision == "accepted",
    )
    return row
