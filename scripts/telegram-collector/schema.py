"""JSON schema and validation for Telegram ad analysis results."""

from __future__ import annotations

from typing import Any

CLASSIFICATIONS = {
    "direct_business_ad",
    "direct_specialist_ad",
    "self_promotion_without_contact",
    "third_party_recommendation",
    "recommendation_request",
    "event_ad",
    "job_post",
    "marketplace_item",
    "real_estate_listing",
    "discussion",
    "irrelevant",
    "unclear",
}

DECISIONS = {"accepted", "needs_review", "rejected"}
ADVERTISER_RELATIONSHIPS = {
    "self",
    "authorized_business_post",
    "third_party_recommendation",
    "unknown",
}
ENTITY_TYPES = {"business", "private_specialist", None}
NAME_SOURCES = {
    "explicit_text",
    "business_brand",
    "instagram",
    "sender_profile",
    "unknown",
}
DUPLICATE_STATUSES = {
    "unique",
    "exact_duplicate",
    "likely_duplicate",
    "recurring_ad",
}

from categories import CATEGORIES


def empty_entity(post: dict[str, Any]) -> dict[str, Any]:
    ids = post.get("source_message_ids") or (
        [post["primary_message_id"]] if post.get("primary_message_id") is not None else []
    )
    return {
        "entity_type": None,
        "business_name": None,
        "person_name": None,
        "category": "other",
        "subcategory": None,
        "description": None,
        "services": [],
        "prices": [],
        "phone": [],
        "email": [],
        "website": [],
        "instagram": [],
        "facebook": [],
        "telegram": [],
        "whatsapp": [],
        "address": None,
        "city": None,
        "state": None,
        "service_area": [],
        "languages": [],
        "booking_url": None,
        "source_message_ids": ids,
        "source_date": post.get("message_date_start") or post.get("message_date"),
        "extracted_name_source": "unknown",
    }


def empty_evidence() -> dict[str, list[str]]:
    return {
        "business_evidence": [],
        "contact_evidence": [],
        "location_evidence": [],
        "service_evidence": [],
    }


def apply_decision_policy(result: dict[str, Any]) -> dict[str, Any]:
    """Enforce hard decision rules after analyzer output."""
    classification = result.get("classification")
    confidence = float(result.get("confidence") or 0)
    relationship = result.get("advertiser_relationship") or "unknown"
    entity = result.get("extracted_entity") or {}

    phones = entity.get("phone") or []
    emails = entity.get("email") or []
    websites = entity.get("website") or []
    instagrams = entity.get("instagram") or []
    telegrams = entity.get("telegram") or []
    whatsapps = entity.get("whatsapp") or []
    has_contact = bool(phones or emails or websites or instagrams or telegrams or whatsapps)
    has_brand = bool(entity.get("business_name") or entity.get("person_name"))

    warnings = list(result.get("warnings") or [])

    # Third-party recommendations never auto-accepted.
    if (
        classification == "third_party_recommendation"
        or relationship == "third_party_recommendation"
    ):
        result["classification"] = "third_party_recommendation"
        result["advertiser_relationship"] = "third_party_recommendation"
        result["decision"] = "needs_review"
        if confidence < 0.55:
            result["confidence"] = 0.6
        warnings.append("third_party_recommendation_forced_needs_review")
        result["warnings"] = warnings
        return result

    # Typed catalog posts → needs_review (never trash). Only noise stays rejected.
    if classification in {
        "job_post",
        "marketplace_item",
        "real_estate_listing",
        "event_ad",
    }:
        result["decision"] = "needs_review"
        return result

    # «Ищу / посоветуйте» — admin lane seeking, not catalog junk.
    if classification == "recommendation_request":
        result["decision"] = "needs_review"
        warnings.append("seeking_request_needs_review")
        result["warnings"] = warnings
        return result

    if classification in {
        "discussion",
        "irrelevant",
    }:
        result["decision"] = "rejected"
        return result

    if classification == "self_promotion_without_contact":
        result["decision"] = "needs_review"
        return result

    if classification in {"direct_business_ad", "direct_specialist_ad"}:
        if (
            relationship in {"self", "authorized_business_post"}
            and (has_contact or has_brand)
            and confidence >= 0.82
        ):
            result["decision"] = "accepted"
            return result
        result["decision"] = "needs_review"
        if confidence >= 0.82 and not (has_contact or has_brand):
            warnings.append("high_confidence_but_missing_contact_or_brand")
        result["warnings"] = warnings
        return result

    # unclear / fallback
    if confidence < 0.55:
        result["decision"] = "rejected"
    else:
        result["decision"] = "needs_review"
    return result


