#!/usr/bin/env python3
"""Extract specialist recommendations from Fun for Mom + LA_OrangeCounty.

Sources:
  1) reviewer_v1 classifications:
     - third_party_recommendation
     - direct_specialist_ad
     - direct_business_ad
     (only rows with at least one contact)
  2) raw reply threads: replies with contacts under «кто посоветует?» posts

Clusters by phone / Instagram / Telegram username / website.
mention_count = how many posts/replies mention the same contact.

Usage:
  python3 scripts/telegram-collector/extract_telegram_recommendations.py
  python3 scripts/telegram-collector/extract_telegram_recommendations.py --apply
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from eligibility import (  # noqa: E402
    normalize_instagram,
    normalize_phone,
    normalize_telegram_username,
)
from recommendation_subject import recommended_subject_name  # noqa: E402

REVIEWER_PATHS = [
    (
        "Fun for Mom",
        ROOT
        / "scripts/telegram-collector/data/full/fun_for_mom_reviewer_v1.json",
    ),
    (
        "LA_OrangeCounty",
        ROOT
        / "scripts/telegram-collector/data/la_orange_county/full/la_orange_county_reviewer_v1.json",
    ),
    (
        "Sacramento_Adaptation",
        ROOT
        / "scripts/telegram-collector/data/sacramento_adaptation/full/sacramento_adaptation_reviewer_v1.json",
    ),
    (
        "Sacramento_RusRek",
        ROOT
        / "scripts/telegram-collector/data/sacramento_rusrek/full/sacramento_rusrek_reviewer_v1.json",
    ),
    (
        "SF_RusRek",
        ROOT
        / "scripts/telegram-collector/data/sf_rusrek/full/sf_rusrek_reviewer_v1.json",
    ),
    (
        "SF_General",
        ROOT
        / "scripts/telegram-collector/data/sf_general/full/sf_general_reviewer_v1.json",
    ),
    (
        "SD_RusRek",
        ROOT
        / "scripts/telegram-collector/data/sd_rusrek/full/sd_rusrek_reviewer_v1.json",
    ),
    (
        "SD_General",
        ROOT
        / "scripts/telegram-collector/data/sd_general/full/sd_general_reviewer_v1.json",
    ),
    (
        "Irvine_Friends",
        ROOT
        / "scripts/telegram-collector/data/irvine_friends/full/irvine_friends_reviewer_v1.json",
    ),
]
RAW_BATCH_DIRS = [
    (
        "Fun for Mom",
        ROOT / "scripts/telegram-collector/data/full/batches",
    ),
    (
        "LA_OrangeCounty",
        ROOT / "scripts/telegram-collector/data/la_orange_county/full/batches",
    ),
    (
        "Sacramento_Adaptation",
        ROOT / "scripts/telegram-collector/data/sacramento_adaptation/full/batches",
    ),
    (
        "Sacramento_RusRek",
        ROOT / "scripts/telegram-collector/data/sacramento_rusrek/full/batches",
    ),
    (
        "SF_RusRek",
        ROOT / "scripts/telegram-collector/data/sf_rusrek/full/batches",
    ),
    (
        "SF_General",
        ROOT / "scripts/telegram-collector/data/sf_general/full/batches",
    ),
    (
        "SD_RusRek",
        ROOT / "scripts/telegram-collector/data/sd_rusrek/full/batches",
    ),
    (
        "SD_General",
        ROOT / "scripts/telegram-collector/data/sd_general/full/batches",
    ),
    (
        "Irvine_Friends",
        ROOT / "scripts/telegram-collector/data/irvine_friends/full/batches",
    ),
]

# Maps extract groupLabel → directory_source id for admin panels
GROUP_DIRECTORY_SOURCE: dict[str, str] = {
    "Fun for Mom": "tg_fun_for_mom",
    "LA_OrangeCounty": "tg_la_orange_county",
    "Sacramento_Adaptation": "tg_sacramento_adaptation",
    "Sacramento_RusRek": "tg_sacramento_rusrek",
    "SF_RusRek": "tg_sf_rusrek",
    "SF_General": "tg_sf_general",
    "SD_RusRek": "tg_sd_rusrek",
    "SD_General": "tg_sd_general",
    "Irvine_Friends": "tg_irvine_friends",
}
OUT_JSON = (
    ROOT
    / "scripts/telegram-collector/data"
    / "telegram_recommendations_clusters.json"
)

INCLUDE_CLASSES = {
    "third_party_recommendation",
    "direct_specialist_ad",
    "direct_business_ad",
    "event_ad",
    "job_post",
    "marketplace_item",
    "real_estate_listing",
    "recommendation_request",
}

# classification → (kind, target_bucket, category_guess fallback)
CLASS_ROUTE: dict[str, tuple[str, str, str]] = {
    "third_party_recommendation": ("profi", "professional", "услуга / специалист"),
    "direct_specialist_ad": ("profi", "professional", "услуга / специалист"),
    "direct_business_ad": ("profi", "business", "бизнес"),
    "event_ad": ("event", "other", "событие"),
    "job_post": ("profi", "other", "вакансия"),
    "marketplace_item": ("profi", "other", "marketplace"),
    "real_estate_listing": ("profi", "other", "недвижимость"),
    "recommendation_request": ("profi", "other", "я ищу"),
}

REQUEST_RE = re.compile(
    r"(подскаж|посоветуй|порекоменд|кто\s+знает|кто\s+может|"
    r"нужен\s+|нужна\s+|нужны\s+|ищ[уеи]\s+|дайте\s+(номер|контакт)|"
    r"recommend|looking\s+for|anyone\s+know)",
    re.I,
)
REC_SIGNAL_RE = re.compile(
    r"(рекоменд|советую|посоветовал|посоветовала|от души советую|"
    r"очень\s+хорош|классный\s+мастер|проверенн)",
    re.I,
)
DM_TO_AUTHOR_RE = re.compile(
    r"(?:пишите|напишите|пиши|писать)\s+(?:пожалуйста\s+)?(?:мне\s+)?"
    r"(?:в\s*)?(?:личк|лс)\b|"
    r"\bв\s*личк[уеа]\b|\bв\s*лс\b|dm\s+me|pm\s+me",
    re.I,
)
TME_C_RE = re.compile(r"(?:https?://)?t\.me/c/(\d+)/(\d+)", re.I)
PHONE_RE = re.compile(
    r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{10,15}"
)
URL_RE = re.compile(
    r"https?://[^\s<>\"']+|www\.[^\s<>\"']+|t\.me/[^\s<>\"']+|instagram\.com/[^\s<>\"']+",
    re.I,
)
IG_OR_TG_HANDLE_RE = re.compile(r"(?<!\w)@([A-Za-z0-9._]{3,30})")
# Explicit Instagram mentions in ad copy: "Instagram: @foo", "Инстаграм foo"
IG_LABEL_RE = re.compile(
    r"(?:instagram|инстаграм(?:м)?|инста|insta)\s*[:\-–]?\s*@?([A-Za-z0-9._]{3,30})\b",
    re.I,
)
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
SEEKING_TAG = "[seeking]"


def redact_contacts_from_text(text: str) -> str:
    """Strip phones / URLs / @handles / emails from narrative snippets."""
    if not text:
        return ""
    out = PHONE_RE.sub(" ", text)
    out = URL_RE.sub(" ", out)
    out = EMAIL_RE.sub(" ", out)
    out = IG_OR_TG_HANDLE_RE.sub(" ", out)
    out = re.sub(r"\s+", " ", out).strip(" -–|,;:")
    return out


def parse_tme_c_link(url: str | None) -> tuple[int, int] | None:
    """Return (chat_id, message_id) from https://t.me/c/<internal>/<msg>."""
    if not url:
        return None
    m = TME_C_RE.search(url)
    if not m:
        return None
    internal = m.group(1)
    msg_id = int(m.group(2))
    chat_id = int(f"-100{internal}")
    return chat_id, msg_id


