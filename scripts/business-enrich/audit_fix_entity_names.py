#!/usr/bin/env python3
"""Audit + fix weak business/professional display names.

Finds titles like «Office» / «Контакты» / phone / @handle when the real brand
or person is clear from description / website, and renames (fill-only on apply
unless --force).

Usage:
  python3 scripts/business-enrich/audit_fix_entity_names.py --dry-run
  python3 scripts/business-enrich/audit_fix_entity_names.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "entity_name_audit"
OUT.mkdir(parents=True, exist_ok=True)

GENERIC_EXACT = re.compile(
    r"^(office|офис|studio|студия|салон|salon|clinic|клиника|магазин|shop|store|"
    r"business|компания|llc|inc|услуга|service|services|мастер|кабинет|филиал|"
    r"центр|center|beauty\s*salon|новый\s+beauty\s*salon|наш\s+офис|новый\s+офис|"
    r"открытие|реклама|объявление|contact|контакты|location|локация|"
    r"new\s+beauty\s*salon)[\s\d\-#!]*$",
    re.I,
)

PHONE_NAME = re.compile(r"^\+?\d[\d\s\-().]{8,}$")
HANDLE_NAME = re.compile(r"^@([A-Za-z0-9._]{2,30})$")
INITIALS = re.compile(r"^[A-ZА-ЯЁ]{1,2}$")

SKIP_HOSTS = {
    "instagram.com",
    "facebook.com",
    "fb.com",
    "t.me",
    "telegram.me",
    "linktr.ee",
    "yelp.com",
    "wa.me",
    "bit.ly",
    "google.com",
}


def fetch_all(
    client: SupabaseRest, path: str, select: str, extra: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        params: dict[str, str] = {
            "select": select,
            "order": "id.asc",
            "offset": str(offset),
            "limit": "1000",
        }
        if extra:
            params.update(extra)
        batch = client._request("GET", path, params=params) or []
        out.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return out


def clean_name(s: str) -> str:
    s = re.sub(r"\s+", " ", s or "").strip(" .,—–-|:：#«»\"'")
    return s[:120]


PERSON_LIKE_NAME = re.compile(
    r"^[A-ZА-ЯЁ][a-zа-яё'’-]+(?:\s+[A-ZА-ЯЁ][a-zа-яё'’-]+){1,2}$"
)

# Words that make a title a place/brand, not a person.
BRAND_TOKEN = re.compile(
    r"\b(clinic|studio|salon|center|centre|school|camp|spa|dental|"
    r"dentistry|recovery|group|company|llc|inc|house|beauty|preschool|"
    r"restaurant|cafe|café|kitchen|market|shop|store|halal|gym|"
    r"academy|institute|lab|labs|therapy|massage|services|service|"
    r"registration|kids|club|truck|trailer|repair|motors|jewelry|"
    r"cargo|express|logistics|delivery|movers|transport|"
    r"delights?|gourmet|foods?|bakery|deli|grocer(?:y|ies)|bistro|grill|"
    r"pharmacy|boutique|gallery|"
    r"клиник|студи|салон|центр|школ|лагер|спа|ресторан|кафе|"
    r"садик|садок|детск|магазин|агентств|мастерск|сервис|карго|доставка)\b",
    re.I,
)

JUNK_BRAND = re.compile(
    r"^(открытие|opening|новый|новая|наш|наша|привет|здравствуйте|"
    r"friends|друзья|услуги|services|category|address|location|"
    r"pricing|программа|program|our|this|the|old|call|private|"
    r"home|interior|professional|many|по\s|в\s|на\s|"
    r"hair\s+salon|call\s+center|old\s+school|this\s+business|"
    r"home\s+improvement|shopping\s+trips)\b",
    re.I,
)

# Tokens that look like English words, not personal names.
NON_NAME_TOKENS = {
    "art",
    "backyard",
    "house",
    "beauty",
    "title",
    "company",
    "sky",
    "neptune",
    "seafood",
    "fish",
    "cafe",
    "camp",
    "design",
    "market",
    "shop",
    "store",
    "group",
    "auto",
    "dental",
    "school",
    "studio",
    "salon",
    "clinic",
    "spa",
    "gym",
    "kids",
    "food",
    "home",
    "care",
    "mi",
    "office",
    "service",
    "services",
    "make",
    "pilaf",
    "plov",
    "truck",
    "trailer",
    "repair",
    "towing",
    "registration",
    "wizards",
    "wizard",
    "club",
    "academy",
    "early",
    "learning",
    "westcliff",
    "delights",
    "delight",
    "gourmet",
    "foods",
    "bakery",
    "deli",
    "grocery",
    "groceries",
    "kitchen",
    "bistro",
    "grill",
    "pizza",
    "sushi",
    "pharmacy",
    "boutique",
    "gallery",
    "fitness",
    "yoga",
    "motors",
    "cargo",
    "express",
    "logistics",
    "delivery",
    "transport",
    "center",
    "centre",
}


def is_person_like_name(name: str) -> bool:
    """Facebook author style: «Asiya Ahmadi», not «NeroFix Recovery Clinic»."""
    n = clean_name(name)
    if not n or BRAND_TOKEN.search(n):
        return False
    parts = n.split()
    # «Alena Petrova Hair» — person + weak trailing token
    if (
        len(parts) == 3
        and PERSON_LIKE_NAME.match(" ".join(parts[:2]))
        and parts[2].lower() in {"hair", "nails", "beauty", "makeup", "photo"}
    ):
        return True
    if not PERSON_LIKE_NAME.match(n):
        return False
    # «Art Backyard» / «Neptune Seafood» are brands, not people
    if any(p.lower() in NON_NAME_TOKENS for p in parts):
        return False
    return True


def _accept_brand(cand: str | None, *, current: str = "") -> str | None:
    if not cand:
        return None
    c = clean_name(cand)
    if not c or len(c) < 3 or len(c) > 70:
        return None
    if GENERIC_EXACT.match(c) or PHONE_NAME.match(c) or HANDLE_NAME.match(c):
        return None
    if JUNK_BRAND.match(c):
        return None
    # Must start with a letter/digit capital or Latin brand char
    if not re.match(r"^[A-ZА-ЯЁ0-9]", c):
        return None
    # Reject Russian marketing sentences mistaken for brands
    cyr = len(re.findall(r"[А-Яа-яЁё]", c))
    lat = len(re.findall(r"[A-Za-z]", c))
    if cyr > lat and not BRAND_TOKEN.search(c):
        return None
    if re.search(
        r"\b(хочу|поделиться|опытом|если|кто|только|замечательн|"
        r"по адресу|совмещают|принимает|предлагаем|приглашаем|"
        r"offers a|offers the|is the|для вашего|для вас)\b",
        c,
        re.I,
    ):
        return None
    if len(c.split()) >= 5 and not BRAND_TOKEN.search(c):
        return None
    # Generic two-word labels
    if re.fullmatch(
        r"(hair|nail|beauty|auto|home|call|old|private|this)\s+"
        r"(salon|studio|center|school|business|company|spa|shop)",
        c,
        re.I,
    ):
        return None
    if current and c.lower() == clean_name(current).lower():
        return None
    # Don't replace with another plain person name
    if is_person_like_name(c) and not BRAND_TOKEN.search(c):
        if not re.match(r"^(dr\.?|доктор)\b", c, re.I):
            return None
    return c


def _title_case_brand_run(s: str) -> str:
    """Keep leading Title/ALLCAPS brand tokens; stop at «в Costa Mesa»."""
    parts = (s or "").split()
    out: list[str] = []
    for i, p in enumerate(parts):
        if re.match(r"^[A-ZА-ЯЁ0-9]", p) or p.lower() in {"&", "and", "of", "the", "for"}:
            out.append(p)
            continue
        break
    return " ".join(out).strip(" —–-|")


def brand_from_description(desc: str | None, *, current: str = "") -> str | None:
    if not desc:
        return None
    text = desc.strip()
    head = text[:900]
    first = text.split("\n")[0].strip()

    patterns: list[tuple[str, int]] = [
        # Opening / ОТКРЫТИЕ NEROFIX… / открытии Wizards Registration Services
        (
            r"(?:открытие|открытии|открытия|opening)\s+"
            r"([A-ZА-ЯЁ0-9][A-ZА-ЯЁA-Za-zА-Яа-яЁё0-9&'’. \-]{2,55})",
            1,
        ),
        # ALL-CAPS brand line: STARWAY TRUCK & TRAILER REPAIR —
        (
            r"^[\s\W]*([A-Z][A-Z0-9 &']{3,50}(?:REPAIR|SERVICES|STUDIO|CLINIC|SALON|"
            r"CENTER|CAMP|SCHOOL|CAFE|GROUP|MOTORS|ACADEMY))"
            r"\s*[—–\-|!]",
            1,
        ),
        # TeaStorm is a small…
        (
            r"^[\s\W]*([A-Z][A-Za-z0-9&'’\-]{2,40})\s+is\s+a\s+(?:small\s+)?"
            r"(?:family\s+)?(?:business|studio|salon|clinic|company|shop)\b",
            1,
        ),
        # в ресторане MoonHalal / в студии X (capitalized brand only)
        (
            r"(?:в|у)\s+(?:ресторане|кафе|студии|салоне|клинике|центре|школе|"
            r"лагере|магазине|агентстве)\s+[«\"“]?"
            r"([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*"
            r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*){0,4})",
            1,
        ),
        # «вже в European Delights» / Latin Title Case after в|у
        (
            r"(?:^|[\s,.!?…])(?:вже\s+)?(?:в|у)\s+"
            r"([A-Z][A-Za-z0-9&'’\-]*(?:\s+[A-Z][A-Za-z0-9&'’\-]*){0,4})\b",
            1,
        ),
        # Pin marker: 📍 European Delights
        (
            r"(?:📍|📌)\s*"
            r"([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9&'’\-]*"
            r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9&'’\-]*){0,4})",
            1,
        ),
        (
            r"(?:новая|новый)\s+(?:клиника|студия|салон|центр|школа|"
            r"ресторан|кафе|лагерь)\s+"
            r"(?:[а-яё\s]{0,40}?[—–-]\s*)?"
            r"[«\"“]?([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*"
            r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*){0,4})",
            1,
        ),
        # Artistry Summer Camp — это …
        (
            r"([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*){0,4})"
            r"\s*[—–-]\s*(?:это|студия|салон|клиника|лагерь|центр)\b",
            1,
        ),
        # Hollywood House of Beauty offers …
        (
            r"^[\s\W]*([A-Z][A-Za-z0-9&'’. \-]{2,55}?)\s+offers\b",
            1,
        ),
        # Dr. Aleksey Stugarev offers …
        (
            r"\b((?:Dr\.?|Doctor)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+offers\b",
            1,
        ),
        # могу порекомендовать Westcliff Early Learning Academy
        (
            r"(?:порекомендовать|рекомендую|recommend(?:ing)?)\s+"
            r"([A-Z][A-Za-z0-9&'’\-]*(?:\s+[A-Z][A-Za-z0-9&'’\-]*){1,5})",
            1,
        ),
        # Explicit labels
        (
            r"(?:название|компани[яи]|бизнес)\s*[:：]\s*"
            r"[\"«]?([A-ZА-ЯЁ][^\"\n«»]{2,50})",
            1,
        ),
        (
            r"(?:добро\s+пожаловать\s+в\s+|welcome\s+to\s+)"
            r"[\"«]?([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*"
            r"(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*){0,4})",
            1,
        ),
        # Title Case Brand + Clinic/Studio/Camp/Services (full match)
        (
            r"\b([A-Z][A-Za-z0-9&'’-]+(?:\s+[A-Z][A-Za-z0-9&'’-]+){0,4}\s+"
            r"(?:Clinic|Studio|Salon|Center|Centre|School|Camp|Spa|Dental|"
            r"Dentistry|Recovery(?:\s+Clinic)?|Group|Company|Preschool|"
            r"Restaurant|Cafe|Kitchen|Services|Kids\s+Club|"
            r"House\s+of\s+Beauty))\b",
            1,
        ),
    ]

    for pat, group in patterns:
        m = re.search(pat, head, re.I | re.M)
        if not m:
            continue
        if group == 0:
            cand = m.group(0).strip()
            cand = re.sub(r"\s+offers$", "", cand, flags=re.I)
        else:
            cand = m.group(group)
            # Opening line: keep full «NEROFIX RECOVERY CLINIC», not just first word
            if re.match(r"(?:открытие|открытии|открытия|opening)\b", m.group(0), re.I):
                full = clean_name(m.group(0))
                full = re.sub(
                    r"^(открытие|открытии|открытия|opening)\s+",
                    "",
                    full,
                    flags=re.I,
                )
                full = _title_case_brand_run(full)
                got = _accept_brand(full, current=current)
                if got:
                    return _prefer_mixed_case(got, text)

        cand = _title_case_brand_run(cand) if cand else cand
        got = _accept_brand(cand, current=current)
        if got:
            after = head[m.end() : m.end() + 40]
            suf = re.match(
                r"^\s*((?:Recovery\s+)?(?:Clinic|Studio|Salon|Camp|Center|"
                r"Preschool|Restaurant))\b",
                after,
                re.I,
            )
            if suf and suf.group(1).lower() not in got.lower():
                got2 = _accept_brand(f"{got} {suf.group(1)}", current=current)
                if got2:
                    return _prefer_mixed_case(got2, text)
            return _prefer_mixed_case(got, text)

    # Dedicated: NeroFix Recovery Clinic (Latin Brand + Clinic)
    m = re.search(
        r"\b([A-Z][A-Za-z0-9&'’-]+(?:\s+[A-Z][A-Za-z0-9&'’-]+){0,4}\s+"
        r"(?:Clinic|Studio|Salon|Center|School|Camp|Spa|Preschool|"
        r"Restaurant|Recovery\s+Clinic|House\s+of\s+Beauty))\b",
        head,
    )
    if m:
        got = _accept_brand(m.group(1), current=current)
        if got:
            return _prefer_mixed_case(got, text)

    # «NAVAT — HALAL…» / «Rush In Documentation (747)…»
    m = re.match(
        r"^(?:[\s\W]*)([A-ZА-ЯЁ0-9][A-ZА-ЯЁA-Za-zА-Яа-яЁё0-9&'’. \-]{1,50}?)"
        r"\s*(?:[—–\-|:：]|\(\d)",
        first,
    )
    if m:
        cand = _accept_brand(m.group(1), current=current)
        if cand:
            return _prefer_mixed_case(cand, text)

    m = re.search(r"[«\"]([A-Za-zА-Яа-яЁё][^\"»]{2,50})[»\"]", text[:400])
    if m:
        got = _accept_brand(m.group(1), current=current)
        return _prefer_mixed_case(got, text) if got else None

    return None


def _prefer_mixed_case(brand: str, text: str) -> str:
    """If extract is ALL CAPS, prefer a mixed-case spelling from the body."""
    if not brand.isupper() or len(brand) < 4:
        return brand
    pat = re.compile(re.escape(brand), re.I)
    for m in pat.finditer(text):
        hit = m.group(0)
        if hit != brand and not hit.isupper():
            return clean_name(hit)
    if re.fullmatch(r"[A-Z0-9][A-Z0-9 &'\\-]+", brand):
        return clean_name(
            " ".join(
                w if len(w) <= 3 and w.isupper() else w.title()
                for w in brand.split()
            )
        )
    return brand


def brand_from_website(url: str | None) -> str | None:
    if not url:
        return None
    try:
        host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    except Exception:
        return None
    if not host or any(host == h or host.endswith("." + h) for h in SKIP_HOSTS):
        return None
    base = host.split(".")[0]
    if len(base) < 4 or base.isdigit():
        return None
    # ocacting → OC Acting when looks like acronym+word
    if re.fullmatch(r"[a-z]{2,}acting", base):
        return base[:2].upper() + " Acting"

    # teremokpreschoolsf → Teremok Preschool SF
    metro = ""
    core = base
    for code in ("sf", "la", "oc", "sd", "nyc"):
        if core.endswith(code) and len(core) > len(code) + 3:
            metro = code.upper()
            core = core[: -len(code)]
            break
    for suffix in (
        "preschool",
        "school",
        "dental",
        "dentistry",
        "clinic",
        "salon",
        "studio",
        "beauty",
        "cafe",
        "restaurant",
        "kitchen",
        "market",
        "fitness",
        "gym",
        "spa",
    ):
        if core.endswith(suffix) and len(core) > len(suffix) + 2:
            head = core[: -len(suffix)]
            parts = [head.replace("-", " ").title(), suffix.title()]
            if metro:
                parts.append(metro)
            return clean_name(" ".join(parts))

    if re.fullmatch(r"[a-z]+", base):
        return base.replace("-", " ").title()
    return base.replace("-", " ").title()


def _title_token(p: str) -> str:
    if p.isupper() and len(p) <= 4:
        return p
    return p[:1].upper() + p[1:].lower()


def prettify_handle(handle: str) -> str:
    """Turn @Averina_Notary_Public → Averina Notary Public.

    Avoid splitting digits into lone tokens (lisi4ka48 must not become «Lisi 4 Ka»).
    """
    h = handle.lstrip("@")

    # Underscore / dot handles: drop trailing digits per segment
    if re.search(r"[._]", h):
        parts = [p for p in re.split(r"[._]+", h) if p]
        cleaned: list[str] = []
        for p in parts:
            p2 = re.sub(r"\d+$", "", p)
            if p2:
                cleaned.append(p2)
        tokens = cleaned or parts
        return clean_name(" ".join(_title_token(p) for p in tokens))

    # Digits anywhere → keep as one token (strip trailing digit run only)
    if re.search(r"\d", h):
        base = re.sub(r"\d+$", "", h) or h
        return clean_name(base[:1].upper() + base[1:])

    # Clear camelCase (has internal capitals)
    if re.search(r"[a-z][A-Z]", h) or re.search(r"[A-Z]{2,}[a-z]", h):
        bits = re.findall(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+", h)
        if bits:
            return clean_name(" ".join(_title_token(b) for b in bits))

    # Plain single token
    return clean_name(h[:1].upper() + h[1:])


# «Al · auto_services», «BH · legal» — FB pack category titles
CATEGORY_DOT_NAME = re.compile(
    r"^[A-Za-zА-Яа-яЁё0-9]{1,20}\s*[·•]\s*[a-z][a-z0-9_]{1,40}$"
)
# Reddit-style throwaway: ElegantHamster9292
REDDIT_USER_NAME = re.compile(r"^[A-Z][a-z]+[A-Z][a-z]+\d{2,}$")
# snake_case / _handle_ / teastorm
SNAKE_OR_HANDLE = re.compile(r"^_?[a-z0-9]+(?:_[a-z0-9]+)*_?$")
# Price/question titles
PRICE_QUESTION_NAME = re.compile(r"^\$|\?$")


def is_weak_name(name: str) -> bool:
    n = (name or "").strip()
    if len(n) < 2:
        return True
    if GENERIC_EXACT.match(n):
        return True
    if PHONE_NAME.match(n):
        return True
    if HANDLE_NAME.match(n):
        return True
    if INITIALS.match(n):
        return True
    if re.match(r"^(новый|новая|наш|наша|мой|моя)\b", n, re.I):
        return True
    if CATEGORY_DOT_NAME.match(n):
        return True
    if REDDIT_USER_NAME.match(n):
        return True
    if SNAKE_OR_HANDLE.match(n) and len(n) >= 4:
        # Allow real brands that happen to be lowercase single tokens only if
        # they contain a brand word when underscored→spaced; else weak.
        spaced = n.strip("_").replace("_", " ")
        if not BRAND_TOKEN.search(spaced):
            return True
    if n.startswith("$") or (n.endswith("?") and len(n) < 40):
        return True
    return False


def suggest_name(entity: dict[str, Any], *, name_key: str) -> dict[str, Any] | None:
    current = (entity.get(name_key) or "").strip()
    desc = "\n".join(
        str(x)
        for x in (
            entity.get("short_description"),
            entity.get("headline"),
            entity.get("description"),
        )
        if x
    )
    website = entity.get("website")
    weak = is_weak_name(current)
    person = is_person_like_name(current)

    brand = brand_from_description(desc, current=current)

    # 0b) «Маке плов (Aibek)» → Make Pilaf when description has clear brand
    paren = re.match(
        r"^(.+?)\s*\(([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\s.\-]{1,40})\)$",
        current,
    )
    if paren and brand and brand.lower() != paren.group(1).strip().lower():
        if BRAND_TOKEN.search(brand) or re.search(
            r"\boffers\b|—\s*", desc[:400], re.I
        ):
            return {
                "from": current,
                "to": brand,
                "reason": "paren_author_brand_in_description",
                "confidence": "high",
            }

    # 0) Author/person in header, brand clear in description
    #    Asiya Ahmadi → NeroFix Recovery Clinic
    #    Dustov Dustmuhammad → MoonHalal
    if person and brand and brand.lower() != current.lower():
        has_brand_token = bool(BRAND_TOKEN.search(brand))
        is_dr = bool(re.match(r"^(dr\.?|доктор)\b", brand, re.I))
        is_compound = bool(
            re.search(r"[A-Z][a-z]+[A-Z]|Halal|Cafe|Café", brand)
        ) and len(brand.split()) <= 3
        solid = has_brand_token or is_dr or is_compound
        if solid:
            return {
                "from": current,
                "to": brand,
                "reason": "person_name_brand_in_description",
                "confidence": "high",
            }

    # 1) Generic / Office → brand in description
    if weak and brand and brand.lower() != current.lower():
        if current.lower() not in brand.lower() or GENERIC_EXACT.match(current):
            return {
                "from": current,
                "to": brand,
                "reason": "weak_name_brand_in_description",
                "confidence": "high",
            }

    # 2) Phone-as-name → brand/company line
    if PHONE_NAME.match(current) and brand:
        return {
            "from": current,
            "to": brand,
            "reason": "phone_as_name",
            "confidence": "high",
        }

    # 3) @handle-as-name → pretty handle (always cosmetic cleanup)
    m = HANDLE_NAME.match(current)
    if m:
        pretty = prettify_handle(m.group(1))
        if pretty and pretty.lower() != current.lower():
            return {
                "from": current,
                "to": pretty,
                "reason": "instagram_handle_as_name",
                "confidence": "medium",
            }

    # 4) Person + clear business website (medium — domain parse can be rough)
    web_brand = brand_from_website(website)
    if person and web_brand and web_brand.lower() != current.lower():
        if BRAND_TOKEN.search(web_brand) or len(web_brand.split()) >= 2:
            return {
                "from": current,
                "to": web_brand,
                "reason": "person_name_website_brand",
                "confidence": "medium",
            }

    # 5) Weak + website
    if weak and web_brand and web_brand.lower() != current.lower():
        return {
            "from": current,
            "to": web_brand,
            "reason": "weak_name_website_brand",
            "confidence": "medium",
        }

    # 6) Weak with no suggestion — report only
    if weak:
        return {
            "from": current,
            "to": None,
            "reason": "weak_name_no_suggestion",
            "confidence": "low",
        }

    return None


def unique_slug(client: SupabaseRest, table: str, base: str, *, exclude_id: str) -> str:
    candidate = base
    n = 0
    while True:
        rows = (
            client._request(
                "GET",
                f"/{table}",
                params={"select": "id", "slug": f"eq.{candidate}", "limit": "2"},
            )
            or []
        )
        ids = [r["id"] for r in rows]
        if not ids or ids == [exclude_id]:
            return candidate
        n += 1
        candidate = f"{base}-{n}"[:70]


def slugify(name: str) -> str:
    import hashlib
    import unicodedata

    raw = (name or "").strip().lower()
    norm = unicodedata.normalize("NFKD", raw)
    ascii_only = "".join(ch for ch in norm if not unicodedata.combining(ch))
    s = re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")
    if len(s) >= 3 and re.search(r"[a-z]", s):
        return s[:60]
    return "item-" + hashlib.md5(raw.encode()).hexdigest()[:10]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--min-confidence",
        choices=["high", "medium", "low"],
        default="medium",
        help="Apply renames at or above this confidence (default medium)",
    )
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    if not args.apply and not args.dry_run:
        args.dry_run = True

    rank = {"high": 3, "medium": 2, "low": 1}
    min_rank = rank[args.min_confidence]

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    businesses = fetch_all(
        client,
        "/businesses",
        "id,name,slug,short_description,description,website,instagram_url,status",
        extra={"status": "eq.approved"},
    )
    professionals = fetch_all(
        client,
        "/professionals",
        "id,display_name,slug,headline,short_description,description,website,"
        "instagram_url,status",
        extra={"status": "eq.approved"},
    )

    findings: list[dict[str, Any]] = []
    for row in businesses:
        sug = suggest_name(row, name_key="name")
        if not sug:
            continue
        findings.append(
            {
                "entity_type": "business",
                "id": row["id"],
                "slug": row.get("slug"),
                **sug,
                "preview": (row.get("description") or row.get("short_description") or "")[
                    :200
                ],
            }
        )
    for row in professionals:
        sug = suggest_name(row, name_key="display_name")
        if not sug:
            continue
        findings.append(
            {
                "entity_type": "professional",
                "id": row["id"],
                "slug": row.get("slug"),
                **sug,
                "preview": (
                    row.get("description")
                    or row.get("short_description")
                    or row.get("headline")
                    or ""
                )[:200],
            }
        )

    actionable = [
        f
        for f in findings
        if f.get("to") and rank.get(f.get("confidence") or "low", 0) >= min_rank
    ]
    # Only auto-rename businesses for person→brand (professionals often
    # correctly use the person's name; venues in the post are not the pro).
    actionable = [
        f
        for f in actionable
        if f["entity_type"] == "business"
    ]
    if args.limit:
        actionable = actionable[: args.limit]

    applied = 0
    if args.apply:
        for f in actionable:
            table = "businesses" if f["entity_type"] == "business" else "professionals"
            name_field = "name" if table == "businesses" else "display_name"
            body: dict[str, Any] = {
                name_field: f["to"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            # Refresh slug when old title was weak / author name
            old_slug = (f.get("slug") or "").lower()
            weak_slug_bits = (
                "office",
                "kontakty",
                "contact",
                "salon",
                "beauty-salon",
            )
            reason = f.get("reason") or ""
            if (
                any(b in old_slug for b in weak_slug_bits)
                or PHONE_NAME.match(f["from"] or "")
                or reason.startswith("person_name_")
                or reason.startswith("weak_name_")
                or reason.startswith("paren_author_")
                or CATEGORY_DOT_NAME.match(f["from"] or "")
                or REDDIT_USER_NAME.match(f["from"] or "")
                or SNAKE_OR_HANDLE.match(f["from"] or "")
            ):
                base = slugify(f["to"])
                body["slug"] = unique_slug(
                    client, table, base, exclude_id=f["id"]
                )
            client._request(
                "PATCH",
                f"/{table}",
                params={"id": f"eq.{f['id']}"},
                body=body,
                prefer="return=minimal",
            )
            applied += 1
            print(
                f"ok {f['entity_type']}: {f['from']!r} → {f['to']!r} "
                f"({f['reason']})"
            )
            time.sleep(0.02)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "min_confidence": args.min_confidence,
        "scanned": {"businesses": len(businesses), "professionals": len(professionals)},
        "issues": len(findings),
        "actionable": len(actionable),
        "applied": applied,
        "by_reason": dict(Counter(f["reason"] for f in findings)),
        "by_confidence": dict(Counter(f.get("confidence") for f in findings)),
        "actionable_sample": actionable[:80],
        "no_suggestion": [f for f in findings if not f.get("to")][:40],
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if args.apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / ("apply_latest.json" if args.apply else "dry_run_latest.json")).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                k: report[k]
                for k in (
                    "mode",
                    "scanned",
                    "issues",
                    "actionable",
                    "applied",
                    "by_reason",
                    "by_confidence",
                )
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print("report", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
