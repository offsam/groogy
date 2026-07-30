#!/usr/bin/env python3
"""Enrich pending Svoi.us Yellow Pages cards, then optionally publish to businesses.

Flow per card (fill-empty):
  1) scrape svoi company page → website / cover / phones / emails
  2) Google Places → street address, hours, maps, rating, website
  3) PATCH import_comment_recommendations (notes + websites + city + cover)
  4) with --publish: create/merge approved businesses when street address found

Prefer California hubs (LA / San Diego / Sacramento / SF). Gradual batches.

Usage:
  python3 scripts/business-enrich/enrich_svoi_directory.py --dry-run --limit 5
  python3 scripts/business-enrich/enrich_svoi_directory.py --apply --limit 8
  python3 scripts/business-enrich/enrich_svoi_directory.py --apply --publish --limit 8
  python3 scripts/business-enrich/enrich_svoi_directory.py --apply --publish --region "Los Angeles" --limit 10
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from source_kind import resolve_source_kind  # noqa: E402
from address_geo import resolve_address_geo  # noqa: E402
from google_places import (  # noqa: E402
    lookup_business_places,
    maps_api_key,
    place_to_fill_empty_patch,
)
from scrape_svoi_us import normalize_website  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "svoi_enrich"
OUT.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

CA_REGIONS = {
    "Los Angeles",
    "San Diego",
    "Sacramento",
    "San Francisco Bay",
}

REGION_STATE = {
    "Los Angeles": "US-CA",
    "San Diego": "US-CA",
    "Sacramento": "US-CA",
    "San Francisco Bay": "US-CA",
    "Orange County": "US-CA",
    "New York metro": "US-NY",
    "Chicago metro": "US-IL",
    "Miami / Florida": "US-FL",
    "Boston metro": "US-MA",
    "Philadelphia": "US-PA",
    "Portland": "US-OR",
    "Seattle": "US-WA",
    "Houston": "US-TX",
    "Dallas": "US-TX",
    "Atlanta": "US-GA",
    "Baltimore": "US-MD",
    "Washington DC": "US-DC",
    "Denver": "US-CO",
    "Phoenix": "US-AZ",
    "Cleveland": "US-OH",
    "Minneapolis": "US-MN",
}

CITY_EN = {
    "лос-анджелес": "Los Angeles",
    "лос анджелес": "Los Angeles",
    "глендейл": "Glendale",
    "бербанк": "Burbank",
    "уэст голливуд": "West Hollywood",
    "вест голливуд": "West Hollywood",
    "голливуд": "Hollywood",
    "беверли-хиллз": "Beverly Hills",
    "беверли хиллз": "Beverly Hills",
    "сан-диего": "San Diego",
    "сан диего": "San Diego",
    "сакраменто": "Sacramento",
    "фолсом": "Folsom",
    "нью-йорк": "New York",
    "бруклин": "Brooklyn",
    "чикаго": "Chicago",
}

CAT_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("restaurants", re.compile(r"ресторан|кафе|пицц|bakery|deli|еда|food|sushi|кухн", re.I)),
    ("beauty", re.compile(r"салон|beauty|маникюр|парикмахер|nail|косметолог|барбер", re.I)),
    ("auto", re.compile(r"авто|auto|ремонт машин|автосервис|детейлинг", re.I)),
    ("medical", re.compile(r"аптек|pharmacy|clinic|медицин|стомат|dental|doctor", re.I)),
    ("groceries", re.compile(r"магазин|grocery|продукт|market\b|супермаркет", re.I)),
    ("education", re.compile(r"школ|school|обучен|репетитор|курс", re.I)),
    ("fitness", re.compile(r"фитнес|gym|йога|спорт|танц|rhythmic", re.I)),
    ("legal", re.compile(r"юрист|адвокат|legal|нотариус", re.I)),
    ("finance", re.compile(r"бухгалтер|tax|налог|консалтинг|consult", re.I)),
    ("real_estate", re.compile(r"риелтор|недвижим|realtor", re.I)),
    ("services", re.compile(r"агентств|employment|найм|услуг|service|перевоз|транспорт", re.I)),
]

BATCH = "svoi_directory_enrich_v1"


def note_field(notes: str | None, key: str) -> str | None:
    if not notes:
        return None
    for part in notes.split(";"):
        p = part.strip()
        if p.lower().startswith(f"{key.lower()}:"):
            return p[len(key) + 1 :].strip() or None
    return None


def set_note(notes: str | None, key: str, value: str | None) -> str:
    parts: list[str] = []
    key_l = key.lower()
    for part in (notes or "").split(";"):
        p = part.strip()
        if not p:
            continue
        if p.lower().startswith(f"{key_l}:"):
            continue
        parts.append(p)
    if value:
        parts.append(f"{key}:{value}")
    return "; ".join(parts)


def is_bad_city(city: str | None) -> bool:
    if not city:
        return True
    c = city.strip()
    if "@" in c or "email" in c.lower():
        return True
    if len(c) < 2:
        return True
    return False


def english_city(city: str | None) -> str | None:
    if not city or is_bad_city(city):
        return None
    key = city.strip().lower().replace("ё", "е")
    return CITY_EN.get(key) or city.strip()


def company_path_from_url(url: str | None) -> str | None:
    if not url:
        return None
    path = urlparse(url).path or ""
    if "/company/" not in path:
        return None
    return path.lstrip("/")


def fetch_html(url: str, *, timeout: int = 45) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def scrape_website_details(website: str | None) -> dict[str, Any]:
    """Deep scrape of company website: hours, contacts, social, schema address."""
    out: dict[str, Any] = {}
    if not website:
        return out
    try:
        html = fetch_html(website, timeout=30)
    except Exception as exc:  # noqa: BLE001
        out["_error"] = str(exc)[:160]
        return out

    # JSON-LD OpeningHours
    for m in re.finditer(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.I | re.S,
    ):
        blob = m.group(1)
        if "openingHours" in blob or "OpeningHours" in blob:
            oh = re.findall(r'"openingHours"\s*:\s*(\[[^\]]+\]|"[^"]+")', blob)
            if oh and "opening_hours" not in out:
                try:
                    parsed = json.loads(oh[0].replace("'", '"'))
                    if isinstance(parsed, list):
                        out["opening_hours"] = {
                            "weekday_text": [str(x) for x in parsed][:14]
                        }
                    elif isinstance(parsed, str):
                        out["opening_hours"] = {"weekday_text": [parsed]}
                except json.JSONDecodeError:
                    pass
        # Postal address in schema
        street = re.search(r'"streetAddress"\s*:\s*"([^"]+)"', blob)
        locality = re.search(r'"addressLocality"\s*:\s*"([^"]+)"', blob)
        region = re.search(r'"addressRegion"\s*:\s*"([^"]+)"', blob)
        postal = re.search(r'"postalCode"\s*:\s*"([^"]+)"', blob)
        if street and "address_line" not in out:
            out["address_line"] = normalize_street_line(street.group(1).strip())[:160]
            if locality:
                out["city"] = locality.group(1).strip()
            if region and len(region.group(1).strip()) == 2:
                out["state_code"] = f"US-{region.group(1).strip().upper()}"
            if postal:
                out["postal_code"] = postal.group(1).strip()

    if "opening_hours" not in out:
        texts = re.findall(
            r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)"
            r"[^<\n]{0,50}\d{1,2}(?::\d{2})?\s*[AaPp][Mm]"
            r"[^<\n]{0,30}\d{1,2}(?::\d{2})?\s*[AaPp][Mm]",
            html,
        )
        if texts:
            cleaned = [re.sub(r"\s+", " ", t).strip() for t in texts]
            uniq: list[str] = []
            for t in cleaned:
                if t not in uniq:
                    uniq.append(t)
            if uniq:
                out["opening_hours"] = {"weekday_text": uniq[:14]}

    emails: list[str] = []
    for raw in re.findall(r"mailto:([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})", html, re.I):
        e = raw.strip().lower()
        if e not in emails and "example." not in e and "sentry" not in e:
            emails.append(e)
    if emails:
        out["emails"] = emails[:4]

    phones: list[str] = []
    for raw in re.findall(r"tel:([+\d().\-\s]{10,20})", html, re.I):
        digits = re.sub(r"\D", "", raw)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) == 10:
            p = f"+1{digits}"
            if p not in phones:
                phones.append(p)
    if phones:
        out["phones"] = phones[:4]

    ig = re.search(
        r'https?://(?:www\.)?instagram\.com/([A-Za-z0-9_.]+)/?',
        html,
        re.I,
    )
    if ig and ig.group(1).lower() not in {"p", "reel", "stories", "explore"}:
        out["instagram_url"] = f"https://www.instagram.com/{ig.group(1)}"

    fb = re.search(
        r'https?://(?:www\.)?facebook\.com/([A-Za-z0-9.]+)/?',
        html,
        re.I,
    )
    if fb and fb.group(1).lower() not in {"sharer", "share", "dialog", "plugins"}:
        out["facebook_url"] = f"https://www.facebook.com/{fb.group(1)}"

    og_desc = re.search(r'property="og:description"\s+content="([^"]+)"', html, re.I)
    if og_desc:
        out["description"] = re.sub(r"\s+", " ", og_desc.group(1)).strip()[:4000]

    yelp = re.search(r'https?://(?:www\.)?yelp\.com/biz/[^"\s<>]+', html, re.I)
    if yelp:
        out["yelp_url"] = yelp.group(0).split("?")[0][:300]

    return out


def scrape_website_hours(website: str | None) -> dict[str, Any] | None:
    """Back-compat wrapper."""
    details = scrape_website_details(website)
    return details.get("opening_hours")


def parse_maps_search_address(html: str) -> dict[str, Any]:
    """Svoi embeds google.com/maps/search/<urlencoded address> — best street source."""
    m = re.search(
        r"https://(?:www\.)?google\.[a-z.]+/maps/search/([^\"'\s]+)",
        html,
        re.I,
    )
    if not m:
        return {}
    raw = urllib.parse.unquote(m.group(1).replace("+", " ")).strip()
    raw = raw.split("?")[0].strip(" /")
    if len(raw) < 8:
        return {}
    out: dict[str, Any] = {
        "formatted_address": raw,
        "google_maps_url": f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(raw)}",
    }
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if len(parts) >= 2:
        street = normalize_street_line(parts[0])
        out["address_line"] = street[:160]
        city = parts[1]
        cm = re.match(r"^(.*?)\s+([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$", city)
        if cm:
            out["city"] = cm.group(1).strip()
            out["state_code"] = f"US-{cm.group(2)}"
            if cm.group(3):
                out["postal_code"] = cm.group(3)
        else:
            out["city"] = city
            if len(parts) >= 3:
                sm = re.match(r"^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$", parts[2])
                if sm:
                    out["state_code"] = f"US-{sm.group(1)}"
                    if sm.group(2):
                        out["postal_code"] = sm.group(2)
    elif streetish(raw):
        out["address_line"] = raw[:160]
    return out


def looks_like_person_name(name: str | None) -> bool:
    n = (name or "").strip()
    if not n:
        return True
    if re.search(
        r"llc|inc|corp|studio|salon|clinic|agency|auto|pizza|market|pharmacy|"
        r"cafe|restaurant|school|center|centre|group|services|shop|store|"
        r"dental|law|bank|church|temple|gym|yoga|deli|bakery|bar|grill|"
        r"аптек|салон|школ|агентств|студи|центр|кафе|ресторан",
        n,
        re.I,
    ):
        return False
    parts = re.split(r"\s+", n)
    if len(parts) in (2, 3) and all(len(p) >= 2 for p in parts) and not re.search(r"\d", n):
        return True
    return False


# Sidebar / chrome hosts that leak into naive whole-page scrapes.
ORANGE_PAGES_JUNK_HOSTS = (
    "russianorangepages.com",
    "fchconstruction.org",
    "liveattheshell.org",
    "ocparks.com",
    "art-a-fair.com",
    "fonts.googleapis.com",
    "gmpg.org",
    "w.org",
    "wordpress.org",
    "themuck.org",
    "facebook.com/sharer",
    "twitter.com",
    "pinterest.com",
)


def is_orange_pages_junk_website(url: str | None) -> bool:
    if not url:
        return True
    low = url.lower()
    return any(h in low for h in ORANGE_PAGES_JUNK_HOSTS)


def enrich_orange_pages_detail(rec: dict[str, Any]) -> dict[str, Any]:
    """Scrape russianorangepages.com listing — article body only (not page chrome)."""
    out: dict[str, Any] = {}
    src = (rec.get("source_post_urls") or [None])[0]
    if not src:
        return out
    try:
        html = fetch_html(src, timeout=45)
    except Exception as exc:  # noqa: BLE001
        out["_svoi_error"] = str(exc)[:200]
        return out

    # Reuse the dedicated listing parser (article body, labeled fields).
    from scrape_russian_orange_pages import parse_listing  # local import

    parsed = parse_listing(html, src)
    if not parsed:
        out["_svoi_error"] = "parse_listing_failed"
        return out

    websites = [
        w
        for w in (parsed.get("websites") or [])
        if w and not is_orange_pages_junk_website(w)
    ]
    phones = list(parsed.get("phones") or [])
    emails = list(parsed.get("emails") or [])

    addr = parsed.get("address")
    cleaned_addr = None
    if addr:
        # Inline light clean (shared helpers live in professional enrich script;
        # keep a conservative filter here so directory enrich stays safe).
        line = re.sub(r"\s+", " ", str(addr)).strip()
        line = re.sub(r"^(?:new!+\s*)+", "", line, flags=re.I).strip()
        street_only = re.split(r",\s*(?:[A-Za-z .]+,?\s*)?CA\b", line, maxsplit=1)[0]
        street_only = re.sub(r",?\s*\d{5}(?:-\d{4})?\s*$", "", street_only).strip(" ,")
        if (
            streetish(street_only)
            and re.match(r"^\d{1,5}\s+[A-Za-z]", street_only)
            and not re.match(r"^\d{1,5}\s+\d+", street_only)
            and not re.search(r"wp-|single-format|class=|russian lawyer|olga\s+lannom", street_only, re.I)
            and len(street_only.split()) <= 10
        ):
            cleaned_addr = normalize_street_line(street_only)[:160]
    if cleaned_addr:
        # Precision is decided by the geo step (address_geo), not by the string
        # shape — a street-like line without coordinates is not a street pin.
        out["address_line"] = cleaned_addr
        zip_m = re.search(r"\bCA\s+(\d{5})\b", str(addr), re.I)
        if zip_m and zip_m.group(1).startswith("9"):
            out["postal_code"] = zip_m.group(1)

    city = parsed.get("city")
    if city:
        city_s = str(city).strip()
        if city_s.upper() in {"OC", "ORANGE COUNTY"}:
            out["region"] = "Orange County"
        else:
            out["city"] = city_s
            out["state_code"] = "US-CA"
            out["region"] = "Orange County"

    # City, CA / ZIP embedded in body when parser missed city
    if not out.get("city"):
        blob = f"{parsed.get('description') or ''} {addr or ''}"
        city_m = re.search(
            r"\b(Costa Mesa|Newport Beach|Fullerton|Irvine|Anaheim|Tustin|"
            r"Fountain Valley|Mission Viejo|Laguna Woods|Laguna Niguel|"
            r"Lake Forest|Long Beach|Santa Ana|Huntington Beach|Garden Grove|"
            r"Yorba Linda|San Clemente|Brea|Placentia|Westminster|Buena Park|"
            r"Orange)\b,?\s*CA\b",
            blob,
            re.I,
        )
        if city_m:
            out["city"] = city_m.group(1)
            out["state_code"] = "US-CA"
            out["region"] = "Orange County"
        zip_m = re.search(r"\b(\d{5})(?:-\d{4})?\b", blob)
        if zip_m and not out.get("postal_code"):
            out["postal_code"] = zip_m.group(1)

    if websites:
        out["websites"] = websites[:4]
    if phones:
        out["phones"] = phones[:6]
    if emails:
        out["emails"] = emails[:4]
    if parsed.get("cover_image_url"):
        out["cover_image_url"] = parsed["cover_image_url"]
    if parsed.get("instagram"):
        out["instagram"] = parsed["instagram"][:3]
    desc = (parsed.get("short_description") or parsed.get("description") or "").strip()
    if desc:
        out["description"] = desc[:4000]
    return out


def enrich_source_page(rec: dict[str, Any], directory_source: str) -> dict[str, Any]:
    if directory_source == "orange_pages":
        return enrich_orange_pages_detail(rec)
    return enrich_svoi_page(rec)


def enrich_svoi_page(rec: dict[str, Any]) -> dict[str, Any]:
    """Return fill fields from svoi detail page (site, phones, maps address)."""
    out: dict[str, Any] = {}
    src = (rec.get("source_post_urls") or [None])[0]
    if not src:
        return out
    try:
        html = fetch_html(src)
    except Exception as exc:  # noqa: BLE001
        out["_svoi_error"] = str(exc)[:200]
        return out

    path = company_path_from_url(src)
    card: dict[str, Any] = {
        "company_path": path,
        "phones": list(rec.get("phones") or []),
        "websites": list(rec.get("websites") or []),
        "emails": [],
        "cover_image_url": rec.get("cover_image_url"),
        "description": "\n".join(rec.get("comment_texts") or [])[:4000],
        "short_description": "",
    }
    # Reuse detail parsers against already-fetched HTML via temp monkeypatch path:
    # enrich_from_detail fetches again — avoid double fetch by inlining key bits.
    websites: list[str] = []
    for raw in re.findall(
        r'class="[^"]*site-button[^"]*"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="[^"]*site-button',
        html,
        re.I,
    ):
        cand = raw[0] or raw[1]
        w = normalize_website(cand)
        if w and w not in websites:
            websites.append(w)
    if not websites:
        for raw in re.findall(r'href="(https?://[^"]+)"', html):
            w = normalize_website(raw)
            if w and w not in websites:
                websites.append(w)
            if len(websites) >= 3:
                break
    phones = list(rec.get("phones") or [])
    for raw in re.findall(r'href="tel:([^"]+)"', html):
        digits = re.sub(r"\D", "", raw)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) == 10:
            p = f"+1{digits}"
            if p not in phones:
                phones.append(p)
    emails: list[str] = []
    for raw in re.findall(r'href="mailto:([^"?]+)', html, re.I):
        e = raw.strip().lower()
        if e and e not in emails and "@" in e:
            emails.append(e)
    og_img = re.search(r'property="og:image"\s+content="([^"]+)"', html, re.I)
    og_desc = re.search(r'property="og:description"\s+content="([^"]+)"', html, re.I)
    maps = parse_maps_search_address(html)

    if websites:
        out["websites"] = websites[:4]
    if phones:
        out["phones"] = phones[:6]
    if emails:
        out["emails"] = emails[:4]
    if og_img:
        out["cover_image_url"] = og_img.group(1)
    if og_desc:
        out["description"] = re.sub(r"\s+", " ", og_desc.group(1)).strip()[:4000]
    out.update(maps)
    _ = card  # keep shape docs
    return out


def guess_category_slug(rec: dict[str, Any]) -> str:
    blob = " ".join(
        [
            str(rec.get("category_guess") or ""),
            str(rec.get("display_name") or ""),
            " ".join(rec.get("comment_texts") or [])[:400],
        ]
    )
    for slug, pat in CAT_RULES:
        if pat.search(blob):
            return slug
    return "services"


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")[:48]
    return s or "biz"


def unique_slug(client: SupabaseRest, base: str) -> str:
    slug = base
    n = 2
    while True:
        rows = (
            client._request(
                "GET",
                "/businesses",
                params={"select": "id", "slug": f"eq.{slug}", "limit": "1"},
            )
            or []
        )
        if not rows:
            return slug
        slug = f"{base}-{n}"
        n += 1


def plain_website(websites: list[Any]) -> str | None:
    for w in websites or []:
        if not isinstance(w, str):
            continue
        low = w.lower()
        if any(
            x in low
            for x in (
                "instagram.com",
                "facebook.com",
                "t.me/",
                "yelp.com",
                "wa.me",
                "linktr.ee",
            )
        ):
            continue
        nw = normalize_website(w) if "://" not in w else w
        if nw:
            return nw.split("?")[0][:300]
    return None


def streetish(address: str | None) -> bool:
    if not address:
        return False
    a = address.strip()
    if is_bad_city(a):
        return False
    # city-only Russian/English names usually lack digits or street tokens
    if re.search(r"\d", a):
        return True
    if re.search(
        r"\b(st|street|ave|avenue|blvd|road|rd|dr|drive|way|lane|ln|ct|court|pl|place|suite|ste|#)\b",
        a,
        re.I,
    ):
        return True
    return False


def needs_enrichment(rec: dict[str, Any], *, allow_enriched: bool = False) -> bool:
    notes = rec.get("notes") or ""
    entity = (note_field(notes, "entity") or "business").lower()
    if entity not in {"business", "professional"}:
        return False
    if allow_enriched:
        if rec.get("published_entity_id"):
            return False
        return entity == "business" and bool(streetish(note_field(notes, "address")))
    if note_field(notes, "svoi_enriched") == "1":
        return False
    if note_field(notes, "places_enriched") == "1" and streetish(note_field(notes, "address")):
        return False
    return True


def fetch_targets(
    client: SupabaseRest,
    *,
    limit: int,
    region: str | None,
    prefer_ca: bool,
    skip_persons: bool,
    allow_enriched: bool = False,
    directory_source: str = "svoi",
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    select = (
        "id,display_name,city,phones,instagram,websites,notes,source_post_urls,"
        "comment_texts,status,target_bucket,category_guess,cover_image_url,"
        "directory_source,cluster_key,source_channel,source_groups,published_entity_id"
    )
    while len(rows) < limit and offset < 4000:
        batch = (
            client._request(
                "GET",
                "/import_comment_recommendations",
                params={
                    "select": select,
                    "directory_source": f"eq.{directory_source}",
                    "status": "eq.pending",
                    "target_bucket": "eq.yellow_pages",
                    "order": "updated_at.desc" if allow_enriched else "updated_at.asc",
                    "offset": str(offset),
                    "limit": "100",
                },
            )
            or []
        )
        if not batch:
            break
        for rec in batch:
            if not needs_enrichment(rec, allow_enriched=allow_enriched):
                continue
            if skip_persons and looks_like_person_name(rec.get("display_name")):
                continue
            reg = note_field(rec.get("notes"), "region") or ""
            if region and reg != region:
                continue
            if prefer_ca and not region and directory_source == "svoi" and reg not in CA_REGIONS:
                continue
            rows.append(rec)
            if len(rows) >= limit:
                break
        offset += len(batch)
        if len(batch) < 100:
            break
    if not rows and prefer_ca and not region and directory_source == "svoi":
        return fetch_targets(
            client,
            limit=limit,
            region=None,
            prefer_ca=False,
            skip_persons=skip_persons,
            allow_enriched=allow_enriched,
            directory_source=directory_source,
        )
    return rows


def normalize_street_line(street: str) -> str:
    s = street.strip()
    flip = re.match(r"^([A-Za-z][A-Za-z0-9 .#'/-]+?)\s+(\d{1,6}[A-Za-z\-]*)$", s)
    if flip and not re.match(r"^\d", s):
        return f"{flip.group(2)} {flip.group(1)}"
    # "N Maclay Ave # 104 541" → "541 N Maclay Ave # 104"
    m = re.match(r"^(.+?\s#\s*\w+)\s+(\d{2,6})$", s)
    if m and not re.match(r"^\d", s):
        return f"{m.group(2)} {m.group(1)}"
    return s


def find_biz_by_phone(client: SupabaseRest, phone: str | None) -> dict[str, Any] | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return None
    variants = [f"+1{digits}", f"1{digits}", digits, f"+1 {digits}"]
    for v in variants:
        rows = (
            client._request(
                "GET",
                "/businesses",
                params={
                    "select": "id,name,slug,phone,website,city,address_line,opening_hours,"
                    "google_maps_url,google_rating,latitude,longitude,image_url,status",
                    "phone": f"eq.{v}",
                    "limit": "1",
                },
            )
            or []
        )
        if rows:
            return rows[0]
    return None


def publish_business(
    client: SupabaseRest,
    rec: dict[str, Any],
    patch: dict[str, Any],
    *,
    category_id: str | None,
    dry_run: bool,
) -> dict[str, Any]:
    phone = patch.get("phone")
    if not phone:
        for p in rec.get("phones") or []:
            d = re.sub(r"\D", "", str(p))
            if len(d) == 11 and d.startswith("1"):
                phone = f"+1{d[1:]}"
                break
            if len(d) == 10:
                phone = f"+1{d}"
                break
    existing = find_biz_by_phone(client, phone)
    website = patch.get("website") or plain_website(rec.get("websites") or [])
    name = (rec.get("display_name") or "Business").strip()[:120]
    desc_parts = [t for t in (rec.get("comment_texts") or [])[:3] if t]
    description = "\n\n".join(desc_parts)[:4000] or None
    now = datetime.now(timezone.utc).isoformat()
    region = note_field(rec.get("notes"), "region")
    state = REGION_STATE.get(region or "", "US-CA")
    city = patch.get("city") or english_city(rec.get("city")) or None

    body: dict[str, Any] = {
        "name": name,
        "short_description": (description or "")[:240] or None,
        "description": description,
        "phone": phone,
        "website": website,
        "city": city,
        "state_code": state,
        "status": "approved",
        "category_id": category_id,
        "source_url": (rec.get("source_post_urls") or [None])[0],
        "source_kind": resolve_source_kind(
            (rec.get("source_post_urls") or [None])[0],
            rec.get("directory_source") or rec.get("source_channel"),
        ),
        "updated_at": now,
    }
    for k in (
        "address_line",
        "latitude",
        "longitude",
        "location_precision",
        "google_maps_url",
        "google_rating",
        "google_reviews_count",
        "opening_hours",
        "email",
        "instagram_url",
        "yelp_url",
        "postal_code",
    ):
        if patch.get(k) is not None:
            body[k] = patch[k]
    if patch.get("state_code"):
        body["state_code"] = patch["state_code"]
    # Address found → geocode it, so the card publishes with a real pin.
    if body.get("address_line") and body.get("latitude") is None and not dry_run:
        geo = resolve_address_geo(
            body["address_line"],
            body.get("city"),
            body.get("state_code"),
            body.get("postal_code"),
        )
        body.update(geo.patch)
        print(f"  geo: {geo.reason} {geo.query or ''}", flush=True)
    cover = rec.get("cover_image_url")
    if cover and "placeholder" not in str(cover).lower():
        body["image_url"] = cover

    if existing:
        merge: dict[str, Any] = {"updated_at": now}
        for k, v in body.items():
            if k in {"name", "status", "source_kind", "source_url"}:
                continue
            if v is None:
                continue
            cur = existing.get(k)
            if cur is None or cur == "" or cur == []:
                merge[k] = v
        if dry_run:
            return {"action": "merge", "id": existing["id"], "patch": merge}
        client._request(
            "PATCH",
            "/businesses",
            params={"id": f"eq.{existing['id']}"},
            body=merge,
            prefer="return=minimal",
        )
        return {"action": "merge", "id": existing["id"], "patch": merge}

    prefix = "rop" if (rec.get("directory_source") or "") == "orange_pages" else "svoi"
    base = f"{prefix}-{slugify(name)}"
    slug = base if dry_run else unique_slug(client, base)
    body["slug"] = slug
    body["created_at"] = now
    if dry_run:
        return {"action": "create", "slug": slug, "body": body}
    rows = client._request(
        "POST",
        "/businesses",
        body=body,
        prefer="return=representation",
    )
    if isinstance(rows, list) and rows:
        return {"action": "create", "id": rows[0]["id"], "slug": slug}
    raise RuntimeError(f"business insert failed: {name}")


def publish_professional(
    client: SupabaseRest,
    rec: dict[str, Any],
    patch: dict[str, Any],
    *,
    category_id: str | None,
    dry_run: bool,
) -> dict[str, Any]:
    phone = patch.get("phone")
    if not phone:
        for p in rec.get("phones") or []:
            d = re.sub(r"\D", "", str(p))
            if len(d) == 11 and d.startswith("1"):
                phone = f"+1{d[1:]}"
                break
            if len(d) == 10:
                phone = f"+1{d}"
                break
    name = (rec.get("display_name") or "Специалист").strip()[:120]
    website = patch.get("website") or plain_website(rec.get("websites") or [])
    desc_parts = [t for t in (rec.get("comment_texts") or [])[:3] if t]
    description = "\n\n".join(desc_parts)[:4000] or None
    now = datetime.now(timezone.utc).isoformat()
    region = note_field(rec.get("notes"), "region")
    state = patch.get("state_code") or REGION_STATE.get(region or "", "US-CA")
    city = patch.get("city") or english_city(rec.get("city"))
    base = f"svoi-{slugify(name)}"
    slug = base if dry_run else unique_slug_table(client, "professionals", base)
    body: dict[str, Any] = {
        "display_name": name,
        "slug": slug,
        "short_description": (description or "")[:280] or None,
        "description": description,
        "phone": phone,
        "website": website,
        "city": city,
        "state_code": state,
        "status": "approved",
        "visibility": "public",
        "category_id": category_id,
        "source_type": "IMPORT",
        "source_url": (rec.get("source_post_urls") or [None])[0],
        "source_record_id": rec["id"],
        "imported_at": now,
        "published_at": now,
        "updated_at": now,
        "created_at": now,
        # Street precision comes from the geo step only; without coordinates a
        # card stays city/county level.
        "location_precision": patch.get("location_precision")
        or ("city" if city else None),
        "public_exact_address": False,
    }
    if patch.get("instagram_url"):
        body["instagram_url"] = patch["instagram_url"]
    cover = rec.get("cover_image_url")
    if cover and "placeholder" not in str(cover).lower():
        body["image_url"] = cover
    # Match existing by phone
    if phone and not dry_run:
        existing = (
            client._request(
                "GET",
                "/professionals",
                params={
                    "select": "id,display_name,phone,website,city,image_url,category_id",
                    "phone": f"eq.{phone}",
                    "limit": "1",
                },
            )
            or []
        )
        if existing:
            merge: dict[str, Any] = {"updated_at": now}
            for k, v in body.items():
                if k in {"display_name", "status", "source_type", "slug", "created_at"}:
                    continue
                if v is None:
                    continue
                cur = existing[0].get(k)
                if cur is None or cur == "":
                    merge[k] = v
            client._request(
                "PATCH",
                "/professionals",
                params={"id": f"eq.{existing[0]['id']}"},
                body=merge,
                prefer="return=minimal",
            )
            return {"action": "merge", "id": existing[0]["id"]}
    if dry_run:
        return {"action": "create", "slug": slug, "body": body}
    rows = client._request(
        "POST",
        "/professionals",
        body=body,
        prefer="return=representation",
    )
    if isinstance(rows, list) and rows:
        return {"action": "create", "id": rows[0]["id"], "slug": slug}
    raise RuntimeError(f"professional insert failed: {name}")


def unique_slug_table(client: SupabaseRest, table: str, base: str) -> str:
    slug = base
    n = 2
    while True:
        rows = (
            client._request(
                "GET",
                f"/{table}",
                params={"select": "id", "slug": f"eq.{slug}", "limit": "1"},
            )
            or []
        )
        if not rows:
            return slug
        slug = f"{base}-{n}"
        n += 1


def mark_recommendation(
    client: SupabaseRest,
    rec_id: str,
    *,
    entity_type: str,
    entity_id: str | None,
    dry_run: bool,
) -> None:
    if dry_run or not entity_id:
        return
    client._request(
        "PATCH",
        "/import_comment_recommendations",
        params={"id": f"eq.{rec_id}"},
        body={
            "status": "approved",
            "published_entity_type": entity_type,
            "published_entity_id": entity_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        prefer="return=minimal",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--publish", action="store_true", help="Also write approved businesses")
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--region", default="", help='e.g. "Los Angeles"')
    parser.add_argument(
        "--any-region",
        action="store_true",
        help="Do not prefer California hubs",
    )
    parser.add_argument(
        "--include-persons",
        action="store_true",
        help="Also process person-like display names",
    )
    parser.add_argument(
        "--places",
        action="store_true",
        default=True,
        help="Call Google Places when quota allows (default on)",
    )
    parser.add_argument(
        "--no-places",
        action="store_true",
        help="Skip Google Places lookups",
    )
    parser.add_argument(
        "--publish-enriched",
        action="store_true",
        help="Only publish already svoi_enriched pending cards (no re-scrape)",
    )
    parser.add_argument(
        "--directory-source",
        default="svoi",
        help="yellow_pages directory_source (svoi, orange_pages, ...)",
    )
    parser.add_argument("--sleep", type=float, default=0)
    args = parser.parse_args()
    if not args.apply and not args.dry_run:
        args.dry_run = True
    dry_run = not args.apply
    use_places = bool(args.places) and not args.no_places

    load_env()
    key = maps_api_key() if use_places else None
    if use_places and not key:
        print("WARN: no GOOGLE_MAPS_API_KEY — continuing without Places", flush=True)
        use_places = False
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    skey = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not skey:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, skey)

    cats = (
        client._request(
            "GET",
            "/categories",
            params={
                "select": "id,slug,domain",
                "is_active": "eq.true",
                "limit": "300",
            },
        )
        or []
    )
    biz_cat = {c["slug"]: c for c in cats if c.get("domain") == "business"}
    pro_cat = {c["slug"]: c for c in cats if c.get("domain") == "professional"}
    cat_by_slug = biz_cat  # default for publish-enriched path

    targets = fetch_targets(
        client,
        limit=args.limit,
        region=args.region or None,
        prefer_ca=not args.any_region and args.directory_source == "svoi",
        skip_persons=not args.include_persons,
        allow_enriched=args.publish_enriched,
        directory_source=args.directory_source,
    )
    print(
        f"source={args.directory_source} targets={len(targets)} dry_run={dry_run} "
        f"publish={args.publish or args.publish_enriched} "
        f"places={use_places} publish_enriched={args.publish_enriched}"
    )

    report: list[dict[str, Any]] = []
    for i, rec in enumerate(targets, 1):
        name = (rec.get("display_name") or "").strip()
        print(f"\n[{i}/{len(targets)}] {name}", flush=True)
        entry: dict[str, Any] = {"id": rec["id"], "name": name, "changes": {}}

        if args.publish_enriched:
            notes = rec.get("notes") or ""
            addr = note_field(notes, "address")
            fill_patch: dict[str, Any] = {
                "address_line": normalize_street_line(addr) if addr else None,
                "city": english_city(rec.get("city")) or rec.get("city"),
                "website": plain_website(rec.get("websites") or []),
                "phone": (rec.get("phones") or [None])[0],
            }
            hours_note = note_field(notes, "hours")
            if hours_note:
                fill_patch["opening_hours"] = {
                    "weekday_text": [h.strip() for h in hours_note.split("|") if h.strip()]
                }
            zipc = note_field(notes, "zip")
            if zipc:
                fill_patch["postal_code"] = zipc
            region = note_field(notes, "region") or ""
            if region in REGION_STATE:
                fill_patch["state_code"] = REGION_STATE[region]
            if fill_patch.get("address_line") and fill_patch.get("city"):
                q = f"{fill_patch['address_line']}, {fill_patch['city']}, CA"
                fill_patch["google_maps_url"] = (
                    f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(q)}"
                )
            # drop empties
            fill_patch = {k: v for k, v in fill_patch.items() if v not in (None, "", [])}
            entry["fill"] = {k: fill_patch.get(k) for k in fill_patch if k != "opening_hours"}
            print(f"  from notes: {sorted(fill_patch.keys())}", flush=True)
            if not args.apply and not dry_run:
                dry_run = True
            do_publish = True
            # skip recommendation update
            if streetish(fill_patch.get("address_line")):
                cat_slug = guess_category_slug(rec)
                cat = cat_by_slug.get(cat_slug) or cat_by_slug.get("services")
                try:
                    pub_result = publish_business(
                        client,
                        rec,
                        fill_patch,
                        category_id=cat["id"] if cat else None,
                        dry_run=dry_run,
                    )
                    entry["publish"] = {
                        k: pub_result.get(k)
                        for k in ("action", "id", "slug")
                        if k in pub_result
                    }
                    print(f"  publish: {entry['publish']}", flush=True)
                    if not dry_run and pub_result.get("id"):
                        notes2 = set_note(notes, "address", fill_patch["address_line"])
                        client._request(
                            "PATCH",
                            "/import_comment_recommendations",
                            params={"id": f"eq.{rec['id']}"},
                            body={
                                "notes": notes2,
                                "updated_at": datetime.now(timezone.utc).isoformat(),
                            },
                            prefer="return=minimal",
                        )
                        mark_recommendation(
                            client,
                            rec["id"],
                            entity_type="business",
                            entity_id=pub_result["id"],
                            dry_run=False,
                        )
                except Exception as exc:  # noqa: BLE001
                    entry["publish_error"] = str(exc)[:240]
                    print(f"  publish error: {exc}", flush=True)
            else:
                print("  skip publish (no street address)", flush=True)
            report.append(entry)
            time.sleep(0.2)
            continue

        svoi = enrich_source_page(rec, args.directory_source)
        if svoi.get("_svoi_error"):
            entry["svoi_error"] = svoi["_svoi_error"]
            print(f"  svoi detail: {svoi['_svoi_error']}")
        else:
            print(
                f"  svoi: webs={len(svoi.get('websites') or [])} "
                f"phones={len(svoi.get('phones') or [])} "
                f"addr={svoi.get('address_line') or '-'}",
                flush=True,
            )

        websites = list(rec.get("websites") or [])
        for w in svoi.get("websites") or []:
            if w not in websites:
                websites.append(w)
        phones = list(rec.get("phones") or [])
        for p in svoi.get("phones") or []:
            if p not in phones:
                phones.append(p)
        cover = svoi.get("cover_image_url") or rec.get("cover_image_url")
        emails = list(svoi.get("emails") or [])
        if svoi.get("description"):
            texts = list(rec.get("comment_texts") or [])
            if svoi["description"] not in texts:
                texts = [svoi["description"]] + texts
                rec["comment_texts"] = texts[:5]

        city_hint = svoi.get("city") or english_city(rec.get("city"))
        region = note_field(rec.get("notes"), "region") or ""
        if not city_hint and region in CA_REGIONS:
            city_hint = {
                "Los Angeles": "Los Angeles",
                "San Diego": "San Diego",
                "Sacramento": "Sacramento",
                "San Francisco Bay": "San Francisco",
            }.get(region)

        fill_patch: dict[str, Any] = {}
        if svoi.get("address_line") and streetish(svoi["address_line"]):
            fill_patch["address_line"] = normalize_street_line(svoi["address_line"])
        elif svoi.get("address_line"):
            # city-only maps pin — keep as city hint, not street
            if not city_hint:
                city_hint = svoi["address_line"]
            print(f"  weak address skipped: {svoi['address_line']}", flush=True)
        if svoi.get("city"):
            fill_patch["city"] = svoi["city"]
        if svoi.get("state_code"):
            fill_patch["state_code"] = svoi["state_code"]
        if svoi.get("postal_code"):
            fill_patch["postal_code"] = svoi["postal_code"]
        if svoi.get("google_maps_url"):
            fill_patch["google_maps_url"] = svoi["google_maps_url"]
        if plain_website(websites):
            fill_patch["website"] = plain_website(websites)
        if phones:
            fill_patch["phone"] = phones[0]

        # Deep scrape company website
        site = plain_website(websites)
        if site:
            web = scrape_website_details(site)
            if web.get("_error"):
                print(f"  website error: {web['_error']}", flush=True)
            else:
                print(f"  website keys: {sorted(k for k in web if not k.startswith('_'))}", flush=True)
            if web.get("opening_hours") and not fill_patch.get("opening_hours"):
                fill_patch["opening_hours"] = web["opening_hours"]
            if web.get("address_line") and not streetish(fill_patch.get("address_line")):
                if streetish(web["address_line"]):
                    fill_patch["address_line"] = normalize_street_line(web["address_line"])
            for k in ("city", "state_code", "postal_code", "instagram_url", "yelp_url"):
                if web.get(k) and not fill_patch.get(k):
                    fill_patch[k] = web[k]
            if web.get("emails"):
                for e in web["emails"]:
                    if e not in emails:
                        emails.append(e)
            if web.get("phones"):
                for p in web["phones"]:
                    if p not in phones:
                        phones.append(p)
                fill_patch["phone"] = phones[0]
            if web.get("description"):
                texts = list(rec.get("comment_texts") or [])
                if web["description"] not in texts:
                    texts = [web["description"]] + texts
                    rec["comment_texts"] = texts[:5]
            if web.get("facebook_url") and web["facebook_url"] not in websites:
                websites.append(web["facebook_url"])
        elif not site:
            print("  no company website", flush=True)

        if use_places and key:
            biz_stub = {
                "name": name,
                "phone": phones[0] if phones else None,
                "website": site,
                "city": city_hint or fill_patch.get("city"),
                "address_line": fill_patch.get("address_line"),
                "opening_hours": fill_patch.get("opening_hours"),
                "google_rating": None,
                "google_maps_url": fill_patch.get("google_maps_url"),
                "latitude": None,
            }
            try:
                places = lookup_business_places(biz_stub, key=key, sleep_s=max(args.sleep, 0.5))
            except Exception as exc:  # noqa: BLE001
                places = {"decision": "error", "error": str(exc)[:200]}
            entry["places_decision"] = places.get("decision")
            err = places.get("error") or ""
            print(f"  places: {places.get('decision')}", flush=True)
            if "429" in err or "RESOURCE_EXHAUSTED" in err:
                print("  places quota exhausted — continuing without Places", flush=True)
                use_places = False
                key = None
            elif places.get("decision") == "accept" and places.get("place"):
                filled = place_to_fill_empty_patch(biz_stub, places["place"])
                for k, v in (filled.get("patch") or {}).items():
                    if k not in fill_patch or fill_patch.get(k) in (None, "", []):
                        fill_patch[k] = v
                entry["places_patch"] = filled.get("patch")

        if emails and not fill_patch.get("email"):
            fill_patch["email"] = emails[0]
        if phones and not fill_patch.get("phone"):
            fill_patch["phone"] = phones[0]
        if plain_website(websites) and not fill_patch.get("website"):
            fill_patch["website"] = plain_website(websites)

        entry["fill"] = {k: fill_patch[k] for k in fill_patch if k != "opening_hours"}
        if fill_patch.get("opening_hours"):
            entry["fill"]["opening_hours"] = True
        print(f"  fill keys: {sorted(fill_patch.keys())}", flush=True)

        notes = rec.get("notes") or ""
        entity = (note_field(notes, "entity") or "business").lower()
        if fill_patch.get("address_line"):
            notes = set_note(notes, "address", fill_patch["address_line"])
        elif is_bad_city(note_field(notes, "address")) and city_hint:
            notes = set_note(notes, "address", city_hint)
        if emails:
            notes = set_note(notes, "emails", ", ".join(emails[:4]))
        hours = fill_patch.get("opening_hours")
        if isinstance(hours, dict) and hours.get("weekday_text"):
            notes = set_note(notes, "hours", " | ".join(hours["weekday_text"])[:500])
        notes = set_note(notes, "svoi_enriched", "1")
        if fill_patch.get("postal_code"):
            notes = set_note(notes, "zip", str(fill_patch["postal_code"]))
        if fill_patch.get("instagram_url"):
            notes = set_note(notes, "instagram", fill_patch["instagram_url"])
        if fill_patch.get("yelp_url"):
            notes = set_note(notes, "yelp", fill_patch["yelp_url"])

        new_city = fill_patch.get("city") or city_hint
        rec_patch: dict[str, Any] = {
            "notes": notes,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if websites != (rec.get("websites") or []):
            rec_patch["websites"] = websites[:8]
        if phones != (rec.get("phones") or []):
            rec_patch["phones"] = phones[:6]
        ig_list = list(rec.get("instagram") or [])
        if fill_patch.get("instagram_url"):
            handle = fill_patch["instagram_url"].rstrip("/").split("/")[-1]
            if handle and handle not in ig_list:
                ig_list.append(handle)
                rec_patch["instagram"] = ig_list[:6]
        if cover and cover != rec.get("cover_image_url"):
            rec_patch["cover_image_url"] = cover
        if new_city and new_city != rec.get("city"):
            rec_patch["city"] = str(new_city)[:80]
        if rec.get("comment_texts"):
            rec_patch["comment_texts"] = rec["comment_texts"][:5]

        entry["rec_patch_keys"] = sorted(rec_patch.keys())
        if not dry_run:
            client._request(
                "PATCH",
                "/import_comment_recommendations",
                params={"id": f"eq.{rec['id']}"},
                body=rec_patch,
                prefer="return=minimal",
            )
            print("  recommendation updated", flush=True)
        else:
            print(f"  dry-run rec keys={entry['rec_patch_keys']}", flush=True)

        can_publish_biz = entity == "business" and (
            streetish(fill_patch.get("address_line"))
            or (
                args.directory_source == "orange_pages"
                and bool(fill_patch.get("phone") or fill_patch.get("website"))
            )
        )
        can_publish_pro = entity == "professional" and bool(
            fill_patch.get("phone") or fill_patch.get("website")
        )
        if args.publish and (can_publish_biz or can_publish_pro):
            cat_slug = guess_category_slug(rec)
            try:
                if can_publish_biz:
                    cat = biz_cat.get(cat_slug) or biz_cat.get("services")
                    pub_result = publish_business(
                        client,
                        rec,
                        fill_patch,
                        category_id=cat["id"] if cat else None,
                        dry_run=dry_run,
                    )
                    etype = "business"
                else:
                    # map business slugs loosely onto professional taxonomy
                    pro_slug = {
                        "beauty": "beauty",
                        "medical": "health",
                        "legal": "legal",
                        "finance": "finance",
                        "real_estate": "real_estate",
                        "fitness": "fitness",
                        "education": "education",
                        "auto": "auto",
                    }.get(cat_slug, "pro_other")
                    cat = pro_cat.get(pro_slug) or pro_cat.get("pro_other")
                    pub_result = publish_professional(
                        client,
                        rec,
                        fill_patch,
                        category_id=cat["id"] if cat else None,
                        dry_run=dry_run,
                    )
                    etype = "professional"
                entry["publish"] = {
                    "entity": etype,
                    **{
                        k: pub_result.get(k)
                        for k in ("action", "id", "slug")
                        if k in pub_result
                    },
                }
                print(f"  publish: {entry['publish']}", flush=True)
                if not dry_run and pub_result.get("id"):
                    mark_recommendation(
                        client,
                        rec["id"],
                        entity_type=etype,
                        entity_id=pub_result["id"],
                        dry_run=False,
                    )
            except Exception as exc:  # noqa: BLE001
                entry["publish_error"] = str(exc)[:240]
                print(f"  publish error: {exc}", flush=True)
        elif args.publish:
            print(
                f"  skip publish (entity={entity}, street={streetish(fill_patch.get('address_line'))})",
                flush=True,
            )

        report.append(entry)
        time.sleep(args.sleep)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = OUT / f"batch_{stamp}.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    with_addr = sum(1 for r in report if (r.get("fill") or {}).get("address_line"))
    published = sum(1 for r in report if r.get("publish"))
    print(
        f"\nDone. enriched={len(report)} with_address={with_addr} "
        f"published={published} report={out_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
