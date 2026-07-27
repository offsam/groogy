#!/usr/bin/env python3
"""Scrape Our Texas (ourtx.com) Yellow Pages into cards.

WordPress newspaper directory for Houston / Dallas / Austin / San Antonio.

Usage:
  python3 scripts/business-enrich/scrape_our_texas.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

OUT = Path(__file__).resolve().parent / "data" / "yellow_pages"
OUT.mkdir(parents=True, exist_ok=True)

BASE = "https://ourtx.com"
INDEX = f"{BASE}/yellow-pages"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
}

PHONE_RE = re.compile(
    r"(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-]\d{3}[\s\-]\d{4}|\(\d{3}\)\s*\d{3}[\-\s]?\d{4}|\d{3}[\-\s]\d{3}[\-\s]\d{4})"
)
EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.I)
DETAIL_RE = re.compile(r"https?://ourtx\.com/archives/yellow-pages/[^\"'#?\s]+", re.I)
PERSON_HINTS = re.compile(
    r"\b(md|dmd|dds|attorney|lawyer|realtor|notary|"
    r"доктор|д-р|юрист|адвокат|нотариус|риэлтор|риелтор|бухгалтер)\b",
    re.I,
)

# Site footer phones — ignore
IGNORE_PHONES = {"+17133953301", "+17133953306"}

CATEGORY_MAP = [
    (r"юриспруден|адвокат|право|lawyer|attorney", ("legal", "юристы")),
    (r"медицин|стомат|health|dental|clinic", ("health", "медицина")),
    (r"недвижим|realtor|риэлтор", ("real_estate", "недвижимость")),
    (r"финанс|бухгалтер|налог|insurance|страхов", ("finance", "финансы")),
    (r"красот|салон|beauty|маникюр", ("beauty", "красота")),
    (r"ресторан|кафе|еда|food|deli", ("food", "еда")),
    (r"ремонт|строител|home|электр", ("home_services", "дом / ремонт")),
    (r"школ|образован|детск|dance|танц|fencing", ("education", "обучение")),
    (r"авто|автосервис|auto", ("auto", "авто")),
    (r"доставк|переезд|moving|ship", ("travel", "доставка")),
]


def clean(s: str | None) -> str:
    t = unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", t).strip()


def encode_url(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(parts.path, safe="/%")
    query = urllib.parse.quote(parts.query, safe="=&%")
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, path, query, parts.fragment)
    )


def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def get_text(url: str) -> str:
    last: Exception | None = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(encode_url(url), headers=UA)
            with urllib.request.urlopen(req, timeout=25) as resp:
                return resp.read().decode("utf-8", "ignore")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"GET {url}: {last}")


def map_category(blob: str) -> tuple[str, str]:
    low = blob.lower()
    for pat, mapped in CATEGORY_MAP:
        if re.search(pat, low, re.I):
            return mapped
    return ("other", "бизнес")


def collect_detail_urls(max_pages: int) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for page in range(1, max_pages + 1):
        url = INDEX if page == 1 else f"{INDEX}/page/{page}"
        try:
            html = get_text(url)
        except Exception as exc:  # noqa: BLE001
            print(f"index err {url}: {exc}", flush=True)
            break
        found = 0
        for m in DETAIL_RE.findall(html):
            u = m.rstrip("/")
            if u not in seen:
                seen.add(u)
                out.append(u)
                found += 1
        print(f"index page={page} +{found} total={len(out)}", flush=True)
        if found == 0 and page > 1:
            break
        # also relative links
        for rel in re.findall(r'href=["\'](/archives/yellow-pages/[^"\'#?]+)["\']', html):
            u = urljoin(BASE, rel).rstrip("/")
            if u not in seen:
                seen.add(u)
                out.append(u)
        time.sleep(0.15)
    return out


def parse_detail(url: str) -> dict[str, Any] | None:
    html = get_text(url)
    title_m = (
        re.search(
            r'<h1[^>]*class=["\'][^"\']*entry-title[^"\']*["\'][^>]*>([\s\S]*?)</h1>',
            html,
            re.I,
        )
        or re.search(r"<h1[^>]*>([\s\S]*?)</h1>", html, re.I)
        or re.search(r"<title[^>]*>([^<]+)", html, re.I)
    )
    title = clean(title_m.group(1) if title_m else "")
    title = re.sub(r"\s*[–—\-]\s*Our Texas.*$", "", title, flags=re.I).strip()
    if len(title) < 2:
        return None

    article = re.search(
        r'<div[^>]+class=["\'][^"\']*entry-content[^"\']*["\'][^>]*>([\s\S]*?)</div>',
        html,
        re.I,
    )
    body_html = article.group(1) if article else ""
    # Contact widgets / captions often sit outside entry-content
    search_html = html
    # Drop footer / newsletter / shared chrome phones
    search_html = re.sub(
        r"<footer[\s\S]*?</footer>",
        " ",
        search_html,
        flags=re.I,
    )
    body = clean(body_html) or clean(
        re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", html, flags=re.I)
    )
    if not body:
        return None

    phones: list[str] = []
    for raw in PHONE_RE.findall(search_html):
        p = normalize_phone(raw)
        if p and p not in IGNORE_PHONES and p not in phones:
            phones.append(p)
    phones = phones[:4]

    emails: list[str] = []
    for m in EMAIL_RE.findall(search_html):
        e = m.lower()
        if "ourtexas" in e or "ourtx" in e:
            continue
        if e not in emails:
            emails.append(e)

    websites: list[str] = []
    for href in re.findall(r'href=["\'](https?://[^"\']+)["\']', body_html or search_html):
        host = (urlparse(href).hostname or "").lower()
        if any(
            x in host
            for x in (
                "ourtx.com",
                "facebook.com",
                "instagram.com",
                "twitter.com",
                "x.com",
                "youtube.com",
                "googleapis",
                "w.org",
                "wordpress",
                "linkedin.com",
                "ok.ru",
            )
        ):
            continue
        u = href.rstrip("/")
        if u not in websites:
            websites.append(u)
    websites = websites[:3]

    if not phones and not websites and not emails:
        return None

    cat_m = re.search(
        r'rel=["\']category tag["\'][^>]*>([^<]+)',
        html,
        re.I,
    )
    cat_blob = clean(cat_m.group(1) if cat_m else "") + " " + title + " " + body[:200]
    cat_slug, cat_guess = map_category(cat_blob)

    city = None
    for c in ("Houston", "Dallas", "Austin", "San Antonio", "Katy", "Spring", "Plano", "Sugar Land"):
        if re.search(rf"\b{re.escape(c)}\b", body, re.I):
            city = c
            break

    entity = "professional" if PERSON_HINTS.search(f"{title} {body}") else "business"
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    cluster = "otx-" + hashlib.sha1(urllib.parse.unquote(slug).encode("utf-8")).hexdigest()[:16]

    return {
        "cluster_key": cluster,
        "display_name": title[:160],
        "entity_type_guess": entity,
        "target_bucket": "yellow_pages",
        "directory_source": "our_texas",
        "category_slug": cat_slug,
        "category_guess": cat_guess,
        "city": city,
        "address": None,
        "phones": phones,
        "emails": emails[:3],
        "instagram": [],
        "websites": websites,
        "cover_image_url": None,
        "images": [],
        "short_description": body[:280],
        "description": body[:4000],
        "source_url": url,
        "source_channel": "other",
        "source_groups": ["Our Texas"],
        "region": "Texas",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-pages", type=int, default=8)
    args = parser.parse_args()

    urls = collect_detail_urls(args.max_pages)
    print(f"details={len(urls)}", flush=True)
    cards: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for i, url in enumerate(urls, 1):
        try:
            card = parse_detail(url)
        except Exception as exc:  # noqa: BLE001
            errors.append({"url": url, "error": str(exc)})
            continue
        if card:
            cards.append(card)
        if i % 10 == 0 or i == len(urls):
            print(f"progress {i}/{len(urls)} cards={len(cards)} errs={len(errors)}", flush=True)
        time.sleep(0.12)

    by_key = {c["cluster_key"]: c for c in cards}
    cards = list(by_key.values())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "source": INDEX,
        "directory_source": "our_texas",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "errors": errors[:30],
        "cards": cards,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    (OUT / f"our_texas_{stamp}.json").write_text(text, encoding="utf-8")
    (OUT / "our_texas_latest.json").write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(OUT / "our_texas_latest.json"),
                "count": len(cards),
                "errors": len(errors),
                "with_phone": sum(1 for c in cards if c.get("phones")),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if cards else 1


if __name__ == "__main__":
    raise SystemExit(main())
