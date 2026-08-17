#!/usr/bin/env python3
"""Scrape Russian Bazaar (russian-bazaar.com) service featured ads.

Only keeps ads with a parseable business/service name + phone.
Jobs / help-wanted are skipped (pilot: services only).

Usage:
  python3 scripts/business-enrich/scrape_russian_bazaar.py --pilot 5
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

OUT = Path(__file__).resolve().parent / "data" / "yellow_pages"
OUT.mkdir(parents=True, exist_ok=True)

BASE = "http://russian-bazaar.com"
# USA parent list id used by service categories on the site.
USA_LIST = "595"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
}

PHONE_RE = re.compile(r"\b(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b")
PERSON_HINTS = re.compile(
    r"\b(md|dmd|dds|attorney|lawyer|realtor|notary|"
    r"доктор|д-р|юрист|адвокат|нотариус|риэлтор|риелтор|бухгалтер)\b",
    re.I,
)

# Service categories only (not Help wanted / Real estate / Personals).
SERVICE_CATEGORIES: list[tuple[str, str, str]] = [
    ("105526", "legal", "юристы / иммиграция"),
    ("105528", "health", "медицина"),
    ("778", "home_services", "ремонт"),
    ("777", "moving", "перевозки"),
    ("784", "beauty", "красота"),
    ("772", "legal", "нотариус / переводы"),
    ("105532", "education", "автошколы"),
    ("51321", "education", "репетиторы"),
    ("776", "services", "посылки"),
    ("147938", "services", "прочие услуги"),
    ("274510", "services", "веб-услуги"),
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
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"GET {url}: {last}")


def extract_name(block: str, white_text: str, phones: list[str]) -> str | None:
    # 1) Visible white caption after GIF (best signal)
    name = white_text
    for p in phones:
        digits = re.sub(r"\D", "", p)
        variants = {p, digits}
        if len(digits) == 11 and digits.startswith("1"):
            variants.add(digits[1:])
        if len(digits) == 10:
            variants.add("1" + digits)
        for v in variants:
            if v:
                name = name.replace(v, " ")
        name = PHONE_RE.sub(" ", name)
    name = re.sub(r"\s+", " ", name).strip(" ,.|/;")
    if re.search(r"[A-Za-zА-Яа-яЁё]{3,}", name) and len(name) >= 3:
        return name[:160]

    # 2) alt text on images
    for alt in re.findall(r'alt="([^"]+)"', block):
        alt_c = clean(alt)
        if len(alt_c) >= 3 and not alt_c.isdigit() and not PHONE_RE.fullmatch(alt_c):
            return alt_c[:160]

    # 3) GIF filename stem without phone digits
    for src in re.findall(r'src="([^"]+)"', block):
        base = src.rsplit("/", 1)[-1]
        base = re.sub(r"\.(gif|jpg|png|jpeg)$", "", base, flags=re.I)
        base = re.sub(r"_\d+$", "", base)
        base = re.sub(r"\d{10,}", " ", base)
        base = base.replace("_", " ").replace("-", " ")
        base = re.sub(r"\s+", " ", base).strip()
        if len(base) >= 3 and re.search(r"[A-Za-zА-Яа-яЁё]{3,}", base):
            return base.title()[:160]
    return None


def parse_blocks(
    html: str,
    cat_id: str,
    cat_slug: str,
    cat_guess: str,
    list_url: str,
) -> list[dict[str, Any]]:
    blocks = re.findall(
        r'<div class="annRad">([\s\S]*?)<div class="clear"></div>\s*</div>',
        html,
    )
    out: list[dict[str, Any]] = []
    for block in blocks:
        white = " ".join(
            clean(w)
            for w in re.findall(r"color:white[^>]*>([\s\S]*?)</div>", block)
        )
        blob = white + " " + clean(block)
        phones: list[str] = []
        for a, b, c in PHONE_RE.findall(blob):
            p = normalize_phone(f"{a}{b}{c}")
            if p and p not in phones:
                phones.append(p)
        if not phones:
            continue
        name = extract_name(block, white, phones)
        if not name:
            continue
        # Skip pure phone captions that slipped through
        if not re.search(r"[A-Za-zА-Яа-яЁё]{3,}", name):
            continue

        entity = (
            "professional"
            if PERSON_HINTS.search(f"{name} {cat_guess}")
            else "business"
        )
        key_src = f"rbz:{cat_id}:{phones[0]}:{name.lower()}"
        cluster = "rbz-" + hashlib.sha1(key_src.encode("utf-8")).hexdigest()[:16]
        out.append(
            {
                "cluster_key": cluster,
                "display_name": name[:160],
                "entity_type_guess": entity,
                "target_bucket": "yellow_pages",
                "directory_source": "russian_bazaar",
                "category_slug": cat_slug,
                "category_guess": cat_guess,
                "city": "New York, NY",
                "address": None,
                "phones": phones[:4],
                "emails": [],
                "instagram": [],
                "websites": [],
                "cover_image_url": None,
                "images": [],
                "short_description": f"{name}. {cat_guess}. Источник: Русский базар.",
                "description": f"{name}. Категория: {cat_guess}. Телефон: {', '.join(phones)}.",
                "source_url": list_url,
                "source_channel": "other",
                "source_groups": ["Русский базар"],
                "region": "New York",
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilot", type=int, default=0, help="Max cards for pilot")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=0.2)
    args = parser.parse_args()

    target = args.pilot or args.limit or 50
    by_key: dict[str, dict[str, Any]] = {}
    seen_cats: set[str] = set()
    errors: list[dict[str, str]] = []
    diversify = bool(args.pilot)

    for cat_id, cat_slug, cat_guess in SERVICE_CATEGORIES:
        if len(by_key) >= target:
            break
        url = f"{BASE}/ru/ad-list/{USA_LIST}/{cat_id}.htm"
        try:
            html = get_text(url)
        except Exception as exc:  # noqa: BLE001
            errors.append({"url": url, "error": str(exc)})
            continue
        cards = parse_blocks(html, cat_id, cat_slug, cat_guess, url)
        added = 0
        for card in cards:
            if len(by_key) >= target:
                break
            if diversify and card["category_slug"] in seen_cats:
                # allow second named card in same cat if pilot not filled and name unique
                if sum(1 for c in by_key.values() if c["category_slug"] == card["category_slug"]) >= 1:
                    # still allow up to 2 from legal where names exist
                    if card["category_slug"] != "legal" or sum(
                        1
                        for c in by_key.values()
                        if c["category_slug"] == "legal"
                    ) >= 2:
                        continue
            if card["cluster_key"] in by_key:
                continue
            by_key[card["cluster_key"]] = card
            seen_cats.add(card["category_slug"])
            added += 1
        print(
            f"{cat_id} {cat_guess}: parsed={len(cards)} +{added} total={len(by_key)}",
            flush=True,
        )
        time.sleep(args.sleep)

    cards = list(by_key.values())[:target]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "source": f"{BASE}/ru/ad-view-cat.htm",
        "directory_source": "russian_bazaar",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "errors": errors[:40],
        "cards": cards,
        "note": (
            "Many RB featured ads are phone-only GIFs; pilot keeps only "
            "cards with a parseable name + phone. Jobs skipped."
        ),
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    (OUT / f"russian_bazaar_{stamp}.json").write_text(text, encoding="utf-8")
    (OUT / "russian_bazaar_latest.json").write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(OUT / "russian_bazaar_latest.json"),
                "count": len(cards),
                "names": [c["display_name"] for c in cards],
                "categories": sorted({c["category_slug"] for c in cards}),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if cards else 1


if __name__ == "__main__":
    raise SystemExit(main())
