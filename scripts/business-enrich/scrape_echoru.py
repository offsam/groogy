#!/usr/bin/env python3
"""Scrape EchoRU Russian business directory (LA / San Diego / Phoenix).

Listings live under /russian-business-directory/{category}/ with phone+address
in card HTML. Detail .html pages are often ad articles — we use card data.

Usage:
  python3 scripts/business-enrich/scrape_echoru.py
  python3 scripts/business-enrich/scrape_echoru.py --max-cat-pages 3 --limit 400
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

OUT = Path(__file__).resolve().parent / "data" / "yellow_pages"
OUT.mkdir(parents=True, exist_ok=True)

BASE = "https://www.echoru.com"
INDEX = f"{BASE}/russian-business-directory/"
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
PERSON_HINTS = re.compile(
    r"\b(md|dmd|dds|attorney|lawyer|realtor|notary|"
    r"доктор|д-р|юрист|адвокат|нотариус|риэлтор|риелтор|бухгалтер)\b",
    re.I,
)
JUNK_NAME = re.compile(
    r"(уникальн|если вы|что делать|как |аварии|иммиграционн|"
    r"защита от|looking for|call now|best deal|ясновид|гадалка|"
    r"цыганк|cyganka|yasnovidyashchaya|экстрасенс|opportunity|"
    r"premier appliance provides|samsung, lg)",
    re.I,
)
FIRM_HINTS = re.compile(
    r"\b(llp|llc|inc|apc|pc|law office|offices|clinic|center|centre|"
    r"studio|salon|agency|firm|school|магазин|клиника|центр|школа|салон)\b",
    re.I,
)

CATEGORY_MAP = [
    (r"attorney|advokat|юрист|lawyer", ("legal", "юристы")),
    (r"dental|stomatolog|стомат", ("health", "стоматология")),
    (r"medical|health|медицин|doctor", ("health", "медицина")),
    (r"real.?estate|недвижим|rieltor|realtor", ("real_estate", "недвижимость")),
    (r"insurance|страхов|financ|бухгалтер|налог", ("finance", "финансы")),
    (r"beauty|kosmetolog|salon|маникюр|красот", ("beauty", "красота")),
    (r"restaurant|cafe|bakery|food|ресторан|кафе|пекар", ("food", "еда")),
    (r"auto|avto|авто", ("auto", "авто")),
    (r"construction|repair|remont|строител|ремонт|electric|plumbing", ("home_services", "дом / ремонт")),
    (r"education|school|детсад|obrazovan", ("education", "обучение")),
    (r"travel|туризм|tour", ("travel", "туризм")),
    (r"child|nyani|detsad", ("childcare", "дети")),
]


def clean(s: str | None) -> str:
    t = unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", t).strip()


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
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", "ignore")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"GET {url}: {last}")


def map_category(cat_slug: str, blob: str) -> tuple[str, str]:
    low = f"{cat_slug} {blob}".lower()
    for pat, mapped in CATEGORY_MAP:
        if re.search(pat, low, re.I):
            return mapped
    label = cat_slug.replace("-", " ")
    return ("other", label[:60] or "бизнес")


def guess_name(title: str, body: str, href: str) -> str | None:
    title = clean(title)
    body = clean(body)
    slug = href.rstrip("/").rsplit("/", 1)[-1].replace(".html", "")
    slug_name = slug.replace("-", " ").strip().title()

    candidates: list[str] = []
    # Prefer URL slug when it looks like a business name
    if slug_name and len(slug_name) >= 4 and not slug_name.lower().startswith("index"):
        candidates.append(slug_name)
    if title and FIRM_HINTS.search(title) and len(title) <= 100:
        candidates.append(title)
    if body:
        chunk = re.split(r"[.!?\|]", body, maxsplit=1)[0].strip()
        if 3 <= len(chunk) <= 70 and not chunk.lower().startswith(("we ", "если ", "looking ")):
            candidates.append(chunk)
        m = re.match(r"^([A-ZА-ЯЁ][\wА-Яа-яЁё&.'\- ]{2,55})", body)
        if m:
            candidates.append(m.group(1).strip(" -"))
    if title and len(title) <= 70 and not JUNK_NAME.search(title):
        candidates.append(title)

    for name in candidates:
        name = clean(name)
        if len(name) < 3 or len(name) > 100:
            continue
        if JUNK_NAME.search(name):
            continue
        if name.lower().startswith(("http", "www.")):
            continue
        return name[:160]
    return None


def parse_cards(html: str, cat_slug: str) -> list[dict[str, Any]]:
    parts = re.split(r'<div class="business" id="mapi\d+">', html)
    out: list[dict[str, Any]] = []
    for part in parts[1:]:
        title_a = re.search(
            r'<div class="title">\s*<a href="([^"]+)">([\s\S]*?)</a>',
            part,
        )
        if not title_a:
            continue
        href = title_a.group(1).strip()
        title = clean(title_a.group(2))
        addr_m = re.search(r'<div class="address"><span></span>([^<]*)</div>', part)
        phone_m = re.search(r'<div class="phone"><span></span>([^<]*)</div>', part)
        body_m = re.search(r'<div class="body">([\s\S]*?)</div>', part)
        body = clean(body_m.group(1) if body_m else "")
        address = clean(addr_m.group(1) if addr_m else "") or None
        phones: list[str] = []
        if phone_m:
            p = normalize_phone(phone_m.group(1))
            if p:
                phones.append(p)
        for raw in PHONE_RE.findall(body):
            p = normalize_phone(raw)
            if p and p not in phones:
                phones.append(p)
        if not phones:
            continue
        name = guess_name(title, body, href)
        if not name:
            continue
        city = None
        if address:
            m = re.search(
                r"\b(Los Angeles|San Diego|Phoenix|Glendale|Hollywood|Irvine|"
                r"Beverly Hills|Santa Monica|Long Beach|Pasadena|Encino|"
                r"West Hollywood|Burbank|La Jolla|Chula Vista|Scottsdale|"
                r"Tempe|Mesa|Tucson)\b",
                address,
                re.I,
            )
            if m:
                city = m.group(1)
        cat_slug_map, cat_guess = map_category(cat_slug, f"{name} {title} {body}")
        entity = (
            "professional"
            if PERSON_HINTS.search(f"{name} {title} {body} {cat_slug}")
            else "business"
        )
        slug = href.rstrip("/").rsplit("/", 1)[-1]
        cluster = "ech-" + hashlib.sha1(slug.encode("utf-8")).hexdigest()[:16]
        out.append(
            {
                "cluster_key": cluster,
                "display_name": name[:160],
                "entity_type_guess": entity,
                "target_bucket": "yellow_pages",
                "directory_source": "echoru",
                "category_slug": cat_slug_map,
                "category_guess": cat_guess,
                "city": city,
                "address": address,
                "phones": phones[:4],
                "emails": [],
                "instagram": [],
                "websites": [],
                "cover_image_url": None,
                "images": [],
                "short_description": (body or title or name)[:280],
                "description": (body or title or name)[:4000],
                "source_url": href,
                "source_channel": "other",
                "source_groups": ["EchoRU"],
                "region": "California / Arizona",
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    return out


def list_categories() -> list[str]:
    html = get_text(INDEX)
    cats = sorted(
        set(
            re.findall(
                r"https://www\.echoru\.com/russian-business-directory/([a-z0-9\-]+)/",
                html,
            )
        )
    )
    return [c for c in cats if c and not c.startswith("page")]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-cat-pages", type=int, default=12)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=0.12)
    args = parser.parse_args()

    cats = list_categories()
    print(f"categories={len(cats)}", flush=True)
    by_key: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, str]] = []

    for ci, cat in enumerate(cats, 1):
        if args.limit and len(by_key) >= args.limit:
            break
        for page in range(1, args.max_cat_pages + 1):
            if args.limit and len(by_key) >= args.limit:
                break
            url = f"{INDEX}{cat}/" if page == 1 else f"{INDEX}{cat}/?page={page}"
            try:
                html = get_text(url)
            except Exception as exc:  # noqa: BLE001
                errors.append({"url": url, "error": str(exc)})
                break
            cards = parse_cards(html, cat)
            if not cards:
                if page == 1:
                    print(f"  {cat}: empty", flush=True)
                break
            new = 0
            for card in cards:
                if args.limit and len(by_key) >= args.limit:
                    break
                if card["cluster_key"] not in by_key:
                    by_key[card["cluster_key"]] = card
                    new += 1
            print(
                f"[{ci}/{len(cats)}] {cat} p{page} +{new} total={len(by_key)}",
                flush=True,
            )
            if new == 0 and page > 1:
                break
            time.sleep(args.sleep)

    cards = list(by_key.values())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "source": INDEX,
        "directory_source": "echoru",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "errors": errors[:40],
        "cards": cards,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    (OUT / f"echoru_{stamp}.json").write_text(text, encoding="utf-8")
    (OUT / "echoru_latest.json").write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(OUT / "echoru_latest.json"),
                "count": len(cards),
                "errors": len(errors),
                "with_phone": sum(1 for c in cards if c.get("phones")),
                "with_address": sum(1 for c in cards if c.get("address")),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if cards else 1


if __name__ == "__main__":
    raise SystemExit(main())
