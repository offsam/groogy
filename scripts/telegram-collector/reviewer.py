"""AI Reviewer v1 — second pass over needs_review only.

Does not re-extract facts from Telegram. Does not call Analyzer.
Returns: promote_to_accepted | keep_review | reject (+ optional light corrections).
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import SCRIPT_DIR, load_env
from contacts import (
    extract_emails,
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
    extract_whatsapp,
)
from cost import CostTracker, load_max_cost_usd
from llm_client import LLMClient
from names import extract_names, GREETING_BLOCKLIST, BANNED_NAME_EXACT

DATA_DIR = SCRIPT_DIR / "data"
FULL_DIR = DATA_DIR / "full"
REVIEWER_VERSION = "reviewer_v1"

ACTIONS = {"promote_to_accepted", "keep_review", "reject"}

TARGET_COLLECTIONS = {
    "businesses",
    "private_specialists",
    "services",
    "marketplace",
    "jobs",
    "events",
    "organizations",
    "real_estate",
    "lechu",
    "transfers",
}

ENTITY_TYPES = {
    "business",
    "private_specialist",
    "marketplace_listing",
    "organization",
    "event",
    "job",
    "real_estate",
    "lechu_listing",
    "transfer_listing",
}

CATEGORY_OVERRIDES = {
    # brand/name hints -> category
    "vanilla street bakery": "food",
    "pastry": "food",
    "bakery": "food",
    "cafe": "food",
    "кафе": "food",
}

BAD_NAME_EXTRA = {
    "whatsapp",
    "instagram",
    "telegram",
    "контакт",
    "передзамовлення",
    "предзаказ",
    "вылет",
    "преподаватель",
    "косметолог",
    "таргетолог",
    "м². клиника",
}


REVIEWER_SYSTEM = """You are a Reviewer for a local Russian-speaking services marketplace in the USA.
You do NOT re-extract facts from scratch. You review an already-analyzed Telegram post.

Return ONLY valid JSON:
{
  "action": "promote_to_accepted" | "keep_review" | "reject",
  "reason": "short reason",
  "entity_type": one of [business, private_specialist, marketplace_listing, organization, event, job, real_estate, lechu_listing, transfer_listing] or null,
  "target_collection": one of [businesses, private_specialists, services, marketplace, jobs, events, organizations, real_estate, lechu, transfers] or null,
  "category": controlled category or null (only if clearly wrong and you can fix),
  "confidence": 0..1
}

Promote to accepted when the author clearly advertises their OWN business/service/product/specialist
AND there is at least one contact among: phone, Instagram, WhatsApp, Telegram username, Telegram user_id, website, email.
Phone is NOT required.

Keep review for third-party recommendations, ambiguous ownership, weak ads, duplicates needing human check.

Reject only clear non-inventory noise: pure questions asking for recommendations, pure discussion, politics, empty spam.
Do NOT reject marketplace sales of goods (car, furniture, electronics, clothes, kids items, pets, tools, realty as a listing).
Those should be marketplace_listing / real_estate with action promote_to_accepted or keep_review, never reject if a sell intent + contact exists.

Travel-carry ads ("Лечу", take packages/documents on a flight) → lechu_listing / lechu.
Money transfer / remittance / currency exchange offers → transfer_listing / transfers.

Never invent names, phones, cities, or services.
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    s = str(value).strip()
    return [s] if s else []