JUNK_HANDLES = {
    "everyone",
    "here",
    "channel",
    "admin",
    "facebook",
    "instagram",
    "telegram",
    "funformom",
    "la_orangecounty",
    "adaptationinsacramento",
    "chat_sacramento_rusrek",
    "chat_rusrek_sanfrancisco",
    "chat_rusrek_sandiego",
    "san_franciscochat",
    "sandiegov",
    "rusrekoff",
    "rusrekbot_bot",
    "gram",
    "com",
    "www",
    "http",
    "https",
}
JUNK_DISPLAY_NAMES = {
    "звоните",
    "телефон",
    "phone",
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "call",
    "text",
    "whatsapp",
    "telegram",
    "instagram",
}
BOT_NAME_RE = re.compile(r"_bot\b|bot$|^bot\b", re.I)

CATEGORY_MAP = {
    "beauty": "визаж / beauty",
    "health": "косметология",
    "education": "репетитор",
    "legal": "юрист",
    "accounting": "бухгалтерия / нотариус",
    "insurance": "авто / страхование",
    "auto_services": "автосервис",
    "car_rental": "автосервис",
    "moving": "переезд / перевозки",
    "food": "кейтеринг / цветы",
    "childcare": "няня",
    "fitness": "фитнес",
    "photography_video": "фото / видео",
    "real_estate_services": "риелтор",
    "home_services": "ремонт / стройка",
    "pet_services": "услуга / специалист",
    "professional_services": "услуга / специалист",
    "events": "событие",
    "travel": "услуга / специалист",
    "other": "услуга / специалист",
}

CATEGORY_HINTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"риелтор|realtor|недвижим", re.I), "риелтор"),
    (re.compile(r"сантехник|plumber", re.I), "сантехник"),
    (re.compile(r"хэндимэн|handyman|мастер\s+на\s+час", re.I), "handyman"),
    (re.compile(r"электрик|electrician", re.I), "электрик"),
    (re.compile(r"нян|nanny|babysitter", re.I), "няня"),
    (re.compile(r"масс[аa]ж", re.I), "массаж"),
    (re.compile(r"парикмахер|барбер|barber|стрижк", re.I), "парикмахер"),
    (re.compile(r"визаж|make[\s-]?up|макияж|брови|ресниц|маникюр|педикюр|ногт", re.I), "визаж / beauty"),
    (re.compile(r"ботокс|инъекц|косметолог|филлер", re.I), "косметология"),
    (re.compile(r"фотограф|видеограф|photographer", re.I), "фото / видео"),
    (re.compile(r"клинер|химчистк|уборк", re.I), "клининг"),
    (re.compile(r"юрист|адвокат|immigration", re.I), "юрист"),
    (re.compile(r"бухгалтер|tax\b|налог|нотариус", re.I), "бухгалтерия / нотариус"),
    (re.compile(r"репетитор|tutor|учитель|преподаю", re.I), "репетитор"),
    (re.compile(r"ремонт|полы|строител|хандимен", re.I), "ремонт / стройка"),
    (re.compile(r"автосервис|механик|кузовн|тониров", re.I), "автосервис"),
    (re.compile(r"переезд|moving|грузчик", re.I), "переезд / перевозки"),
]


def guess_category(text: str, entity_category: str | None = None) -> str:
    for pattern, label in CATEGORY_HINTS:
        if pattern.search(text or ""):
            return label
    if entity_category and entity_category in CATEGORY_MAP:
        return CATEGORY_MAP[entity_category]
    return "услуга / специалист"


def city_for_group(group: str) -> str:
    if "Irvine" in group or "Orange" in group or "LA_" in group:
        return "Orange County / LA" if "LA_" in group else "Orange County"
    if "Fun for Mom" in group:
        return "Orange County"
    if "Sacramento" in group:
        return "Sacramento, CA"
    if group.startswith("SF_"):
        return "San Francisco, CA"
    if group.startswith("SD_"):
        return "San Diego, CA"
    return "California"


def directory_source_for_group(group: str) -> str | None:
    return GROUP_DIRECTORY_SOURCE.get(group)


def website_root_host(href: str) -> str | None:
    try:
        host = (urlparse(href).hostname or "").lower().removeprefix("www.")
    except Exception:  # noqa: BLE001
        return None
    if not host or "." not in host:
        return None
    skip = {
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
        "maps.app.goo.gl",
        "goo.gl",
        "bit.ly",
        "linktr.ee",
    }
    if any(host == h or host.endswith("." + h) for h in skip):
        return None
    return host


