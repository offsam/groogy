#!/usr/bin/env python3
"""Scrape Boston Russian Pages business cards into Yellow Pages JSON.

Listing pages: /city-{slug}-c-{id} with .business_card blocks.
Also walks /cities for MA-focused batch by default.

Usage:
  python3 scripts/business-enrich/scrape_boston_russian_pages.py
  python3 scripts/business-enrich/scrape_boston_russian_pages.py --limit 400
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

BASE = "https://bostonrussianpages.com"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
}

PERSON_HINTS = re.compile(
    r"\b(d\.?m\.?d|d\.?d\.?s|m\.?d|j\.?d|esq|cpa|attorney|lawyer|realtor|"
    r"доктор|д-р|юрист|адвокат|нотариус|риэлтор|риелтор|бухгалтер|"
    r"стоматолог|массаж)\b",
    re.I,
)
BUSINESS_HINTS = re.compile(
    r"\b(llc|inc|corp|company|clinic|center|school|studio|restaurant|"
    r"agency|salon|office|construction|restoration|spa|"
    r"клиника|центр|школа|студия|ресторан|агентство|салон|компания)\b",
    re.I,
)


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
    if not host or "bostonrussianpages" in host:
        return None
    if any(
        x in host
        for x in (
            "facebook.com",
            "instagram.com",
            "google.com",
            "schema.org",
            "googleapis.com",
        )
    ):
        return None
    return u.rstrip("/")


def guess_entity(name: str, text: str) -> str:
    blob = f"{name} {text}"
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
            time.sleep(1.1 * (attempt + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


SEED_CITY_PATHS = [
    "/city-boston-ma-c-6",
    "/city-newton-ma-c-4",
    "/city-brookline-ma-c-2",
    "/city-cambridge-ma-c-32",
    "/city-somerville-ma-c-74",
    "/city-waltham-ma-c-1",
    "/city-watertown-ma-c-29",
    "/city-needham-ma-c-10",
    "/city-wellesley-ma-c-11",
    "/city-weston-ma-c-73",
]


def list_city_paths(*, states: set[str] | None) -> list[tuple[str, str]]:
    html = fetch(f"{BASE}/cities")
    # Fix broken newlines inside href occasionally
    html = html.replace("\r", "").replace("\n", "")
    pairs = re.findall(r'href="(/city-[^"]+)"[^>]*>([^<]+)</a>', html)
    out: list[tuple[str, str]] = []
    seen: set[str] = set()

    def add(path: str, label: str) -> None:
        path = re.sub(r"\s+", "", path)
        if path in seen:
            return
        if states:
            m = re.search(r"-([a-z]{2})-c-\d+", path)
            st = m.group(1).upper() if m else ""
            if st and st not in states:
                return
        seen.add(path)
        out.append((path, clean(label) or path))

    for path in SEED_CITY_PATHS:
        label = path.replace("/city-", "").rsplit("-c-", 1)[0].replace("-", " ").title()
        add(path, label)

    for path, label in pairs:
        add(path, label)
    return out


def parse_city_cards(html: str, city_label: str) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for block in re.findall(
        r'<div class="business_card">(.*?)</div>\s*(?=<div class="business_card"|$)',
        html,
        re.S,
    ):
        href_m = re.search(r'href="(/[^"]+-wiw-\d+)"', block)
        name_m = re.search(r"<h3>(.*?)</h3>", block, re.S)
        if not href_m or not name_m:
            continue
        path = href_m.group(1)
        name = clean(name_m.group(1))
        if not name:
            continue
        addr_m = re.search(r'class="business_address">(.*?)</div>', block, re.S)
        addr = clean(addr_m.group(1)) if addr_m else ""
        phone_m = re.search(r'href="tel:([^"]+)"', block)
        phones: list[str] = []
        if phone_m:
            p = normalize_phone(phone_m.group(1))
            if p:
                phones.append(p)
        desc_m = re.search(r'class="business_desc">(.*?)</div>', block, re.S)
        desc = clean(desc_m.group(1)) if desc_m else ""

        # city from address or page label
        city = city_label
        if addr:
            # "Brookline, MA" or full street
            cm = re.search(
                r"\b([A-Za-zА-Яа-яЁё .'\-]+),\s*([A-Z]{2})\b",
                addr,
            )
            if cm:
                city = cm.group(1).strip()

        wid = path.rsplit("-wiw-", 1)[-1]
        cluster = "brp-" + hashlib.sha1(f"wiw-{wid}".encode("utf-8")).hexdigest()[:16]
        entity = guess_entity(name, desc)
        cards.append(
            {
                "cluster_key": cluster,
                "display_name": name[:160],
                "entity_type_guess": entity,
                "target_bucket": "yellow_pages",
                "directory_source": "boston_pages",
                "category_slug": None,
                "category_guess": None,
                "city": city[:80] if city else "Boston",
                "address": addr or None,
                "phones": phones,
                "emails": [],
                "instagram": [],
                "websites": [],
                "cover_image_url": None,
                "images": [],
                "short_description": (desc or name)[:280],
                "description": desc or name,
                "source_url": urljoin(BASE + "/", path),
                "source_channel": "other",
                "source_groups": ["Boston Russian Pages"],
                "region": "New England",
                "detail_path": path,
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    return cards


def enrich_detail(card: dict[str, Any]) -> None:
    path = card.get("detail_path")
    if not path:
        return
    html = fetch(urljoin(BASE + "/", path))
    # JSON-LD
    for blob in re.findall(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.I | re.S,
    ):
        try:
            data = json.loads(blob)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            data = next((x for x in data if isinstance(x, dict)), {})
        if not isinstance(data, dict):
            continue
        tel = data.get("telephone")
        if tel:
            p = normalize_phone(str(tel))
            if p and p not in card["phones"]:
                card["phones"].append(p)
        url = data.get("url") or data.get("sameAs")
        if isinstance(url, list):
            url = url[0] if url else None
        w = normalize_website(str(url)) if url else None
        if w and w not in card["websites"]:
            card["websites"].append(w)
        addr = data.get("address")
        if isinstance(addr, dict):
            parts = [
                addr.get("streetAddress"),
                addr.get("addressLocality"),
                addr.get("addressRegion"),
                addr.get("postalCode"),
            ]
            line = clean(", ".join(str(p) for p in parts if p))
            if line and (not card.get("address") or len(line) > len(card["address"] or "")):
                card["address"] = line
            if addr.get("addressLocality"):
                card["city"] = clean(str(addr["addressLocality"]))

    # site links
    for raw in re.findall(r'href="(https?://[^"]+)"', html):
        w = normalize_website(raw)
        if w and w not in card["websites"]:
            card["websites"].append(w)
        if len(card["websites"]) >= 3:
            break

    # cover
    og = re.search(r'property="og:image"\s+content="([^"]+)"', html, re.I)
    if og and "logo" not in og.group(1).lower():
        card["cover_image_url"] = og.group(1)

    emails = list(card.get("emails") or [])
    for raw in re.findall(r'mailto:([^"?]+)', html, re.I):
        e = clean(raw).lower()
        if e and "@" in e and e not in emails:
            emails.append(e)
    card["emails"] = emails[:4]
    card["phones"] = card["phones"][:4]
    card["websites"] = card["websites"][:4]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument(
        "--states",
        default="MA,NH,RI,CT,VT,ME",
        help="Comma-separated state codes in city paths (default New England)",
    )
    parser.add_argument("--enrich-details", action="store_true")
    parser.add_argument("--sleep", type=float, default=0.25)
    parser.add_argument(
        "--cities",
        default="",
        help="Optional comma-separated city path fragments to include",
    )
    args = parser.parse_args()
    states = {s.strip().upper() for s in args.states.split(",") if s.strip()} or None
    city_filter = {c.strip() for c in args.cities.split(",") if c.strip()} or None

    cities = list_city_paths(states=states)
    if city_filter:
        cities = [(p, l) for p, l in cities if any(f in p for f in city_filter)]
    print(f"cities: {len(cities)}", flush=True)

    by_key: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, str]] = []

    for path, label in cities:
        if len(by_key) >= args.limit:
            break
        url = urljoin(BASE + "/", path)
        try:
            html = fetch(url)
        except Exception as exc:  # noqa: BLE001
            errors.append({"url": url, "error": str(exc)})
            print(f"ERR {url}: {exc}", flush=True)
            continue
        cards = parse_city_cards(html, label)
        new = 0
        for c in cards:
            if c["cluster_key"] not in by_key:
                by_key[c["cluster_key"]] = c
                new += 1
            if len(by_key) >= args.limit:
                break
        print(f"  {label}: +{new} (total {len(by_key)})", flush=True)
        time.sleep(args.sleep)

    cards = list(by_key.values())
    if args.enrich_details:
        print(f"enriching {len(cards)}…", flush=True)
        for i, card in enumerate(cards, 1):
            try:
                enrich_detail(card)
            except Exception as exc:  # noqa: BLE001
                errors.append({"url": card.get("source_url") or "", "error": str(exc)})
            if i % 40 == 0:
                print(f"  enriched {i}/{len(cards)}", flush=True)
            time.sleep(args.sleep)

    for c in cards:
        c.pop("detail_path", None)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "source": f"{BASE}/yellowpages",
        "directory_source": "boston_pages",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "errors": errors,
        "cards": cards,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    (OUT / f"boston_pages_{stamp}.json").write_text(text, encoding="utf-8")
    latest = OUT / "boston_pages_latest.json"
    latest.write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(latest),
                "count": len(cards),
                "errors": len(errors),
                "with_phone": sum(1 for c in cards if c.get("phones")),
                "with_address": sum(1 for c in cards if c.get("address")),
                "with_website": sum(1 for c in cards if c.get("websites")),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if cards else 1


if __name__ == "__main__":
    raise SystemExit(main())
