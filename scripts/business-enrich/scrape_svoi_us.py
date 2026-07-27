#!/usr/bin/env python3
"""Scrape svoi.us company listings into Yellow Pages cards (gradual batches).

Uses plain HTTP (no Playwright). Parses category listing pages for NYC / Chicago
hubs first; optional detail enrichment for website + cover image.

Usage:
  python3 scripts/business-enrich/scrape_svoi_us.py
  python3 scripts/business-enrich/scrape_svoi_us.py --hubs nyc,cho --max-pages 1 --limit 250
  python3 scripts/business-enrich/scrape_svoi_us.py --enrich-details --limit 80
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

OUT = Path(__file__).resolve().parent / "data" / "yellow_pages"
OUT.mkdir(parents=True, exist_ok=True)

BASE = "https://svoi.us"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
}

# Hub slug on svoi → display region / default city
HUBS: dict[str, dict[str, str]] = {
    "nyc": {"region": "New York metro", "city": "New York", "label": "NYC"},
    "cho": {"region": "Chicago metro", "city": "Chicago", "label": "Chicago"},
}

# Tag-cloud city ids from svoi.us homepage
CITY_IDS: dict[str, dict[str, str]] = {
    "1": {"region": "Los Angeles", "city": "Los Angeles", "label": "LA"},
    "5": {"region": "New York metro", "city": "New York", "label": "NYC"},
    "29": {"region": "Miami / Florida", "city": "Miami", "label": "Miami"},
    "45": {"region": "Boston metro", "city": "Boston", "label": "Boston"},
    "78": {"region": "Chicago metro", "city": "Chicago", "label": "Chicago"},
    "87": {"region": "Philadelphia", "city": "Philadelphia", "label": "Philly"},
    "7": {"region": "San Diego", "city": "San Diego", "label": "San Diego"},
    "21": {"region": "San Francisco Bay", "city": "San Francisco", "label": "SF"},
    "348": {"region": "Seattle", "city": "Seattle", "label": "Seattle"},
    "104": {"region": "Denver", "city": "Denver", "label": "Denver"},
    "12": {"region": "Washington DC", "city": "Washington", "label": "DC"},
    "24": {"region": "Los Angeles", "city": "Glendale", "label": "Glendale"},
    "11": {"region": "Los Angeles", "city": "West Hollywood", "label": "West Hollywood"},
    "55": {"region": "Los Angeles", "city": "Hollywood", "label": "Hollywood"},
    "134": {"region": "Los Angeles", "city": "Burbank", "label": "Burbank"},
    "60": {"region": "Los Angeles", "city": "Beverly Hills", "label": "Beverly Hills"},
    "309": {"region": "New York metro", "city": "Brooklyn", "label": "Brooklyn"},
    "322": {"region": "Portland", "city": "Portland", "label": "Portland"},
    "66": {"region": "Sacramento", "city": "Sacramento", "label": "Sacramento"},
    "74": {"region": "Houston", "city": "Houston", "label": "Houston"},
    "10": {"region": "Baltimore", "city": "Baltimore", "label": "Baltimore"},
    "212": {"region": "Atlanta", "city": "Atlanta", "label": "Atlanta"},
    "305": {"region": "Phoenix", "city": "Phoenix", "label": "Phoenix"},
    "185": {"region": "Cleveland", "city": "Cleveland", "label": "Cleveland"},
    "167": {"region": "Dallas", "city": "Dallas", "label": "Dallas"},
    "410": {"region": "Minneapolis", "city": "Minneapolis", "label": "Minneapolis"},
    "354": {"region": "Miami / Florida", "city": "Fort Lauderdale", "label": "Fort Lauderdale"},
    "328": {"region": "Miami / Florida", "city": "Miami Beach", "label": "Miami Beach"},
    "17": {"region": "Miami / Florida", "city": "Sunny Isles", "label": "Sunny Isles"},
}

CATEGORY_LABELS: dict[str, str] = {
    "zubnoj-doktor-stomatologiya": "стоматология",
    "yuristy": "юристы",
    "buhgalterskie-uslugi-nalogi": "бухгалтерия / налоги",
    "agenty-nedvizhimosti": "недвижимость",
    "agentstva-po-najmu": "агентства по найму",
    "apteki": "аптеки",
    "restorany": "рестораны",
    "magaziny": "магазины",
    "avtomobili": "авто",
    "krasota-i-zdorove": "красота / здоровье",
    "meditsinskie-kliniki": "медицина",
    "strahovanie": "страхование",
    "perevody": "переводы",
    "obuchenie": "обучение",
    "detskie-sady-i-servis": "детские сады",
    "fotograf": "фотографы",
    "remont": "ремонт",
    "transportnye-uslugi": "транспорт",
}

PERSON_HINTS = re.compile(
    r"\b(dr\.|dds|dmd|md|esq|attorney|lawyer|realtor|notary|"
    r"доктор|д-р|юрист|нотариус|риэлтор|риелтор|бухгалтер|репетитор|"
    r"массаж|терапевт|стоматолог)\b",
    re.I,
)
BUSINESS_HINTS = re.compile(
    r"\b(llc|inc|corp|company|clinic|center|centre|school|studio|"
    r"restaurant|market|store|pharmacy|agency|firm|salon|office|"
    r"клиника|центр|школа|студия|ресторан|магазин|аптека|агентство|"
    r"салон|офис|компания)\b",
    re.I,
)

PHONE_RE = re.compile(r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}")
EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.I)


def clean(s: str | None) -> str:
    t = unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", t).strip()


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
    if not host or "svoi.us" in host or "schema.org" in host:
        return None
    if any(
        x in host
        for x in (
            "google.com",
            "googleapis.com",
            "gstatic.com",
            "goo.gl",
            "cloudflare",
            "jsdelivr",
            "facebook.com",
            "instagram.com",
            "twitter.com",
            "x.com",
            "linkedin.com",
            "youtube.com",
            "meetup.com",
            "docs.google.com",
        )
    ):
        return None
    return u.rstrip("/")


def guess_entity(name: str, category: str, text: str) -> str:
    blob = f"{name} {category} {text}"
    if PERSON_HINTS.search(blob) and not BUSINESS_HINTS.search(name):
        return "professional"
    return "business"


def fetch(url: str, retries: int = 3) -> str:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as resp:
                return resp.read().decode("utf-8", "replace")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def category_paths_for_hub(hub: str) -> list[tuple[str, str]]:
    html = fetch(f"{BASE}/companies/{hub}")
    paths = sorted(
        set(
            re.findall(
                rf'href="(/companies/category/{re.escape(hub)}/[^"?#]+)"',
                html,
            )
        )
    )
    out: list[tuple[str, str]] = []
    for path in paths:
        slug = path.rstrip("/").split("/")[-1]
        label = CATEGORY_LABELS.get(slug) or slug.replace("-", " ")
        out.append((path, label))
    return out


def max_page_from_html(html: str) -> int:
    pages = [int(p) for p in re.findall(r"[?&]page=(\d+)", html)]
    return max(pages) if pages else 1


def parse_listing_cards(
    html: str,
    *,
    hub: str,
    category_path: str,
    category_label: str,
    region_meta: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    hub_meta = region_meta or HUBS.get(hub) or {
        "region": "USA",
        "city": "USA",
        "label": hub,
    }
    # Split on product cards only — not js-product-name.
    chunks = re.split(
        r'<div[^>]*class="[^"]*\bjs-product(?:\s|")[^"]*"',
        html,
    )
    cards: list[dict[str, Any]] = []
    for chunk in chunks[1:]:
        m = re.search(
            r'href="(/company/[^"]+)"[^>]*(?:title="([^"]*)")?',
            chunk,
        )
        if not m:
            continue
        path, title_attr = m.group(1), m.group(2) or ""
        name = clean(title_attr)
        if not name:
            name_m = re.search(
                r'js-product-name[^>]*>.*?<a[^>]*>(.*?)</a>',
                chunk,
                re.I | re.S,
            )
            name = clean(name_m.group(1)) if name_m else ""
        name = name.lstrip("»").strip()
        if not name or len(name) < 2:
            continue
        # Quality: drop junk shells / job posts / untitled
        low = name.lower()
        if any(
            x in low
            for x in (
                "help wanted",
                "требуется",
                "ищу ",
                "looking for",
                "untitled",
                "без названия",
                "test company",
            )
        ):
            continue
        if len(re.sub(r"[\W_]+", "", name, flags=re.U)) < 2:
            continue

        descr_m = re.search(
            r't353__descr[^>]*>\s*(.*?)</div>',
            chunk,
            re.I | re.S,
        )
        descr = clean(descr_m.group(1)) if descr_m else ""
        if descr.endswith("..."):
            descr = descr[:-3].rstrip()

        phones: list[str] = []
        for raw in re.findall(r'href="tel:([^"]+)"', chunk):
            p = normalize_phone(raw) or normalize_phone(clean(raw))
            if p and p not in phones:
                phones.append(p)
        for raw in PHONE_RE.findall(chunk):
            p = normalize_phone(raw)
            if p and p not in phones:
                phones.append(p)

        emails: list[str] = []
        for raw in re.findall(r'href="mailto:([^"?]+)', chunk, re.I):
            e = clean(raw).lower()
            if e and e not in emails:
                emails.append(e)
        for raw in EMAIL_RE.findall(chunk):
            e = raw.lower()
            if e not in emails:
                emails.append(e)

        # Address / city: last span in t-info-second often has city link text
        city = hub_meta["city"]
        address: str | None = None
        info_m = re.search(r't-info-second">(.*?)</div>\s*</div>', chunk, re.I | re.S)
        if info_m:
            spans = re.findall(r"<span>(.*?)</span>", info_m.group(1), re.I | re.S)
            cleaned = [clean(s) for s in spans]
            cleaned = [s for s in cleaned if s and s != "-"]
            # Prefer non-phone text as address/city
            for s in cleaned:
                if PHONE_RE.search(s) or "@" in s:
                    continue
                if re.fullmatch(r"\+?1?\d[\d\-\s()]{8,}", s):
                    continue
                address = s[:160]
                city = s[:80]
                break

        source_url = urljoin(BASE + "/", path)
        company_id = path.rstrip("/").split("/")[-1]
        cluster = "svoi-" + hashlib.sha1(company_id.encode("utf-8")).hexdigest()[:16]
        entity = guess_entity(name, category_label, descr)

        cards.append(
            {
                "cluster_key": cluster,
                "display_name": name[:160],
                "entity_type_guess": entity,
                "target_bucket": "yellow_pages",
                "directory_source": "svoi",
                "category_slug": category_path.rstrip("/").split("/")[-1],
                "category_guess": category_label,
                "city": city,
                "address": address,
                "phones": phones[:4],
                "emails": emails[:4],
                "instagram": [],
                "websites": [],
                "cover_image_url": None,
                "images": [],
                "short_description": (descr or category_label)[:280],
                "description": descr or name,
                "source_url": source_url,
                "source_channel": "other",
                "source_groups": ["Svoi.us", hub_meta["label"]],
                "region": hub_meta["region"],
                "hub": hub,
                "company_path": path,
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    return cards


def enrich_from_detail(card: dict[str, Any]) -> None:
    path = card.get("company_path")
    if not path:
        return
    html = fetch(urljoin(BASE + "/", path))
    websites: list[str] = []
    # Prefer explicit site-button (company website on svoi).
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
    card["websites"] = websites[:4]

    og_img = re.search(
        r'property="og:image"\s+content="([^"]+)"',
        html,
        re.I,
    )
    if og_img:
        card["cover_image_url"] = og_img.group(1)

    # Better description
    og_desc = re.search(
        r'property="og:description"\s+content="([^"]+)"',
        html,
        re.I,
    )
    if og_desc:
        d = clean(og_desc.group(1))
        if d and len(d) > len(card.get("description") or ""):
            card["description"] = d[:4000]
            card["short_description"] = d[:280]

    # phones / emails if missing
    phones = list(card.get("phones") or [])
    for raw in re.findall(r'href="tel:([^"]+)"', html):
        p = normalize_phone(raw)
        if p and p not in phones:
            phones.append(p)
    card["phones"] = phones[:4]

    emails = list(card.get("emails") or [])
    for raw in re.findall(r'href="mailto:([^"?]+)', html, re.I):
        e = clean(raw).lower()
        if e and e not in emails:
            emails.append(e)
    card["emails"] = emails[:4]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--hubs",
        default="",
        help="Comma-separated hub slugs (nyc,cho). Empty = skip hubs.",
    )
    parser.add_argument(
        "--cities",
        default="",
        help="Comma-separated svoi city ids (1=LA,29=Miami,45=Boston,…)",
    )
    parser.add_argument("--max-pages", type=int, default=1, help="Pages per category/city")
    parser.add_argument("--limit", type=int, default=250, help="Max unique cards")
    parser.add_argument(
        "--enrich-details",
        action="store_true",
        help="Fetch company detail pages for website/image",
    )
    parser.add_argument("--sleep", type=float, default=0.35)
    parser.add_argument(
        "--categories",
        default="",
        help="Optional comma-separated category slug filter",
    )
    args = parser.parse_args()

    hubs = [h.strip() for h in args.hubs.split(",") if h.strip()]
    city_ids = [c.strip() for c in args.cities.split(",") if c.strip()]
    if not hubs and not city_ids:
        hubs = ["nyc", "cho"]
    cat_filter = {
        c.strip() for c in args.categories.split(",") if c.strip()
    } or None

    by_key: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, str]] = []

    for hub in hubs:
        if hub not in HUBS:
            print(f"skip unknown hub {hub}", flush=True)
            continue
        print(f"=== hub {hub} ===", flush=True)
        try:
            cats = category_paths_for_hub(hub)
        except Exception as exc:  # noqa: BLE001
            errors.append({"url": f"/companies/{hub}", "error": str(exc)})
            print(f"ERR hub {hub}: {exc}", flush=True)
            continue
        if cat_filter:
            cats = [(p, l) for p, l in cats if p.rstrip("/").split("/")[-1] in cat_filter]
        print(f"  categories: {len(cats)}", flush=True)

        for cat_path, cat_label in cats:
            if len(by_key) >= args.limit:
                break
            for page in range(1, max(1, args.max_pages) + 1):
                if len(by_key) >= args.limit:
                    break
                url = urljoin(BASE + "/", cat_path)
                if page > 1:
                    url = f"{url}?page={page}"
                try:
                    html = fetch(url)
                except Exception as exc:  # noqa: BLE001
                    errors.append({"url": url, "error": str(exc)})
                    print(f"ERR {url}: {exc}", flush=True)
                    break
                cards = parse_listing_cards(
                    html,
                    hub=hub,
                    category_path=cat_path,
                    category_label=cat_label,
                )
                new = 0
                for c in cards:
                    if c["cluster_key"] not in by_key:
                        by_key[c["cluster_key"]] = c
                        new += 1
                    if len(by_key) >= args.limit:
                        break
                print(
                    f"  {hub}/{cat_path.split('/')[-1]} p{page}: "
                    f"+{new} (total {len(by_key)})",
                    flush=True,
                )
                if new == 0 and page > 1:
                    break
                time.sleep(args.sleep)
            if len(by_key) >= args.limit:
                break

    for cid in city_ids:
        meta = CITY_IDS.get(cid) or {
            "region": "USA",
            "city": f"city-{cid}",
            "label": f"city-{cid}",
        }
        print(f"=== city {cid} ({meta['label']}) ===", flush=True)
        for page in range(1, max(1, args.max_pages) + 1):
            if len(by_key) >= args.limit:
                break
            url = f"{BASE}/companies?city={cid}"
            if page > 1:
                url = f"{url}&page={page}"
            try:
                html = fetch(url)
            except Exception as exc:  # noqa: BLE001
                errors.append({"url": url, "error": str(exc)})
                print(f"ERR {url}: {exc}", flush=True)
                break
            cards = parse_listing_cards(
                html,
                hub=f"city-{cid}",
                category_path=f"/companies?city={cid}",
                category_label=meta["label"],
                region_meta=meta,
            )
            new = 0
            for c in cards:
                if c["cluster_key"] not in by_key:
                    by_key[c["cluster_key"]] = c
                    new += 1
                if len(by_key) >= args.limit:
                    break
            print(
                f"  city={cid} p{page}: +{new} (total {len(by_key)})",
                flush=True,
            )
            if new == 0 and page > 1:
                break
            time.sleep(args.sleep)

    cards = list(by_key.values())
    if args.enrich_details:
        print(f"enriching {len(cards)} detail pages…", flush=True)
        for i, card in enumerate(cards, 1):
            try:
                enrich_from_detail(card)
            except Exception as exc:  # noqa: BLE001
                errors.append(
                    {"url": card.get("source_url") or "", "error": str(exc)}
                )
            if i % 25 == 0:
                print(f"  enriched {i}/{len(cards)}", flush=True)
            time.sleep(args.sleep)

    # Drop scrape-only helpers before write
    for c in cards:
        c.pop("company_path", None)
        c.pop("hub", None)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "source": f"{BASE}/companies",
        "directory_source": "svoi",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "hubs": hubs,
        "cities": city_ids,
        "count": len(cards),
        "errors": errors,
        "cards": cards,
    }
    out_stamp = OUT / f"svoi_cards_{stamp}.json"
    out_latest = OUT / "svoi_cards_latest.json"
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    out_stamp.write_text(text, encoding="utf-8")
    out_latest.write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(out_latest),
                "count": len(cards),
                "errors": len(errors),
                "with_phone": sum(1 for c in cards if c.get("phones")),
                "with_email": sum(1 for c in cards if c.get("emails")),
                "with_website": sum(1 for c in cards if c.get("websites")),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if cards else 1


if __name__ == "__main__":
    raise SystemExit(main())
