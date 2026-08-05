#!/usr/bin/env python3
"""Extract Facebook comment recommendations from existing Apify raw dumps.

No Apify calls — only local *_raw.json. Clusters by phone / Instagram / website
and writes a deduped list with mention_count.

Usage:
  python3 scripts/facebook-collector/extract_comment_recommendations.py
  python3 scripts/facebook-collector/extract_comment_recommendations.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402
from eligibility import normalize_instagram, normalize_phone  # noqa: E402

RAW_GLOBS = [
    ROOT / "scripts/facebook-collector/data/poc/multi_group_6m" / "*_raw.json",
    ROOT / "scripts/facebook-collector/data/poc" / "*_raw.json",
]
OUT_JSON = (
    ROOT
    / "scripts/facebook-collector/data/poc"
    / "comment_recommendations_clusters.json"
)

REQUEST_RE = re.compile(
    r"(подскаж|посоветуй|порекоменд|кто\s+знает|кто\s+может|"
    r"нужен\s+|нужна\s+|нужны\s+|ищ[уеи]\s+|дайте\s+(номер|контакт)|"
    r"recommend|looking\s+for|anyone\s+know|good\s+\w+\s*\?|"
    r"хорош(его|ую|ий|ей)\s+)",
    re.I,
)
# Ads / self-promo often contain "ищу клиентов" — keep request short-ish.
AD_HINT_RE = re.compile(
    r"(меня\s+зовут|с\s+опытом\s+работы|записывайтесь|прайс|\$\d{2,}|"
    r"работаю\s+уже|более\s+\d+\s+лет)",
    re.I,
)
PHONE_RE = re.compile(
    r"(?:\+?1[-.\s]*)?\(?\d{3}\)?[-.\s]*\d{3}[-.\s]*\d{4}|\+\d{10,15}"
)
URL_RE = re.compile(
    r"https?://[^\s<>\"']+|www\.[^\s<>\"']+|t\.me/[^\s<>\"']+|instagram\.com/[^\s<>\"']+",
    re.I,
)
IG_HANDLE_RE = re.compile(r"(?<!\w)@([A-Za-z0-9._]{3,30})")
TG_HANDLE_RE = re.compile(r"(?<!\w)@([A-Za-z][A-Za-z0-9_]{3,32})\b")
JUNK_HANDLES = {"everyone", "here", "channel", "admin", "facebook", "reply", "edited"}

# Facebook page / profile vanity (not groups / permalinks / photos).
FB_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:facebook|fb)\.com/"
    r"(?:pages/[^/\s?]+/)?"
    r"([A-Za-z0-9.][A-Za-z0-9._-]{1,80})"
    r"(?:[/?#]|\s|$)",
    re.I,
)
FB_SKIP_SEGMENTS = {
    "groups",
    "share",
    "story.php",
    "photo",
    "photos",
    "reel",
    "reels",
    "watch",
    "login",
    "marketplace",
    "events",
    "permalink.php",
    "profile.php",
    "people",
    "hashtag",
    "posts",
    "videos",
    "live",
    "stories",
}

# Google Maps short + place URLs.
MAPS_URL_RE = re.compile(
    r"https?://(?:maps\.app\.goo\.gl/[A-Za-z0-9_-]+|"
    r"goo\.gl/maps/[A-Za-z0-9_-]+|"
    r"(?:www\.)?google\.(?:com|[a-z]{2})/maps/[^\s<>\"']+)",
    re.I,
)
MAPS_PLACE_RE = re.compile(
    r"google\.(?:com|[a-z]{2})/maps/place/([^/?#]+)",
    re.I,
)

# «Euroman» / “only Euroman” / "Vitalii Butakov рекомендую"
QUOTED_NAME_RE = re.compile(
    r"[«\"“„]\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 .&'-]{1,48})\s*[»\"”]",
)
NAME_RECOMMEND_RE = re.compile(
    r"(?:^|\b)(?:рекоменд\w*|советую|только|есть)\s+"
    r"[«\"“]?([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 .&'-]{1,40})[»\"”]?",
    re.I,
)
NAME_BEFORE_RECOMMEND_RE = re.compile(
    r"^([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 .&'-]{1,40})\s+рекоменд\w*",
    re.I,
)
PLACE_DOT_CITY_RE = re.compile(
    r"^([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 .&'-]{1,50})\s*[·•|]\s*"
    r"([A-Za-zА-Яа-яЁё .'-]{2,40})(?:,|\s|$)",
)

NOISE_COMMENT_RE = re.compile(
    r"(какая\s+у\s+вас\s+машин|"
    r"смешанн\w*\s+брак|"
    r"лиц\w*\s+славян|"
    r"такое\s+сочетание\s+невозможно|"
    r"^reply$|^edited$|"
    r"^no\s+photo\s+description)",
    re.I,
)

CATEGORY_HINTS: list[tuple[re.Pattern[str], str]] = [
    # Real estate before "лечу" — ads often say "лечу на конференцию" without parcels.
    (re.compile(
        r"риелтор|realtor|недвижим|"
        r"инвестор\w*\s+в\s+недвижим|"
        r"покупа\w+\s+(дом|квартир)|"
        r"сдам\s+(квартир|дом|комнату)|сниму\s+(квартир|дом)",
        re.I,
    ), "риелтор"),
    (re.compile(
        r"страхов\w*\s+(случа|оценк|выплат)|урегулирован\w*\s+страхов|"
        r"оценка\s+авто|after\s+accident|auto\s+body|кузовн",
        re.I,
    ), "авто / страхование"),
    (re.compile(
        r"офисн\w*\s+помещен|офис\w*\s+в\s+аренду|commercial\s+office|"
        r"меблированн\w*\s+офис",
        re.I,
    ), "аренда офиса"),
    (re.compile(
        r"("
        r"леч(у|ит)\s+(в|из).{0,80}(возьму|посылк|передач|багаж|оказия)|"
        r"возьму\s+(с\s+собой\s+)?(посылк|передач|документы|вещи)|"
        r"могу\s+взять\s+(с\s+собой\s+)?(посылк|передач|вещи)|"
        r"есть\s+\d+\s*мест[ао]?\s+багажа|"
        r"оказия\s+(в|из)|"
        r"передать.{0,40}(посылк|вещи|документы)|"
        r"нужно\s+передать.{0,40}посылк"
        r")",
        re.I,
    ), "лечу / посылка"),
    (re.compile(
        r"перевод(ы|ов|а)?\s+(денег|средств|доллар|рубл)|"
        r"перевест(и|у).{0,20}(деньг|доллар|рубл)|"
        r"\bswift\b|\bwise\b|обмен\s+валют|money\s+transfer",
        re.I,
    ), "переводы денег"),
    (re.compile(r"сантехник|plumber|засор|смесител", re.I), "сантехник"),
    (re.compile(r"хэндимэн|handyman|мастер\s+на\s+час", re.I), "handyman"),
    (re.compile(r"электрик|electrician", re.I), "электрик"),
    (re.compile(r"нян|nanny|babysitter", re.I), "няня"),
    (re.compile(r"масс[аa]ж", re.I), "массаж"),
    (re.compile(r"парикмахер|барбер|barber|стрижк", re.I), "парикмахер"),
    (re.compile(r"визаж|make[\s-]?up|макияж|pmu|брови|ресниц", re.I), "визаж / beauty"),
    (re.compile(r"ботокс|инъекц|косметолог|филлер", re.I), "косметология"),
    (re.compile(r"фотограф|видеограф|photographer", re.I), "фото / видео"),
    (re.compile(r"таргет|реклам|smm", re.I), "маркетинг"),
    (re.compile(r"клинер|химчистк|авто\s*мойк|detail|мойк\w*\s+окон", re.I), "клининг"),
    (re.compile(r"плаван|swim", re.I), "плавание"),
    (re.compile(r"catering|доставк\w*\s+ед|кейтеринг|букет", re.I), "кейтеринг / цветы"),
    (re.compile(r"wrap|тониров|переклеит\w*\s+авто", re.I), "авто / детейлинг"),
    (
        re.compile(
            r"маляр|покраск\w*\s+авто|автосервис|механик|автомастер|"
            r"ходов(ая|ой|ую)|collision|garage|авто\s*сервис|"
            r"кузовн|подвеск",
            re.I,
        ),
        "автосервис",
    ),
    (re.compile(r"юрист|адвокат|immigration", re.I), "юрист"),
    (re.compile(r"бухгалтер|tax\b|налог|notary|нотариус", re.I), "бухгалтерия / нотариус"),
    (re.compile(r"репетитор|tutor|учитель", re.I), "репетитор"),
    (re.compile(r"архитектор|контрактор|строител|ремонт|полы|prefab|прифаб", re.I), "ремонт / стройка"),
    (re.compile(r"водитель|cdl|cargo\s*van", re.I), "водитель"),
]

EVENT_SIGNAL_RE = re.compile(
    r"("
    r"прямой\s+эфир|эфир\s+(сегодня|завтра|уже)|youtube[\s-]?стрим|youtube[\s-]?эфир|"
    r"вебинар|мастер[\s-]?класс|workshop|meetup|конференц|"
    r"мероприят|регистрац\w+\s+(на|по)|запись\s+на\s+(эфир|мероприят|вебинар)|"
    r"eventbrite|lu\.ma|partiful|"
    r"\b\d{1,2}\s*[–—\-]\s*\d{1,2}\s+август|"
    r"\b\d{1,2}\s+августа\b|"
    r"(january|february|march|april|may|june|july|august|september)\s+\d{1,2}"
    r")",
    re.I,
)
EVENT_DATE_RE = re.compile(
    r"("
    r"\b\d{1,2}\s*[–—\-]\s*\d{1,2}\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\w*"
    r"|"
    r"\b\d{1,2}\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\w*"
    r"|"
    r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}"
    r"|"
    r"\b\d{1,2}/\d{1,2}(/\d{2,4})?\b"
    r")",
    re.I,
)


def is_event_post(text: str) -> bool:
    if not text or len(text) < 40:
        return False
    if not EVENT_SIGNAL_RE.search(text):
        return False
    # Strong: explicit stream/webinar/meetup OR date + registration link vibe
    strong = bool(
        re.search(
            r"эфир|вебинар|мастер[\s-]?класс|workshop|meetup|конференц|"
            r"мероприят|eventbrite|lu\.ma|открытый\s+урок",
            text,
            re.I,
        )
    )
    if strong:
        return True
    return bool(EVENT_DATE_RE.search(text) and re.search(r"https?://", text))


def event_title_from_text(text: str) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    # Prefer first line-ish up to emoji block
    title = clean[:120]
    for sep in (" http", " 🏠", " 🔥", " 📢", " 🔴"):
        if sep in f" {title}":
            title = title.split(sep)[0].strip()
    return title[:100] or "Мероприятие"


def event_when_from_text(text: str) -> str | None:
    m = EVENT_DATE_RE.search(text or "")
    return m.group(0).strip() if m else None


# Recurring webinar / coaching spam: many posts, one brand, rotating copy.
EVENT_SERIES_BRANDS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r"usabytemamila|"
            r"svet[_]?lana[_]?zaychenko|"
            r"светлан\w*\s+зайчен|"
            r"@svet_lana_zaychenko",
            re.I,
        ),
        "usabytemamila.com",
    ),
]


def event_series_brand(text: str, websites: list[str]) -> str | None:
    for w in websites:
        host = website_root_host(w)
        if host and "usabytemamila" in host:
            return "usabytemamila.com"
    blob = text or ""
    for pattern, brand in EVENT_SERIES_BRANDS:
        if pattern.search(blob):
            return brand
    return None


def event_title_fingerprint(text: str) -> str:
    """Normalize promo titles so near-duplicate posts collapse."""
    t = event_title_from_text(text).lower()
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub(
        r"\b\d{1,2}\s*[–—\-]?\s*\d{0,2}\s*"
        r"(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|"
        r"january|february|march|april|may|june|july|august|september)\w*",
        " ",
        t,
        flags=re.I,
    )
    t = re.sub(r"[^\w\sа-яё]+", " ", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:72]


def merge_event_dates(current: str | None, incoming: str | None) -> str | None:
    if not incoming:
        return current
    if not current:
        return incoming
    base = current.replace(" и др.", "").strip()
    parts = [p.strip() for p in base.split(",") if p.strip()]
    if incoming in parts:
        return ", ".join(parts[:3]) + (" и др." if len(parts) > 3 else "")
    parts.append(incoming)
    if len(parts) <= 3:
        return ", ".join(parts)
    return ", ".join(parts[:3]) + " и др."


def event_cluster_key(text: str, url: str | None, websites: list[str]) -> str:
    brand = event_series_brand(text, websites)
    if brand:
        # One card for the whole promo series (Zaichenko / USAbyTemamila, etc.)
        return f"event:series:{brand}"
    for w in websites:
        host = website_root_host(w)
        if host:
            # Same landing site → one event series, not one card per date
            return f"event:web:{host}"
    fp = event_title_fingerprint(text)
    if len(fp) >= 28:
        return f"event:title:{hash(fp) & 0xFFFFFFFF:x}"
    if url:
        return f"event:post:{url.split('?')[0]}"
    when = (event_when_from_text(text) or "").lower()
    title = event_title_from_text(text).lower()
    return f"event:title:{hash(title + when) & 0xFFFFFFFF:x}"


# Hub city from Facebook group dump stem when post text has no city.
GROUP_CITY = {
    "full_group_6m": "Лос-Анджелес",
    "audit": "Лос-Анджелес",
    "russiansf": "Сан-Франциско",
    "sacramento": "Сакраменто",
    "group_201388609209577": "Сакраменто",
}

CITY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r"\b(Los\s*Angeles|LA\b|Лос[-\s]?Анджелес\w*|Глендейл|Glendale|Burbank|Бурбанк)\b",
            re.I,
        ),
        "Лос-Анджелес",
    ),
    (
        re.compile(
            r"\b(San\s*Francisco|SF\b|Bay\s*Area|Сан[-\s]?Франциско|Окленд|Oakland|Peninsula)\b",
            re.I,
        ),
        "Сан-Франциско",
    ),
    (
        re.compile(
            r"\b(Sacramento|Сакраменто|Roseville|Elk\s*Grove|Rancho\s*Cordova)\b",
            re.I,
        ),
        "Сакраменто",
    ),
    (
        re.compile(r"\b(Orange\s*County|Irvine|Айрвин|OC\b|Орендж)\b", re.I),
        "Orange County",
    ),
    (
        re.compile(
            r"\b(Huntington\s*Beach|Costa\s*Mesa|Garden\s*Grove|Laguna\s*Niguel|"
            r"Newport\s*Beach|Anaheim|Santa\s*Ana|Fullerton|Alhambra|"
            r"Хантингтон|Коста\s*Меса|Гарден\s*Гроув)\b",
            re.I,
        ),
        "Orange County",
    ),
    (re.compile(r"\b(San\s*Diego|Сан[-\s]?Диего)\b", re.I), "Сан-Диего"),
]


def city_from_text(text: str) -> str | None:
    if not text:
        return None
    for pattern, label in CITY_PATTERNS:
        if pattern.search(text[:1200]):
            return label
    return None


def city_from_group(group: str) -> str | None:
    return GROUP_CITY.get(group)


def resolve_city(
    *,
    text: str = "",
    group: str | None = None,
    existing: str | None = None,
) -> str | None:
    """Prefer city already on the card, then text mention, then FB group hub."""
    if existing:
        return existing
    from_text = city_from_text(text)
    if from_text:
        return from_text
    if group:
        return city_from_group(group)
    return None


# Prefer these when merging conflicting categories for the same contact.
CATEGORY_PRIORITY = {
    "авто / страхование": 90,
    "автосервис": 85,
    "авто / детейлинг": 80,
    "сантехник": 70,
    "handyman": 70,
    "риелтор": 60,
    "аренда офиса": 40,
    "событие": 55,
    "услуга / специалист": 10,
}


def clean_display_name(raw: str | None, *, fallback: str | None = None) -> str | None:
    name = (raw or "").strip()
    if not name:
        name = (fallback or "").strip()
    if not name:
        return None
    # Drop long sentence intros → keep first short phrase if looks like greeting
    if len(name) > 48 or re.match(
        r"^(здравств|добр|привет|я\s+могу|я\s+работа|я\s+хожу)", name, re.I
    ):
        # Prefer FB author fallback when comment body is a pitch
        if fallback and fallback.strip() and fallback.strip() != name:
            name = fallback.strip()
        else:
            # "Я хожу к Марии Очень довольна" → Мария
            m = re.search(r"к\s+([A-ZА-ЯЁ][a-zа-яё]+)", name)
            if m:
                name = m.group(1)
            else:
                words = re.findall(r"[A-Za-zА-Яа-яЁё]{2,}", name)
                if 1 <= len(words) <= 3 and len(" ".join(words)) <= 40:
                    name = " ".join(words)
                else:
                    return fallback.strip() if fallback and fallback.strip() else None
    # Anon FB placeholders / phone-as-name
    if re.match(
        r"^(lavender|thoughtful|gentle|cheerful|productive)\w+\d+$", name, re.I
    ):
        return None
    if re.match(r"^\+?\d[\d\s\-()]{6,}$", name):
        return None
    if re.search(r"\bmibextid\b|\bid\s+\d+", name, re.I):
        return None
    if len(name) < 2:
        return None
    return name[:80]


def pick_better_category(current: str | None, incoming: str | None) -> str | None:
    if not incoming:
        return current
    if not current:
        return incoming
    if current == incoming:
        return current
    return max(
        (current, incoming),
        key=lambda c: CATEGORY_PRIORITY.get(c, 50),
    )


def load_raw_posts() -> list[tuple[str, dict[str, Any]]]:
    files: list[Path] = []
    for pattern in RAW_GLOBS:
        files.extend(sorted(pattern.parent.glob(pattern.name)))
    files = sorted({f.resolve() for f in files if f.is_file()})
    out: list[tuple[str, dict[str, Any]]] = []
    seen_post: set[str] = set()
    for path in files:
        group = path.stem.replace("_raw", "")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"skip {path}: {exc}", file=sys.stderr)
            continue
        if not isinstance(data, list):
            continue
        for post in data:
            if not isinstance(post, dict):
                continue
            pid = post_key(post)
            if pid in seen_post:
                continue
            seen_post.add(pid)
            out.append((group, post))
    return out


def post_key(post: dict[str, Any]) -> str:
    for k in ("postId", "post_id", "id"):
        v = post.get(k)
        if v:
            return f"id:{v}"
    url = post_url(post)
    if url:
        return f"url:{url.split('?')[0]}"
    text = (post_text(post) or "")[:80]
    return f"text:{hash(text)}"


def post_text(post: dict[str, Any]) -> str:
    for k in ("text", "message", "postText", "post_text"):
        v = post.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def post_url(post: dict[str, Any]) -> str | None:
    for k in ("url", "postUrl", "facebookUrl", "permalink", "post_url"):
        v = post.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
    return None


def post_comments(post: dict[str, Any]) -> list[dict[str, Any]]:
    for k in ("topComments", "comments", "commentList"):
        v = post.get(k)
        if isinstance(v, list):
            return [c for c in v if isinstance(c, dict)]
    return []


def comment_author(c: dict[str, Any]) -> str | None:
    a = c.get("author")
    if isinstance(a, dict):
        name = a.get("name") or a.get("profileName")
        if name:
            return str(name).strip() or None
    for k in ("profileName", "authorName", "name"):
        if c.get(k):
            return str(c[k]).strip() or None
    return None


def guess_category(request_text: str) -> str | None:
    for pattern, label in CATEGORY_HINTS:
        if pattern.search(request_text):
            return label
    return None


def strip_invisible(text: str) -> str:
    """Drop FB spam combining marks / zero-width junk from pasted or scraped text."""
    if not text:
        return ""
    t = text.replace("\u00a0", " ")
    t = re.sub(r"[\u200b-\u200f\u202a-\u202e\ufe0e\ufe0f\ufeff]", "", t)
    # Combining marks used to obfuscate (r͏t͏S͏…)
    t = re.sub(r"[\u0300-\u036f\u0483-\u0489\u1ab0-\u1aff\u1dc0-\u1dff]", "", t)
    return t


def facebook_page_slug(href: str) -> str | None:
    low = (href or "").lower()
    if "facebook.com" not in low and "fb.com" not in low:
        return None
    m = FB_URL_RE.search(href)
    if not m:
        return None
    slug = m.group(1).strip(".")
    if not slug or slug.lower() in FB_SKIP_SEGMENTS:
        return None
    if slug.lower() in {"home", "watch", "gaming", "marketplace"}:
        return None
    return slug


def maps_cluster_token(href: str) -> str | None:
    low = (href or "").lower()
    if not any(
        x in low
        for x in ("maps.app.goo.gl", "goo.gl/maps", "google.com/maps", "google.ru/maps")
    ):
        return None
    place = MAPS_PLACE_RE.search(href)
    if place:
        raw = place.group(1)
        try:
            from urllib.parse import unquote

            name = unquote(raw).replace("+", " ").strip()
        except Exception:  # noqa: BLE001
            name = raw.replace("+", " ").strip()
        name = re.sub(r"\s+", " ", name)
        if len(name) >= 3:
            return f"place:{name.lower()[:60]}"
    # short link path
    m = re.search(r"(?:maps\.app\.goo\.gl|goo\.gl/maps)/([A-Za-z0-9_-]+)", href, re.I)
    if m:
        return f"short:{m.group(1).lower()}"
    return f"url:{hash(href.split('?')[0]) & 0xFFFFFFFF:x}"


def guess_business_name(text: str) -> str | None:
    """Name from quoted / recommend phrasing / «Place · City» lines."""
    raw = strip_invisible(text or "").strip()
    if not raw or NOISE_COMMENT_RE.search(raw):
        return None
    for pattern in (QUOTED_NAME_RE, NAME_BEFORE_RECOMMEND_RE, NAME_RECOMMEND_RE):
        m = pattern.search(raw)
        if m:
            candidate = clean_display_name(m.group(1))
            if candidate and len(candidate) >= 2:
                return candidate
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.lower() in {"reply", "edited", "facebook", "google.com"}:
            continue
        m = PLACE_DOT_CITY_RE.match(line)
        if m:
            candidate = clean_display_name(m.group(1))
            if candidate:
                return candidate
        # FB page title lines often repeat brand without punctuation
        if (
            3 <= len(line) <= 60
            and not URL_RE.search(line)
            and not PHONE_RE.search(line)
            and re.search(r"[A-Za-zА-Яа-яЁё]", line)
            and not NOISE_COMMENT_RE.search(line)
            and (
                re.search(r"\b(collision|garage|auto|llc|inc|center|studio|shop)\b", line, re.I)
                or re.search(r"[A-ZА-ЯЁ][a-zа-яё]+(?:\s+[A-ZА-ЯЁ][a-zа-яё]+){0,4}", line)
            )
        ):
            # Prefer lines that look like brand titles (few lowercase filler words)
            words = line.split()
            if 1 <= len(words) <= 6:
                candidate = clean_display_name(line)
                if candidate:
                    return candidate
    return None


def extract_contacts_from_comment(text: str) -> dict[str, Any]:
    text = strip_invisible(text or "")
    phones: list[str] = []
    for raw in PHONE_RE.findall(text):
        n = normalize_phone(raw)
        if n and n not in phones:
            phones.append(n)
    ig: list[str] = []
    websites: list[str] = []
    facebook_pages: list[str] = []
    maps_urls: list[str] = []
    telegram: list[str] = []

    for raw in MAPS_URL_RE.findall(text):
        href = raw.rstrip(").,;\"'")
        if href not in maps_urls:
            maps_urls.append(href.split("?")[0][:300])
            if href not in websites:
                websites.append(href.split("?")[0][:300])

    for raw in URL_RE.findall(text):
        href = raw if raw.lower().startswith("http") else f"https://{raw}"
        href = href.rstrip(").,;\"'")
        handle = normalize_instagram(href)
        if handle and handle.lower() not in JUNK_HANDLES and handle not in ig:
            ig.append(handle)
            continue
        low = href.lower()
        if "instagram.com" in low:
            continue
        fb_slug = facebook_page_slug(href)
        if fb_slug:
            if fb_slug.lower() not in {x.lower() for x in facebook_pages}:
                facebook_pages.append(fb_slug)
            # Keep as website so admin sees the link
            clean_fb = f"https://www.facebook.com/{fb_slug}"
            if clean_fb not in websites:
                websites.append(clean_fb)
            continue
        if any(x in low for x in ("maps.app.goo.gl", "goo.gl/maps", "/maps/")):
            continue
        try:
            host = (urlparse(href).hostname or "").lower()
        except Exception:  # noqa: BLE001
            host = ""
        if host and host not in {"t.me", "www.t.me", "wa.me"} and href not in websites:
            if website_root_host(href):
                websites.append(href.split("?")[0][:200])
            elif "t.me/" in low or "telegram.me/" in low:
                m = re.search(r"(?:t\.me|telegram\.me)/([A-Za-z0-9_]+)", href, re.I)
                if m and m.group(1).lower() not in JUNK_HANDLES:
                    tg = m.group(1)
                    if tg not in telegram:
                        telegram.append(tg)

    for m in IG_HANDLE_RE.findall(text):
        handle = normalize_instagram(m)
        if handle and handle.lower() not in JUNK_HANDLES and handle not in ig:
            # @boldcarsshop may be telegram — keep as ig if looks like ig, else telegram
            if handle.lower().startswith("bold") or "car" in handle.lower():
                if handle not in telegram:
                    telegram.append(handle)
            ig.append(handle)

    name = guess_business_name(text)
    if not name:
        # Fallback: strip contacts from short comments
        cleaned = text
        for p in PHONE_RE.findall(cleaned):
            cleaned = cleaned.replace(p, " ")
        for u in URL_RE.findall(cleaned):
            cleaned = cleaned.replace(u, " ")
        for u in MAPS_URL_RE.findall(cleaned):
            cleaned = cleaned.replace(u, " ")
        cleaned = IG_HANDLE_RE.sub(" ", cleaned)
        cleaned = re.sub(r"[^\w\s\-'.а-яА-ЯёЁ]", " ", cleaned, flags=re.UNICODE)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" -'")
        if 2 <= len(cleaned) <= 80 and cleaned.lower() not in JUNK_HANDLES:
            name = clean_display_name(cleaned)

    return {
        "phones": phones,
        "instagram": ig,
        "websites": websites,
        "facebook_pages": facebook_pages,
        "maps_urls": maps_urls,
        "telegram": telegram,
        "name": name,
    }


def website_root_host(href: str) -> str | None:
    try:
        host = (urlparse(href).hostname or "").lower().removeprefix("www.")
    except Exception:  # noqa: BLE001
        return None
    if not host or "." not in host:
        return None
    # Skip social / video hosts as *marketing website* (FB/maps handled separately)
    if any(
        host == h or host.endswith("." + h)
        for h in (
            "facebook.com",
            "fb.com",
            "instagram.com",
            "youtube.com",
            "youtu.be",
            "t.me",
            "telegram.me",
            "wa.me",
            "tiktok.com",
            "google.com",
            "google.ru",
            "maps.app.goo.gl",
            "goo.gl",
            "bit.ly",
            "linktr.ee",
        )
    ):
        return None
    parts = host.split(".")
    if len(parts) >= 3 and parts[-1] in {"com", "net", "org", "us", "io"}:
        # vegas.usabytemamila.com → usabytemamila.com
        host = ".".join(parts[-2:])
    return host


def cluster_key(contacts: dict[str, Any]) -> str | None:
    if contacts.get("phones"):
        return f"phone:{contacts['phones'][0]}"
    if contacts.get("instagram"):
        return f"ig:{contacts['instagram'][0].lower()}"
    if contacts.get("facebook_pages"):
        return f"fb:{contacts['facebook_pages'][0].lower()}"
    if contacts.get("maps_urls"):
        tok = maps_cluster_token(contacts["maps_urls"][0])
        if tok:
            return f"maps:{tok}"
    if contacts.get("websites"):
        for w in contacts["websites"]:
            host = website_root_host(w)
            if host:
                return f"web:{host}"
            fb = facebook_page_slug(w)
            if fb:
                return f"fb:{fb.lower()}"
            tok = maps_cluster_token(w)
            if tok:
                return f"maps:{tok}"
    name = (contacts.get("name") or "").strip()
    if name and len(name) >= 3 and not NOISE_COMMENT_RE.search(name):
        # Name-only recommendations (Euroman, Vitalii Butakov)
        norm = re.sub(r"[^a-z0-9а-яё]+", "", name.lower(), flags=re.I)
        if len(norm) >= 4:
            return f"name:{norm[:48]}"
    return None


def is_noise_comment(text: str) -> bool:
    t = strip_invisible(text or "").strip()
    if not t or len(t) < 2:
        return True
    if NOISE_COMMENT_RE.search(t):
        return True
    if t.lower() in {"reply", "edited", "facebook", "google.com"}:
        return True
    return False


def is_request_post(text: str) -> bool:
    if not text or len(text) < 15:
        return False
    if not REQUEST_RE.search(text[:900]):
        return False
    # Long self-promo with "ищу клиентов" style
    if len(text) > 600 and AD_HINT_RE.search(text):
        return False
    return True


def build_clusters() -> dict[str, Any]:
    posts = load_raw_posts()
    clusters: dict[str, dict[str, Any]] = {}
    stats = defaultdict(int)
    stats["posts_scanned"] = len(posts)

    for group, post in posts:
        text = post_text(post)
        if not is_request_post(text):
            continue
        stats["request_posts"] += 1
        comments = post_comments(post)
        if not comments:
            continue
        stats["request_with_comments"] += 1
        url = post_url(post)
        posted = post.get("timestamp") or post.get("time") or post.get("date")
        cat = guess_category(text)

        for c in comments:
            ctext = strip_invisible((c.get("text") or "").strip())
            if is_noise_comment(ctext):
                continue
            contacts = extract_contacts_from_comment(ctext)
            key = cluster_key(contacts)
            if not key:
                continue
            stats["useful_comment_mentions"] += 1
            row = clusters.get(key)
            author = comment_author(c)
            nice_name = clean_display_name(contacts.get("name"), fallback=author)
            if not row:
                row = {
                    "cluster_key": key,
                    "kind": "profi",
                    "display_name": nice_name,
                    "phones": list(contacts["phones"]),
                    "instagram": list(contacts["instagram"]),
                    "websites": list(contacts["websites"]),
                    "mention_count": 0,
                    "third_party_mention_count": 0,
                    "self_ad_mention_count": 0,
                    "comment_texts": [],
                    "request_snippets": [],
                    "source_post_urls": [],
                    "source_groups": [],
                    "category_guess": cat,
                    "recommender_names": [],
                    "last_posted_at": None,
                    "event_at": None,
                    "city": None,
                }
                clusters[key] = row
            row["mention_count"] += 1
            row["third_party_mention_count"] = int(
                row.get("third_party_mention_count") or 0
            ) + 1
            row["city"] = resolve_city(
                text=f"{ctext}\n{text}", group=group, existing=row.get("city")
            )
            if nice_name and (
                not row["display_name"]
                or (
                    len(nice_name) < len(row["display_name"] or "")
                    and " " in nice_name
                )
            ):
                row["display_name"] = nice_name
            if not row["display_name"] and nice_name:
                row["display_name"] = nice_name
            # Prefer IG handle as nickname when no name
            if not row["display_name"] and contacts.get("instagram"):
                row["display_name"] = f"@{contacts['instagram'][0]}"
            for p in contacts["phones"]:
                if p not in row["phones"]:
                    row["phones"].append(p)
            for ig in contacts["instagram"]:
                if ig not in row["instagram"]:
                    row["instagram"].append(ig)
            for w in contacts["websites"]:
                if w not in row["websites"]:
                    row["websites"].append(w)
            if ctext not in row["comment_texts"] and len(row["comment_texts"]) < 8:
                row["comment_texts"].append(ctext[:300])
            snippet = re.sub(r"\s+", " ", text)[:180]
            if snippet and snippet not in row["request_snippets"] and len(row["request_snippets"]) < 6:
                row["request_snippets"].append(snippet)
            if url and url not in row["source_post_urls"] and len(row["source_post_urls"]) < 10:
                row["source_post_urls"].append(url)
            if group not in row["source_groups"]:
                row["source_groups"].append(group)
            if author and author not in row["recommender_names"] and len(row["recommender_names"]) < 12:
                row["recommender_names"].append(author)
            if not row["category_guess"] and cat:
                row["category_guess"] = cat
            elif cat:
                row["category_guess"] = pick_better_category(row["category_guess"], cat)
            if posted:
                # Normalize to timestamptz-friendly ISO when possible
                raw_posted = str(posted).strip()
                try:
                    if raw_posted.endswith("Z") or "+" in raw_posted[10:]:
                        row["last_posted_at"] = raw_posted
                    else:
                        row["last_posted_at"] = raw_posted.replace(" ", "T")
                        if not row["last_posted_at"].endswith("Z") and "+" not in row[
                            "last_posted_at"
                        ][10:]:
                            row["last_posted_at"] = row["last_posted_at"] + "Z"
                except Exception:  # noqa: BLE001
                    row["last_posted_at"] = None

    # Direct offer posts: лечу / переводы / realtor / auto — not event promos
    for group, post in posts:
        text = post_text(post)
        if is_event_post(text):
            continue
        cat = guess_category(text)
        if cat not in {
            "лечу / посылка",
            "переводы денег",
            "риелтор",
            "аренда офиса",
            "авто / страхование",
        }:
            continue
        # Skip real-estate event spam unless it has a clear contact + realtor signal
        if cat == "риелтор" and not re.search(
            r"недвижим|риелтор|realtor|инвестор|квартир|дом\b", text, re.I
        ):
            continue
        contacts = extract_contacts_from_comment(text)
        key = cluster_key(contacts)
        if not key:
            continue
        stats["direct_offer_posts"] += 1
        author = None
        user = post.get("user") or post.get("author")
        if isinstance(user, dict):
            author = user.get("name") or user.get("profileName")
        elif isinstance(user, str):
            author = user
        author = author or post.get("authorName") or post.get("profileName")
        nice_name = clean_display_name(contacts.get("name"), fallback=str(author) if author else None)
        if not nice_name and contacts.get("instagram"):
            nice_name = f"@{contacts['instagram'][0]}"
        row = clusters.get(key)
        if not row:
            row = {
                "cluster_key": key,
                "kind": "profi",
                "display_name": nice_name,
                "phones": list(contacts["phones"]),
                "instagram": list(contacts["instagram"]),
                "websites": list(contacts["websites"]),
                "mention_count": 0,
                "third_party_mention_count": 0,
                "self_ad_mention_count": 0,
                "comment_texts": [],
                "request_snippets": [],
                "source_post_urls": [],
                "source_groups": [],
                "category_guess": cat,
                "recommender_names": [],
                "last_posted_at": None,
                "event_at": None,
                "city": None,
            }
            clusters[key] = row
        row["mention_count"] += 1
        row["self_ad_mention_count"] = int(row.get("self_ad_mention_count") or 0) + 1
        row["city"] = resolve_city(text=text, group=group, existing=row.get("city"))
        if nice_name and not row.get("display_name"):
            row["display_name"] = nice_name
        # Brand hints beat weak categories
        brand = f"{nice_name or ''} {row.get('display_name') or ''}"
        if re.search(r"\bmotors\b|автосалон", brand, re.I):
            cat = pick_better_category(cat, "авто / страхование")
        row["category_guess"] = pick_better_category(row.get("category_guess"), cat)
        snippet = re.sub(r"\s+", " ", text)[:180]
        if snippet and snippet not in row["request_snippets"] and len(row["request_snippets"]) < 6:
            row["request_snippets"].append(snippet)
        url = post_url(post)
        if url and url not in row["source_post_urls"] and len(row["source_post_urls"]) < 10:
            row["source_post_urls"].append(url)
        if group not in row["source_groups"]:
            row["source_groups"].append(group)
        for p in contacts["phones"]:
            if p not in row["phones"]:
                row["phones"].append(p)
        for ig in contacts["instagram"]:
            if ig not in row["instagram"]:
                row["instagram"].append(ig)

    # Event promos (webinars, meetups, conferences) — separate from profi cards
    for group, post in posts:
        text = post_text(post)
        if not is_event_post(text):
            continue
        contacts = extract_contacts_from_comment(text)
        url = post_url(post)
        key = event_cluster_key(text, url, list(contacts.get("websites") or []))
        stats["event_posts"] += 1
        author = None
        user = post.get("user") or post.get("author")
        if isinstance(user, dict):
            author = user.get("name") or user.get("profileName")
        elif isinstance(user, str):
            author = user
        author = author or post.get("authorName") or post.get("profileName")
        title = event_title_from_text(text)
        when = event_when_from_text(text)
        row = clusters.get(key)
        if not row:
            series0 = event_series_brand(text, list(contacts.get("websites") or []))
            row = {
                "cluster_key": key,
                "kind": "event",
                "display_name": (
                    "USAbyTemamila — эфиры / вебинары по недвижимости"
                    if series0 == "usabytemamila.com"
                    else title
                ),
                "phones": list(contacts.get("phones") or []),
                "instagram": list(contacts.get("instagram") or []),
                "websites": list(contacts.get("websites") or []),
                "mention_count": 0,
                "third_party_mention_count": 0,
                "self_ad_mention_count": 0,
                "comment_texts": [],
                "request_snippets": [],
                "source_post_urls": [],
                "source_groups": [],
                "category_guess": "событие",
                "recommender_names": [str(author)] if author else [],
                "last_posted_at": None,
                "event_at": when,
                "city": None,
            }
            clusters[key] = row
        row["mention_count"] += 1
        row["self_ad_mention_count"] = int(row.get("self_ad_mention_count") or 0) + 1
        row["city"] = resolve_city(text=text, group=group, existing=row.get("city"))
        row["event_at"] = merge_event_dates(row.get("event_at"), when)
        series = event_series_brand(text, list(contacts.get("websites") or []))
        if series == "usabytemamila.com":
            row["display_name"] = "USAbyTemamila — эфиры / вебинары по недвижимости"
            row["category_guess"] = "событие"
        else:
            current_title = row.get("display_name") or ""
            prefer_new = False
            if title and not current_title:
                prefer_new = True
            elif title and len(title) >= 20 and len(title) < len(current_title):
                prefer_new = True
            elif title and current_title.startswith(("🔴", "📢", "🔥")) and not title.startswith(
                ("🔴", "📢", "🔥")
            ):
                prefer_new = True
            if prefer_new:
                row["display_name"] = title
        snippet = re.sub(r"\s+", " ", text)[:180]
        if snippet and snippet not in row["request_snippets"] and len(row["request_snippets"]) < 6:
            row["request_snippets"].append(snippet)
        if url and url not in row["source_post_urls"] and len(row["source_post_urls"]) < 10:
            row["source_post_urls"].append(url)
        if group not in row["source_groups"]:
            row["source_groups"].append(group)
        for p in contacts.get("phones") or []:
            if p not in row["phones"]:
                row["phones"].append(p)
        for ig in contacts.get("instagram") or []:
            if ig not in row["instagram"]:
                row["instagram"].append(ig)
        for w in contacts.get("websites") or []:
            if w not in row["websites"] and len(row["websites"]) < 6:
                row["websites"].append(w)
        if author and str(author) not in row["recommender_names"] and len(row["recommender_names"]) < 8:
            row["recommender_names"].append(str(author))

    # Ensure kind / city fallback from groups on all rows
    for row in clusters.values():
        row.setdefault("kind", "profi")
        row.setdefault("event_at", None)
        if not row.get("city"):
            for g in row.get("source_groups") or []:
                hub = city_from_group(g)
                if hub:
                    row["city"] = hub
                    break

    items = sorted(clusters.values(), key=lambda r: (-r["mention_count"], r["cluster_key"]))
    # Merge same person split across web/ig keys (e.g. Светлана Зайченко) — profi only
    merged: dict[str, dict[str, Any]] = {}
    for item in items:
        kind = item.get("kind") or "profi"
        if kind == "event":
            merged[item["cluster_key"]] = item
            continue
        name = (item.get("display_name") or "").strip().lower()
        cat = item.get("category_guess") or ""
        if name and cat:
            mkey = f"profi|{cat}|{name}"
        else:
            mkey = f"profi|{item['cluster_key']}"
        if mkey not in merged:
            merged[mkey] = item
            continue
        dest = merged[mkey]
        dest["mention_count"] += int(item.get("mention_count") or 0)
        dest["third_party_mention_count"] = int(
            dest.get("third_party_mention_count") or 0
        ) + int(item.get("third_party_mention_count") or 0)
        dest["self_ad_mention_count"] = int(
            dest.get("self_ad_mention_count") or 0
        ) + int(item.get("self_ad_mention_count") or 0)
        for field in ("phones", "instagram", "websites", "comment_texts", "request_snippets", "source_post_urls", "source_groups", "recommender_names"):
            for v in item.get(field) or []:
                if v not in dest[field] and len(dest[field]) < 12:
                    dest[field].append(v)
        dest["category_guess"] = pick_better_category(
            dest.get("category_guess"), item.get("category_guess")
        )
        if not dest.get("city"):
            dest["city"] = item.get("city")
        # Prefer phone-based cluster_key when available
        if item["cluster_key"].startswith("phone:") and not dest["cluster_key"].startswith("phone:"):
            dest["cluster_key"] = item["cluster_key"]
        # Prefer human display names over anon/phone
        if item.get("display_name") and (
            not dest.get("display_name")
            or re.match(r"^\+?\d", dest["display_name"] or "")
            or re.match(r"^(productive|lavender)\w+\d+$", dest["display_name"] or "", re.I)
        ):
            dest["display_name"] = item["display_name"]
    items = sorted(merged.values(), key=lambda r: (-r["mention_count"], r["cluster_key"]))
    for item in items:
        item.setdefault("kind", "profi")
        item.setdefault("event_at", None)
        if not item.get("city"):
            for g in item.get("source_groups") or []:
                hub = city_from_group(g)
                if hub:
                    item["city"] = hub
                    break
        if not item.get("display_name"):
            if item.get("instagram"):
                item["display_name"] = f"@{item['instagram'][0]}"
            elif item.get("phones"):
                item["display_name"] = item["phones"][0]
        if not item.get("category_guess"):
            item["category_guess"] = (
                "событие" if item.get("kind") == "event" else "услуга / специалист"
            )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stats": dict(stats),
        "cluster_count": len(items),
        "profi_count": sum(1 for i in items if i.get("kind") != "event"),
        "event_count": sum(1 for i in items if i.get("kind") == "event"),
        "items": items,
    }


def upsert_clusters(client: SupabaseRest, items: list[dict[str, Any]]) -> int:
    # Replace-all strategy for this offline extract: delete facebook source rows then insert
    client._request(
        "DELETE",
        "/import_comment_recommendations",
        params={"source_channel": "eq.facebook"},
        prefer="return=minimal",
    )
    payload = []
    for item in items:
        payload.append(
            {
                "cluster_key": item["cluster_key"],
                "kind": item.get("kind") or "profi",
                "display_name": item.get("display_name"),
                "phones": item.get("phones") or [],
                "instagram": item.get("instagram") or [],
                "websites": item.get("websites") or [],
                "mention_count": int(item.get("mention_count") or 1),
                "third_party_mention_count": max(
                    0, int(item.get("third_party_mention_count") or 0)
                ),
                "self_ad_mention_count": max(
                    0, int(item.get("self_ad_mention_count") or 0)
                ),
                "comment_texts": item.get("comment_texts") or [],
                "request_snippets": item.get("request_snippets") or [],
                "source_post_urls": item.get("source_post_urls") or [],
                "source_groups": item.get("source_groups") or [],
                "category_guess": item.get("category_guess"),
                "recommender_names": item.get("recommender_names") or [],
                "last_posted_at": item.get("last_posted_at"),
                "event_at": item.get("event_at"),
                "city": item.get("city"),
                "source_channel": "facebook",
                "status": "pending",
            }
        )
        row = payload[-1]
        if (
            row["third_party_mention_count"] == 0
            and row["self_ad_mention_count"] == 0
            and row["mention_count"] > 0
        ):
            # Legacy fallback: comments ≈ third-party; events/offers ≈ self.
            if (item.get("kind") or "profi") == "event" or not (
                item.get("recommender_names") or []
            ):
                row["self_ad_mention_count"] = row["mention_count"]
            else:
                row["third_party_mention_count"] = row["mention_count"]
        ts = payload[-1].get("last_posted_at")
        if ts:
            try:
                datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            except ValueError:
                payload[-1]["last_posted_at"] = None
        else:
            payload[-1]["last_posted_at"] = None
    # chunk insert
    n = 0
    for i in range(0, len(payload), 100):
        chunk = payload[i : i + 100]
        client._request(
            "POST",
            "/import_comment_recommendations",
            body=chunk,
            prefer="return=minimal",
        )
        n += len(chunk)
        print(f"  upserted {n}/{len(payload)}")
    return n


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    report = build_clusters()
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("stats:", json.dumps(report["stats"], ensure_ascii=False))
    print(f"clusters: {report['cluster_count']}")
    print(f"wrote {OUT_JSON}")
    for item in report["items"][:8]:
        print(
            f"  ×{item['mention_count']} {item.get('display_name') or '—'} "
            f"{item['cluster_key']} [{item.get('category_guess') or '?'}]"
        )

    if not args.apply:
        print("dry-run only; pass --apply to write DB")
        return 0

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)
    n = upsert_clusters(client, report["items"])
    print(f"DB rows written: {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
