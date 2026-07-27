#!/usr/bin/env python3
"""Scrape RusPagesUSA company detail pages into Yellow Pages cards.

Listing search UI is broken (companies_list.js 404). We BFS from featured
links on city/home pages and follow related company links on detail pages.

Usage:
  python3 scripts/business-enrich/scrape_ruspagesusa.py
  python3 scripts/business-enrich/scrape_ruspagesusa.py --limit 800 --max-hops 4
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

OUT = Path(__file__).resolve().parent / "data" / "yellow_pages"
OUT.mkdir(parents=True, exist_ok=True)

BASE = "https://ruspagesusa.com"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
}

SEED_CITIES = [
    "gorod_nyu-york",
    "new_york_city",
    "mayami",
    "miami",
    "atlanta",
    "fort_lauderdale",
    "dallas",
    "florida",
    "djorjiya",
    "los_angeles",
    "chicago",
    "boston",
    "philadelphia",
    "san_francisco",
    "houston",
    "seattle",
    "denver",
    "sacramento",
    "san_diego",
    "phoenix",
    "minneapolis",
    "portland",
    "baltimore",
    "brooklyn",
]

JUNK_NAME = re.compile(
    r"\b(best buy|apple store|epl apple|avis |budget |hertz |enterprise |"
    r"consulate|консульство|seks-?shop|sex shop|adult entertainment|"
    r"flea mart|advance auto parts)\b",
    re.I,
)
PERSON_HINTS = re.compile(
    r"\b(md|dmd|dds|do|phd|attorney|lawyer|realtor|notary|"
    r"доктор|д-р|юрист|адвокат|нотариус|риэлтор|риелтор|стоматолог)\b",
    re.I,
)

PHONE_RE = re.compile(r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}")
DETAIL_RE = re.compile(r"^/catalog/(?!category)([a-z0-9_\-]+)/([a-z0-9_\-]+)/$")


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
    if not host or "ruspagesusa" in host:
        return None
    if any(x in host for x in ("facebook.com", "instagram.com", "google.com", "schema.org")):
        return None
    return u.rstrip("/")


def fetch(url: str, retries: int = 3) -> str:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as resp:
                return resp.read().decode("utf-8", "replace")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def is_detail_path(path: str) -> bool:
    return bool(DETAIL_RE.match(path))


def extract_detail_paths(html: str) -> set[str]:
    out: set[str] = set()
    for m in re.findall(r'href="(/catalog/[^"]+)"', html):
        path = m.split("?")[0]
        if not path.endswith("/"):
            path += "/"
        if is_detail_path(path):
            out.add(path)
    # also bare paths in HTML
    for m in re.findall(r"(/catalog/(?!category)[a-z0-9_\-]+/[a-z0-9_\-]+/)", html):
        if is_detail_path(m):
            out.add(m)
    return out


def parse_detail(html: str, url: str) -> dict[str, Any] | None:
    title_m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    title = clean(title_m.group(1) if title_m else "")
    # Title often: "Type - NAME. City, address..."
    name = title
    if " - " in title:
        name = title.split(" - ", 1)[1]
    name = name.split(". ", 1)[0].strip(" .")
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S)
    if h1:
        h1t = clean(h1.group(1))
        if h1t and len(h1t) < 160:
            name = h1t
    name = clean(name)
    if not name or len(name) < 2:
        return None
    if JUNK_NAME.search(name) or JUNK_NAME.search(title):
        return None

    phones: list[str] = []
    for raw in re.findall(r'class=["\']phone-primary["\'][^>]*>([^<]+)', html, re.I):
        p = normalize_phone(raw)
        if p and p not in phones:
            phones.append(p)
    for raw in re.findall(r'class="phone"[^>]*>.*?<span[^>]*>([^<]+)', html, re.I | re.S):
        p = normalize_phone(raw)
        if p and p not in phones:
            phones.append(p)
    if not phones:
        for raw in PHONE_RE.findall(html):
            p = normalize_phone(raw)
            if p and p not in phones:
                phones.append(p)
            if len(phones) >= 3:
                break
    # Drop page chrome phones (often second is site support) — keep primary first only if many
    phones = phones[:3]
    if not phones:
        return None

    addr_m = re.search(r'class="adr">(.*?)</div>', html, re.I | re.S)
    address = clean(addr_m.group(1)) if addr_m else None
    city = None
    if address:
        cm = re.search(r"\b([A-Za-z .'\-]+),\s*([A-Z]{2})\b", address)
        if cm:
            city = cm.group(1).strip()
    if not city:
        path = urlparse(url).path
        m = DETAIL_RE.match(path if path.endswith("/") else path + "/")
        if m:
            city = m.group(1).replace("_", " ").replace("-", " ").title()

    websites: list[str] = []
    for raw in re.findall(r'href="(https?://[^"]+)"', html):
        w = normalize_website(raw)
        if w and w not in websites:
            websites.append(w)
        if len(websites) >= 3:
            break

    emails: list[str] = []
    for raw in re.findall(r'mailto:([^"?]+)', html, re.I):
        e = clean(raw).lower()
        if e and "@" in e and e not in emails:
            emails.append(e)

    # category from breadcrumb / title prefix
    cat = None
    if " - " in title:
        cat = clean(title.split(" - ", 1)[0])[:80]

    desc_m = re.search(
        r'property="og:description"\s+content="([^"]+)"',
        html,
        re.I,
    )
    desc = clean(desc_m.group(1)) if desc_m else (cat or name)

    og_img = re.search(r'property="og:image"\s+content="([^"]+)"', html, re.I)
    cover = og_img.group(1) if og_img else None

    entity = "professional" if PERSON_HINTS.search(f"{name} {cat or ''}") else "business"
    cluster = "rpu-" + hashlib.sha1(urlparse(url).path.encode("utf-8")).hexdigest()[:16]

    return {
        "cluster_key": cluster,
        "display_name": name[:160],
        "entity_type_guess": entity,
        "target_bucket": "yellow_pages",
        "directory_source": "ruspagesusa",
        "category_slug": None,
        "category_guess": cat,
        "city": city,
        "address": address,
        "phones": phones,
        "emails": emails[:4],
        "instagram": [],
        "websites": websites[:4],
        "cover_image_url": cover,
        "images": [],
        "short_description": desc[:280],
        "description": desc[:4000],
        "source_url": url,
        "source_channel": "other",
        "source_groups": ["RusPagesUSA"],
        "region": "USA",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


def collect_seeds() -> set[str]:
    seeds: set[str] = set()
    html = fetch(f"{BASE}/catalog/")
    seeds |= extract_detail_paths(html)
    for city in SEED_CITIES:
        try:
            h = fetch(f"{BASE}/catalog/{city}/")
            seeds |= extract_detail_paths(h)
            time.sleep(0.15)
        except Exception as exc:  # noqa: BLE001
            print(f"seed skip {city}: {exc}", flush=True)
    return seeds


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=800)
    parser.add_argument("--max-hops", type=int, default=5)
    parser.add_argument("--sleep", type=float, default=0.2)
    args = parser.parse_args()

    print("collecting seeds…", flush=True)
    seeds = collect_seeds()
    print(f"seeds: {len(seeds)}", flush=True)

    queue: deque[tuple[str, int]] = deque((p, 0) for p in sorted(seeds))
    seen_paths: set[str] = set()
    by_key: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, str]] = []

    while queue and len(by_key) < args.limit:
        path, hop = queue.popleft()
        if path in seen_paths:
            continue
        seen_paths.add(path)
        url = urljoin(BASE + "/", path)
        try:
            html = fetch(url)
        except Exception as exc:  # noqa: BLE001
            errors.append({"url": url, "error": str(exc)})
            continue

        card = parse_detail(html, url)
        if card:
            by_key[card["cluster_key"]] = card
            if len(by_key) % 25 == 0:
                print(f"  cards={len(by_key)} queue={len(queue)} seen={len(seen_paths)}", flush=True)

        if hop < args.max_hops:
            for rel in extract_detail_paths(html):
                if rel not in seen_paths:
                    queue.append((rel, hop + 1))
        time.sleep(args.sleep)

    cards = list(by_key.values())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "source": f"{BASE}/catalog/",
        "directory_source": "ruspagesusa",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "errors": errors,
        "seen_paths": len(seen_paths),
        "cards": cards,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    (OUT / f"ruspagesusa_{stamp}.json").write_text(text, encoding="utf-8")
    latest = OUT / "ruspagesusa_latest.json"
    latest.write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(latest),
                "count": len(cards),
                "errors": len(errors),
                "seen_paths": len(seen_paths),
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
