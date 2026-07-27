#!/usr/bin/env python3
"""Scrape Slavic Seattle WA business directory into Yellow Pages cards.

Primary source: sitemap.xml + schema.org JSON-LD on each /businesses/{slug}.

Usage:
  python3 scripts/business-enrich/scrape_slavic_seattle.py
  python3 scripts/business-enrich/scrape_slavic_seattle.py --limit 50
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
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

OUT = Path(__file__).resolve().parent / "data" / "yellow_pages"
OUT.mkdir(parents=True, exist_ok=True)

BASE = "https://slavicseattle.com"
SITEMAP = f"{BASE}/sitemap.xml"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
}

PHONE_RE = re.compile(
    r"(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-]\d{3}[\s\-]\d{4}|\(\d{3}\)\s*\d{3}[\-\s]?\d{4}|\d{3}[\-\s]\d{3}[\-\s]\d{4})"
)
PERSON_HINTS = re.compile(
    r"\b(md|dmd|dds|attorney|lawyer|realtor|notary|"
    r"доктор|д-р|юрист|адвокат|нотариус|риэлтор|риелтор|бухгалтер|массаж)\b",
    re.I,
)
JUNK_NAME = re.compile(
    r"\b(untitled|test listing|sample business|без названия)\b",
    re.I,
)

TYPE_TO_CAT = {
    "Dentist": ("health", "стоматология"),
    "Physician": ("health", "медицина"),
    "MedicalClinic": ("health", "медицина"),
    "MedicalBusiness": ("health", "медицина"),
    "LegalService": ("legal", "юристы"),
    "Attorney": ("legal", "юристы"),
    "RealEstateAgent": ("real_estate", "недвижимость"),
    "HomeAndConstructionBusiness": ("home_services", "дом / ремонт"),
    "AutoRepair": ("auto", "автосервис"),
    "AutomotiveBusiness": ("auto", "авто"),
    "Restaurant": ("food", "рестораны"),
    "FoodEstablishment": ("food", "еда"),
    "Store": ("retail", "магазины"),
    "BeautySalon": ("beauty", "красота"),
    "HairSalon": ("beauty", "красота"),
    "DaySpa": ("beauty", "спа"),
    "EducationalOrganization": ("education", "образование"),
    "ChildCare": ("childcare", "дети"),
    "InsuranceAgency": ("insurance", "страхование"),
    "AccountingService": ("finance", "бухгалтерия"),
    "FinancialService": ("finance", "финансы"),
    "TravelAgency": ("travel", "туризм"),
    "LocalBusiness": ("other", "бизнес"),
}


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


def encode_url(url: str) -> str:
    """Percent-encode non-ASCII path segments for urllib (py3.9)."""
    parts = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(parts.path, safe="/%")
    query = urllib.parse.quote(parts.query, safe="=&%")
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, path, query, parts.fragment)
    )


def get_text(url: str, timeout: float = 25) -> str:
    last: Exception | None = None
    encoded = encode_url(url)
    for attempt in range(2):
        try:
            req = urllib.request.Request(encoded, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", "ignore")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"GET {url}: {last}")


def business_urls_from_sitemap() -> list[str]:
    xml = get_text(SITEMAP)
    locs = re.findall(r"<loc>([^<]+)</loc>", xml)
    out: list[str] = []
    seen: set[str] = set()
    for loc in locs:
        if "/businesses/" not in loc:
            continue
        slug = loc.rstrip("/").rsplit("/", 1)[-1]
        if slug in {"", "new", "businesses"}:
            continue
        if loc not in seen:
            seen.add(loc)
            out.append(loc)
    return out


def extract_jsonld(html: str) -> dict[str, Any] | None:
    for raw in re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>',
        html,
        re.I,
    ):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and item.get("name"):
                    return item
        elif isinstance(data, dict) and data.get("name"):
            return data
    return None


def map_category(schema_type: str) -> tuple[str, str]:
    if isinstance(schema_type, list):
        schema_type = schema_type[0] if schema_type else "LocalBusiness"
    return TYPE_TO_CAT.get(str(schema_type), ("other", clean(str(schema_type)) or "бизнес"))


def parse_detail(url: str) -> dict[str, Any] | None:
    html = get_text(url)
    data = extract_jsonld(html)
    if not data:
        return None

    title = clean(data.get("name"))
    if len(title) < 2 or JUNK_NAME.search(title):
        return None

    phones: list[str] = []
    for raw in [data.get("telephone"), *PHONE_RE.findall(clean(data.get("description")))]:
        p = normalize_phone(str(raw or ""))
        if p and p not in phones:
            phones.append(p)
    phones = phones[:4]

    emails: list[str] = []
    email = clean(data.get("email") or "")
    if email and "@" in email and email not in emails:
        emails.append(email)

    addr = data.get("address") or {}
    if not isinstance(addr, dict):
        addr = {}
    street = clean(addr.get("streetAddress"))
    city = clean(addr.get("addressLocality")) or None
    region = clean(addr.get("addressRegion")) or "WA"
    postal = clean(addr.get("postalCode"))
    address_parts = [p for p in [street, city, region, postal] if p]
    address = ", ".join(address_parts) if address_parts else None

    websites: list[str] = []
    for raw in data.get("sameAs") or []:
        u = clean(str(raw))
        if not u.startswith("http"):
            continue
        host = (urlparse(u).hostname or "").lower()
        if "slavicseattle" in host or "facebook.com" in host or "instagram.com" in host:
            continue
        if u.rstrip("/") not in websites:
            websites.append(u.rstrip("/"))

    if not phones and not websites and not address:
        return None

    images = data.get("image") or []
    if isinstance(images, str):
        images = [images]
    images = [clean(str(x)) for x in images if str(x).startswith("http")][:8]
    cover = images[0] if images else None

    schema_type = data.get("@type") or "LocalBusiness"
    cat_slug, cat_guess = map_category(schema_type)
    desc = clean(data.get("description"))
    entity = (
        "professional"
        if PERSON_HINTS.search(f"{title} {desc} {cat_guess}")
        else "business"
    )

    slug = url.rstrip("/").rsplit("/", 1)[-1]
    cluster = "sls-" + hashlib.sha1(slug.encode("utf-8")).hexdigest()[:16]

    return {
        "cluster_key": cluster,
        "display_name": title[:160],
        "entity_type_guess": entity,
        "target_bucket": "yellow_pages",
        "directory_source": "slavic_seattle",
        "category_slug": cat_slug,
        "category_guess": cat_guess,
        "city": city,
        "address": address,
        "phones": phones,
        "emails": emails,
        "instagram": [],
        "websites": websites,
        "cover_image_url": cover,
        "images": images,
        "short_description": (desc or title)[:280],
        "description": (desc or title)[:4000],
        "source_url": url,
        "source_channel": "other",
        "source_groups": ["Slavic Seattle"],
        "region": region if len(region) <= 40 else "WA",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--sleep", type=float, default=0.02)
    args = parser.parse_args()

    urls = business_urls_from_sitemap()
    if args.limit and args.limit > 0:
        urls = urls[: args.limit]
    print(f"urls={len(urls)}", flush=True)

    cards: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    workers = max(1, min(args.workers, 12))

    def _one(u: str) -> dict[str, Any] | None:
        try:
            return parse_detail(u)
        except Exception as exc:  # noqa: BLE001
            errors.append({"url": u, "error": str(exc)})
            return None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_one, u): u for u in urls}
        done = 0
        for fut in as_completed(futs):
            done += 1
            card = fut.result()
            if card:
                cards.append(card)
            if done % 25 == 0 or done == len(urls):
                print(
                    f"progress {done}/{len(urls)} cards={len(cards)} errs={len(errors)}",
                    flush=True,
                )
            if args.sleep:
                time.sleep(args.sleep)

    by_key = {c["cluster_key"]: c for c in cards}
    cards = list(by_key.values())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "source": f"{BASE}/businesses",
        "directory_source": "slavic_seattle",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "errors": errors[:40],
        "cards": cards,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    (OUT / f"slavic_seattle_{stamp}.json").write_text(text, encoding="utf-8")
    (OUT / "slavic_seattle_latest.json").write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(OUT / "slavic_seattle_latest.json"),
                "count": len(cards),
                "errors": len(errors),
                "with_phone": sum(1 for c in cards if c.get("phones")),
                "with_website": sum(1 for c in cards if c.get("websites")),
                "with_address": sum(1 for c in cards if c.get("address")),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if cards else 1


if __name__ == "__main__":
    raise SystemExit(main())
