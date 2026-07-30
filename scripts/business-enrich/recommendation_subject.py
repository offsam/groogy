"""Helpers for third-party recommendations → professional cards.

Rules derived from the Lyubov Nikonova / Aiman Zeitun / Mercedes-Benz case:

1. Card name is the recommended person, never the comment author.
2. External American employers stay as employer_name (no catalog business card).
3. Russian / diaspora businesses may get employer_business_id.
4. Description must not carry phones, URLs, or admin source footers.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

# «обратиться … к Айман Зейтун», «рекомендую NAME», «NAME поможет»
SUBJECT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"обратить(?:ся|есь)\s+(?:в\s+[^.\n]{2,60}?\s+)?к\s+"
        r"([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\-]{1,40}"
        r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\-]{1,40}){0,3})",
        re.I,
    ),
    re.compile(
        r"(?:рекомендую|советую|посоветовал[аи]?|очень\s+рекомендую)\s+"
        r"(?:обратиться\s+к\s+|к\s+)?"
        r"([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\-]{1,40}"
        r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\-]{1,40}){0,3})",
        re.I,
    ),
    re.compile(
        r"([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\-]{1,40}"
        r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\-]{1,40}){0,2})\s+"
        r"(?:поможет|помог(?:ла)?|сориентирует|подберёт|подберет|ответит)",
        re.I,
    ),
    re.compile(
        r"(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\s+"
        r"([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\-]{1,40}"
        r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\-]{1,40}){0,2})",
        re.I,
    ),
]

SUBJECT_STOP = {
    "mercedes",
    "benz",
    "instagram",
    "telegram",
    "whatsapp",
    "телефон",
    "звоните",
    "пишите",
    "контакты",
    "сайт",
    "дилера",
    "дилер",
    "салона",
    "салон",
    "компании",
    "компания",
    "отличные",
    "условия",
    "модельный",
    "источник",
    "здравствуйте",
    "привет",
    "также",
    "может",
    "сможет",
    "быть",
    "мастера",
    "мастер",
    "что",
    "это",
    "для",
    "кто",
    "как",
    "или",
    "the",
    "best",
    "and",
    "studio",
    "website",
    "getpro",
    "preschool",
    "learning",
    "гибридные",
    "авто",
}

EMPLOYER_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"(?:обратить(?:ся|есь)\s+)?(?:в|at)\s+"
        r"("
        r"(?:Mercedes[\-\s]?Benz|Toyota|Honda|BMW|Lexus|Audi|Ford|Chevrolet|"
        r"Nissan|Hyundai|Kia|Volkswagen|Volvo|Subaru|Mazda|Acura|Infiniti)"
        r"(?:\s+of\s+[A-Z][A-Za-z .'\-]{2,40})?"
        r"|"
        r"[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9&'’.\-]{2,40}"
        r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9&'’.\-]{2,40}){0,4}"
        r"(?:\s+(?:Inc|LLC|Corp|Company|Motors|Dealership|Clinic|Hospital|"
        r"Medical|Dental|Law|Group|Center|Centre|Studio|Salon)\.?)"
        r")",
        re.I,
    ),
]

# Signals that the employer itself belongs in the Russian catalog.
RUSSIAN_BUSINESS_RE = re.compile(
    r"(?:русск|украин|славян|советск|израил|"
    r"russian|ukrainian|slavic|soviet|"
    r"наш[аеи]\s+(?:компани|фирм|клиник|салон|агентств)|"
    r"русскоязычн|для\s+русскоязычн)",
    re.I,
)

CORPORATE_IG_RE = re.compile(
    r"(?:mercedesbenzusa|toyota|honda|bmwusa|audi|ford|"
    r"chevrolet|nissanusa|hyundaiusa|kia|volkswagen|"
    r"lexus|volvo|subaru)\b",
    re.I,
)

SOURCE_FOOTER_RE = re.compile(
    r"(?im)^(?:контакты|источник|source|telegram\s*id)\s*:.*$",
)
ISO_STAMP_RE = re.compile(
    r"\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b"
)
URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(
    r"(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})"
)
HANDLE_RE = re.compile(r"(?:^|[\s(,])@[A-Za-z0-9._]{3,30}\b")
FLAG_RE = re.compile(r"[\U0001F1E6-\U0001F1FF]{2}")


def _norm_name(value: str | None) -> str:
    return re.sub(r"[^a-z0-9а-яё]+", "", (value or "").lower())


def _clean_person_name(raw: str | None) -> str | None:
    if not raw:
        return None
    value = re.sub(r"\s+", " ", str(raw)).strip(" -–—,.;:")
    # Drop trailing junk like "Источник" glued by OCR / footer.
    value = re.sub(
        r"\s+(?:источник|telegram|instagram|whatsapp|телефон)\b.*$",
        "",
        value,
        flags=re.I,
    ).strip(" -–—,.;:")
    if len(value) < 2 or len(value) > 80:
        return None
    parts = [p for p in re.split(r"\s+", value) if p]
    if not parts or len(parts) > 4:
        return None
    if any(p.lower().strip(".,") in SUBJECT_STOP for p in parts):
        return None
    if re.search(r"\d", value):
        return None
    if "-" in value or "/" in value:
        return None
    # Company-ish endings are employers, not people.
    if re.search(
        r"(?i)\b(?:inc|llc|corp|company|motors|dealership|clinic|hospital|"
        r"preschool|academy|school|studio|salon|group|center|centre|lab)\b",
        value,
    ):
        return None
    # Require at least one capitalized name token (Latin or Cyrillic).
    if not any(re.match(r"^[A-ZА-ЯЁ]", p) for p in parts):
        return None
    # Single lowercase function words already filtered; reject all-lowercase.
    if value == value.lower():
        return None
    return value[:80]


def _clean_employer_name(raw: str | None) -> str | None:
    if not raw:
        return None
    value = re.sub(r"\s+", " ", str(raw)).strip(" -–—,.;:")
    if len(value) < 3 or len(value) > 120:
        return None
    low = value.lower()
    if any(x in low for x in ("отличн", "условия", "модельный", "лизинг на")):
        return None
    if re.fullmatch(r"(?:дилер|dealer|салон|clinic|company)", low):
        return None
    return value[:120]


def recommended_subject_name(*texts: str | None) -> str | None:
    blob = "\n".join(t for t in texts if t)
    if not blob.strip():
        return None
    for pattern in SUBJECT_PATTERNS:
        for match in pattern.finditer(blob):
            cand = _clean_person_name(match.group(1))
            if cand:
                return cand
    return None


def names_match(a: str | None, b: str | None) -> bool:
    na, nb = _norm_name(a), _norm_name(b)
    if not na or not nb or len(na) < 4 or len(nb) < 4:
        return False
    return na == nb or na in nb or nb in na


def resolve_professional_display_name(
    rec: dict[str, Any],
    *,
    texts: list[str] | None = None,
) -> str | None:
    """Pick the recommended person; never keep the recommender as the title."""
    blob_parts = list(texts or [])
    blob_parts.extend(str(t) for t in (rec.get("comment_texts") or []) if t)
    blob_parts.append(str(rec.get("notes") or ""))
    subject = recommended_subject_name(*blob_parts)
    current = (rec.get("display_name") or "").strip() or None
    recommenders = [
        str(x).strip()
        for x in (rec.get("recommender_names") or [])
        if str(x).strip()
    ]
    third = int(rec.get("third_party_mention_count") or 0) > 0

    if subject:
        return subject
    if current and not any(names_match(current, r) for r in recommenders):
        return current
    if third and current and any(names_match(current, r) for r in recommenders):
        return None
    return current


# A community comment is somebody's opinion about the card owner. It belongs to
# «Рекомендации сообщества» (count + source link), never to «О специалисте».
# Only first-person recommender voice is listed here: «рекомендуем записаться»
# from the owner's own ad must stay.
# Deliberately narrow: only first-person speech *about* the owner. Owner CTAs
# («обращайтесь в ЛС», «рекомендуем записаться») must survive untouched.
RECOMMENDER_VOICE_RE = re.compile(
    r"\bрекомендую\b|\bпорекомендую\b|\bсоветую\b|\bпосоветую\b"
    r"|хочу\s+(?:\w+\s+){0,3}(?:по)?рекомендовать|могу\s+(?:по)?рекомендовать"
    r"|\bя\s+(?:ходил\w*|была\s+у\b|был\s+у\b|обращал\w*|пользу\w+|довольн\w+)"
    r"|\bмы\s+(?:ходили|были\s+у\b|обращались|остались\s+довольны)"
    r"|\bмо[йяё]\w*\s+(?:знаком\w+|подруг\w+|дочк\w+|сын\b|муж\b|жена\b)"
    r"|\bмне\s+(?:очень\s+)?(?:нравил\w*|понравил\w*|зашло\b)"
    r"|\bмне\s+кажется\b|\bя\s+в\s+восторге\b|остались\s+довольны"
    r"|делюсь\s+контакт\w+|дам\s+контакт\w*|могу\s+дать\s+контакт"
    r"|\bищу\s+|\bкто\s+(?:знает|подскажет)\b",
    re.I,
)

# «кв. ф» / «т. д.» must not be read as a sentence end.
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?…])\s+(?=[«\"A-ZА-ЯЁ\W])")
ABBREV_TAIL_RE = re.compile(r"(?:^|\s)(?:кв|ул|д|т|г|стр|им|пр|см|мин|руб)\.$", re.I)


def is_recommender_voice(text: str | None) -> bool:
    """True when the sentence speaks about the owner, not for the owner."""
    return bool(text and RECOMMENDER_VOICE_RE.search(text))


def split_sentences(line: str) -> list[str]:
    parts = SENTENCE_SPLIT_RE.split(line)
    merged: list[str] = []
    for part in parts:
        if merged and ABBREV_TAIL_RE.search(merged[-1]):
            merged[-1] = f"{merged[-1]} {part}"
        else:
            merged.append(part)
    return merged


def strip_recommender_voice(text: str | None) -> str | None:
    """Keep only sentences that describe the subject, drop the opinion ones.

    Returns None when what is left is a fragment rather than a description —
    a card with no text is better than one starting mid-sentence.
    """
    if not text:
        return None
    kept_paragraphs: list[str] = []
    total = 0
    dropped = 0
    for paragraph in re.split(r"\n\s*\n", str(text)):
        kept_lines: list[str] = []
        for line in paragraph.split("\n"):
            kept: list[str] = []
            for sentence in split_sentences(line):
                if not sentence.strip():
                    continue
                total += 1
                if is_recommender_voice(sentence):
                    dropped += 1
                else:
                    kept.append(sentence)
            if kept:
                kept_lines.append(" ".join(kept).strip())
        if kept_lines:
            kept_paragraphs.append("\n".join(kept_lines))
    # Half the copy being an opinion means the card *is* the review. Salvaging
    # the rest only produces fragments, so the description goes away.
    if total and dropped / total >= 0.5:
        return None
    result = "\n\n".join(kept_paragraphs).strip()
    if len(result) < 60:
        return None
    head = result.lstrip("«\"'•-–—✅✔️ ")[:1]
    if head and head.isalpha() and head.islower():
        return None
    return result


def clean_public_description(text: str | None, *, max_len: int = 4000) -> str | None:
    if not text:
        return None
    cleaned = str(text)
    cleaned = SOURCE_FOOTER_RE.sub("", cleaned)
    cleaned = ISO_STAMP_RE.sub(" ", cleaned)
    cleaned = FLAG_RE.sub("", cleaned)
    cleaned = URL_RE.sub(" ", cleaned)
    cleaned = EMAIL_RE.sub(" ", cleaned)
    cleaned = PHONE_RE.sub(" ", cleaned)
    cleaned = HANDLE_RE.sub(" ", cleaned)
    cleaned = re.sub(r"(?im)^\s*(?:тел(?:ефон)?|phone|call|сайт|website|instagram|telegram)\s*[:：].*$", "", cleaned)
    cleaned = re.sub(
        r"(?im)^\s*(?:телефон\s+для\s+связи|ознакомиться\s+с\s+выбором|"
        r"пишите(?:\s*/\s*звоните)?(?:\s+напрямую)?|"
        r"звоните(?:\s+или\s+пишите)?|"
        r"пишите(?:\s+или\s+звоните)?).*$",
        "",
        cleaned,
    )
    cleaned = re.sub(r"(?m)^\s*[📍📞📧🌐✨🎉👇🇺🇸]+\s*$", "", cleaned)
    cleaned = re.sub(r"[📍📞📧🌐✨🎉👇]", " ", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()
    # Drop exact duplicate paragraphs
    paras = [p.strip() for p in re.split(r"\n\s*\n", cleaned) if p.strip()]
    uniq: list[str] = []
    seen: set[str] = set()
    for p in paras:
        key = re.sub(r"\s+", " ", p.lower())
        if key in seen:
            continue
        seen.add(key)
        uniq.append(p)
    cleaned = "\n\n".join(uniq).strip()
    if len(cleaned) < 40:
        return None
    return cleaned[:max_len]


def short_teaser(text: str | None, *, max_len: int = 220) -> str | None:
    cleaned = clean_public_description(text, max_len=max_len * 2)
    if not cleaned:
        return None
    first = cleaned.split("\n\n", 1)[0].strip()
    if len(first) <= max_len:
        return first
    cut = first[: max_len - 1].rsplit(" ", 1)[0].rstrip(" ,.;:")
    return (cut or first[:max_len]).strip() + "…"


def website_host(url: str | None) -> str | None:
    if not url:
        return None
    raw = str(url).strip()
    if not raw.startswith("http"):
        raw = "https://" + raw
    try:
        host = (urlparse(raw).hostname or "").lower().removeprefix("www.")
    except Exception:
        return None
    return host or None


def extract_employer(text: str | None) -> dict[str, Any] | None:
    """Return employer_name / role / catalog eligibility from free text."""
    blob = text or ""
    if not blob.strip():
        return None
    name = None
    for pattern in EMPLOYER_PATTERNS:
        match = pattern.search(blob)
        if match:
            name = _clean_employer_name(match.group(1))
            if name:
                break
    if not name:
        return None
    role = None
    if re.search(r"лизинг|lease|sales|продаж|менеджер|consultant|advisor", blob, re.I):
        if re.search(r"лизинг|lease", blob, re.I):
            role = "Менеджер по продажам / лизинг"
        else:
            role = "Менеджер по продажам"
    russian = bool(RUSSIAN_BUSINESS_RE.search(blob))
    return {
        "employer_name": name[:120],
        "employer_role": role,
        "is_russian_catalog": russian,
    }


def is_corporate_instagram(url_or_handle: str | None) -> bool:
    if not url_or_handle:
        return False
    return bool(CORPORATE_IG_RE.search(str(url_or_handle)))


def personal_website_or_none(
    websites: list[Any] | None,
    *,
    employer_name: str | None = None,
) -> str | None:
    """Keep only websites that look like the specialist's own site."""
    employer_key = _norm_name(employer_name)
    for w in websites or []:
        s = str(w).strip()
        if not s.startswith("http"):
            continue
        low = s.lower()
        if any(
            x in low
            for x in (
                "instagram.com",
                "facebook.com",
                "t.me/",
                "telegram.me",
                "wa.me",
                "dealer.com",
                "cars.com",
                "autotrader.com",
            )
        ):
            continue
        host = website_host(s) or ""
        host_key = _norm_name(host.rsplit(".", 1)[0] if "." in host else host)
        if employer_key and host_key and (
            employer_key in host_key or host_key in employer_key
        ):
            # Employer dealership site — not the person's identity website.
            continue
        return s.split("?")[0][:300]
    return None
