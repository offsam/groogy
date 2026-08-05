"""Shared Svoi.us parse helpers (address + description).

Used by scrape_svoi_us, enrich_svoi_directory, and catalog repair.
"""

from __future__ import annotations

import re


def is_bad_city_token(city: str | None) -> bool:
    if not city:
        return True
    c = city.strip()
    if "@" in c or "email" in c.lower():
        return True
    if len(c) < 2:
        return True
    return False


def streetish(address: str | None) -> bool:
    """True only for a concrete street pin — not bare house numbers."""
    if not address:
        return False
    a = address.strip()
    if is_bad_city_token(a):
        return False
    # Bare house number («2951») is NOT a street — Svoi maps often omit the road.
    if re.fullmatch(r"\d{1,6}[A-Za-z]?", a):
        return False
    if re.match(r"^\d{1,6}\s+[A-Za-zА-Яа-яЁё]", a):
        return True
    if re.search(
        r"\b(st|street|ave|avenue|blvd|road|rd|dr|drive|way|lane|ln|ct|court|"
        r"pl|place|suite|ste|#|улиц|проспект|бульвар)\b",
        a,
        re.I,
    ) and re.search(r"\d", a):
        return True
    return False


def is_svoi_seo_blurb(text: str | None) -> bool:
    """Svoi og:description template — not a real about text."""
    t = (text or "").strip()
    if not t:
        return False
    if re.search(r"по\s+приемлемым\s+ценам", t, re.I):
        return True
    if re.search(r"от\s+компании\s+.+\s+по\s+приемлемым", t, re.I):
        return True
    if re.search(r"Телефон\s*[:：]\s*\+?\d", t, re.I) and len(t) < 220:
        return True
    return False


def strip_inline_phone_labels(text: str) -> str:
    """Remove phone labels from narrative (contacts belong in contact fields)."""
    t = text
    t = re.sub(
        r"(?:^|[.\s])(?:Телефон|Phone|Tel|Call)\s*[:：]?\s*"
        r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b",
        " ",
        t,
        flags=re.I,
    )
    t = re.sub(r"\b(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b", " ", t)
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"\s+([.,;:])", r"\1", t)
    return t.strip(" \n\t-–—")


def extract_svoi_body_description(html: str) -> str | None:
    """Real company blurb from Svoi detail HTML — never the SEO og:description."""
    m = re.search(
        r"<h1[^>]*>.*?</h1>\s*(?:<(?:div|span|p)[^>]*>\s*)*([^<]{60,})",
        html,
        re.I | re.S,
    )
    if m:
        body = re.sub(r"\s+", " ", m.group(1)).strip()
        if _looks_like_svoi_body(body):
            return strip_inline_phone_labels(body)[:4000] or None
    best = ""
    for raw in re.findall(r"<p[^>]*>(.*?)</p>", html, re.I | re.S):
        t = re.sub(r"<[^>]+>", " ", raw)
        t = re.sub(r"\s+", " ", t).strip()
        if not _looks_like_svoi_body(t):
            continue
        if len(t) > len(best):
            best = t
    if best:
        return strip_inline_phone_labels(best)[:4000] or None
    return None


def _looks_like_svoi_body(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < 60:
        return False
    if is_svoi_seo_blurb(t) or t.startswith("."):
        return False
    # Sidebar / chrome after empty company pages
    if re.match(r"Сообщить\s+о\s+Проблеме", t, re.I):
        return False
    if "Похожие компании" in t:
        return False
    if "gsib_b" in t or "gsc-control" in t:
        return False
    # Contact-only dump from the right column
    if re.search(r"Телефон\s*[:：]", t, re.I) and re.search(r"Адрес\s*[:：]", t, re.I):
        return False
    return True