def as_str_list(value: Any) -> list[str]:
    """Normalize LLM entity fields that may be str | list | None."""
    if value is None:
        return []
    if isinstance(value, str):
        v = value.strip()
        return [v] if v else []
    if isinstance(value, (list, tuple, set)):
        out: list[str] = []
        for item in value:
            s = str(item).strip()
            if s:
                out.append(s)
        return out
    s = str(value).strip()
    return [s] if s else []


def extract_contacts(
    text: str,
    *,
    prefer_bare_at_as_telegram: bool = True,
    entity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    phones: list[str] = []
    ig: list[str] = []
    websites: list[str] = []
    telegrams: list[str] = []
    emails: list[str] = []

    ent = entity or {}
    for raw in as_str_list(ent.get("phone")) + as_str_list(ent.get("whatsapp")):
        n = normalize_phone(str(raw))
        if n and n not in phones:
            phones.append(n)
    for raw in as_str_list(ent.get("instagram")):
        handle = normalize_instagram(str(raw))
        if handle and handle.lower() not in JUNK_HANDLES and handle not in ig:
            ig.append(handle)
    for raw in as_str_list(ent.get("website")):
        href = str(raw)
        if not href.lower().startswith("http"):
            href = f"https://{href}"
        if website_root_host(href) and href not in websites:
            websites.append(href.split("?")[0][:200])
    for raw in as_str_list(ent.get("email")):
        em = str(raw).strip().lower()
        if EMAIL_RE.fullmatch(em) and em not in emails:
            emails.append(em)
    tg_raw = ent.get("telegram_username") or ent.get("telegram")
    for raw in as_str_list(tg_raw):
        tg_ent = normalize_telegram_username(raw)
        if tg_ent and tg_ent.lower() not in JUNK_HANDLES and tg_ent not in telegrams:
            telegrams.append(tg_ent)

    for raw in PHONE_RE.findall(text or ""):
        n = normalize_phone(raw)
        if n and n not in phones:
            phones.append(n)

    for em in EMAIL_RE.findall(text or ""):
        low = em.lower()
        # skip instagram-like false positives already handled
        if low.endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        if low not in emails:
            emails.append(low)

    # Labeled Instagram first (before bare @ → telegram)
    for m in IG_LABEL_RE.finditer(text or ""):
        handle = normalize_instagram(m.group(1))
        if handle and handle.lower() not in JUNK_HANDLES and handle not in ig:
            ig.append(handle)

    for raw in URL_RE.findall(text or ""):
        href = raw if raw.lower().startswith("http") else f"https://{raw}"
        low = href.lower()
        if "instagram.com" in low:
            handle = normalize_instagram(href)
            if handle and handle.lower() not in JUNK_HANDLES and handle not in ig:
                ig.append(handle)
            continue
        if "t.me/" in low or "telegram.me/" in low:
            path = urlparse(href).path.strip("/")
            handle = normalize_telegram_username(path.split("/")[0] if path else None)
            if handle and handle.lower() not in JUNK_HANDLES and handle not in telegrams:
                telegrams.append(handle)
            continue
        if "facebook.com" in low or "fb.com" in low:
            # keep profile/page links as secondary websites for admin
            clean = href.split("?")[0][:200]
            if clean not in websites and len(websites) < 8:
                websites.append(clean)
            continue
        if website_root_host(href) and href.split("?")[0][:200] not in websites:
            websites.append(href.split("?")[0][:200])

    ig_lower = {x.lower() for x in ig}
    for m in IG_OR_TG_HANDLE_RE.findall(text or ""):
        handle = m.strip().lstrip("@")
        if not handle or handle.lower() in JUNK_HANDLES:
            continue
        if handle.lower() in ig_lower:
            continue
        # Context window: if near "instagram/инста" → IG, else telegram in TG groups
        # (already captured labeled IG above)
        if prefer_bare_at_as_telegram:
            tg = normalize_telegram_username(handle)
            if tg and tg not in telegrams and tg.lower() not in ig_lower:
                telegrams.append(tg)
        else:
            ig_h = normalize_instagram(handle)
            if ig_h and ig_h not in ig:
                ig.append(ig_h)

    for tg in telegrams:
        link = f"https://t.me/{tg}"
        if link not in websites:
            websites.append(link)

    name = None
    for key in ("person_name", "business_name"):
        val = (ent.get(key) or "").strip() if ent else ""
        if val and len(val) >= 2 and len(val) <= 80 and val.lower() not in JUNK_HANDLES:
            name = val
            break

    return {
        "phones": phones,
        "instagram": ig,
        "websites": websites,
        "telegrams": telegrams,
        "emails": emails,
        "name": name,
    }


def cluster_key(contacts: dict[str, Any]) -> str | None:
    if contacts.get("phones"):
        return f"phone:{contacts['phones'][0]}"
    if contacts.get("instagram"):
        return f"ig:{contacts['instagram'][0].lower()}"
    if contacts.get("telegrams"):
        return f"tg:{contacts['telegrams'][0].lower()}"
    if contacts.get("sender_ids"):
        return f"tgid:{contacts['sender_ids'][0]}"
    if contacts.get("seeking_keys"):
        return f"seek:{contacts['seeking_keys'][0]}"
    if contacts.get("websites"):
        for w in contacts["websites"]:
            host = website_root_host(w)
            if host:
                return f"web:{host}"
            if "t.me/" in w.lower():
                handle = w.rstrip("/").split("/")[-1]
                tg = normalize_telegram_username(handle)
                if tg:
                    return f"tg:{tg.lower()}"
    return None


def clean_display_name(name: str | None, fallback: str | None = None) -> str | None:
    for cand in (name, fallback):
        if not cand:
            continue
        value = re.sub(r"\s+", " ", str(cand)).strip(" -'")
        if len(value) < 2 or len(value) > 80:
            continue
        low = value.lower()
        if low in JUNK_HANDLES or low in JUNK_DISPLAY_NAMES:
            continue
        if BOT_NAME_RE.search(value):
            continue
        if re.match(r"^\+?\d[\d\s\-()]{8,}$", value):
            continue
        if re.match(r"^[\w.-]+\.(com|net|org|ru|us)$", low):
            continue
        return value
    return None


def is_bot_author(author: str | None) -> bool:
    if not author:
        return False
    return bool(BOT_NAME_RE.search(author))


def empty_row(key: str, contacts: dict[str, Any], *, kind: str = "profi") -> dict[str, Any]:
    return {
        "cluster_key": key,
        "kind": kind,
        "display_name": None,
        "phones": list(contacts.get("phones") or []),
        "instagram": list(contacts.get("instagram") or []),
        "websites": list(contacts.get("websites") or []),
        "sender_ids": list(contacts.get("sender_ids") or []),
        "seeking_keys": list(contacts.get("seeking_keys") or []),
        "mention_count": 0,
        "third_party_mention_count": 0,
        "self_ad_mention_count": 0,
        "comment_texts": [],
        "request_snippets": [],
        "source_post_urls": [],
        "source_groups": [],
        "category_guess": None,
        "recommender_names": [],
        "last_posted_at": None,
        "event_at": None,
        "city": None,
        "directory_source": None,
        "target_bucket": "professional",
        "cover_image_url": None,
        "_seeking": False,
    }


def apply_class_route(row: dict[str, Any], classification: str) -> None:
    kind, bucket, cat_fallback = CLASS_ROUTE.get(
        classification, ("profi", "professional", "услуга / специалист")
    )
    row["kind"] = kind
    row["target_bucket"] = bucket
    if not row.get("category_guess"):
        row["category_guess"] = cat_fallback
    # Entity-type overrides from extracted_entity (lechu/transfers)
    # handled by caller via ent target_collection when present.


def merge_into(
    clusters: dict[str, dict[str, Any]],
    *,
    contacts: dict[str, Any],
    text: str,
    group: str,
    url: str | None,
    author: str | None,
    posted: str | None,
    category: str | None,
    is_recommendation: bool,
    classification: str = "direct_specialist_ad",
    entity: dict[str, Any] | None = None,
    is_seeking: bool = False,
) -> bool:
    key = cluster_key(contacts)
    if not key:
        return False
    row = clusters.get(key)
    if not row:
        route = CLASS_ROUTE.get(classification)
        kind = route[0] if route else "profi"
        row = empty_row(key, contacts, kind=kind)
        apply_class_route(row, classification)
        clusters[key] = row
    else:
        # Prefer more specific typed class over generic specialist if first was generic
        if classification in {
            "job_post",
            "marketplace_item",
            "real_estate_listing",
            "event_ad",
            "recommendation_request",
        }:
            apply_class_route(row, classification)

    if is_seeking or classification == "recommendation_request":
        row["_seeking"] = True
        row["category_guess"] = "я ищу"
        row["target_bucket"] = "other"

    # Lechu / transfers from entity target_collection
    ent = entity or {}
    tc = str(ent.get("target_collection") or "").lower()
    et = str(ent.get("entity_type") or "").lower()
    if tc == "lechu" or et == "lechu_listing":
        row["kind"] = "profi"
        row["target_bucket"] = "other"
        row["category_guess"] = "лечу / попутчик"
    elif tc == "transfers" or et == "transfer_listing":
        row["kind"] = "profi"
        row["target_bucket"] = "other"
        row["category_guess"] = "перевод денег"
    row["mention_count"] += 1
    if is_recommendation:
        row["third_party_mention_count"] = int(row.get("third_party_mention_count") or 0) + 1
    else:
        row["self_ad_mention_count"] = int(row.get("self_ad_mention_count") or 0) + 1
    nice = clean_display_name(contacts.get("name"), fallback=author if not is_recommendation else None)
    if is_seeking:
        cleaned_req = redact_contacts_from_text(text) or re.sub(r"\s+", " ", text or "").strip()
        if cleaned_req:
            nice = clean_display_name(cleaned_req[:72]) or cleaned_req[:72]
    elif is_recommendation:
        subject = recommended_subject_name(text)
        if subject:
            nice = clean_display_name(subject) or subject
        elif author and nice and clean_display_name(author) and (
            nice.lower() == author.lower()
            or nice.lower() in author.lower()
            or author.lower() in nice.lower()
        ):
            # Author is the recommender — do not use as the card title.
            nice = None
    if not nice and contacts.get("telegrams"):
        nice = f"@{contacts['telegrams'][0]}"
    if not nice and contacts.get("instagram"):
        nice = f"@{contacts['instagram'][0]}"
    if nice and (
        not row["display_name"]
        or (row["display_name"] or "").startswith("@")
        and " " in nice
    ):
        row["display_name"] = nice
        for p in contacts.get("phones") or []:
            if p not in row["phones"]:
                row["phones"].append(p)
        for ig in contacts.get("instagram") or []:
            if ig not in row["instagram"]:
                row["instagram"].append(ig)
        for w in contacts.get("websites") or []:
            if w not in row["websites"] and len(row["websites"]) < 8:
                row["websites"].append(w)
        for sid in contacts.get("sender_ids") or []:
            row.setdefault("sender_ids", [])
            if sid not in row["sender_ids"]:
                row["sender_ids"].append(sid)
        for sk in contacts.get("seeking_keys") or []:
            row.setdefault("seeking_keys", [])
            if sk not in row["seeking_keys"]:
                row["seeking_keys"].append(sk)
        for em in contacts.get("emails") or []:
            note = f"email:{em}"
            if note not in row.get("comment_texts", []) and len(row.get("comment_texts") or []) < 10:
                # keep email visible in card snippets / notes bucket
                row.setdefault("comment_texts", []).append(f"✉ {em}")
            row.setdefault("_emails", [])
            if em not in row["_emails"]:
                row["_emails"].append(em)
    elif is_recommendation and not row.get("display_name"):
        # Still collect contacts even when the subject name is unknown.
        for p in contacts.get("phones") or []:
            if p not in row["phones"]:
                row["phones"].append(p)
        for ig in contacts.get("instagram") or []:
            if ig not in row["instagram"]:
                row["instagram"].append(ig)
        for w in contacts.get("websites") or []:
            if w not in row["websites"] and len(row["websites"]) < 8:
                row["websites"].append(w)
    raw_snip = re.sub(r"\s+", " ", text or "").strip()
    snippet = (redact_contacts_from_text(raw_snip) or raw_snip)[:220]
    if is_seeking:
        if snippet and snippet not in row["request_snippets"] and len(row["request_snippets"]) < 6:
            row["request_snippets"].append(snippet)
    elif is_recommendation:
        if snippet and snippet not in row["comment_texts"] and len(row["comment_texts"]) < 8:
            row["comment_texts"].append(snippet)
    else:
        if snippet and snippet not in row["request_snippets"] and len(row["request_snippets"]) < 6:
            row["request_snippets"].append(snippet)
    if url and url not in row["source_post_urls"] and len(row["source_post_urls"]) < 10:
        row["source_post_urls"].append(url)
    if group not in row["source_groups"]:
        row["source_groups"].append(group)
    ds = directory_source_for_group(group)
    if ds and not row.get("directory_source"):
        row["directory_source"] = ds
    if author and author not in row["recommender_names"] and len(row["recommender_names"]) < 12:
        if is_recommendation:
            row["recommender_names"].append(author)
    if category:
        row["category_guess"] = row.get("category_guess") or category
    if not row.get("city"):
        row["city"] = city_for_group(group)
    if posted:
        raw = str(posted).strip()
        try:
            datetime.fromisoformat(raw.replace("Z", "+00:00"))
            row["last_posted_at"] = raw if raw.endswith("Z") or "+" in raw[10:] else raw + "Z"
        except ValueError:
            pass
    return True


def load_reviewer_posts() -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    for group, path in REVIEWER_PATHS:
        if not path.exists():
            print(f"missing reviewer: {path}")
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for post in data.get("posts") or []:
            out.append((group, post))
    return out


def load_raw_messages() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for group, batch_dir in RAW_BATCH_DIRS:
        if not batch_dir.exists():
            continue
        for path in sorted(batch_dir.glob("*_raw.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            for m in data.get("raw_messages") or []:
                row = dict(m)
                row["_group"] = group
                out.append(row)
    return out


def build_clusters() -> dict[str, Any]:
    clusters: dict[str, dict[str, Any]] = {}
    stats: dict[str, int] = defaultdict(int)

    posts = load_reviewer_posts()
    stats["reviewer_posts"] = len(posts)
    for group, post in posts:
        classification = post.get("classification") or ""
        ent = post.get("extracted_entity") or {}
        tc = str((ent or {}).get("target_collection") or "").lower() if isinstance(ent, dict) else ""
        typed_extra = tc in {
            "lechu",
            "transfers",
            "jobs",
            "marketplace",
            "events",
            "real_estate",
        }
        if classification not in INCLUDE_CLASSES and not typed_extra:
            continue
        if typed_extra and classification not in INCLUDE_CLASSES:
            # Normalize synthetic class for routing
            if tc == "lechu":
                classification = "unclear"
            elif tc == "transfers":
                classification = "unclear"
            elif tc == "jobs":
                classification = "job_post"
            elif tc == "marketplace":
                classification = "marketplace_item"
            elif tc == "events":
                classification = "event_ad"
            elif tc == "real_estate":
                classification = "real_estate_listing"
        stats["reviewer_candidate_posts"] += 1
        text = post.get("merged_text") or post.get("text") or ""
        contacts = extract_contacts(text, entity=ent if isinstance(ent, dict) else None)
        is_seeking = classification == "recommendation_request"
        # Lechu / transfers: author is reachable in Telegram even without phone/IG.
        if not cluster_key(contacts) and tc in {"lechu", "transfers"}:
            sid = post.get("sender_id")
            if sid is not None:
                contacts["sender_ids"] = [int(sid)]
        # Seeking demand: cluster by author or message id (no public category card).
        if is_seeking and not cluster_key(contacts):
            sid = post.get("sender_id")
            if sid is not None:
                contacts["sender_ids"] = [int(sid)]
            else:
                mid = post.get("primary_message_id") or post.get("message_id")
                chat = post.get("source_chat_id") or post.get("chat_id")
                if mid is not None and chat is not None:
                    contacts["seeking_keys"] = [f"{chat}_{mid}"]
        if not cluster_key(contacts):
            stats["reviewer_skipped_no_contact"] += 1
            continue
        is_rec = (
            classification == "third_party_recommendation"
            or (not is_seeking and bool(REC_SIGNAL_RE.search(text)))
        )
        cat = guess_category(text, (ent or {}).get("category") if isinstance(ent, dict) else None)
        if is_seeking:
            cat = "я ищу"
        elif tc == "lechu":
            cat = cat or "лечу / попутчик"
        elif tc == "transfers":
            cat = cat or "перевод денег"
        author = post.get("sender_name")
        if is_bot_author(str(author) if author else None):
            stats["reviewer_skipped_bot"] += 1
            continue
        # For third-party: author is recommender; for self-ad: author is specialist name fallback
        route_class = classification if classification in INCLUDE_CLASSES else (
            "job_post" if tc == "jobs" else
            "marketplace_item" if tc == "marketplace" else
            "event_ad" if tc == "events" else
            "real_estate_listing" if tc == "real_estate" else
            "direct_specialist_ad"
        )
        ok = merge_into(
            clusters,
            contacts=contacts,
            text=text,
            group=group,
            url=post.get("telegram_message_link"),
            author=str(author) if author else None,
            posted=post.get("message_date") or post.get("latest_source_date"),
            category=cat,
            is_recommendation=is_rec,
            classification=route_class,
            entity=ent if isinstance(ent, dict) else None,
            is_seeking=is_seeking,
        )
        if ok:
            stats["reviewer_merged"] += 1
            if is_rec:
                stats["reviewer_third_party"] += 1
            else:
                stats["reviewer_self_ads"] += 1

    # Reply threads under recommendation requests
    msgs = load_raw_messages()
    stats["raw_messages"] = len(msgs)
    by_id = {(m.get("chat_id"), m.get("message_id")): m for m in msgs}
    for m in msgs:
        rid = m.get("reply_to_message_id")
        if not rid:
            continue
        parent = by_id.get((m.get("chat_id"), rid))
        if not parent:
            continue
        ptext = parent.get("text") or ""
        if not REQUEST_RE.search(ptext):
            continue
        stats["raw_request_replies"] += 1
        ctext = m.get("text") or ""
        if is_bot_author(str(m.get("sender_name") or "") or None):
            continue
        contacts = extract_contacts(ctext)
        if not cluster_key(contacts):
            continue
        cat = guess_category(f"{ctext}\n{ptext}")
        ok = merge_into(
            clusters,
            contacts=contacts,
            text=ctext,
            group=str(m.get("_group") or "Telegram"),
            url=m.get("telegram_message_link"),
            author=str(m.get("sender_name") or "") or None,
            posted=m.get("message_date"),
            category=cat,
            is_recommendation=True,
        )
        if ok:
            stats["raw_reply_merged"] += 1
            # keep parent request snippet
            key = cluster_key(contacts)
            if key and key in clusters:
                snip = redact_contacts_from_text(re.sub(r"\s+", " ", ptext).strip())[:180]
                row = clusters[key]
                if snip and snip not in row["request_snippets"] and len(row["request_snippets"]) < 6:
                    row["request_snippets"].append(snip)

    # Cross-enrich: same phone/IG often appears with website in another post.
    # Only pull secondary contacts from posts that primarily belong to this cluster
    # (same cluster_key, or the post contains exactly this one matching phone).
    phone_index: dict[str, str] = {}
    ig_index: dict[str, str] = {}
    tg_index: dict[str, str] = {}
    for key, row in clusters.items():
        for p in row.get("phones") or []:
            phone_index[p] = key
        for ig in row.get("instagram") or []:
            ig_index[ig.lower()] = key
        for w in row.get("websites") or []:
            if "t.me/" in w.lower():
                handle = w.rstrip("/").split("/")[-1].lower()
                tg_index[handle] = key

    for group, post in posts:
        text = post.get("merged_text") or post.get("text") or ""
        ent = post.get("extracted_entity") or {}
        contacts = extract_contacts(
            text, entity=ent if isinstance(ent, dict) else None
        )
        primary = cluster_key(contacts)
        post_phones = list(contacts.get("phones") or [])

        target_keys: set[str] = set()
        if primary and primary in clusters:
            target_keys.add(primary)
        # Also allow: post has exactly one known phone → that cluster
        known_phone_keys = {phone_index[p] for p in post_phones if p in phone_index}
        if len(known_phone_keys) == 1 and len(post_phones) <= 2:
            target_keys |= known_phone_keys
        for ig in contacts.get("instagram") or []:
            if ig.lower() in ig_index and primary and primary.startswith("ig:"):
                target_keys.add(ig_index[ig.lower()])

        if not target_keys:
            continue
        for key in target_keys:
            row = clusters[key]
            # Don't mix contacts across different phone identities
            if key.startswith("phone:") and post_phones:
                own = key.split(":", 1)[1]
                if own not in post_phones and primary != key:
                    continue
            before_ig = len(row.get("instagram") or [])
            before_web = len(
                [
                    w
                    for w in (row.get("websites") or [])
                    if "t.me/" not in w.lower()
                ]
            )
            for ig in contacts.get("instagram") or []:
                if ig not in row["instagram"]:
                    row["instagram"].append(ig)
            for w in contacts.get("websites") or []:
                if w not in row["websites"] and len(row["websites"]) < 10:
                    row["websites"].append(w)
            # Emails only from posts whose primary key is this cluster
            if primary == key:
                for em in contacts.get("emails") or []:
                    row.setdefault("_emails", [])
                    if em not in row["_emails"]:
                        row["_emails"].append(em)
            after_ig = len(row.get("instagram") or [])
            after_web = len(
                [
                    w
                    for w in (row.get("websites") or [])
                    if "t.me/" not in w.lower()
                ]
            )
            if after_ig > before_ig or after_web > before_web:
                stats["cross_enriched"] += 1
            nice = clean_display_name(contacts.get("name"))
            cur = row.get("display_name") or ""
            if nice and (
                not cur
                or cur.startswith("@")
                or re.match(r"^\+?\d", cur)
            ):
                row["display_name"] = nice

    # Rebuild email markers cleanly
    for row in clusters.values():
        emails = list(row.get("_emails") or [])
        row["comment_texts"] = [
            t for t in (row.get("comment_texts") or []) if not str(t).startswith("✉ ")
        ]
        for em in emails[:3]:
            row["comment_texts"].append(f"✉ {em}")
        if len(row["comment_texts"]) > 10:
            row["comment_texts"] = row["comment_texts"][:10]

    items = sorted(clusters.values(), key=lambda r: (-r["mention_count"], r["cluster_key"]))

    # Merge same person split across contact types when display names match
    merged: dict[str, dict[str, Any]] = {}
    for item in items:
        name = (item.get("display_name") or "").strip().lower()
        cat = item.get("category_guess") or ""
        if name and not name.startswith("@") and cat:
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
        for field in (
            "phones",
            "instagram",
            "websites",
            "comment_texts",
            "request_snippets",
            "source_post_urls",
            "source_groups",
            "recommender_names",
        ):
            for v in item.get(field) or []:
                if v not in dest[field] and len(dest[field]) < 12:
                    dest[field].append(v)
        if item["cluster_key"].startswith("phone:") and not dest["cluster_key"].startswith(
            "phone:"
        ):
            dest["cluster_key"] = item["cluster_key"]
        elif item["cluster_key"].startswith("tg:") and dest["cluster_key"].startswith("ig:"):
            # Prefer explicit telegram cluster when names matched
            pass

    items = sorted(merged.values(), key=lambda r: (-r["mention_count"], r["cluster_key"]))
    cleaned: list[dict[str, Any]] = []
    for item in items:
        item.setdefault("kind", "profi")
        item.setdefault("third_party_mention_count", 0)
        item.setdefault("self_ad_mention_count", 0)
        # Keep counters consistent with total when only one side was tracked historically.
        third = int(item.get("third_party_mention_count") or 0)
        self_n = int(item.get("self_ad_mention_count") or 0)
        total = int(item.get("mention_count") or 0)
        if third + self_n == 0 and total > 0:
            item["self_ad_mention_count"] = total
        elif third + self_n < total and self_n == 0 and third > 0:
            pass
        elif third + self_n < total and third == 0 and self_n > 0:
            pass
        elif third + self_n != total and total > 0:
            # Prefer tracked split; bump mention_count to sum if counters exceed.
            if third + self_n > total:
                item["mention_count"] = third + self_n
        item.setdefault("event_at", None)
        dn = (item.get("display_name") or "").strip()
        if dn.lower() in JUNK_DISPLAY_NAMES or BOT_NAME_RE.search(dn):
            item["display_name"] = None
        if not item.get("display_name"):
            if item.get("instagram"):
                item["display_name"] = f"@{item['instagram'][0]}"
            elif item.get("phones"):
                item["display_name"] = item["phones"][0]
            else:
                for w in item.get("websites") or []:
                    if "t.me/" in w:
                        item["display_name"] = "@" + w.rstrip("/").split("/")[-1]
                        break
        if not item.get("category_guess"):
            item["category_guess"] = "услуга / специалист"
        if not item.get("city"):
            for g in item.get("source_groups") or []:
                item["city"] = city_for_group(g)
                break
        if not item.get("request_snippets") and item.get("comment_texts"):
            item["request_snippets"] = list(item["comment_texts"][:2])
        if not (
            item.get("phones")
            or item.get("instagram")
            or item.get("websites")
            or item.get("sender_ids")
            or item.get("seeking_keys")
            or str(item.get("cluster_key") or "").startswith(("tgid:", "seek:"))
        ):
            stats["dropped_no_contact"] += 1
            continue
        cleaned.append(item)

    items = cleaned
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stats": dict(stats),
        "cluster_count": len(items),
        "profi_count": len(items),
        "multi_mention_count": sum(1 for i in items if int(i.get("mention_count") or 0) >= 2),
        "items": items,
    }


def upsert_clusters(
    client: SupabaseRest,
    items: list[dict[str, Any]],
    *,
    replace_directory_sources: list[str] | None = None,
) -> int:
    """Upsert telegram rows. Optionally clear pending rows for given directory_source ids first.

    Never wipes unrelated telegram groups or Facebook rows.
    """
    if replace_directory_sources:
        # Delete only pending rows for the sources we are re-importing
        for ds in replace_directory_sources:
            try:
                client._request(
                    "DELETE",
                    "/import_comment_recommendations",
                    params={
                        "source_channel": "eq.telegram",
                        "directory_source": f"eq.{ds}",
                        "status": "eq.pending",
                    },
                    prefer="return=minimal",
                )
                print(f"  cleared pending telegram rows for {ds}", flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"  warn clear {ds}: {exc}", flush=True)

    payload = []
    for item in items:
        groups = item.get("source_groups") or []
        directory_source = item.get("directory_source")
        if not directory_source:
            for g in groups:
                directory_source = directory_source_for_group(g)
                if directory_source:
                    break
        row = {
            "cluster_key": item["cluster_key"],
            "kind": item.get("kind") or "profi",
            "display_name": item.get("display_name"),
            "phones": item.get("phones") or [],
            "instagram": item.get("instagram") or [],
            "websites": item.get("websites") or [],
            "mention_count": max(1, int(item.get("mention_count") or 1)),
            "third_party_mention_count": max(
                0, int(item.get("third_party_mention_count") or 0)
            ),
            "self_ad_mention_count": max(
                0, int(item.get("self_ad_mention_count") or 0)
            ),
            "comment_texts": item.get("comment_texts") or [],
            "request_snippets": item.get("request_snippets") or [],
            "source_post_urls": item.get("source_post_urls") or [],
            "source_groups": groups,
            "category_guess": item.get("category_guess"),
            "recommender_names": item.get("recommender_names") or [],
            "last_posted_at": item.get("last_posted_at"),
            "event_at": item.get("event_at"),
            "city": item.get("city"),
            "cover_image_url": item.get("cover_image_url"),
            "directory_source": directory_source,
            "target_bucket": item.get("target_bucket") or "professional",
            "source_channel": "telegram",
            "status": "pending",
            "notes": (
                "; ".join(
                    p
                    for p in (
                        (SEEKING_TAG if item.get("_seeking") else None),
                        (
                            "emails: " + ", ".join((item.get("_emails") or [])[:2])
                            if item.get("_emails")
                            else None
                        ),
                        (
                            "telegram_dm_author_ids: "
                            + ", ".join(str(x) for x in (item.get("sender_ids") or [])[:3])
                            if item.get("sender_ids")
                            else None
                        ),
                    )
                    if p
                )
                or None
            ),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        # If counters were never set, treat total as self-ads (legacy ads dominate).
        if (
            row["third_party_mention_count"] == 0
            and row["self_ad_mention_count"] == 0
            and row["mention_count"] > 0
        ):
            row["self_ad_mention_count"] = row["mention_count"]
        ts = row.get("last_posted_at")
        if ts:
            try:
                datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            except ValueError:
                row["last_posted_at"] = None
        else:
            row["last_posted_at"] = None
        payload.append(row)

    n = 0
    for i in range(0, len(payload), 50):
        chunk = payload[i : i + 50]
        for row in chunk:
            try:
                client._request(
                    "POST",
                    "/import_comment_recommendations",
                    body=row,
                    prefer="resolution=merge-duplicates,return=minimal",
                    params={"on_conflict": "source_channel,cluster_key"},
                )
                n += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  ERR {row.get('display_name')!r}: {exc}", flush=True)
        print(f"  upserted {n}/{len(payload)}", flush=True)
    return n


def attach_covers_from_telegram(
    client: SupabaseRest,
    items: list[dict[str, Any]],
    *,
    limit: int = 40,
) -> int:
    """Fill empty cover_image_url from first photo on source Telegram message.

    Soft-fail: missing session / private chat / no media → skip.
    Uses existing media-pipeline helpers (same as queue avatar enrich).
    """
    need = [
        i
        for i in items
        if not i.get("cover_image_url")
        and any(parse_tme_c_link(u) for u in (i.get("source_post_urls") or []))
    ][:limit]
    if not need:
        return 0

    media_dir = ROOT / "scripts" / "media-pipeline"
    if str(media_dir) not in sys.path:
        sys.path.insert(0, str(media_dir))

    try:
        from storage_client import MediaSupabase  # type: ignore
        from telegram_photos import TelegramPhotoClient  # type: ignore
        from validate import reencode_webp  # type: ignore
    except Exception as exc:  # noqa: BLE001
        print(f"  cover skip: media pipeline import failed ({exc})", flush=True)
        return 0

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        print("  cover skip: missing supabase env", flush=True)
        return 0

    tg = TelegramPhotoClient()
    try:
        tg.connect()
    except Exception as exc:  # noqa: BLE001
        print(f"  cover skip: telegram connect ({exc})", flush=True)
        return 0

    storage = MediaSupabase(url, key)
    filled = 0
    try:
        for item in need:
            parsed = None
            for u in item.get("source_post_urls") or []:
                parsed = parse_tme_c_link(u)
                if parsed:
                    break
            if not parsed:
                continue
            chat_id, msg_id = parsed
            try:
                result = tg.fetch_photos(chat_id, [msg_id], max_photos=1, dry_run=False)
            except Exception as exc:  # noqa: BLE001
                print(f"  cover warn {item.get('cluster_key')}: {exc}", flush=True)
                continue
            raw = result.photos[0] if result.photos else None
            if not raw or len(raw) < 800:
                continue
            try:
                webp = reencode_webp(raw, max_edge=1200, quality=85)
            except Exception as exc:  # noqa: BLE001
                print(f"  cover reencode warn: {exc}", flush=True)
                continue
            safe_key = re.sub(r"[^a-zA-Z0-9._-]+", "_", str(item.get("cluster_key") or "x"))[:80]
            path = f"import-recommendations/{safe_key}/tg_{webp.sha256[:16]}.webp"
            try:
                storage.upload(
                    "business-images",
                    path,
                    webp.data,
                    content_type="image/webp",
                    upsert=True,
                )
                public = storage.public_url("business-images", path)
            except Exception as exc:  # noqa: BLE001
                print(f"  cover upload warn: {exc}", flush=True)
                continue
            if not public:
                continue
            try:
                client._request(
                    "PATCH",
                    "/import_comment_recommendations",
                    params={
                        "source_channel": "eq.telegram",
                        "cluster_key": f"eq.{item['cluster_key']}",
                        "status": "eq.pending",
                    },
                    body={"cover_image_url": public},
                    prefer="return=minimal",
                )
                item["cover_image_url"] = public
                filled += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  cover patch warn: {exc}", flush=True)
    finally:
        try:
            tg.close()
        except Exception:  # noqa: BLE001
            pass
    print(f"  covers attached: {filled}/{len(need)}", flush=True)
    return filled


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--groups",
        type=str,
        default="",
        help="Comma-separated group labels to include (default: all present)",
    )
    parser.add_argument(
        "--ca-cities-only",
        action="store_true",
        help="Only Sacramento / SF / SD groups",
    )
    parser.add_argument(
        "--no-replace",
        action="store_true",
        help=(
            "Upsert only — do not DELETE pending rows for directory_source first. "
            "Use for incremental windows so older pending backlog is kept."
        ),
    )
    parser.add_argument(
        "--skip-photos",
        action="store_true",
        help="Do not download Telegram post photos into cover_image_url on --apply.",
    )
    args = parser.parse_args()

    allow = {
        g.strip()
        for g in args.groups.split(",")
        if g.strip()
    }
    if args.ca_cities_only:
        allow = {
            "Sacramento_Adaptation",
            "Sacramento_RusRek",
            "SF_RusRek",
            "SF_General",
            "SD_RusRek",
            "SD_General",
        }

    report = build_clusters()
    if allow:
        before = len(report["items"])
        report["items"] = [
            i
            for i in report["items"]
            if any(g in allow for g in (i.get("source_groups") or []))
        ]
        print(f"filtered groups {allow}: {before} → {len(report['items'])}")
        report["cluster_count"] = len(report["items"])

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("stats:", json.dumps(report["stats"], ensure_ascii=False))
    print(
        f"clusters: {report['cluster_count']} "
        f"(multi-mention ≥2: {report['multi_mention_count']})"
    )
    print(f"wrote {OUT_JSON}")
    for item in report["items"][:12]:
        print(
            f"  ×{item['mention_count']:>2}  {item.get('category_guess')}"
            f"  {item.get('display_name')}  {item['cluster_key']}"
            f"  groups={item.get('source_groups')} ds={item.get('directory_source')}"
        )

    if args.apply:
        load_env()
        client = SupabaseRest(
            os.environ["NEXT_PUBLIC_SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )
        replace_ds: list[str] | None
        if args.no_replace:
            replace_ds = None
            print("replace_directory_sources=None (--no-replace)", flush=True)
        else:
            # Only clear pending rows for groups we intentionally imported.
            # Cross-group clusters may carry extra labels — do NOT wipe those queues.
            if allow:
                replace_ds = sorted(
                    {
                        directory_source_for_group(g)
                        for g in allow
                        if directory_source_for_group(g)
                    }
                )
            else:
                replace_ds = sorted(
                    {
                        directory_source_for_group(g)
                        for item in report["items"]
                        for g in (item.get("source_groups") or [])
                        if directory_source_for_group(g)
                    }
                )
            print(f"replace_directory_sources={replace_ds}", flush=True)
        n = upsert_clusters(
            client,
            report["items"],
            replace_directory_sources=replace_ds,
        )
        print(f"applied {n} telegram recommendation rows")
        if not args.skip_photos:
            attach_covers_from_telegram(client, report["items"])
        else:
            print("covers skipped (--skip-photos)", flush=True)
    else:
        print("dry-run only; pass --apply to write to Supabase")
    return 0


if __name__ == "__main__":
    import os

    raise SystemExit(main())
