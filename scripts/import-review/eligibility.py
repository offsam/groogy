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
    COMPLETE_CARD_CONFIDENCE_MIN,
    COMPLETE_CARD_DESCRIPTION_MIN,
    EMAIL_RE,
    HIGH_CONFIDENCE_MIN,
    HIRING_AD_RE,
    IG_USER_RE,
    JOB_EVENT_MAX_AGE_DAYS,
    JUNK_CONTACT_TITLE_RE,
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
    # Platform is US (OC/LA): require NANP +1 NXX NXX XXXX
    if not digits.startswith("1") or len(digits) != 11:
        return None
    # NANP (+1): NXX NXX XXXX — area/exchange cannot start with 0 or 1
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
    if not EMAIL_RE.match(value):
        return None
    # reject asset-like false positives from HTML scrapes
    if value.endswith(
        (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js", ".map")
    ):
        return None
    local, _, domain = value.partition("@")
    if not local or not domain or "." not in domain:
        return None
    if "yelp-logo" in value or "snippet-" in value or "button-" in value:
        return None
    if "sentry" in domain or "wixpress.com" in domain or domain.endswith(".png"):
        return None
    return value


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
    # reject bare domains and common false-positive handles
    if value.lower() in {
        "everyone",
        "reel",
        "reels",
        "stories",
        "explore",
        "p",
        "tv",
        "share",
        "liked_by",
    }:
        return None
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


def normalize_facebook_url(raw: str | None) -> str | None:
    if not raw:
        return None
    value = str(raw).strip()
    if not value:
        return None
    href = value if value.lower().startswith("http") else f"https://{value}"
    try:
        parsed = urlparse(href)
    except Exception:  # noqa: BLE001
        return None
    host = (parsed.hostname or "").lower()
    if host not in {
        "facebook.com",
        "www.facebook.com",
        "m.facebook.com",
        "fb.com",
        "www.fb.com",
        "fb.me",
    }:
        return None
    path = (parsed.path or "").strip("/")
    if not path:
        return None
    # Drop pure group listing roots without post/profile segment noise later.
    return f"https://www.facebook.com/{path}"


def normalize_source_url(raw: str | None) -> str | None:
    if not raw:
        return None
    value = str(raw).strip()
    if not value.lower().startswith("http"):
        return None
    try:
        parsed = urlparse(value)
    except Exception:  # noqa: BLE001
        return None
    if not parsed.scheme or not parsed.netloc:
        return None
    return value


def normalize_telegram_user_id(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value or not value.isdigit() or len(value) < 5:
        return None
    return value


def extract_facebook_contacts(row: dict[str, Any]) -> list[str]:
    found: list[str] = []

    def add(raw: str | None) -> None:
        n = normalize_facebook_url(raw)
        if n and n not in found:
            found.append(n)

    for w in row.get("website") or []:
        add(str(w))
    add(row.get("source_url"))
    author = (row.get("source_author_username") or "").strip().lstrip("@")
    source = (row.get("source") or "").lower()
    source_url = (row.get("source_url") or "").lower()
    if author and ("facebook" in source or "facebook" in source_url or "fb.com" in source_url):
        if "/" not in author and " " not in author:
            add(f"https://www.facebook.com/{author}")
    raw = row.get("raw_payload") or {}
    if isinstance(raw, str):
        try:
            import json

            raw = json.loads(raw)
        except Exception:  # noqa: BLE001
            raw = {}
    if isinstance(raw, dict):
        for key in (
            "facebook_url",
            "author_url",
            "profile_url",
            "user_url",
            "post_url",
            "url",
            "link",
        ):
            add(raw.get(key) if isinstance(raw.get(key), str) else None)
        user = raw.get("user") or raw.get("author") or {}
        if isinstance(user, dict):
            add(user.get("profileUrl") if isinstance(user.get("profileUrl"), str) else None)
            add(user.get("url") if isinstance(user.get("url"), str) else None)
    return found


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
    if not tg:
        # Author username on Telegram-sourced posts is a usable handle.
        source = (row.get("source") or "").lower()
        if "telegram" in source or "t.me" in (row.get("source_url") or "").lower():
            tg = normalize_telegram_username(row.get("source_author_username"))
    tg_uid = normalize_telegram_user_id(
        row.get("telegram_user_id") or row.get("source_author_id")
    )
    facebook = extract_facebook_contacts(row)
    source_url = normalize_source_url(row.get("source_url"))
    return {
        "phone": phones,
        "whatsapp": whatsapp,
        "instagram": instagram,
        "website": websites,
        "email": emails,
        "telegram_username": tg,
        "telegram_user_id": tg_uid,
        "facebook": facebook,
        "source_url": source_url,
    }


def has_direct_contact(contacts: dict[str, Any]) -> bool:
    """Any reachable contact: phone/social OR Telegram id OR FB/post/source link."""
    return bool(
        contacts.get("phone")
        or contacts.get("whatsapp")
        or contacts.get("instagram")
        or contacts.get("website")
        or contacts.get("email")
        or contacts.get("telegram_username")
        or contacts.get("telegram_user_id")
        or contacts.get("facebook")
        or contacts.get("source_url")
    )


def contact_priority_rank(contacts: dict[str, Any]) -> tuple[int, int, float, int, str]:
    """Lower tuple = higher publish priority."""
    has_phone = bool(contacts.get("phone"))
    extras = sum(
        1
        for k in (
            "whatsapp",
            "instagram",
            "website",
            "email",
            "telegram_username",
            "facebook",
        )
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
    elif contacts.get("website") or contacts.get("facebook"):
        bucket = 4
    elif contacts.get("email"):
        bucket = 5
    elif contacts.get("telegram_username"):
        bucket = 6
    elif contacts.get("telegram_user_id"):
        bucket = 7
    elif contacts.get("source_url"):
        bucket = 8
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


def description_complete(description: str | None) -> bool:
    if not description or not str(description).strip():
        return False
    return len(str(description).strip()) >= COMPLETE_CARD_DESCRIPTION_MIN


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
    mode: str = "accepted",
) -> dict[str, Any]:
    """Return {eligible, reasons[], contacts, publish_rank}.

    mode:
      - accepted: strict Reviewer accepted + high confidence (legacy JSON path)
      - complete_card: queue cards that already look publishable (phone + body)
    """
    reasons: list[str] = []
    raw = row.get("_raw_post") or row.get("raw_payload") or {}
    if isinstance(raw, str):
        try:
            import json

            raw = json.loads(raw)
        except Exception:  # noqa: BLE001
            raw = {}
    contacts = extract_direct_contacts(row)
    complete_mode = mode == "complete_card"

    decision = (row.get("ai_decision") or raw.get("decision") or "").lower()
    if complete_mode:
        if decision and decision not in {"accepted", "needs_review"}:
            reasons.append(f"решение не для автопостинга: {decision}")
    elif decision != "accepted":
        reasons.append("не accepted")

    conf = float(row.get("ai_confidence") or 0)
    conf_min = COMPLETE_CARD_CONFIDENCE_MIN if complete_mode else HIGH_CONFIDENCE_MIN
    if conf < conf_min:
        reasons.append(f"низкая confidence ({conf:.2f} < {conf_min})")

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

    title = row.get("title") or row.get("business_name") or row.get("person_name")
    if not title_ok(title):
        reasons.append("нет title")
    elif title and JUNK_CONTACT_TITLE_RE.match(str(title).strip()):
        reasons.append("мусорный title (не название)")
    elif title and str(title).strip().lower().startswith("http"):
        reasons.append("title — URL, не название")

    if complete_mode:
        if not description_complete(row.get("description")):
            reasons.append(
                f"короткое description (< {COMPLETE_CARD_DESCRIPTION_MIN} симв.)"
            )
    elif not description_ok(row.get("description")):
        reasons.append("нет description")

    # Hiring posts mislabeled as business/specialist → manual review
    hire_blob = f"{title or ''}\n{row.get('description') or ''}\n{row.get('source_text') or ''}"
    if complete_mode and target in {"businesses", "private_specialists", "services"}:
        if HIRING_AD_RE.search(hire_blob):
            reasons.append("похоже на вакансию / набор сотрудников")

    if not row.get("category") or str(row.get("category")).strip().lower() in {"", "null"}:
        reasons.append("нет category")

    # classification / offer vs request
    classification = (raw.get("classification") or "").lower()
    relationship = (raw.get("advertiser_relationship") or "").lower()
    if not complete_mode and (
        "third_party" in classification or relationship == "third_party_recommendation"
    ):
        reasons.append("конфликтующая классификация / рекомендация")
    text = (row.get("source_text") or row.get("description") or "")[:2000]
    if REQUEST_RE.search(text) and classification not in {
        "direct_specialist_ad",
        "direct_business_ad",
        "marketplace_item",
        "real_estate_listing",
        "event_ad",
    }:
        # Soft: if the opening looks like an offer, keep it.
        offer_hint = re.search(
            r"(предлагаю|делаю|услуги|мастер|сантехник|handyman|продаю|сдам|"
            r"работаю|принимаю|запись)",
            text[:400],
            re.I,
        )
        if not offer_hint:
            reasons.append("похоже на запрос/обсуждение, не предложение")

    # For complete cards: allow recurring Telegram ads when phone is new to catalog.
    # exact/likely duplicates still need manual merge.
    dup = (row.get("duplicate_status") or "unique").lower()
    if complete_mode:
        if dup in {"exact_duplicate", "likely_duplicate"}:
            reasons.append("возможный дубликат")
    elif dup in {"exact_duplicate", "likely_duplicate", "recurring_ad"}:
        reasons.append("возможный дубликат")

    if complete_mode:
        # Phone preferred, but FB/TG id/source post link also count as reachable contact.
        if not has_direct_contact(contacts):
            reasons.append("нет контакта")
    elif not has_direct_contact(contacts):
        reasons.append("нет контакта")
    else:
        raw_ig = bool(row.get("instagram"))
        if raw_ig and not contacts["instagram"] and not has_direct_contact(
            {**contacts, "instagram": []}
        ):
            reasons.append("некорректный Instagram/URL")

    # City is optional when a direct contact exists.
    if (
        target in CITY_REQUIRED_WITHOUT_CONTACT
        and not (row.get("city") or "").strip()
        and not has_direct_contact(contacts)
    ):
        reasons.append("нет города")

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

    # contact only in free text, not normalized
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
        "mode": mode,
    }


def re_search_phone_in_text(text: str) -> bool:
    return bool(re.search(r"\+?\d[\d\-\s()]{8,}\d", text or ""))
