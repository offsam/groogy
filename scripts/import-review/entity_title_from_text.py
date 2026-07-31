"""Derive an entity name from source text when the card name is junk.

Rule for every entity kind (business, professional, listing, event):
«Обогатить» must never leave a card named after a meta label from the post
(«Контакты», «Форма», «Когда: …») or with no name at all while the text itself
carries the real name.

Mirrors lib/import-review/display-name.ts (isJunkImportTitle + quoted name).
"""

from __future__ import annotations

import re
from typing import Any

from structure_event_from_text import demath_text

META_LABELS = (
    r"контакты?|contacts?|телефон\w*|phone|почта|e-?mail|"
    r"когда|when|дата|date|где|where|адрес|address|локация|location|"
    r"билеты?|tickets?|цена|price|стоимость|оплат[аы]|payment|"
    r"форма|form|регистрац\w*|registration|запись|как\s+записаться|как\s+оплатить|"
    r"тема|theme|возраст|age|продолжительность|duration|"
    r"описание|description|услуги|services|график|расписание|hours"
)

META_ONLY_RE = re.compile(rf"^\s*(?:{META_LABELS})\s*[:：]?\s*$", re.I)
META_PREFIX_RE = re.compile(rf"^\s*(?:{META_LABELS})\s*[:：]", re.I)

JUNK_EXACT = {
    "messenger",
    "whatsapp",
    "telegram",
    "instagram",
    "facebook",
    "gmail.com",
    "yahoo.com",
    "mail.com",
    "outlook.com",
    "hotmail.com",
    "unknown",
    "user",
    "admin",
    "null",
    "none",
    "n/a",
    "без названия",
    "no name",
}

URL_RE = re.compile(r"https?://[^\s<>\"']+|www\.[^\s<>\"']+", re.I)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:\+?\d[\d\-\s().]{8,}\d)")
HASHTAG_RE = re.compile(r"#\w+", re.U)
CAMERA_IG_RE = re.compile(r"(?:📷|📸)\s*@?([A-Za-z0-9._]{2,30})\b")
QUOTED_RE = re.compile(r"[«\"“„]([^«»\"“”„\n]{2,60})[»\"”]")
DOMAIN_RE = re.compile(r"^[\w.\-]+\.(?:com|net|org|ru|io|co|info)$", re.I)
LETTER_RE = re.compile(r"[^\W\d_]", re.U)

# Greetings and vocatives open half of the posts — not the name of anything.
GREETING_RE = re.compile(
    r"^(?:всем\s+)?(?:здравствуйте|здравствуй|привет(?:ствую)?|"
    r"добрый\s+день|добрый\s+вечер|доброе\s+утро|доброго\s+времени(?:\s+суток)?|"
    r"добро\s+пожаловать|уважаемые\s+\w+|"
    r"hello|hi|hey|good\s+(?:morning|afternoon|evening)|welcome)"
    r"[\s,!.:;—–-]*",
    re.I,
)

VOCATIVE_RE = re.compile(
    r"^(?:дорог\w+\s+)?(?:девочк\w+|девушк\w+|дам\w+|мамочки|мамы|родители|"
    r"друзья|ребят\w+|коллеги|соседи|земляки|люди\s+добрые|народ|всем)"
    r"[\s,!.:;—–-]+",
    re.I,
)

# Affiche CTAs («Пишите «+»…», «ПРИСОЕДИНЯЙТЕСЬ…») — never an event name.
CTA_OPENER_RE = re.compile(
    r"^(?:пишите|пиши(?:те)?|напишите|присоединяйтесь|подписывайтесь|"
    r"жмите|ставьте\s*[«\"]?\+|оставьте\s+комментар\w*|"
    r"пишите\s+[«\"]?\+|"
    r"write\s+[«\"]?\+|join\s+(?:us|our)|click\s+(?:here|the\s+link)|"
    r"comment\s+[«\"]?\+|leave\s+a\s+comment)"
    r"[\s,!.:;—–«»\"'+]*",
    re.I,
)

MAX_TITLE = 80


def _letters(value: str) -> int:
    return len(LETTER_RE.findall(value or ""))


def is_junk_title(value: Any) -> bool:
    """True when the value is empty, a meta label, a handle/domain or noise."""
    text = str(value or "").strip()
    if not text:
        return True
    low = text.lower()
    if low in JUNK_EXACT:
        return True
    if META_ONLY_RE.match(text) or META_PREFIX_RE.match(text):
        return True
    if CTA_OPENER_RE.match(text):
        return True
    if GREETING_RE.match(text) and _letters(GREETING_RE.sub("", text, count=1)) < 12:
        return True
    if "@" in text:
        return True
    if DOMAIN_RE.match(low):
        return True
    if _letters(text) < 3:
        return True
    digits = re.sub(r"\D", "", text)
    if len(digits) >= 7 and _letters(text) < 6:
        return True
    return False


