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

from common import SupabaseRest, load_env  # noqa: E402
from eligibility import (  # noqa: E402
    normalize_instagram,
    normalize_phone,
    normalize_telegram_username,
)

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
]
OUT_JSON = (
    ROOT
    / "scripts/telegram-collector/data"
    / "telegram_recommendations_clusters.json"
)

INCLUDE_CLASSES = {
    "third_party_recommendation",
    "direct_specialist_ad",
    "direct_business_ad",
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
    if "Orange" in group or "LA_" in group:
        return "Orange County / LA"
    if "Fun for Mom" in group:
        return "Orange County"
    return "California"


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
    for raw in ent.get("phone") or []:
        n = normalize_phone(str(raw))
        if n and n not in phones:
            phones.append(n)
    for raw in ent.get("instagram") or []:
        handle = normalize_instagram(str(raw))
        if handle and handle.lower() not in JUNK_HANDLES and handle not in ig:
            ig.append(handle)
    for raw in ent.get("website") or []:
        href = str(raw)
        if not href.lower().startswith("http"):
            href = f"https://{href}"
        if website_root_host(href) and href not in websites:
            websites.append(href.split("?")[0][:200])
    for raw in ent.get("email") or []:
        em = str(raw).strip().lower()
        if EMAIL_RE.fullmatch(em) and em not in emails:
            emails.append(em)
    tg_ent = normalize_telegram_username(ent.get("telegram_username"))
    if tg_ent and tg_ent.lower() not in JUNK_HANDLES:
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
    }


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
) -> bool:
    key = cluster_key(contacts)
    if not key:
        return False
    row = clusters.get(key)
    if not row:
        row = empty_row(key, contacts)
        clusters[key] = row
    row["mention_count"] += 1
    if is_recommendation:
        row["third_party_mention_count"] = int(row.get("third_party_mention_count") or 0) + 1
    else:
        row["self_ad_mention_count"] = int(row.get("self_ad_mention_count") or 0) + 1
    nice = clean_display_name(contacts.get("name"), fallback=author if not is_recommendation else None)
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
        for em in contacts.get("emails") or []:
            note = f"email:{em}"
            if note not in row.get("comment_texts", []) and len(row.get("comment_texts") or []) < 10:
                # keep email visible in card snippets / notes bucket
                row.setdefault("comment_texts", []).append(f"✉ {em}")
            row.setdefault("_emails", [])
            if em not in row["_emails"]:
                row["_emails"].append(em)
    snippet = re.sub(r"\s+", " ", text or "").strip()[:220]
    if is_recommendation:
        if snippet and snippet not in row["comment_texts"] and len(row["comment_texts"]) < 8:
            row["comment_texts"].append(snippet)
    else:
        if snippet and snippet not in row["request_snippets"] and len(row["request_snippets"]) < 6:
            row["request_snippets"].append(snippet)
    if url and url not in row["source_post_urls"] and len(row["source_post_urls"]) < 10:
        row["source_post_urls"].append(url)
    if group not in row["source_groups"]:
        row["source_groups"].append(group)
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
        if classification not in INCLUDE_CLASSES:
            continue
        stats["reviewer_candidate_posts"] += 1
        text = post.get("merged_text") or post.get("text") or ""
        ent = post.get("extracted_entity") or {}
        contacts = extract_contacts(text, entity=ent if isinstance(ent, dict) else None)
        if not cluster_key(contacts):
            stats["reviewer_skipped_no_contact"] += 1
            continue
        is_rec = classification == "third_party_recommendation" or bool(
            REC_SIGNAL_RE.search(text)
        )
        cat = guess_category(text, (ent or {}).get("category") if isinstance(ent, dict) else None)
        author = post.get("sender_name")
        if is_bot_author(str(author) if author else None):
            stats["reviewer_skipped_bot"] += 1
            continue
        # For third-party: author is recommender; for self-ad: author is specialist name fallback
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
                snip = re.sub(r"\s+", " ", ptext).strip()[:180]
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
        if not (item.get("phones") or item.get("instagram") or item.get("websites")):
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


def upsert_clusters(client: SupabaseRest, items: list[dict[str, Any]]) -> int:
    # Replace only telegram source rows — keep Facebook recommendations.
    client._request(
        "DELETE",
        "/import_comment_recommendations",
        params={"source_channel": "eq.telegram"},
        prefer="return=minimal",
    )
    payload = []
    for item in items:
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
            "source_groups": item.get("source_groups") or [],
            "category_guess": item.get("category_guess"),
            "recommender_names": item.get("recommender_names") or [],
            "last_posted_at": item.get("last_posted_at"),
            "event_at": item.get("event_at"),
            "city": item.get("city"),
            "source_channel": "telegram",
            "status": "pending",
            "notes": (
                "emails: " + ", ".join((item.get("_emails") or [])[:2])
                if item.get("_emails")
                else None
            ),
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
    print(
        f"clusters: {report['cluster_count']} "
        f"(multi-mention ≥2: {report['multi_mention_count']})"
    )
    print(f"wrote {OUT_JSON}")
    for item in report["items"][:12]:
        print(
            f"  ×{item['mention_count']:>2}  {item.get('category_guess')}"
            f"  {item.get('display_name')}  {item['cluster_key']}"
            f"  groups={item.get('source_groups')}"
        )

    if args.apply:
        load_env()
        client = SupabaseRest(
            os.environ["NEXT_PUBLIC_SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )
        n = upsert_clusters(client, report["items"])
        print(f"applied {n} telegram recommendation rows")
    else:
        print("dry-run only; pass --apply to write to Supabase")
    return 0


if __name__ == "__main__":
    import os

    raise SystemExit(main())
