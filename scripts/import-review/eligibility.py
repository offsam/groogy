"""Eligibility rules for controlled autopublish of strong accepted cards."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from common import (
    AGE_SENSITIVE_COLLECTIONS,
    BAD_TITLE_RE,
    CITY_REQUIRED_WITHOUT_CONTACT,
    EMAIL_RE,
    HIGH_CONFIDENCE_MIN,
    IG_USER_RE,
    JOB_EVENT_MAX_AGE_DAYS,
    MARKETPLACE_MAX_AGE_DAYS,
    PHONE_RE,
    RENTAL_MAX_AGE_DAYS,
    REQUEST_RE,
    SUPPORTED_AUTOPUBLISH_COLLECTIONS,
    TG_USER_RE,
    URL_RE,
)


def normalize_phone(raw: str) -> str | None:
    digits = re_sub_digits(raw)
    if not digits:
        return None
    if len(digits) == 10:
        digits = "1" + digits
    if len(digits) < 10 or len(digits) > 15:
        return None
    # NANP (+1): NXX NXX XXXX — area/exchange cannot start with 0 or 1
    if digits.startswith("1") and len(digits) == 11:
        if digits[1] in "01" or digits[4] in "01":
            return None
    compact = "+" + digits
    if not PHONE_RE.match(compact):
        return None
    return compact


def re_sub_digits(raw: str) -> str:
    return "".join(ch for ch in raw if ch.isdigit())


def normalize_email(raw: str) -> str | None:
    value = raw.strip().lower()
    return value if EMAIL_RE.match(value) else None


def normalize_telegram_username(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip().lstrip("@")
    if not TG_USER_RE.match(value):
        return None
    return value


def normalize_instagram(raw: str) -> str | None:
    value = raw.strip()
    if not value:
        return None
    lower = value.lower()
    if "instagram.com/" in lower:
        value = value.split("instagram.com/")[-1].split("?")[0].strip("/")
        # path may be /username or /p/... — only bare profile handles
        if "/" in value or value.lower() in {"p", "reel", "stories", "explore"}:
            return None
    value = value.lstrip("@").strip()
    if not value or "@" in value:
        return None
    if value.lower() in {"gmail.com", "yahoo.com", "mail.com", "whatsapp", "whatsapp:"}:
        return None
    # reject bare domains mistaken as handles (e.g. example.com)
    if value.count(".") >= 1 and value.lower().endswith(
        (".com", ".net", ".org", ".ru", ".io", ".co")
    ):
        return None
    if not IG_USER_RE.match(value):
        return None
    return value


def normalize_website(raw: str) -> str | None:
    value = raw.strip()
    if value.lower() in {"whatsapp", "whatsapp:", "gmail.com"}:
        return None
    if not URL_RE.match(value) and not value.lower().startswith("http"):
        # try as domain
        if not URL_RE.match(value):
            return None
    href = value if value.lower().startswith("http") else f"https://{value}"
    try:
        parsed = urlparse(href)
    except Exception:  # noqa: BLE001
        return None
    host = (parsed.hostname or "").lower()
    if not host or "." not in host:
        return None
    if host in {"instagram.com", "www.instagram.com", "t.me", "wa.me"}:
        # social-only links are handled by other fields; still valid website? allow
        pass
    return href


def normalize_whatsapp(raw: str) -> str | None:
    if raw.strip().lower() in {"whatsapp", "whatsapp:", "whatsapp,"}:
        return None
    return normalize_phone(raw)


def extract_direct_contacts(row: dict[str, Any]) -> dict[str, list[str] | str | None]:
    phones = []
    for p in row.get("phone") or []:
        n = normalize_phone(str(p))
        if n and n not in phones:
            phones.append(n)
    whatsapp = []
    for w in row.get("whatsapp") or []:
        n = normalize_whatsapp(str(w))
        if n and n not in whatsapp:
            whatsapp.append(n)
    instagram = []
    for ig in row.get("instagram") or []:
        n = normalize_instagram(str(ig))
        if n and n not in instagram:
            instagram.append(n)
    websites = []
    for w in row.get("website") or []:
        n = normalize_website(str(w))
        if n and n not in websites:
            websites.append(n)
    emails = []
    for e in row.get("email") or []:
        n = normalize_email(str(e))
        if n and n not in emails:
            emails.append(n)
    tg = normalize_telegram_username(row.get("telegram_username"))
    return {
        "phone": phones,
        "whatsapp": whatsapp,
        "instagram": instagram,
        "website": websites,
        "email": emails,
        "telegram_username": tg,
    }


def has_direct_contact(contacts: dict[str, Any]) -> bool:
    return bool(
        contacts.get("phone")
        or contacts.get("whatsapp")
        or contacts.get("instagram")
        or contacts.get("website")
        or contacts.get("email")
        or contacts.get("telegram_username")
    )


def contact_priority_rank(contacts: dict[str, Any]) -> tuple[int, int, float, int, str]:
    """Lower tuple = higher publish priority."""
    has_phone = bool(contacts.get("phone"))
    extras = sum(
        1
        for k in ("whatsapp", "instagram", "website", "email", "telegram_username")
        if contacts.get(k)
    )
    if has_phone and extras:
        bucket = 0
    elif has_phone:
        bucket = 1
    elif contacts.get("whatsapp"):
        bucket = 2
    elif contacts.get("instagram"):
        bucket = 3
    elif contacts.get("website"):
        bucket = 4
    elif contacts.get("email"):
        bucket = 5
    elif contacts.get("telegram_username"):
        bucket = 6
    else:
        bucket = 9
    return (bucket, -extras, 0.0, 0, "")


def days_since(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0, int((datetime.now(timezone.utc) - dt).total_seconds() // 86400))


def title_ok(title: str | None) -> bool:
    if not title or not str(title).strip():
        return False
    t = str(title).strip()
    if len(t) < 2:
        return False
    if BAD_TITLE_RE.match(t):
        return False
    # emoji-only / symbol-only
    alnum = sum(1 for c in t if c.isalnum())
    if alnum < 2:
        return False
    return True


def description_ok(description: str | None) -> bool:
    if not description or not str(description).strip():
        return False
    text = str(description).strip()
    return len(text) >= 20


def completeness_score(row: dict[str, Any], contacts: dict[str, Any]) -> int:
    score = 0
    for key in ("title", "description", "city", "category"):
        if row.get(key):
            score += 1
    if row.get("price") is not None:
        score += 1
    if int(row.get("photos_count") or 0) > 0:
        score += 1
    if has_direct_contact(contacts):
        score += 1
    return score


def evaluate_eligibility(
    row: dict[str, Any],
    *,
    known_business_phones: set[str] | None = None,
) -> dict[str, Any]:
    """Return {eligible, reasons[], contacts, publish_rank}."""
    reasons: list[str] = []
    raw = row.get("_raw_post") or row.get("raw_payload") or {}
    contacts = extract_direct_contacts(row)

    decision = (row.get("ai_decision") or raw.get("decision") or "").lower()
    if decision != "accepted":
        reasons.append("не accepted")

    conf = float(row.get("ai_confidence") or 0)
    if conf < HIGH_CONFIDENCE_MIN:
        reasons.append(f"низкая confidence ({conf:.2f} < {HIGH_CONFIDENCE_MIN})")

    entity_type = row.get("entity_type")
    target = row.get("target_collection")
    if not entity_type or not target:
        reasons.append("неопределённый тип")
    elif target == "events" or entity_type == "event":
        reasons.append("неподдерживаемый тип: events")
    elif target == "jobs" or entity_type == "job":
        reasons.append("неподдерживаемый тип: jobs")
    elif target not in SUPPORTED_AUTOPUBLISH_COLLECTIONS:
        reasons.append(f"неподдерживаемый тип: {target}")

    if not title_ok(row.get("title") or row.get("business_name") or row.get("person_name")):
        reasons.append("нет title")
    if not description_ok(row.get("description")):
        reasons.append("нет description")
    if not row.get("category") or str(row.get("category")).strip().lower() in {"", "null"}:
        reasons.append("нет category")

    dup = (row.get("duplicate_status") or "unique").lower()
    if dup in {"exact_duplicate", "likely_duplicate", "recurring_ad"}:
        reasons.append("возможный дубликат")

    if not has_direct_contact(contacts):
        reasons.append("нет контакта")
    else:
        # Invalid-only fields: raw present but nothing normalized
        raw_ig = bool(row.get("instagram"))
        if raw_ig and not contacts["instagram"] and not has_direct_contact(
            {**contacts, "instagram": []}
        ):
            reasons.append("некорректный Instagram/URL")

    # City is optional when a direct contact exists (phone / IG / site / TG / email / WA).
    if (
        target in CITY_REQUIRED_WITHOUT_CONTACT
        and not (row.get("city") or "").strip()
        and not has_direct_contact(contacts)
    ):
        reasons.append("нет города")

    # classification / offer vs request
    classification = (raw.get("classification") or "").lower()
    relationship = (raw.get("advertiser_relationship") or "").lower()
    if "third_party" in classification or relationship == "third_party_recommendation":
        reasons.append("конфликтующая классификация / рекомендация")
    text = (row.get("source_text") or row.get("description") or "")[:2000]
    if REQUEST_RE.search(text) and classification not in {
        "direct_specialist_ad",
        "direct_business_ad",
        "marketplace_item",
        "real_estate_listing",
        "event_ad",
    }:
        reasons.append("похоже на запрос/обсуждение, не предложение")

    # Stale only for time-sensitive collections — never for business / private_specialist.
    age = days_since(row.get("source_posted_at"))
    if age is not None and target in AGE_SENSITIVE_COLLECTIONS:
        limit = MARKETPLACE_MAX_AGE_DAYS
        if target == "real_estate":
            limit = RENTAL_MAX_AGE_DAYS
        elif target in {"jobs", "events"}:
            limit = JOB_EVENT_MAX_AGE_DAYS
        if age > limit:
            reasons.append(f"устаревшая запись ({age} дн.)")

    # contact only in free text, not normalized: if text has phone-like but phone=[] 
    if not has_direct_contact(contacts):
        if re_search_phone_in_text(text):
            reasons.append("контакт только в исходном тексте, не нормализован")

    # duplicate against existing businesses
    known = known_business_phones or set()
    for p in contacts.get("phone") or []:
        if p in known:
            reasons.append("возможный дубликат: телефон уже в businesses")
            break

    # already published
    if row.get("review_status") == "approved" and row.get("published_entity_id"):
        reasons.append("уже опубликовано")

    # Deduplicate reasons preserving order
    reasons = list(dict.fromkeys(reasons))
    eligible = len(reasons) == 0

    conf = float(row.get("ai_confidence") or 0)
    complete = completeness_score(row, contacts)
    posted = row.get("source_posted_at") or ""
    bucket, neg_extras, _, _, _ = contact_priority_rank(contacts)
    # sort key: bucket asc, -confidence, -completeness, -posted
    publish_rank = (
        bucket,
        -conf,
        -complete,
        posted,  # string ISO sorts lexicographically; we'll reverse later if needed
    )

    return {
        "eligible": eligible,
        "reasons": reasons,
        "contacts": contacts,
        "publish_rank": publish_rank,
        "contact_bucket": bucket,
        "completeness": complete,
        "confidence": conf,
        "age_days": age,
    }


def re_search_phone_in_text(text: str) -> bool:
    return bool(re.search(r"\+?\d[\d\-\s()]{8,}\d", text or ""))