def clean_candidate(raw: str | None) -> str:
    s = raw or ""
    for pattern in (URL_RE, EMAIL_RE, PHONE_RE, CAMERA_IG_RE, HASHTAG_RE):
        s = pattern.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^[^\w]+|[^\w]+$", "", s, flags=re.U).strip()
    for _ in range(3):
        stripped = GREETING_RE.sub("", s, count=1)
        stripped = VOCATIVE_RE.sub("", stripped, count=1)
        stripped = CTA_OPENER_RE.sub("", stripped, count=1)
        stripped = re.sub(r"^[^\w]+", "", stripped, flags=re.U).strip()
        if stripped == s:
            break
        s = stripped
    if len(s) > MAX_TITLE:
        s = s[:MAX_TITLE].rsplit(" ", 1)[0].rstrip(" ,.;:!?-—–")
    return s.strip()


def _acceptable(candidate: str) -> bool:
    return bool(candidate) and _letters(candidate) >= 3 and not is_junk_title(candidate)


def _first_sentence(line: str) -> str:
    head = re.split(r"(?<=[.!?…])\s+", line, maxsplit=1)[0].strip()
    return head if _letters(head) >= 6 else line


def derive_title_from_text(
    raw: str | None, *, allow_headline: bool = True
) -> str | None:
    """Quoted name «…» always; the first headline line only where a post
    headline is the name (listing / event). Business and professional names
    must be explicit — a sentence from the ad is not a name."""
    text = demath_text(raw or "")
    if not text.strip():
        return None

    lines: list[str] = []
    for line in text.splitlines():
        t = line.strip()
        if not t:
            continue
        if META_ONLY_RE.match(t) or META_PREFIX_RE.match(t):
            continue
        if re.match(r"^(?:https?://|www\.)", t, re.I):
            continue
        if _letters(t) < 3:
            continue
        lines.append(t)
        if len(lines) >= 8:
            break

    for line in lines:
        if CTA_OPENER_RE.match(line) or GREETING_RE.match(line):
            continue
        for m in QUOTED_RE.finditer(line):
            candidate = clean_candidate(m.group(1))
            if _acceptable(candidate):
                return candidate

    if not allow_headline:
        return None

    for line in lines:
        if CTA_OPENER_RE.match(line) or GREETING_RE.match(line):
            continue
        candidate = clean_candidate(_first_sentence(line))
        if _acceptable(candidate):
            return candidate

    return None


# Which name columns each queue entity publishes under.
NAME_FIELDS_BY_ENTITY = {
    "business": ("title", "business_name"),
    "listing": ("title", "business_name"),
    "event": ("title", "business_name"),
    "professional": ("title", "person_name"),
}

# Listing / event names are post headlines; business & person names are not.
HEADLINE_ENTITIES = {"listing", "event"}


def needs_title(item: dict[str, Any]) -> bool:
    names = (item.get("title"), item.get("business_name"), item.get("person_name"))
    return all(is_junk_title(n) for n in names)


def apply_title_to_queue(
    item: dict[str, Any], entity_key: str | None
) -> tuple[dict[str, Any], list[str]]:
    """Fill-junk-only name patch for import_review_items + filled keys."""
    if not needs_title(item):
        return {}, []

    blob = "\n".join(
        x
        for x in (item.get("description"), item.get("source_text"))
        if isinstance(x, str) and x.strip()
    )
    derived: str | None = None
    # Multi-date affiches name each session on its date line — prefer that
    # over the CTA / greeting that opens the post.
    if (entity_key or "") == "event":
        from structure_event_from_text import (  # noqa: WPS433
            first_schedule_event_title,
        )

        derived = first_schedule_event_title(blob)
    if not derived:
        derived = derive_title_from_text(
            blob, allow_headline=(entity_key or "") in HEADLINE_ENTITIES
        )

    # Ads often omit the person name in the body; the Telegram/FB author line
    # still carries it («Диана Калифорнийская | Психолог…»).
    if not derived:
        author = str(item.get("source_author_display_name") or "").strip()
        if author:
            head = re.split(r"[|·•/—–\-]", author, maxsplit=1)[0].strip()
            head = clean_candidate(head)
            if _acceptable(head):
                derived = head

    if not derived:
        return {}, []

    patch: dict[str, Any] = {}
    filled: list[str] = []
    for field in NAME_FIELDS_BY_ENTITY.get(entity_key or "", ("title",)):
        if is_junk_title(item.get(field)):
            patch[field] = derived
            filled.append(field)
    return patch, filled
