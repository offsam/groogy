"""Contact and text helpers shared by collect/analyze scripts."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

PHONE_RE = re.compile(
    r"(?:\+?\d[\d\-\s().]{8,}\d)",
)
# Mask http(s)/www spans so UUID path digits are not read as phones.
URL_SPAN_RE = re.compile(
    r"https?://[^\s<>\"']+|www\.[^\s<>\"']+",
    re.IGNORECASE,
)
INSTAGRAM_URL_RE = re.compile(
    r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})",
    re.IGNORECASE,
)
INSTAGRAM_LABELED_RE = re.compile(
    r"(?:instagram|инста(?:грам)?)\s*[:：]\s*@?([A-Za-z0-9._]{2,30})\b",
    re.IGNORECASE,
)
INSTAGRAM_HANDLE_RE = re.compile(
    r"(?:^|[\s(,])@([A-Za-z0-9._]{3,30})(?=[\s,).!]|$)",
)
WEBSITE_RE = re.compile(
    r"(?:https?://|www\.)[^\s<>\"']+",
    re.IGNORECASE,
)
# Bare hosts with a path (tinyurl.com/x, loveoverse.com/events/…)
BARE_WEBSITE_RE = re.compile(
    r"(?<![A-Za-z0-9@/])("
    r"(?:[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?\.)+"
    r"(?:com|net|org|io|co|app|coach|at|me|link|cc)"
    r"/[^\s<>\"']+"
    r")",
    re.IGNORECASE,
)
EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}",
)
TELEGRAM_URL_RE = re.compile(
    r"(?:t\.me/|telegram\.me/|tg://resolve\?domain=)([A-Za-z0-9_]{4,32})",
    re.IGNORECASE,
)
TELEGRAM_LABELED_RE = re.compile(
    r"(?:telegram|телеграм(?:м)?)\s*[:：]\s*@?([A-Za-z0-9_]{4,32})\b",
    re.IGNORECASE,
)
WHATSAPP_URL_RE = re.compile(
    r"https?://(?:wa\.me|api\.whatsapp\.com)/\S+",
    re.IGNORECASE,
)
WHATSAPP_LABELED_RE = re.compile(
    r"whats?app\s*[:：]\s*(\S+)",
    re.IGNORECASE,
)

# Keep Instagram false-positives down a bit.
INSTAGRAM_STOP = {
    "gmail",
    "gmail.com",
    "yahoo",
    "yahoo.com",
    "mail",
    "mail.com",
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
    "messenger",
    "whatsapp",
    "telegram",
    "facebook",
    "outlook",
    "hotmail",
}

TELEGRAM_PATH_STOP = {
    "share",
    "joinchat",
    "addstickers",
    "proxy",
    "socks",
    "iv",
}

WA_SHORTENER_HOSTS = {
    "rb.gy",
    "bit.ly",
    "bitly.com",
    "tinyurl.com",
    "t.co",
    "cutt.ly",
}

SOCIAL_HOST_MARKERS = (
    "instagram.com",
    "instagr.am",
    "facebook.com",
    "fb.com",
    "t.me/",
    "telegram.me",
    "wa.me/",
    "whatsapp.com",
)


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


# Group admins sign posts they publish for someone else. That contact belongs
# to the channel, not to the advertiser whose ad it sits under.
AD_FOOTER_RE = re.compile(
    r"^.{0,80}?(?:"
    r"по\s+(?:всем\s+)?вопросам\s+реклам\w*|"
    r"по\s+реклам\w*|"
    r"реклама\s+(?:и\s+сотрудничеств\w*|в\s+канале|у\s+нас)|"
    r"разместить\s+реклам\w*|"
    r"размещение\s+реклам\w*|"
    r"заказать\s+реклам\w*|"
    r"сотрудничество\s+и\s+реклама|"
    r"for\s+advertis\w*|"
    r"ads?\s*[:：]"
    r").{0,200}$",
    re.IGNORECASE | re.MULTILINE,
)


def mask_ad_footer(text: str) -> str:
    """Blank ad-manager lines, keeping offsets, before mining contacts."""
    return AD_FOOTER_RE.sub(lambda m: " " * len(m.group(0)), text or "")


def _mask_urls(text: str) -> str:
    """Replace URL spans with spaces (preserve offsets) so phones aren't mined from paths."""
    return URL_SPAN_RE.sub(lambda m: " " * len(m.group(0)), text or "")


# "Telegram ID: 8135793725" must not become a US phone (+18135793725).
TELEGRAM_ID_SPAN_RE = re.compile(
    r"(?:telegram\s*id|tg\s*id|user\s*id)\s*[:：]?\s*\d{6,15}",
    re.IGNORECASE,
)


def _mask_non_phone_digit_spans(text: str) -> str:
    """Blank Telegram/user id labels so their digits are not mined as phones."""
    return TELEGRAM_ID_SPAN_RE.sub(lambda m: " " * len(m.group(0)), text or "")


