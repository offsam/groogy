#!/usr/bin/env python3
"""Scrape Zerkalo Minnesota Russian Yellow Pages into cards.

Pages are Weebly HTML with HTML-encoded Cyrillic. Entries look like:
  NAME. phone / description

Usage:
  python3 scripts/business-enrich/scrape_zerkalo_mn.py
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

BASE = "https://www.zerkalomn.com"
INDEX = f"{BASE}/yellow-pages1.html"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
}

PHONE_RE = re.compile(
    r"(?<!\d)(\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4})(?!\d)"
)
ENTRY_HEAD_RE = re.compile(
    r"([A-ZА-ЯЁ0-9][^.?/\n]{2,100}?)"
    r"(?:\.|\s)+"
    r"(\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4})",
    re.U,
)

CATEGORY_MAP = {
    "lawyers": ("legal", "юристы"),
    "immigration": ("legal", "юристы / иммиграция"),
    "medical": ("health", "медицина"),
    "dental": ("health", "стоматология"),
    "beauty": ("beauty", "красота"),
    "real-estate": ("real_estate", "недвижимость"),
    "restaurant": ("food", "рестораны"),
    "grocery": ("food", "продукты"),
    "insurance": ("finance", "страхование"),
    "tax": ("finance", "налоги / финансы"),
    "car": ("auto", "авто"),
    "pharmacy": ("health", "аптеки"),
    "store": ("retail", "магазины"),
    "child": ("education", "дети / образование"),
    "kids": ("education", "дети / образование"),
    "computer": ("tech", "компьютеры"),
    "construction": ("home_services", "строительство / ремонт"),
    "adult": ("care", "уход за пожилыми"),
    "funeral": ("other", "ритуальные услуги"),
    "flower": ("retail", "цветы"),
    "jewel": ("retail", "ювелиры"),
    "interpreter": ("legal", "переводы"),
    "job": ("jobs", "работа"),
    "media": ("media", "СМИ"),
    "religious": ("other", "религия"),
    "religion": ("other", "религия"),
    "house": ("home_services", "услуги для дома"),
    "information": ("other", "справочные"),
    "travel": ("travel", "туризм"),
}


def clean(s: str | None) -> str:
    t = unescape(re.sub(r"<[^>]+>", " ", s or ""))
    t = t.replace("\xa0", " ").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", t).strip()


def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def fetch(url: str, retries: int = 3) -> str:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as resp:
                return resp.read().decode("utf-8", "replace")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def guess_category(url: str) -> tuple[str | None, str]:
    slug = urlparse(url).path.lower()
    for key, (cat_slug, label) in CATEGORY_MAP.items():
        if key in slug:
            return cat_slug, label
    name = slug.rsplit("/", 1)[-1].replace(".html", "").replace("-", " ")
    return None, name[:60] or "услуги"


def category_urls(index_html: str) -> list[str]:
    urls = sorted(
        set(
            re.findall(
                r'href="((?:https?://(?:www\.)?zerkalomn\.com)?/[^"]+\.html)"',
                index_html,
                re.I,
            )
        )
    )
    out: list[str] = []
    for u in urls:
        full = urljoin(BASE + "/", u)
        host = (urlparse(full).hostname or "").lower()
        if "zerkalomn.com" not in host:
            continue
        path = urlparse(full).path.lower()
        if "yellow-pages" in path or path in {"/", "/index.html"}:
            continue
        if any(x in path for x in ("news", "about", "contact", "advertise")):
            continue
        # skip weebly junk numeric slug pages unless museum-like content later
        out.append(full)
    return out


def page_text(html: str) -> str:
    paras = re.findall(
        r'<div[^>]*class="[^"]*paragraph[^"]*"[^>]*>(.*?)</div>',
        html,
        re.I | re.S,
    )
    if paras:
        blob = "\n".join(clean(p) for p in paras)
        if PHONE_RE.search(blob):
            return blob
    return clean(html)


def parse_entries(
    html: str,
    *,
    source_url: str,
    category_guess: str,
    category_slug: str | None,
) -> list[dict[str, Any]]:
    work = page_text(html)
    matches = list(ENTRY_HEAD_RE.finditer(work))
    cards: list[dict[str, Any]] = []
    seen_phones: set[str] = set()

    for i, m in enumerate(matches):
        name = clean(m.group(1))
        name = re.sub(r"[\s\.,;:]+$", "", name)
        if len(name) < 3 or len(name) > 120:
            continue
        if "copyright" in name.lower() or "zerkalo" in name.lower():
            continue
        if "нажмите на название" in name.lower():
            continue

        phone = normalize_phone(m.group(2))
        if not phone or phone in seen_phones:
            continue
        seen_phones.add(phone)

        end = matches[i + 1].start() if i + 1 < len(matches) else len(work)
        tail = work[m.end() : end].strip()
        if tail.startswith("/"):
            tail = tail[1:].strip()
        # Stop description at next ALLCAPS name if any leftover
        desc = clean(tail)[:400]

        cluster = "zmn-" + hashlib.sha1(f"{name}|{phone}".encode("utf-8")).hexdigest()[:16]
        entity = (
            "professional"
            if re.search(
                r"адвокат|юрист|доктор|д-р|риэлтор|риелтор|attorney|lawyer|dds|dmd|\bmd\b",
                f"{name} {category_guess}",
                re.I,
            )
            else "business"
        )
        cards.append(
            {
                "cluster_key": cluster,
                "display_name": name[:160],
                "entity_type_guess": entity,
                "target_bucket": "yellow_pages",
                "directory_source": "zerkalo_mn",
                "category_slug": category_slug,
                "category_guess": category_guess,
                "city": "Minneapolis",
                "address": None,
                "phones": [phone],
                "emails": [],
                "instagram": [],
                "websites": [],
                "cover_image_url": None,
                "images": [],
                "short_description": (desc or category_guess)[:280],
                "description": desc or name,
                "source_url": source_url,
                "source_channel": "other",
                "source_groups": ["Zerkalo Minnesota"],
                "region": "Minnesota",
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    return cards


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=800)
    parser.add_argument("--sleep", type=float, default=0.25)
    args = parser.parse_args()

    index_html = fetch(INDEX)
    urls = category_urls(index_html)
    try:
        yp = fetch(f"{BASE}/yellow-pages.html")
        for u in category_urls(yp):
            if u not in urls:
                urls.append(u)
    except Exception:  # noqa: BLE001
        pass

    print(f"categories: {len(urls)}", flush=True)
    by_key: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, str]] = []

    for url in urls:
        if len(by_key) >= args.limit:
            break
        cat_slug, cat_label = guess_category(url)
        try:
            html = fetch(url)
        except Exception as exc:  # noqa: BLE001
            errors.append({"url": url, "error": str(exc)})
            print(f"ERR {url}: {exc}", flush=True)
            continue
        cards = parse_entries(
            html,
            source_url=url,
            category_guess=cat_label,
            category_slug=cat_slug,
        )
        new = 0
        for c in cards:
            if c["cluster_key"] not in by_key:
                by_key[c["cluster_key"]] = c
                new += 1
            if len(by_key) >= args.limit:
                break
        print(
            f"  {cat_label}: +{new} (total {len(by_key)}) from {urlparse(url).path}",
            flush=True,
        )
        time.sleep(args.sleep)

    cards = list(by_key.values())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "source": INDEX,
        "directory_source": "zerkalo_mn",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "errors": errors,
        "cards": cards,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    (OUT / f"zerkalo_mn_{stamp}.json").write_text(text, encoding="utf-8")
    latest = OUT / "zerkalo_mn_latest.json"
    latest.write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(latest),
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
