"""Structure event / affiche free text → queue + events fields.

Mirrors lib/events/structure-event-from-text.ts for P5A pre-publish enrich.
Fill-empty only when applying onto import_review_items.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta
from typing import Any

MONTHS_RU = {
    "январ": 1,
    "феврал": 2,
    "март": 3,
    "апрел": 4,
    "ма": 5,
    "июн": 6,
    "июл": 7,
    "август": 8,
    "сентябр": 9,
    "октябр": 10,
    "ноябр": 11,
    "декабр": 12,
}

META_LINE_RE = re.compile(
    r"^(?:когда|when|где|where|адрес|address|билеты?|tickets?|цена|price|стоимость|"
    r"как\s+записаться|как\s+оплатить|оплат[аы]|контакты?|contacts?|телефон|phone|"
    r"форма|form|регистрац|registration|возраст|age|продолжительность|duration|"
    r"тема|theme)\b",
    re.I,
)

PHONE_RE = re.compile(r"(?:\+?\d[\d\-\s().]{8,}\d)")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"https?://[^\s<>\"']+|www\.[^\s<>\"']+", re.I)
CAMERA_IG_RE = re.compile(r"(?:📷|📸)\s*@?([A-Za-z0-9._]{2,30})\b")
LABELED_RE = re.compile(
    r"(?:^|\n)\s*(Когда|When|Date|Дата|Где|Where|Адрес|Address|"
    r"Билеты?|Tickets?|Цена|Price|Стоимость|"
    r"Как\s+оплатить|Оплата|Payment|Payments|Pay\s+with|"
    r"Способ\s+оплаты|Способы\s+оплаты)\s*[:：]\s*(.+)",
    re.I,
)

PAYMENT_METHOD_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"pay\s*pal|paypal|пейпал", re.I), "PayPal"),
    (re.compile(r"venmo|veneno|в[еэ]нмо|вемо", re.I), "Venmo"),
    (re.compile(r"\bzell(?:e)?\b|з[еэ]лл", re.I), "Zelle"),
    (re.compile(r"cash\s*(?:app|up)|cashapp", re.I), "Cash App"),
    (re.compile(r"apple\s*pay", re.I), "Apple Pay"),
    (re.compile(r"google\s*pay|\bg\s*pay\b", re.I), "Google Pay"),
    (re.compile(r"\bvisa\b", re.I), "Visa"),
    (re.compile(r"mastercard|master\s*card|мастер\s*кард", re.I), "Mastercard"),
    (
        re.compile(r"(?:credit\s*|debit\s*)?cards?|карт(?:а|ой|ы|у)", re.I),
        "Карта",
    ),
    (
        re.compile(r"\bcash\b(?!\s*(?:app|up))|наличн\w*|к[еэ]ш", re.I),
        "Cash",
    ),
    (re.compile(r"\bcheck\b|\bcheque\b|\bчек\b", re.I), "Check"),
]


def _empty_str(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def _empty_list(v: Any) -> bool:
    return not (isinstance(v, list) and any(str(x).strip() for x in v if x is not None))


def _norm_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) < 10:
        return None
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return f"+{digits}" if raw.strip().startswith("+") else (f"+{digits}" if len(digits) >= 10 else None)


def _norm_url(raw: str) -> str:
    u = (raw or "").strip().rstrip(".,);]'\"")
    if not u:
        return u
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    return u


def _month_ru(token: str) -> int | None:
    t = (token or "").lower()
    for prefix, num in MONTHS_RU.items():
        if t.startswith(prefix):
            return num
    return None


def _labeled(text: str, labels: tuple[str, ...]) -> str | None:
    for m in LABELED_RE.finditer(text):
        key = (m.group(1) or "").lower()
        for lab in labels:
            if key.startswith(lab.lower()[: max(3, len(lab) // 2)]):
                return (m.group(2) or "").strip()
            if key == lab.lower():
                return (m.group(2) or "").strip()
    # fallback explicit
    for lab in labels:
        m = re.search(
            rf"(?:^|\n)\s*{re.escape(lab)}\s*[:：]\s*(.+)",
            text,
            re.I,
        )
        if m:
            return m.group(1).strip()
    return None


def _parse_when(label: str) -> tuple[str, str | None]:
    cleaned = re.sub(r"\s+", " ", label).strip()
    year_m = re.search(r"\b(20\d{2})\b", cleaned)
    year = int(year_m.group(1)) if year_m else datetime.now(timezone.utc).year
    month = day = None

    m = re.search(r"(\d{1,2})\s+([а-яё]+)", cleaned, re.I)
    if m:
        day = int(m.group(1))
        month = _month_ru(m.group(2))

    if month is None:
        m = re.search(
            r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})",
            cleaned,
            re.I,
        )
        if m:
            names = {
                "january": 1,
                "february": 2,
                "march": 3,
                "april": 4,
                "may": 5,
                "june": 6,
                "july": 7,
                "august": 8,
                "september": 9,
                "october": 10,
                "november": 11,
                "december": 12,
            }
            month = names[m.group(1).lower()]
            day = int(m.group(2))

    hour, minute = 12, 0
    ampm = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", cleaned, re.I)
    if ampm:
        hour = int(ampm.group(1))
        minute = int(ampm.group(2) or 0)
        ap = ampm.group(3).lower()
        if ap == "pm" and hour < 12:
            hour += 12
        if ap == "am" and hour == 12:
            hour = 0

    if month is None or day is None:
        return cleaned, None
    try:
        # Fixed US Pacific −08 for CA events (same as TS helper).
        local = datetime(year, month, day, hour, minute, tzinfo=timezone(timedelta(hours=-8)))
        return cleaned, local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return cleaned, None


RU_MONTH_WORD_RE = re.compile(
    r"\b(\d{1,2})\s+(январ[ья]|феврал[ья]|марта?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|"
    r"августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])(?![а-яё])",
    re.I,
)
EN_MONTH_WORD_RE = re.compile(
    r"\b(january|february|march|april|may|june|july|august|september|october|"
    r"november|december)\s+(\d{1,2})\b",
    re.I,
)
NUMERIC_DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b")
WHEN_LABEL_RE = re.compile(r"^(?:когда|when|date|дата)\s*[:：]\s*", re.I)


def _line_has_date(line: str) -> bool:
    return bool(
        RU_MONTH_WORD_RE.search(line)
        or EN_MONTH_WORD_RE.search(line)
        or NUMERIC_DATE_RE.search(line)
    )


def _split_multi_day_line(line: str) -> list[str]:
    """«1 и 4 апреля» → ['1 апреля…', '4 апреля…'] so each day stays separate."""
    m = RU_MONTH_WORD_RE.search(line)
    if not m:
        return [line]
    month = m.group(2)
    head = line[: m.start()]
    days = [
        int(d)
        for d in re.findall(r"\b(\d{1,2})\b(?=\s*(?:,|;|\sи\s|/|\s*$))", head)
        if 1 <= int(d) <= 31
    ]
    if not days:
        return [line]
    tail = line[m.end() :]
    return [f"{day} {month}{tail}" for day in [*days, int(m.group(1))]]


def event_occurrences(raw: str | None) -> list[dict[str, Any]]:
    """Every date in the post, in reading order. One public event per entry."""
    if not (raw or "").strip():
        return []
    text = _demath_text(raw)
    year_m = re.search(r"\b(20\d{2})\b", text)
    year_hint = f" {year_m.group(1)}" if year_m else ""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line or not _line_has_date(line):
            continue
        value = WHEN_LABEL_RE.sub("", line)
        for fragment in _split_multi_day_line(value):
            with_year = (
                fragment if re.search(r"\b20\d{2}\b", fragment) else fragment + year_hint
            )
            label, starts_at = _parse_when(with_year)
            if not starts_at:
                continue
            key = starts_at[:16]
            if key in seen:
                continue
            seen.add(key)
            out.append({"label": _parse_when(fragment)[0], "starts_at": starts_at})
    return out


def event_day_keys(raw: str | None) -> list[str]:
    """Day-level date keys (YYYY-MM-DD) of every session announced in the post."""
    keys = {occ["starts_at"][:10] for occ in event_occurrences(raw) if occ.get("starts_at")}
    return sorted(keys)


def same_event_dates(a: str | None, b: str | None) -> bool:
    """Two event ads are the same event only when their dates overlap.

    Unknown dates on either side → fall back to «may be the same».
    """
    ka, kb = set(event_day_keys(a)), set(event_day_keys(b))
    if not ka or not kb:
        return True
    return bool(ka & kb)


def _parse_where(raw: str) -> dict[str, str | None]:
    line = re.sub(r"\s+", " ", raw).strip()
    zip_m = re.search(r"\b(\d{5})(?:-\d{4})?\b", line)
    postal = zip_m.group(1) if zip_m else None
    city_zip = re.search(
        r",\s*([A-Za-z][A-Za-z .'-]+?)\s*,\s*(?:CA|California)?\s*(\d{5})\b",
        line,
        re.I,
    )
    if city_zip:
        city = city_zip.group(1).strip()
        before = line[: city_zip.start()].rstrip(", ").strip()
        return {
            "address_line": before or line,
            "city": city,
            "postal_code": city_zip.group(2) or postal,
        }
    return {"address_line": line, "city": None, "postal_code": postal}


def _parse_price(raw: str) -> tuple[str, float | None]:
    label = re.sub(r"\s+", " ", raw).strip()[:120]
    m = re.search(r"\$\s*(\d+(?:[.,]\d{1,2})?)", label)
    if m:
        try:
            return label, float(m.group(1).replace(",", "."))
        except ValueError:
            return label, None
    return label, None


def _parse_payment_methods(text: str) -> list[str]:
    labeled = _labeled(
        text,
        (
            "Как оплатить",
            "Оплата",
            "Payment",
            "Payments",
            "Pay with",
            "Способ оплаты",
            "Способы оплаты",
        ),
    ) or ""
    hay = f"{labeled}\n{text}"
    found: list[str] = []
    for pattern, label in PAYMENT_METHOD_PATTERNS:
        if pattern.search(hay) and label not in found:
            found.append(label)
    return found


# Public common extractor — payment methods are shared by every entity kind.
parse_payment_methods = _parse_payment_methods


def _prefer_registration(urls: list[str]) -> str | None:
    def score(u: str) -> int:
        low = u.lower()
        if "forms.gle" in low or "docs.google.com/forms" in low:
            return 0
        if "eventbrite" in low or "partiful" in low:
            return 1
        return 5

    return sorted(urls, key=score)[0] if urls else None


def _demath_text(raw: str) -> str:
    """Strip decorative math/emoji alnum lines; keep readable copy."""
    out: list[str] = []
    for ch in raw:
        cp = ord(ch)
        for start, end, base in (
            (0x1D7CE, 0x1D7D7, 48),
            (0x1D7E2, 0x1D7EB, 48),
            (0x1D7EC, 0x1D7F5, 48),
            (0x1D400, 0x1D419, 65),
            (0x1D41A, 0x1D433, 97),
            (0x1D5D4, 0x1D5ED, 65),
            (0x1D5EE, 0x1D607, 97),
        ):
            if start <= cp <= end:
                out.append(chr(base + (cp - start)))
                break
        else:
            out.append(ch)
    text = "".join(out)
    lines = []
    for ln in text.splitlines():
        t = ln.strip()
        if not t:
            continue
        # Skip pure decoration (🔠🔤 / emoji digit banners)
        letters = re.sub(r"[^\wа-яА-ЯёЁ]+", "", t, flags=re.U)
        if len(letters) < 3 and re.search(r"[🔠🔤]|[\U0001F100-\U0001F1FF]", t):
            continue
        if re.fullmatch(r"[🔠🔤\W\d\s]+", t):
            continue
        lines.append(ln)
    return "\n".join(lines)


# Public alias — same decoration cleanup is reused by entity_title_from_text.
demath_text = _demath_text


def structure_event_from_text(raw: str | None) -> dict[str, Any]:
    empty = {
        "event_at_label": None,
        "starts_at": None,
        "occurrences": [],
        "address_line": None,
        "city": None,
        "postal_code": None,
        "price_label": None,
        "price_amount": None,
        "payment_methods": [],
        "phone": None,
        "registration_url": None,
        "website": [],
        "instagram": [],
        "email": [],
        "description": None,
        "date_from_labeled_field": False,
    }
    if not (raw or "").strip():
        return empty

    text = _demath_text(raw)

    when_raw = _labeled(text, ("Когда", "When", "Date", "Дата"))
    occurrences = event_occurrences(raw)
    event_at_label = None
    starts_at = None
    date_from_labeled = False
    if when_raw:
        event_at_label, starts_at = _parse_when(when_raw)
        date_from_labeled = bool(starts_at)
    elif occurrences:
        event_at_label = occurrences[0]["label"]
        starts_at = occurrences[0]["starts_at"]

    where_raw = _labeled(text, ("Где", "Where", "Адрес", "Address"))
    where = _parse_where(where_raw) if where_raw else {
        "address_line": None,
        "city": None,
        "postal_code": None,
    }

    price_raw = _labeled(text, ("Билеты", "Билет", "Tickets", "Ticket", "Цена", "Price", "Стоимость"))
    price_label, price_amount = _parse_price(price_raw) if price_raw else (None, None)
    payment_methods = _parse_payment_methods(text)

    phones: list[str] = []
    for m in PHONE_RE.finditer(re.sub(URL_RE, " ", text)):
        p = _norm_phone(m.group(0))
        if p and p not in phones:
            phones.append(p)

    emails = []
    for m in EMAIL_RE.finditer(text):
        e = m.group(0).lower()
        if e not in emails:
            emails.append(e)

    websites: list[str] = []
    for m in URL_RE.finditer(text):
        u = _norm_url(m.group(0))
        low = u.lower()
        if any(x in low for x in ("instagram.com", "t.me/", "facebook.com", "wa.me")):
            continue
        if u and u not in websites:
            websites.append(u)

    instagram: list[str] = []
    for m in CAMERA_IG_RE.finditer(text):
        h = (m.group(1) or "").lower()
        if h and h not in instagram:
            instagram.append(h)
    for m in re.finditer(r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})", text, re.I):
        h = m.group(1).lower()
        if h and h not in instagram:
            instagram.append(h)

    lines = []
    for line in text.splitlines():
        t = line.strip()
        if not t:
            continue
        if META_LINE_RE.search(t):
            continue
        if re.match(r"^https?://", t, re.I):
            continue
        if re.search(r"\bпосле\s+заполнения\s+формы\b", t, re.I):
            continue
        if CAMERA_IG_RE.search(t) and len(CAMERA_IG_RE.sub(" ", t).strip()) < 8:
            continue
        lines.append(t)
    desc = "\n".join(lines)
    desc = PHONE_RE.sub(" ", desc)
    desc = URL_RE.sub(" ", desc)
    desc = CAMERA_IG_RE.sub(" ", desc)
    desc = re.sub(r"#\w+", " ", desc)
    desc = re.sub(r"[ \t]{2,}", " ", desc)
    desc = re.sub(r"\n{3,}", "\n\n", desc).strip()
    if len(desc) < 12:
        desc = None
    else:
        desc = desc[:4000]

    return {
        "event_at_label": event_at_label,
        "starts_at": starts_at,
        "occurrences": occurrences,
        "address_line": where.get("address_line"),
        "city": where.get("city"),
        "postal_code": where.get("postal_code"),
        "price_label": price_label,
        "price_amount": price_amount,
        "payment_methods": payment_methods,
        "phone": phones[0] if phones else None,
        "registration_url": _prefer_registration(websites),
        "website": websites[:3],
        "instagram": instagram[:3],
        "email": emails[:3],
        "description": desc,
        "date_from_labeled_field": date_from_labeled,
    }


def apply_structured_event_to_queue(
    item: dict[str, Any], structured: dict[str, Any]
) -> tuple[dict[str, Any], list[str]]:
    """Fill-empty patch for import_review_items + list of filled keys."""
    patch: dict[str, Any] = {}
    filled: list[str] = []

    if _empty_list(item.get("phone")) and structured.get("phone"):
        patch["phone"] = [structured["phone"]]
        filled.append("phone")
    if _empty_list(item.get("email")) and structured.get("email"):
        patch["email"] = structured["email"]
        filled.append("email")
    if _empty_list(item.get("website")) and structured.get("website"):
        patch["website"] = structured["website"]
        filled.append("website")
    if _empty_list(item.get("instagram")) and structured.get("instagram"):
        patch["instagram"] = structured["instagram"]
        filled.append("instagram")
    if _empty_str(item.get("city")) and structured.get("city"):
        patch["city"] = structured["city"]
        filled.append("city")
    if _empty_str(item.get("address_line")) and structured.get("address_line"):
        patch["address_line"] = structured["address_line"]
        filled.append("address_line")
    if _empty_str(item.get("postal_code")) and structured.get("postal_code"):
        patch["postal_code"] = structured["postal_code"]
        filled.append("postal_code")
    if item.get("price") is None and structured.get("price_amount") is not None:
        patch["price"] = structured["price_amount"]
        patch["currency"] = "USD"
        filled.append("price")

    desc = item.get("description") or item.get("source_text") or ""
    dump = _empty_str(item.get("description")) or bool(
        META_LINE_RE.search(desc) or re.search(r"Контакты\s*:", desc, re.I) or "forms.gle" in desc.lower()
    )
    if dump and structured.get("description"):
        patch["description"] = structured["description"]
        filled.append("description")

    # Do NOT write raw_payload — DB trigger: "raw_payload is immutable".
    # Date / registration / price_label are re-parsed on Approve from source text;
    # enrich still fills regular columns + [event_date_confirmed] in review_notes.

    return patch, filled
