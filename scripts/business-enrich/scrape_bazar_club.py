#!/usr/bin/env python3
"""Scrape BAZAR.club business/service catalog via search API.

Skips job listings. Prefers cards with company_name + phone.

Usage:
  python3 scripts/business-enrich/scrape_bazar_club.py --pilot 5
  python3 scripts/business-enrich/scrape_bazar_club.py --limit 200
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

SEARCH = "https://search.bazar.club/api/v1/posts"
SITE = "https://www.bazar.club"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

PERSON_HINTS = re.compile(
    r"\b(md|dmd|dds|attorney|lawyer|realtor|notary|cpa|"
    r"доктор|д-р|юрист|адвокат|нотариус|риэлтор|риелтор|бухгалтер|массаж)\b",
    re.I,
)


def clean(s: str | None) -> str:
    t = unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", t).strip()


def normalize_phone(raw: str, country_code: str | None = "1") -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    cc = re.sub(r"\D", "", country_code or "1") or "1"
    if len(digits) == 10:
        return f"+{cc}{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    if len(digits) >= 10:
        return f"+{digits}"
    return None


def get_json(url: str) -> dict[str, Any]:
    last: Exception | None = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            json.JSONDecodeError,
        ) as exc:
            last = exc
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"GET {url}: {last}")


def primary_category(item: dict[str, Any]) -> tuple[str, str]:
    cats = item.get("categories") or []
    for cat in cats:
        slug = (cat.get("slug") or "").strip()
        name = (cat.get("name") or slug).strip()
        if slug and slug not in {"other-business", "other-services", "other-store"}:
            return slug, name[:60] or "услуги"
    if cats:
        slug = (cats[0].get("slug") or "other").strip()
        name = (cats[0].get("name") or slug).strip()
        return slug, name[:60] or "услуги"
    return "other", "услуги"


def city_from_item(item: dict[str, Any]) -> str | None:
    locs = item.get("locations") or []
    # Prefer lvl=1 city-like labels
    for loc in locs:
        if loc.get("lvl") == 1 and loc.get("name"):
            return clean(loc["name"])[:80]
    low = item.get("lowest_location") or {}
    if low.get("name"):
        return clean(low["name"])[:80]
    for loc in locs:
        if loc.get("name"):
            return clean(loc["name"])[:80]
    return None


def item_to_card(item: dict[str, Any]) -> dict[str, Any] | None:
    # Catalog business/service items only (API type=item), not jobs/housing.
    if (item.get("type") or "").lower() != "item":
        return None

    add = item.get("additional") or {}
    social = item.get("social") or {}
    company = clean(add.get("company_name"))
    title = clean(item.get("title"))
    name = company or title
    if not name or len(name) < 2:
        return None

    phone = normalize_phone(
        str(add.get("phone") or ""),
        str(add.get("phone_country_code") or "1"),
    )
    phones: list[str] = []
    if phone:
        phones.append(phone)
    phone2 = normalize_phone(
        str(add.get("phone_2") or ""),
        str(add.get("phone_2_country_code") or "1"),
    )
    if phone2 and phone2 not in phones:
        phones.append(phone2)
    # WhatsApp / Telegram often carry the same mobile
    for key in ("whatsapp", "telegram"):
        link = social.get(key) or ""
        m = re.search(r"(\+?\d{10,15})", link)
        if m:
            p = normalize_phone(m.group(1))
            if p and p not in phones:
                phones.append(p)

    if not phones:
        return None

    emails: list[str] = []
    email = clean(add.get("email"))
    if email and "@" in email:
        emails.append(email)

    websites: list[str] = []
    web = clean(social.get("web_site"))
    if web:
        if not web.startswith("http"):
            web = "https://" + web
        websites.append(web)

    instagram: list[str] = []
    ig = social.get("instagram")
    if ig:
        handle = clean(str(ig)).rstrip("/").rsplit("/", 1)[-1].lstrip("@")
        if handle:
            instagram.append(handle)

    slug = clean(item.get("slug")) or str(item.get("id"))
    cluster = "bzc-" + hashlib.sha1(f"bazar:{slug}".encode("utf-8")).hexdigest()[:16]
    cat_slug, cat_guess = primary_category(item)
    body = clean(item.get("content"))
    entity = (
        "professional"
        if PERSON_HINTS.search(f"{name} {title} {body} {cat_slug}")
        else "business"
    )
    cover = item.get("main_photo")
    images: list[str] = []
    if cover:
        images.append(str(cover))
    for g in item.get("gallery") or []:
        url = g.get("photo_url") if isinstance(g, dict) else None
        if url and url not in images:
            images.append(str(url))

    return {
        "cluster_key": cluster,
        "display_name": name[:160],
        "entity_type_guess": entity,
        "target_bucket": "yellow_pages",
        "directory_source": "bazar_club",
        "category_slug": cat_slug,
        "category_guess": cat_guess,
        "city": city_from_item(item),
        "address": clean(add.get("address")) or None,
        "phones": phones[:4],
        "emails": emails[:3],
        "instagram": instagram[:3],
        "websites": websites[:3],
        "cover_image_url": images[0] if images else None,
        "images": images[:8],
        "short_description": (body or title or name)[:280],
        "description": (body or title or name)[:4000],
        "source_url": f"{SITE}/business/post/{slug}",
        "source_channel": "other",
        "source_groups": ["BAZAR.club"],
        "region": "USA",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "external_id": item.get("id"),
        "contact_person": clean(add.get("contact_person")) or None,
    }


def fetch_page(page: int, paginate: int = 36) -> list[dict[str, Any]]:
    qs = urllib.parse.urlencode(
        {
            "type": "item",
            "paginate": paginate,
            "hasPhoto": "true",
            "page": page,
        }
    )
    data = get_json(f"{SEARCH}?{qs}")
    return list(data.get("data") or [])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilot", type=int, default=0, help="Diverse N cards (one per category)")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-pages", type=int, default=20)
    parser.add_argument("--sleep", type=float, default=0.15)
    args = parser.parse_args()

    target = args.pilot or args.limit or 50
    diversify = bool(args.pilot)

    by_key: dict[str, dict[str, Any]] = {}
    seen_cats: set[str] = set()
    errors: list[dict[str, str]] = []

    for page in range(1, args.max_pages + 1):
        if len(by_key) >= target:
            break
        try:
            items = fetch_page(page)
        except Exception as exc:  # noqa: BLE001
            errors.append({"page": str(page), "error": str(exc)})
            break
        if not items:
            break
        new = 0
        for item in items:
            if len(by_key) >= target:
                break
            card = item_to_card(item)
            if not card:
                continue
            cat = card["category_slug"]
            if diversify and cat in seen_cats:
                continue
            if card["cluster_key"] in by_key:
                continue
            by_key[card["cluster_key"]] = card
            seen_cats.add(cat)
            new += 1
        print(
            f"page {page}: +{new} total={len(by_key)} cats={len(seen_cats)}",
            flush=True,
        )
        time.sleep(args.sleep)

    cards = list(by_key.values())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "source": f"{SITE}/business",
        "directory_source": "bazar_club",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "errors": errors[:40],
        "cards": cards,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    (OUT / f"bazar_club_{stamp}.json").write_text(text, encoding="utf-8")
    (OUT / "bazar_club_latest.json").write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(OUT / "bazar_club_latest.json"),
                "count": len(cards),
                "categories": sorted({c["category_slug"] for c in cards}),
                "with_company_phone": sum(
                    1 for c in cards if c.get("phones") and c.get("display_name")
                ),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if cards else 1


if __name__ == "__main__":
    raise SystemExit(main())