def extract_phones(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    scrubbed = _mask_non_phone_digit_spans(_mask_urls(mask_ad_footer(text)))
    for match in PHONE_RE.finditer(scrubbed):
        phone = normalize_phone(match.group(0))
        if phone and phone not in seen:
            seen.add(phone)
            found.append(phone)
    return found


def extract_emails(text: str) -> list[str]:
    return sorted({m.group(0).lower() for m in EMAIL_RE.finditer(mask_ad_footer(text))})


def _normalize_url(url: str) -> str:
    u = (url or "").strip().rstrip(".,);]\"'")
    if not u:
        return u
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    return u


def _url_host(url: str) -> str:
    try:
        return (urlparse(_normalize_url(url)).netloc or "").lower().removeprefix("www.")
    except Exception:
        return ""


def _is_social_or_chat_url(url: str) -> bool:
    lower = url.lower()
    return any(m in lower for m in SOCIAL_HOST_MARKERS)


def extract_whatsapp(text: str) -> list[str]:
    """Return normalized WhatsApp targets (URLs), without WHATSAPP: prefixes."""
    found: list[str] = []
    seen: set[str] = set()
    text = mask_ad_footer(text)

    def _add(raw: str) -> None:
        value = raw.strip().rstrip(".,);]\"'")
        if not value:
            return
        # Drop accidental capture of trailing punctuation-only
        if value.lower() in {"whatsapp", "whats", "app"}:
            return
        value = _normalize_url(value)
        key = value.lower()
        if key not in seen:
            seen.add(key)
            found.append(value)

    for match in WHATSAPP_URL_RE.finditer(text or ""):
        _add(match.group(0))
    for match in WHATSAPP_LABELED_RE.finditer(text or ""):
        candidate = match.group(1)
        # Only keep if it looks like a link / phone short target
        if re.search(r"(https?://|www\.|wa\.me|[\w-]+\.[\w.-]+/\S*|\+\d|\d{8,})", candidate, re.I):
            _add(candidate)
    return found


def extract_websites(text: str) -> list[str]:
    urls: list[str] = []
    seen_urls: set[str] = set()
    seen_host_paths: set[str] = set()
    text = mask_ad_footer(text)
    wa_normalized = {u.lower() for u in extract_whatsapp(text or "")}
    wa_hosts_paths = set()
    for w in wa_normalized:
        try:
            p = urlparse(w)
            wa_hosts_paths.add((p.netloc.lower().removeprefix("www."), p.path.rstrip("/")))
        except Exception:
            pass

    # WhatsApp-labeled short links on the same line should not become websites
    wa_line_urls: set[str] = set()
    for line in (text or "").splitlines():
        if re.search(r"whats?app", line, re.I):
            for match in WEBSITE_RE.finditer(line):
                wa_line_urls.add(_normalize_url(match.group(0)).lower())
            for match in BARE_WEBSITE_RE.finditer(line):
                wa_line_urls.add(_normalize_url(match.group(1)).lower())

    def _add(raw: str) -> None:
        url = _normalize_url(raw)
        if not url or _is_social_or_chat_url(url):
            return
        lower = url.lower()
        if lower in wa_normalized or lower in wa_line_urls:
            return
        try:
            p = urlparse(url)
            host = p.netloc.lower().removeprefix("www.")
            path = p.path.rstrip("/")
            if (host, path) in wa_hosts_paths:
                return
            if host in WA_SHORTENER_HOSTS and lower in wa_line_urls:
                return
            host_key = f"{host}{path}"
        except Exception:
            host_key = lower
        if lower in seen_urls or host_key in seen_host_paths:
            return
        seen_urls.add(lower)
        seen_host_paths.add(host_key)
        urls.append(url)

    for match in WEBSITE_RE.finditer(text or ""):
        _add(match.group(0))
    for match in BARE_WEBSITE_RE.finditer(text or ""):
        _add(match.group(1))
    return urls


def extract_telegram(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    text = mask_ad_footer(text)

    def _add(handle: str) -> None:
        h = handle.strip().lstrip("@").lower()
        if not h or h in TELEGRAM_PATH_STOP or h.isdigit():
            return
        if h not in seen:
            seen.add(h)
            found.append(h)

    for match in TELEGRAM_URL_RE.finditer(text or ""):
        _add(match.group(1))
    for match in TELEGRAM_LABELED_RE.finditer(text or ""):
        _add(match.group(1))
    return found


def extract_instagram(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    text = mask_ad_footer(text)
    # Handles claimed by Telegram labels must not become Instagram
    telegram_handles = set(extract_telegram(text or ""))

    def _add(handle: str) -> None:
        h = handle.strip(".").lower()
        if not h or h in INSTAGRAM_STOP or h.isdigit():
            return
        if h.endswith((".com", ".net", ".org", ".ru", ".io")):
            return
        # Multi-word display names are not handles (spaces already excluded by regex)
        if h in telegram_handles:
            return
        if h not in seen:
            seen.add(h)
            found.append(h)

    for match in INSTAGRAM_URL_RE.finditer(text or ""):
        _add(match.group(1))
    for match in INSTAGRAM_LABELED_RE.finditer(text or ""):
        # "Instagram: RND Safe Cargo" is a display name, not a handle
        after = (text or "")[match.end(1) : match.end(1) + 24]
        if re.match(r"[ \t]+[A-Za-zА-Яа-яЁё]", after):
            continue
        _add(match.group(1))
    # Bare @handles — skip if they sit on a Telegram-labeled line
    for match in INSTAGRAM_HANDLE_RE.finditer(text or ""):
        start = match.start(1)
        # look back ~40 chars for telegram label
        window = (text or "")[max(0, start - 40) : start].lower()
        if re.search(r"(?:telegram|телеграм(?:м)?)\s*[:：]?\s*@?$", window):
            continue
        if match.group(1).lower() in telegram_handles:
            continue
        _add(match.group(1))
    return found


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