def clean_name(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip(" .,:;!-—–|")
    text = re.sub(r"[\U0001F300-\U0001FAFF]", "", text).strip()
    if not text:
        return None
    lower = text.lower()
    if lower in BANNED_NAME_EXACT or lower in BAD_NAME_EXTRA:
        return None
    if GREETING_BLOCKLIST.match(text):
        return None
    if len(text) < 2 or len(text) > 60:
        return None
    if len(text.split()) > 6:
        return None
    if text.endswith(("!", "?", ".")) and len(text.split()) > 3:
        return None
    return text


def has_any_contact(entity: dict[str, Any], post: dict[str, Any]) -> bool:
    if any(as_list(entity.get(k)) for k in ("phone", "whatsapp", "instagram", "telegram", "website", "email")):
        return True
    if entity.get("telegram_user_id") or post.get("sender_id"):
        return True
    if entity.get("telegram_username"):
        return True
    return False


def attach_telegram_contact(entity: dict[str, Any], post: dict[str, Any]) -> dict[str, Any]:
    entity = dict(entity)
    sender_id = post.get("sender_id")
    sender_name = clean_name(post.get("sender_name"))
    tgs = as_list(entity.get("telegram"))
    if tgs and not entity.get("telegram_username"):
        entity["telegram_username"] = tgs[0].lstrip("@")
    if sender_id is not None:
        entity["telegram_user_id"] = sender_id
    if sender_name and not entity.get("telegram_display_name"):
        entity["telegram_display_name"] = sender_name
    # keep telegram array for compatibility
    if entity.get("telegram_username"):
        handle = entity["telegram_username"]
        if handle not in tgs and f"@{handle}" not in tgs:
            entity["telegram"] = [handle] + tgs
    return entity


def infer_target_collection(entity_type: str | None, category: str | None, classification: str | None) -> str:
    if entity_type == "marketplace_listing":
        return "marketplace"
    if entity_type == "real_estate" or classification == "real_estate_listing":
        return "real_estate"
    if entity_type == "job" or classification == "job_post":
        return "jobs"
    if entity_type == "event" or classification == "event_ad":
        return "events"
    if entity_type == "organization":
        return "organizations"
    if entity_type == "business":
        return "businesses"
    if entity_type == "private_specialist":
        return "private_specialists"
    if entity_type == "lechu_listing" or classification == "lechu":
        return "lechu"
    if entity_type == "transfer_listing" or classification == "transfer":
        return "transfers"
    if category in {"food", "beauty", "auto_services", "car_rental"} and entity_type == "business":
        return "businesses"
    return "services"


LECHU_RE = re.compile(
    r"(?:^|\n|#)\s*лечу\b|#лечу\b|летим\b|летит\b|"
    r"возьму\s+(?:посыл|документ|чемодан|вещи)|"
    r"заберу\s+и\s+привезу|"
    r"передам\s+(?:посыл|документ)|"
    r"flying\s+to|take\s+packages?\b",
    re.I,
)
TRANSFER_RE = re.compile(
    r"(?:денежн\w*\s+)?перевод(?:ы|ов)?\s+(?:в|из|на)\s+(?:росси|сша|украин|европ|карт)|"
    r"money\s+transfer|wire\s+transfer|remittance|swift\b|"
    r"крипто\s*(?:в|→|->|to)\s*фиат|фиат\s*(?:в|→|->|to)\s*крипто|"
    r"обмен\s+валют|меняю\s+(?:руб|доллар|\$)|"
    r"куплю\s+руб|продам\s+руб|куплю\s+доллар|продам\s+доллар|"
    r"рубл\w*\s+на\s+(?:карт|доллар)|доллар\w*\s+на\s+руб|"
    r"переведу\s+(?:деньги|доллар|руб)|"
    r"оплачу\s+(?:вашу|ваш[уые]?).{0,40}рубл|"
    r"комисси[яи]\s*\d+\s*%\s*(?:за\s+)?перевод",
    re.I,
)
TRANSLATOR_NOISE_RE = re.compile(
    r"переводчик|certified\s+translation|апостил|document\s+preparation|"
    r"преподаватель|язык(?:а|ов)?\b",
    re.I,
)


def detect_lechu_or_transfer(text: str) -> str | None:
    blob = text or ""
    if LECHU_RE.search(blob):
        return "lechu_listing"
    if TRANSFER_RE.search(blob) and not TRANSLATOR_NOISE_RE.search(blob):
        return "transfer_listing"
    return None


def infer_entity_type(post: dict[str, Any], entity: dict[str, Any]) -> str:
    text = post.get("merged_text") or entity.get("description") or ""
    travel = detect_lechu_or_transfer(text)
    if travel:
        return travel
    classification = post.get("classification")
    if classification == "marketplace_item":
        return "marketplace_listing"
    if classification == "real_estate_listing":
        return "real_estate"
    if classification == "job_post":
        return "job"
    if classification == "event_ad":
        return "event"
    if classification == "direct_business_ad":
        return "business"
    if classification in {"direct_specialist_ad", "self_promotion_without_contact"}:
        return "private_specialist"
    if entity.get("business_name") and not entity.get("person_name"):
        return "business"
    if entity.get("person_name"):
        return "private_specialist"
    return "private_specialist"


def fix_category(entity: dict[str, Any], text: str) -> str:
    cat = entity.get("category") or "other"
    blob = " ".join(
        [
            str(entity.get("business_name") or ""),
            str(entity.get("person_name") or ""),
            " ".join(as_list(entity.get("instagram"))),
            text[:200],
        ]
    ).lower()
    for needle, fixed in CATEGORY_OVERRIDES.items():
        if needle in blob:
            return fixed
    # bakery/food false education
    if cat == "education" and re.search(r"bakery|выпечк|торт|десерт|кафе|cafe|ресторан", blob, re.I):
        return "food"
    if cat == "auto" or cat == "auto_services":
        if re.search(r"ищу\s+квартир|сда[её]тся", text, re.I):
            return "other"
    return cat if cat else "other"


def extract_marketplace_fields(post: dict[str, Any], entity: dict[str, Any]) -> dict[str, Any]:
    text = post.get("merged_text") or ""
    prices = as_list(entity.get("prices"))
    if not prices:
        found = re.findall(r"\$\s?\d+(?:[.,]\d+)?", text)
        prices = list(dict.fromkeys(found))
    title = clean_name(entity.get("business_name")) or clean_name(entity.get("person_name"))
    if not title:
        first = (text.strip().split("\n")[0] if text.strip() else "")[:80]
        title = clean_name(first) or first.strip()[:80] or None
    return {
        "title": title,
        "description": (entity.get("description") or text[:400] or None),
        "price": prices[0] if prices else None,
        "currency": "USD" if prices and "$" in prices[0] else None,
        "seller_name": clean_name(entity.get("person_name")) or clean_name(post.get("sender_name")),
        "telegram_user_id": entity.get("telegram_user_id") or post.get("sender_id"),
        "telegram_username": entity.get("telegram_username"),
        "phone": as_list(entity.get("phone")),
        "instagram": as_list(entity.get("instagram")),
        "city": entity.get("city"),
        "photos_count": int(post.get("media_count") or 0),
        "condition": None,
        "category": entity.get("category") or "other",
        "source_message_ids": post.get("source_message_ids") or [],
    }


def normalize_entity(post: dict[str, Any]) -> dict[str, Any]:
    entity = dict(post.get("extracted_entity") or {})
    text = post.get("merged_text") or ""

    # refresh contacts from text (deterministic, no invention beyond regex)
    phones = extract_phones(text) or as_list(entity.get("phone"))
    igs = extract_instagram(text) or as_list(entity.get("instagram"))
    webs = extract_websites(text) or as_list(entity.get("website"))
    emails = extract_emails(text) or as_list(entity.get("email"))
    tgs = extract_telegram(text) or as_list(entity.get("telegram"))
    was = extract_whatsapp(text) or as_list(entity.get("whatsapp"))
    entity["phone"] = phones
    entity["instagram"] = igs
    entity["website"] = webs
    entity["email"] = emails
    entity["telegram"] = tgs
    entity["whatsapp"] = was

    entity = attach_telegram_contact(entity, post)

    names = extract_names(text, post.get("sender_name"))
    person = clean_name(entity.get("person_name")) or clean_name(names.get("person_name"))
    business = clean_name(entity.get("business_name")) or clean_name(names.get("business_name"))
    # don't use sender as business brand
    if names.get("extracted_name_source") == "sender_profile":
        if not person:
            person = None
    entity["person_name"] = person
    entity["business_name"] = business
    if names.get("extracted_name_source") in {"explicit_text", "business_brand", "instagram"}:
        entity["extracted_name_source"] = names["extracted_name_source"]
    elif not entity.get("extracted_name_source"):
        entity["extracted_name_source"] = "unknown"

    entity["category"] = fix_category(entity, text)
    et = entity.get("entity_type")
    if et not in ENTITY_TYPES:
        et = infer_entity_type(post, entity)
    entity["entity_type"] = et
    return entity


def reviewer_payload(post: dict[str, Any]) -> str:
    entity = post.get("extracted_entity") or {}
    return json.dumps(
        {
            "merged_text": (post.get("merged_text") or "")[:3500],
            "classification": post.get("classification"),
            "decision": post.get("decision"),
            "confidence": post.get("confidence"),
            "advertiser_relationship": post.get("advertiser_relationship"),
            "duplicate_status": post.get("duplicate_status"),
            "duplicate_reason": post.get("duplicate_reason"),
            "occurrence_count": post.get("occurrence_count"),
            "warnings": post.get("warnings") or [],
            "evidence": post.get("evidence") or {},
            "source_message_ids": post.get("source_message_ids"),
            "sender_id": post.get("sender_id"),
            "sender_name": post.get("sender_name"),
            "extracted_entity": {
                "entity_type": entity.get("entity_type"),
                "business_name": entity.get("business_name"),
                "person_name": entity.get("person_name"),
                "category": entity.get("category"),
                "phone": entity.get("phone"),
                "instagram": entity.get("instagram"),
                "telegram": entity.get("telegram"),
                "telegram_user_id": entity.get("telegram_user_id"),
                "telegram_username": entity.get("telegram_username"),
                "whatsapp": entity.get("whatsapp"),
                "website": entity.get("website"),
                "email": entity.get("email"),
                "city": entity.get("city"),
                "services": entity.get("services"),
                "prices": entity.get("prices"),
            },
            "policy": {
                "phone_not_required": True,
                "any_contact_ok": True,
                "telegram_user_id_is_contact": True,
                "marketplace_not_reject": True,
                "third_party_never_promote": True,
            },
        },
        ensure_ascii=False,
    )


def apply_reviewer_decision(post: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    out = dict(post)
    entity = normalize_entity(out)
    action = review.get("action")
    if action not in ACTIONS:
        action = "keep_review"

    # Hard policy overrides
    if out.get("advertiser_relationship") == "third_party_recommendation" or out.get("classification") == "third_party_recommendation":
        if action == "promote_to_accepted":
            action = "keep_review"
            review["reason"] = (review.get("reason") or "") + " | third_party_blocked_from_accepted"

    if review.get("entity_type") in ENTITY_TYPES:
        entity["entity_type"] = review["entity_type"]
    if review.get("category"):
        entity["category"] = review["category"]
        entity["category"] = fix_category(entity, out.get("merged_text") or "")

    # Marketplace / realty promotions from reviewer or classification
    if entity["entity_type"] in {"marketplace_listing", "real_estate"} or out.get("classification") in {
        "marketplace_item",
        "real_estate_listing",
    }:
        if entity["entity_type"] not in {"marketplace_listing", "real_estate"}:
            entity["entity_type"] = (
                "real_estate" if out.get("classification") == "real_estate_listing" else "marketplace_listing"
            )
        entity["marketplace"] = extract_marketplace_fields(out, entity)
        if action == "reject" and has_any_contact(entity, out):
            action = "promote_to_accepted"
            review["reason"] = (review.get("reason") or "") + " | marketplace_forced_out_of_reject"

    target = review.get("target_collection")
    if target not in TARGET_COLLECTIONS:
        target = infer_target_collection(entity.get("entity_type"), entity.get("category"), out.get("classification"))
    entity["target_collection"] = target

    # Contact gate for promote
    if action == "promote_to_accepted" and not has_any_contact(entity, out):
        action = "keep_review"
        review["reason"] = (review.get("reason") or "") + " | missing_contact"

    if action == "promote_to_accepted":
        out["decision"] = "accepted"
        out["review_status"] = "ready_for_review"
    elif action == "reject":
        out["decision"] = "rejected"
        out["review_status"] = "rejected"
    else:
        out["decision"] = "needs_review"
        out["review_status"] = "pending_manual_review"

    out["reviewer_action"] = action
    out["reviewer_reason"] = review.get("reason")
    out["reviewer_confidence"] = review.get("confidence")
    out["reviewer_version"] = REVIEWER_VERSION
    out["reviewed_at"] = utc_now()
    if isinstance(review.get("confidence"), (int, float)):
        # keep original analyzer confidence; store reviewer separately
        pass
    out["extracted_entity"] = entity
    out["saved_via_telegram_user_id"] = bool(
        not any(as_list(entity.get(k)) for k in ("phone", "whatsapp", "instagram", "website", "email", "telegram"))
        and entity.get("telegram_user_id")
        and action == "promote_to_accepted"
    )
    return out


def review_one_llm(client: LLMClient, post: dict[str, Any]) -> dict[str, Any]:
    base = dict(post)
    base["extracted_entity"] = normalize_entity(base)
    try:
        from llm_client import _parse_json_object

        content, _usage = client._request_with_retries(REVIEWER_SYSTEM, reviewer_payload(base))
        data = _parse_json_object(content)
    except Exception as exc:  # noqa: BLE001
        data = {
            "action": "keep_review",
            "reason": f"reviewer_llm_error:{type(exc).__name__}",
            "confidence": 0.4,
        }
    if not isinstance(data, dict):
        data = {"action": "keep_review", "reason": "invalid_reviewer_json", "confidence": 0.4}
    return apply_reviewer_decision(base, data)
