#!/usr/bin/env python3
"""Scrape to4ka.us business catalog via listings feed + detail API.

Feed pagination uses ?cursor= (base64 page numbers), not ?page=.
Phones often only appear on detail (or author profile in links.canonical).

Usage:
  python3 scripts/business-enrich/scrape_to4ka.py --limit 2000
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

OUT = Path(__file__).resolve().parent / "data" / "yellow_pages"
OUT.mkdir(parents=True, exist_ok=True)

FEED = "https://api.to4ka.us/api/listings/feed"
DETAIL = "https://api.to4ka.us/api/listings"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

PHONE_RE = re.compile(
    r"(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-]\d{3}[\s\-]\d{4}|\(\d{3}\)\s*\d{3}[\-\s]?\d{4}|\d{3}[\-\s]\d{3}[\-\s]\d{4})"
)
PERSON_HINTS = re.compile(
    r"\b(md|dmd|dds|attorney|lawyer|realtor|notary|"
    r"доктор|д-р|юрист|адвокат|нотариус|риэлтор|риелтор|бухгалтер|массаж)\b",
    re.I,
)


def clean(s: str | None) -> str:
    t = unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", t).strip()


def unescape_json_str(raw: str) -> str:
    try:
        return clean(json.loads(f'"{raw}"'))
    except json.JSONDecodeError:
        return clean(raw.replace("\\/", "/"))


def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def get_json(url: str, timeout: float = 20) -> dict[str, Any]:
    last: Exception | None = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"GET {url}: {last}")


def fetch_feed(cursor: str | None = None) -> dict[str, Any]:
    filters = urllib.parse.quote('{"type":"","subcategories":[]}')
    url = (
        f"{FEED}?category=business&scope=business_catalog"
        f"&filters={filters}&location=all-usa"
    )
    if cursor:
        url += f"&cursor={urllib.parse.quote(cursor)}"
    else:
        url += "&page=1"
    return get_json(url)


def phones_from_text(text: str) -> list[str]:
    out: list[str] = []
    for raw in PHONE_RE.findall(text or ""):
        p = normalize_phone(raw)
        # drop coordinate-like / uuid fragments that slipped through
        if not p:
            continue
        digits = re.sub(r"\D", "", p)
        if digits.startswith("1") and len(digits) == 11:
            area = digits[1:4]
        else:
            area = digits[:3]
        if area in {"000", "555"}:
            continue
        if p not in out:
            out.append(p)
    return out


def parse_detail(listing_id: str) -> dict[str, Any] | None:
    data = get_json(f"{DETAIL}/{listing_id}")
    listing = (data.get("data") or {}).get("listing") or {}
    attrs = listing.get("attributes") or {}
    links = listing.get("links") or {}
    canon = links.get("canonical") or ""

    title = clean(attrs.get("title"))
    contractor_m = re.search(r'"contractors_name":"((?:\\.|[^"\\])*)"', canon)
    if contractor_m:
        name = unescape_json_str(contractor_m.group(1))
        if name and len(name) >= 2:
            title = name
    if len(title) < 3:
        return None

    desc = clean(attrs.get("description"))
    phones = phones_from_text(desc)
    author_m = re.search(r'"phone":"([^"]+)"', canon)
    if author_m:
        for p in phones_from_text(author_m.group(1)):
            if p not in phones:
                phones.append(p)
    # also from canon body (avoid lat/lng by requiring phone near Call/тел/author)
    for p in phones_from_text(canon):
        if p not in phones:
            # skip if looks like coordinate fragment already filtered
            phones.append(p)
    phones = phones[:4]
    if not phones:
        return None

    addr = attrs.get("address") or {}
    if isinstance(addr, str):
        try:
            addr = json.loads(addr)
        except json.JSONDecodeError:
            addr = {"full": addr}
    city = clean(addr.get("city") or "") or None
    address = clean(addr.get("full") or "") or None
    region = clean(addr.get("state") or "") or "USA"

    # to4ka often leaves city empty while full address has «…, Нью-Йорк, NY, USA»
    if not city and address:
        m = re.search(
            r",\s*([^,]+?)\s*,\s*([A-Za-zА-Яа-яЁё]{2})\s*(?:,\s*(?:USA|United States))?\s*$",
            address,
            re.I,
        )
        if m:
            city = clean(m.group(1)) or None
            if region in {"", "USA"} and len(m.group(2)) == 2:
                region = m.group(2).upper()
        else:
            m2 = re.match(
                r"^([^,]+?)\s*,\s*(?:USA|United States|[A-Z]{2})\s*$",
                address,
                re.I,
            )
            if m2 and not re.search(r"\d", m2.group(1) or ""):
                city = clean(m2.group(1)) or None

    RU_CITY = {
        "нью-йорк": "New York",
        "лос-анджелес": "Los Angeles",
        "сан-франциско": "San Francisco",
        "сан-диего": "San Diego",
        "чикаго": "Chicago",
        "бостон": "Boston",
        "майами": "Miami",
        "филадельфия": "Philadelphia",
        "сакраменто": "Sacramento",
        "глендейл": "Glendale",
        "сиэтл": "Seattle",
        "сиэттл": "Seattle",
    }
    if city:
        mapped = RU_CITY.get(city.lower().replace("ё", "е"))
        if mapped:
            city = mapped

    website = None
    url_m = re.search(r'"url":"(https?:\\/\\/[^"]+)"', canon)
    if url_m:
        website = url_m.group(1).replace("\\/", "/")
        if "to4ka.us" in website or "api.to4ka" in website:
            website = None

    source_url = links.get("view")
    if source_url and source_url.startswith("/"):
        source_url = "https://to4ka.us" + source_url
    if not source_url:
        source_url = f"https://to4ka.us/catalog/all-usa"

    cover = None
    # cover from relations details if present — skip heavy

    biz_type_m = re.search(r'"business_type":"([^"]+)"', canon)
    cat = clean((biz_type_m.group(1) if biz_type_m else "business").replace("-", " "))

    uuid = attrs.get("uuid") or listing_id
    cluster = "t4k-" + hashlib.sha1(str(uuid).encode("utf-8")).hexdigest()[:16]
    entity = "professional" if PERSON_HINTS.search(f"{title} {desc} {cat}") else "business"

    return {
        "cluster_key": cluster,
        "display_name": title[:160],
        "entity_type_guess": entity,
        "target_bucket": "yellow_pages",
        "directory_source": "to4ka",
        "category_slug": attrs.get("category_alias") or "business",
        "category_guess": cat[:80],
        "city": city,
        "address": address,
        "phones": phones,
        "emails": [],
        "instagram": [],
        "websites": [website] if website else [],
        "cover_image_url": cover,
        "images": [],
        "short_description": (desc or title)[:280],
        "description": (desc or title)[:4000],
        "source_url": source_url,
        "source_channel": "other",
        "source_groups": ["to4ka.us"],
        "region": region if len(region) <= 40 else "USA",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=2000)
    parser.add_argument("--max-pages", type=int, default=200)
    parser.add_argument("--sleep", type=float, default=0.02)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument(
        "--start-cursor",
        default="",
        help="Resume feed from this next_cursor value (e.g. MTQz)",
    )
    args = parser.parse_args()

    by_key: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, str]] = []
    cursor: str | None = args.start_cursor.strip() or None
    pages = 0
    workers = max(1, min(args.workers, 16))

    while pages < args.max_pages and len(by_key) < args.limit:
        try:
            payload = fetch_feed(cursor)
        except Exception as exc:  # noqa: BLE001
            errors.append({"cursor": cursor or "", "error": str(exc)})
            print(f"ERR feed: {exc}", flush=True)
            break

        pages += 1
        items = [x for x in (payload.get("items") or []) if x.get("type") == "listing"]
        ids = [str(it.get("id")) for it in items if it.get("id")]
        room = args.limit - len(by_key)
        ids = ids[:room]
        new = 0

        def _one(lid: str) -> dict[str, Any] | None:
            try:
                return parse_detail(lid)
            except Exception as exc:  # noqa: BLE001
                errors.append({"id": lid, "error": str(exc)})
                return None

        if workers == 1:
            for lid in ids:
                card = _one(lid)
                if card and card["cluster_key"] not in by_key:
                    by_key[card["cluster_key"]] = card
                    new += 1
                if args.sleep:
                    time.sleep(args.sleep)
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futs = {pool.submit(_one, lid): lid for lid in ids}
                for fut in as_completed(futs):
                    card = fut.result()
                    if card and card["cluster_key"] not in by_key:
                        by_key[card["cluster_key"]] = card
                        new += 1

        pag = (payload.get("meta") or {}).get("pagination") or {}
        print(
            f"cursor={cursor or 'start'} page={pag.get('current_page')} "
            f"+{new} total={len(by_key)} errs={len(errors)} has_more={pag.get('has_more')}",
            flush=True,
        )
        if args.sleep:
            time.sleep(args.sleep)
        if not pag.get("has_more"):
            break
        nxt = pag.get("next_cursor")
        if not nxt or nxt == cursor:
            break
        cursor = nxt

    cards = list(by_key.values())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = {
        "source": "https://to4ka.us/catalog/all-usa",
        "directory_source": "to4ka",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "errors": errors[:50],
        "cards": cards,
    }
    text = json.dumps(out, ensure_ascii=False, indent=2)
    (OUT / f"to4ka_{stamp}.json").write_text(text, encoding="utf-8")
    (OUT / "to4ka_latest.json").write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(OUT / "to4ka_latest.json"),
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
