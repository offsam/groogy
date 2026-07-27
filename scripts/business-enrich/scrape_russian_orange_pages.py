#!/usr/bin/env python3
"""Scrape Russian Orange Pages Services into structured Yellow Pages cards.

Uses Playwright (Chromium) because plain HTTP gets 403 from the site WAF.

Usage:
  scripts/telegram-collector/.venv/bin/pip install playwright
  scripts/telegram-collector/.venv/bin/playwright install chromium
  scripts/telegram-collector/.venv/bin/python scripts/business-enrich/scrape_russian_orange_pages.py
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

OUT = Path(__file__).resolve().parent / "data" / "yellow_pages"
OUT.mkdir(parents=True, exist_ok=True)

BASE = "https://www.russianorangepages.com/community"
ARCHIVE_PAGES = [
    f"{BASE}/category/russian-services/",
    f"{BASE}/category/russian-services/page/2/",
    f"{BASE}/category/photographers/",
    f"{BASE}/category/russian-services/accounting-and-tax-services/",
    f"{BASE}/category/russian-services/churches/",
    f"{BASE}/category/russian-services/education-activities/",
    f"{BASE}/category/russian-services/home-services/",
    f"{BASE}/category/russian-services/lawyers/",
    f"{BASE}/category/russian-services/medical-doctors/",
    f"{BASE}/category/russian-services/notary-translation/",
    f"{BASE}/category/russian-services/real-estate-mortgage/",
    f"{BASE}/category/russian-services/restaurants-deli-catering/",
]

CATEGORY_MAP = {
    "accounting-and-tax-services": ("finance", "бухгалтерия / налоги"),
    "churches": ("other", "церкви"),
    "education-activities": ("education", "обучение"),
    "home-services": ("home_services", "дом / ремонт"),
    "lawyers": ("legal", "юристы"),
    "medical-doctors": ("health", "медицина / здоровье"),
    "notary-translation": ("legal", "нотариус / переводы"),
    "photographers": ("photo_video", "фотографы"),
    "real-estate-mortgage": ("real_estate", "недвижимость"),
    "restaurants-deli-catering": ("food", "рестораны / продукты"),
}

BUSINESS_HINTS = re.compile(
    r"\b(llc|inc|corp|company|deli|market|store|church|school|studio|office|"
    r"clinic|restaurant|gourmet|construction|daycare|center|centre|firm)\b",
    re.I,
)
PERSON_HINTS = re.compile(
    r"\b(realtor|lawyer|notary|teacher|tutor|massage|therapist|loan officer|"
    r"доктор|д-р|dr\.|риэлтор|нотариус|юрист|массаж)\b",
    re.I,
)

PHONE_RE = re.compile(r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}")
EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.I)
CITY_RE = re.compile(
    r"\b(Costa Mesa|Newport Beach|Fullerton|Irvine|Anaheim|Tustin|"
    r"Fountain Valley|Mission Viejo|Laguna Woods|Laguna Niguel|Lake Forest|"
    r"Long Beach|Santa Ana|Huntington Beach|Garden Grove|Yorba Linda|"
    r"San Clemente|Brea|Placentia|Westminster|Buena Park|"
    r"Orange County|Orange(?!\s+County)|OC)\b",
    re.I,
)


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def normalize_website(raw: str) -> str | None:
    u = clean(raw)
    if not u:
        return None
    if u.startswith("www."):
        u = "https://" + u
    if not re.match(r"^https?://", u, re.I):
        if "." in u and " " not in u:
            u = "https://" + u
        else:
            return None
    host = (urlparse(u).hostname or "").lower()
    if "russianorangepages" in host:
        return None
    return u.rstrip("/")


def guess_entity_type(name: str, category_slug: str, text: str) -> str:
    blob = f"{name} {text}"
    if category_slug in {"restaurants-deli-catering", "churches"}:
        return "business"
    if PERSON_HINTS.search(blob) and not BUSINESS_HINTS.search(name):
        return "professional"
    if BUSINESS_HINTS.search(blob):
        return "business"
    # Name looks like a person (First Last)
    if re.match(r"^[A-ZА-ЯЁ][a-zа-яё]+\s+[A-ZА-ЯЁ][a-zа-яё'\-]+", name):
        return "professional"
    return "business"


def extract_labeled(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    patterns = {
        "website": r"(?:Website|Сайт)\s*[:：]\s*([^\n]+)",
        "facebook": r"Facebook\s*[:：]\s*([^\n]+)",
        "instagram": r"Instagram\s*[:：]\s*([^\n]+)",
        "yelp": r"Yelp\s*[:：]\s*([^\n]+)",
        "email": r"(?:Email|E-mail|Почта)\s*[:：]\s*([^\n]+)",
        "phone": r"(?:Cell|Phone|Tel\.?|Тел\.?)\s*[:：]\s*([^\n]+)",
        "address": r"(?:Address|Адрес(?:\s+и\s+телефон)?)\s*[:：]\s*([^\n]+)",
    }
    for key, pat in patterns.items():
        m = re.search(pat, text, re.I)
        if m:
            out[key] = clean(m.group(1))
    return out


def parse_listing(html: str, url: str) -> dict[str, Any] | None:
    # Lightweight HTML scrape without BeautifulSoup dependency
    title_m = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S)
    title = clean(re.sub(r"<[^>]+>", "", title_m.group(1) if title_m else ""))
    if not title or title.lower() in {"russian orange pages", "russian services"}:
        return None

    # Prefer article body
    art_m = re.search(
        r"<article\b[^>]*>(.*?)</article>", html, re.I | re.S
    ) or re.search(
        r'class="[^"]*entry-content[^"]*"[^>]*>(.*?)</div>\s*<footer',
        html,
        re.I | re.S,
    )
    body_html = art_m.group(1) if art_m else html
    # Drop scripts/styles
    body_html = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", "", body_html, flags=re.I | re.S)
    text = clean(re.sub(r"<br\s*/?>", "\n", body_html, flags=re.I))
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    # Trim sidebar noise if present
    for cut in ("You may also like", "Sign Up for our Newsletter", "Poll / Наш Опрос"):
        if cut in text:
            text = text.split(cut, 1)[0].strip()

    path = urlparse(url).path.strip("/")
    parts = path.split("/")
    cat_slug = ""
    if "russian-services" in parts:
        i = parts.index("russian-services")
        if i + 1 < len(parts) - 1:
            cat_slug = parts[i + 1]

    cat_key, cat_label = CATEGORY_MAP.get(cat_slug, ("other", cat_slug or "услуги"))
    labeled = extract_labeled(text)

    phones: list[str] = []
    for raw in [labeled.get("phone", "")] + PHONE_RE.findall(text):
        p = normalize_phone(raw)
        if p and p not in phones:
            phones.append(p)

    emails = []
    for raw in [labeled.get("email", "")] + EMAIL_RE.findall(text):
        e = clean(raw).lower()
        if e and "russianorangepages" not in e and e not in emails:
            emails.append(e)

    websites: list[str] = []

    def add_website(raw: str | None) -> None:
        if not raw:
            return
        raw = clean(raw)
        low = raw.lower()
        w: str | None = None
        if "facebook.com" in low or low.startswith("facebook.com"):
            w = normalize_website(raw if raw.startswith("http") else "https://" + raw)
        elif labeled.get("facebook") == raw and " " not in raw and "." not in raw:
            w = f"https://www.facebook.com/{raw.strip('/')}"
        elif "yelp.com" in low:
            w = normalize_website(raw if raw.startswith("http") else "https://" + raw)
        elif labeled.get("yelp") == raw and "yelp.com" not in low:
            # Name-only Yelp label — skip inventing URL
            w = None
        else:
            w = normalize_website(raw)
        if w and w not in websites:
            websites.append(w)

    add_website(labeled.get("website"))
    add_website(labeled.get("facebook"))
    add_website(labeled.get("yelp"))

    skip_hosts = (
        "russianorangepages",
        "facebook.com/sharer",
        "twitter.com",
        "pinterest",
        "google.com",
        "maps.apple.com",
    )
    for href in re.findall(r'href="(https?://[^"]+)"', body_html):
        host = (urlparse(href).hostname or "").lower()
        if any(x in host for x in skip_hosts):
            continue
        w = normalize_website(href)
        if w and w not in websites:
            websites.append(w)

    instagram: list[str] = []
    for w in list(websites):
        m = re.search(r"instagram\.com/([A-Za-z0-9._]+)", w, re.I)
        if m:
            handle = m.group(1).rstrip("/")
            if handle.lower() not in {"p", "reel", "stories"} and handle not in instagram:
                instagram.append(handle)

    if labeled.get("instagram"):
        h = labeled["instagram"].lstrip("@").split("/")[-1]
        if h and h not in instagram:
            instagram.append(h)

    imgs = []
    for src in re.findall(r'<img[^>]+src="([^"]+)"', body_html, re.I):
        if "wp-content/uploads" in src and not any(
            bad in src.lower() for bad in ("avatar", "emoji", "icon", "logo", "gravatar")
        ):
            full = urljoin(url, src)
            if full not in imgs:
                imgs.append(full)

    city = None
    city_m = CITY_RE.search(f"{title} {labeled.get('address', '')} {text[:500]}")
    if city_m:
        city = city_m.group(1)
        if city.upper() == "OC":
            city = "Orange County"

    address = labeled.get("address")
    if not address:
        # Street-like line near Адрес
        m = re.search(
            r"(\d{1,5}\s+[A-Za-z0-9 .#'\-]+(?:,\s*)?(?:CA|California|СА)[^\n]{0,40})",
            text,
        )
        if m:
            address = clean(m.group(1))

    # Short description: first meaningful paragraph
    paragraphs = [p.strip() for p in re.split(r"\n+", text) if len(p.strip()) > 40]
    # Skip title-echo / hours-only first lines when possible
    short = ""
    for p in paragraphs:
        if re.match(r"^(расписание|понедельник|monday)", p, re.I):
            continue
        if title.lower()[:20] in p.lower()[:40] and len(p) < 80:
            continue
        short = p[:280]
        break
    if not short and paragraphs:
        short = paragraphs[0][:280]

    entity_type = guess_entity_type(title, cat_slug, text)
    cluster_key = "rop-" + hashlib.sha1(urlencode_safe(url)).hexdigest()[:16]

    return {
        "cluster_key": cluster_key,
        "display_name": title,
        "entity_type_guess": entity_type,
        "target_bucket": "yellow_pages",
        "directory_source": "orange_pages",
        "category_slug": cat_key,
        "category_guess": cat_label,
        "city": city,
        "address": address,
        "phones": phones,
        "emails": emails,
        "instagram": instagram,
        "websites": websites[:8],
        "cover_image_url": imgs[0] if imgs else None,
        "images": imgs[:5],
        "short_description": short,
        "description": text[:4000],
        "source_url": url,
        "source_channel": "other",
        "source_groups": ["Russian Orange Pages"],
        "region": "Orange County",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


def urlencode_safe(url: str) -> bytes:
    return url.strip().encode("utf-8")


def collect_listing_urls(page_html: str) -> list[str]:
    urls = []
    for href in re.findall(r'href="([^"]+)"', page_html):
        full = urljoin(BASE + "/", href).split("#")[0]
        if "/category/" in full:
            continue
        if "/russian-services/" not in full and "/photographers/" not in full:
            continue
        path = urlparse(full).path.strip("/")
        parts = [p for p in path.split("/") if p]
        # community / russian-services / [subcat]/ slug  OR community / photographers / slug
        if len(parts) < 3 or parts[0] != "community":
            continue
        if parts[1] not in {"russian-services", "photographers"}:
            continue
        # skip bare section roots
        if len(parts) == 2:
            continue
        if full.rstrip("/") not in [u.rstrip("/") for u in urls]:
            urls.append(full.rstrip("/") + "/")
    return urls


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Install playwright in telegram-collector venv first", flush=True)
        return 1

    cards: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="en-US",
        )
        page = context.new_page()

        listing_urls: list[str] = []
        for archive in ARCHIVE_PAGES:
            print(f"archive {archive}", flush=True)
            page.goto(archive, wait_until="domcontentloaded", timeout=90000)
            time.sleep(3.5)
            html = page.content()
            found = collect_listing_urls(html)
            print(f"  found {len(found)} links html={len(html)}", flush=True)
            for u in found:
                if u not in listing_urls:
                    listing_urls.append(u)

        print(f"total unique listings: {len(listing_urls)}", flush=True)
        for i, url in enumerate(listing_urls, 1):
            print(f"[{i}/{len(listing_urls)}] {url}", flush=True)
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                time.sleep(0.6)
                card = parse_listing(page.content(), page.url)
                if not card:
                    errors.append({"url": url, "error": "parse_failed"})
                    continue
                cards.append(card)
                print(
                    f"  → {card['display_name']!r} [{card['entity_type_guess']}] "
                    f"phones={len(card['phones'])} city={card['city']}",
                    flush=True,
                )
            except Exception as exc:  # noqa: BLE001
                errors.append({"url": url, "error": str(exc)})

        browser.close()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = OUT / f"rop_cards_{stamp}.json"
    latest = OUT / "rop_cards_latest.json"
    payload = {
        "source": "https://www.russianorangepages.com/community/",
        "directory_source": "orange_pages",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "errors": errors,
        "cards": cards,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if cards:
        latest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        print("skip updating latest — zero cards", flush=True)
    print(json.dumps({"wrote": str(out_path), "count": len(cards), "errors": len(errors)}, ensure_ascii=False))
    return 0 if cards else 1


if __name__ == "__main__":
    raise SystemExit(main())