def validate_analysis_result(data: dict[str, Any]) -> dict[str, Any]:
    """Validate and coerce LLM/rule output into a safe AnalysisResult dict."""
    if not isinstance(data, dict):
        raise ValueError("Analysis result must be an object")

    classification = data.get("classification")
    if classification not in CLASSIFICATIONS:
        data = dict(data)
        warnings = list(data.get("warnings") or [])
        entity_fix = data.get("extracted_entity")
        if not isinstance(entity_fix, dict):
            entity_fix = {}
            data["extracted_entity"] = entity_fix

        # Common LLM mistake: putting category into classification.
        if classification in CATEGORIES:
            warnings.append(f"classification_was_category:{classification}")
            if not entity_fix.get("category") or entity_fix.get("category") == "other":
                entity_fix["category"] = classification
            relationship_hint = data.get("advertiser_relationship") or "unknown"
            entity_type = entity_fix.get("entity_type")
            if relationship_hint == "third_party_recommendation":
                classification = "third_party_recommendation"
            elif relationship_hint in {"self", "authorized_business_post"}:
                if entity_type == "business" or relationship_hint == "authorized_business_post":
                    classification = "direct_business_ad"
                else:
                    classification = "direct_specialist_ad"
            else:
                # Has service category evidence but unclear advertiser role.
                classification = "unclear"
        else:
            warnings.append(f"invalid_classification_coerced:{classification}")
            classification = "unclear"

        data["warnings"] = warnings
        data["classification"] = classification

    decision = data.get("decision")
    if decision not in DECISIONS:
        data = dict(data)
        data["decision"] = "needs_review"
        decision = "needs_review"
    relationship = data.get("advertiser_relationship", "unknown")
    if relationship not in ADVERTISER_RELATIONSHIPS:
        relationship = "unknown"

    try:
        confidence = float(data.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))

    entity_in = data.get("extracted_entity") or {}
    if not isinstance(entity_in, dict):
        raise ValueError("extracted_entity must be an object")

    def as_str_list(value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value.strip() else []
        if isinstance(value, list):
            out: list[str] = []
            for item in value:
                if item is None:
                    continue
                s = str(item).strip()
                if s:
                    out.append(s)
            return out
        return [str(value)]

    category = entity_in.get("category") or "other"
    if category not in CATEGORIES:
        category = "other"

    name_source = entity_in.get("extracted_name_source") or "unknown"
    if name_source not in NAME_SOURCES:
        name_source = "unknown"

    entity_type = entity_in.get("entity_type")
    if entity_type not in ENTITY_TYPES:
        entity_type = None

    entity = {
        "entity_type": entity_type,
        "business_name": entity_in.get("business_name"),
        "person_name": entity_in.get("person_name"),
        "category": category,
        "subcategory": entity_in.get("subcategory"),
        "description": entity_in.get("description"),
        "services": as_str_list(entity_in.get("services")),
        "prices": as_str_list(entity_in.get("prices")),
        "phone": as_str_list(entity_in.get("phone")),
        "email": as_str_list(entity_in.get("email")),
        "website": as_str_list(entity_in.get("website")),
        "instagram": as_str_list(entity_in.get("instagram")),
        "facebook": as_str_list(entity_in.get("facebook")),
        "telegram": as_str_list(entity_in.get("telegram")),
        "whatsapp": as_str_list(entity_in.get("whatsapp")),
        "address": entity_in.get("address"),
        "city": entity_in.get("city"),
        "state": entity_in.get("state"),
        "service_area": as_str_list(entity_in.get("service_area")),
        "languages": as_str_list(entity_in.get("languages")),
        "booking_url": entity_in.get("booking_url"),
        "source_message_ids": [],
        "source_date": entity_in.get("source_date"),
        "extracted_name_source": name_source,
    }

    # Coerce nullable strings
    for key in (
        "business_name",
        "person_name",
        "subcategory",
        "description",
        "address",
        "city",
        "state",
        "booking_url",
        "source_date",
    ):
        val = entity.get(key)
        if val is not None:
            entity[key] = str(val).strip() or None

    source_ids = entity_in.get("source_message_ids")
    if isinstance(source_ids, list):
        entity["source_message_ids"] = [
            int(x) if str(x).lstrip("-").isdigit() else x for x in source_ids
        ]
    else:
        entity["source_message_ids"] = []

    evidence_in = data.get("evidence") or {}
    evidence = empty_evidence()
    if isinstance(evidence_in, dict):
        for key in evidence:
            evidence[key] = as_str_list(evidence_in.get(key))

    result = {
        "classification": classification,
        "decision": decision,
        "confidence": confidence,
        "decision_reason": str(data.get("decision_reason") or "").strip(),
        "advertiser_relationship": relationship,
        "extracted_entity": entity,
        "evidence": evidence,
        "missing_fields": as_str_list(data.get("missing_fields")),
        "warnings": as_str_list(data.get("warnings")),
    }
    return apply_decision_policy(result)
