"""Contact and text helpers shared by collect/analyze scripts."""

from __future__ import annotations

import re
from typing import Any

PHONE_RE = re.compile(
    r"(?:\+?\d[\d\-\s().]{8,}\d)",
)
INSTAGRAM_RE = re.compile(
    r"(?:instagram\.com/|instagr\.am/|@|инста(?:грам)?[:\s@]*)([A-Za-z0-9._]{2,30})",
    re.IGNORECASE,
)
INSTAGRAM_HANDLE_RE = re.compile(
    r"(?:^|[\s(,])@([A-Za-z0-9._]{3,30})(?=[\s,).!]|$)",
)
WEBSITE_RE = re.compile(
    r"(?:https?://|www\.)[^\s<>\"']+",
    re.IGNORECASE,
)
EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}",
)
TELEGRAM_RE = re.compile(
    r"(?:t\.me/|telegram\.me/|tg://resolve\?domain=)([A-Za-z0-9_]{4,})",
    re.IGNORECASE,
)
WHATSAPP_RE = re.compile(
    r"(?:wa\.me/|whatsapp\.com/send\?phone=|whats?app)[^\s]*",
    re.IGNORECASE,
)

# Keep Instagram false-positives down a bit.
INSTAGRAM_STOP = {
    "gmail",
    "yahoo",
    "mail",
    "email",
    "http",
    "https",
    "www",
    "com",
    "org",
    "net",
    "the",
    "and",
    "for",
    "mom",
    "fun",
}


def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 10:
        return None
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    if digits.startswith("7") and len(digits) == 11:
        return "+" + digits
    if raw.strip().startswith("+"):
        return "+" + digits
    return "+" + digits if len(digits) >= 10 else None


def extract_phones(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for match in PHONE_RE.finditer(text or ""):
        phone = normalize_phone(match.group(0))
        if phone and phone not in seen:
            seen.add(phone)
            found.append(phone)
    return found


def extract_emails(text: str) -> list[str]:
    return sorted({m.group(0).lower() for m in EMAIL_RE.finditer(text or "")})


def extract_websites(text: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for match in WEBSITE_RE.finditer(text or ""):
        url = match.group(0).rstrip(".,);]")
        # Skip pure social hosts handled elsewhere when possible.
        lower = url.lower()
        if "instagram.com" in lower or "t.me/" in lower or "wa.me/" in lower:
            continue
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def extract_instagram(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for pattern in (INSTAGRAM_RE, INSTAGRAM_HANDLE_RE):
        for match in pattern.finditer(text or ""):
            handle = match.group(1).strip(".").lower()
            if handle in INSTAGRAM_STOP or handle.isdigit():
                continue
            if handle not in seen:
                seen.add(handle)
                found.append(handle)
    return found


def extract_telegram(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for match in TELEGRAM_RE.finditer(text or ""):
        handle = match.group(1).lower()
        if handle not in seen:
            seen.add(handle)
            found.append(handle)
    return found


def extract_whatsapp(text: str) -> list[str]:
    return sorted({m.group(0) for m in WHATSAPP_RE.finditer(text or "")})


def has_contact_signal(text: str) -> bool:
    return bool(
        extract_phones(text)
        or extract_emails(text)
        or extract_websites(text)
        or extract_instagram(text)
        or extract_telegram(text)
        or extract_whatsapp(text)
    )


def first_or_none(items: list[str]) -> str | None:
    return items[0] if items else None


def text_fingerprint(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").lower()).strip()
    cleaned = re.sub(r"[^\w\s@.+-]", "", cleaned)
    return cleaned[:500]


def similarity_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    # Lightweight token Jaccard for duplicate detection.
    ta = set(a.split())
    tb = set(b.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def empty_entity(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "entity_type": None,
        "business_name": None,
        "person_name": None,
        "category": None,
        "subcategory": None,
        "description": None,
        "services": [],
        "prices": [],
        "phone": None,
        "email": None,
        "website": None,
        "instagram": None,
        "facebook": None,
        "telegram": None,
        "whatsapp": None,
        "address": None,
        "city": None,
        "state": None,
        "service_area": [],
        "languages": [],
        "booking_url": None,
        "source_text": source.get("text"),
        "source_chat_id": source.get("chat_id"),
        "source_message_ids": source.get("message_ids")
        or ([source["message_id"]] if source.get("message_id") is not None else []),
        "source_date": source.get("message_date"),
    }
