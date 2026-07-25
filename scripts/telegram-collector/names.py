"""Name / brand extraction with greeting guards."""

from __future__ import annotations

import re
from typing import Any

from contacts import extract_instagram

GREETING_BLOCKLIST = re.compile(
    r"^\s*(?:"
    r"всем\s+привет|привет|добрый\s+день|доброе\s+утро|добрый\s+вечер|"
    r"здравствуйте|девочки|девушкам|коллеги|hello|hi\b|hey\b|"
    r"предлагаю\s+услуги|ищу\s+клиентов|открыта\s+запись|нужна\s+модель"
    r")\b",
    re.I,
)

BANNED_NAME_EXACT = {
    "всем привет",
    "всем привет!",
    "всем привет!!",
    "добрый день",
    "добрый день!",
    "девочки",
    "здравствуйте",
    "здравствуйте!",
    "предлагаю услуги",
    "ищу клиентов",
    "привет",
    "hello",
    "hi",
}

EXPLICIT_NAME_RE = re.compile(
    r"(?:меня\s+зовут|my\s+name\s+is|i'?m)\s+([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё\-]{1,30}"
    r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё\-]{1,30}){0,2})",
    re.I,
)
YA_NAME_RE = re.compile(
    r"(?:^|\n)\s*я[,—\-–]\s*([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё\-]{1,30}"
    r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё\-]{1,30}){0,2})\b",
    re.I,
)
YA_ROLE_RE = re.compile(
    r"(?:^|\n)\s*я\s*[—\-–]?\s*([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё\-]{1,30}),\s+"
    r"([^\n.]{5,80})",
    re.I,
)
BEFORE_PHONE_RE = re.compile(
    r"([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё\-]{2,30}(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё\-]{2,30}){0,2})"
    r"\s*[:\-–]?\s*(?:\+?\d[\d\-\s().]{8,}\d)",
)
BUSINESS_BRAND_RE = re.compile(
    r"\b([A-ZА-ЯЁ][\w&'’.\-]{1,30}(?:\s+[A-ZА-ЯЁ][\w&'’.\-]{1,30}){0,4})\s+"
    r"(?:llc|inc|studio|salon|school|клиника|центр|cafe|кафе|bakery)\b",
    re.I,
)


def _clean_candidate(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"\s+", " ", value).strip(" .,:;!-—–")
    if not text:
        return None
    lower = text.lower()
    if lower in BANNED_NAME_EXACT:
        return None
    if GREETING_BLOCKLIST.match(text):
        return None
    if len(text) < 2 or len(text) > 60:
        return None
    if len(text.split()) > 6:
        return None
    return text


def extract_names(text: str, sender_name: str | None = None) -> dict[str, Any]:
    """Return person_name, business_name, extracted_name_source."""
    text = text or ""

    m = EXPLICIT_NAME_RE.search(text)
    if m:
        name = _clean_candidate(m.group(1))
        if name:
            return {
                "person_name": name,
                "business_name": None,
                "extracted_name_source": "explicit_text",
            }

    m = YA_NAME_RE.search(text)
    if m:
        name = _clean_candidate(m.group(1))
        if name:
            return {
                "person_name": name,
                "business_name": None,
                "extracted_name_source": "explicit_text",
            }

    m = YA_ROLE_RE.search(text)
    if m:
        name = _clean_candidate(m.group(1))
        if name:
            return {
                "person_name": name,
                "business_name": None,
                "extracted_name_source": "explicit_text",
            }

    brand = BUSINESS_BRAND_RE.search(text)
    if brand:
        name = _clean_candidate(brand.group(0))
        if name:
            return {
                "person_name": None,
                "business_name": name,
                "extracted_name_source": "business_brand",
            }

    before_phone = BEFORE_PHONE_RE.search(text)
    if before_phone:
        name = _clean_candidate(before_phone.group(1))
        if name:
            return {
                "person_name": name,
                "business_name": None,
                "extracted_name_source": "explicit_text",
            }

    igs = extract_instagram(text)
    if igs:
        # Keep handle as brand-ish signal, not invented personal name.
        return {
            "person_name": None,
            "business_name": igs[0],
            "extracted_name_source": "instagram",
        }

    sender = _clean_candidate(sender_name)
    if sender:
        return {
            "person_name": sender,
            "business_name": None,
            "extracted_name_source": "sender_profile",
        }

    return {
        "person_name": None,
        "business_name": None,
        "extracted_name_source": "unknown",
    }
