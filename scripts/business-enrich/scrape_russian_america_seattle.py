#!/usr/bin/env python3
"""Scrape Russian Seattle Yellow Pages (russianseattle.com/yellow_r.htm).

The modern shared YP at yp.russianamerica.com is broken; Seattle still hosts
a large static directory (windows-1251 HTML tables).

Usage:
  python3 scripts/business-enrich/scrape_russian_america_seattle.py
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

OUT = Path(__file__).resolve().parent / "data" / "yellow_pages"
OUT.mkdir(parents=True, exist_ok=True)

SOURCE_URL = "https://www.russianseattle.com/yellow_r.htm"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

CATEGORY_MAP = [
    (r"health|медицин|доктор|dentist|chiro", ("health", "медицина / здоровье")),
    (r"auto repair|ремонт авто", ("auto", "автосервис")),
    (r"driver school|автошкол", ("education", "обучение")),
    (r"architecture|construction|home repair|строител|ремонт", ("home_services", "дом / ремонт")),
    (r"real estate|недвижим", ("real_estate", "недвижимость")),
    (r"law firm|юридич|lawyer", ("legal", "юристы")),
    (r"financ|mortgage|деньги|кредит", ("finance", "финансы")),
    (r"insurance|страхов", ("insurance", "страховки")),
    (r"fine art|изобразител|art ", ("creative", "творчество")),
    (r"invest", ("finance", "инвестиции")),
    (r"account|tax|налог|бухгалтер", ("finance", "бухгалтерия / налоги")),
    (r"import|export|freight|транспорт|перевоз", ("travel", "логистика")),
    (r"mass media|средств.*информац|media", ("creative", "СМИ")),
    (r"music|музык", ("events", "музыка")),
    (r"restaurant|cafe|ресторан|кафе", ("food", "рестораны / кафе")),
    (r"food store|продовольств|delicatessen|магазин", ("food", "продукты")),
    (r"other store|прочие магазин", ("food", "магазины")),
    (r"technical|техническ", ("home_services", "техуслуги")),
    (r"translation|перевод", ("legal", "переводы")),
    (r"travel|путешеств|турагент", ("travel", "турагентства")),
    (r"family|children|семья|дети|садик", ("childcare", "семья / дети")),
    (r"education|образован|школ", ("education", "обучение")),
    (r"adult care|уход.*пожил|adult family", ("health", "уход")),
    (r"fitness|sport|физкульт|спорт", ("fitness", "спорт")),
    (r"official|официальн", ("other", "организации")),
    (r"television|телевид", ("creative", "ТВ")),
    (r"religio|религиоз", ("other", "церкви")),
    (r"other service|другие услуг", ("other", "прочие услуги")),
]

PHONE_RE = re.compile(r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}")
EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.I)
CITY_RE = re.compile(
    r"\b(Seattle|Bellevue|Redmond|Kirkland|Lynnwood|Everett|Tacoma|"
    r"Renton|Kent|Federal Way|Bothell|Shoreline|Issaquah|Sammamish|"
    r"Mountlake Terrace|Bellingham|Portland|Vancouver)\b",
    re.I,
)
PERSON_RE = re.compile(
    r"\b(realtor|broker|lawyer|attorney|dds|dmd|md|cpa|notary|"
    r"doctor|dr\.|адвокат|риэлтор|нотариус)\b",
    re.I,
)
BUSINESS_RE = re.compile(
    r"\b(llc|inc|corp|company|clinic|office|school|studio|store|"
    r"restaurant|cafe|agency|firm|center|centre|church|home)\b",
    re.I,
)


def clean(s: str) -> str:
    s = unescape(s or "")
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" \t\n\r·•-|")
    return s


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
    u = u.replace(" ", "")
    if u.startswith("www."):
        u = "https://" + u
    if not re.match(r"^https?://", u, re.I):
        if "." in u and " " not in u and "@" not in u:
            u = "https://" + u
        else:
            return None
    host = (urlparse(u).hostname or "").lower()
    if any(x in host for x in ("russianseattle", "russianamerica", "mailto")):
        return None
    return u.rstrip("/")


def map_category(heading: str) -> tuple[str, str]:
    h = heading.lower()
    for pat, mapped in CATEGORY_MAP:
        if re.search(pat, h, re.I):
            return mapped
    return ("other", clean(heading)[:60] or "услуги")


def guess_entity(name: str, text: str) -> str:
    blob = f"{name} {text}"
    if PERSON_RE.search(blob) and not BUSINESS_RE.search(name):
        return "professional"
    if BUSINESS_RE.search(blob):
        return "business"
    if re.match(r"^[A-ZА-ЯЁ][a-zа-яё]+\s+[A-ZА-ЯЁ]", name):
        return "professional"
    return "business"


def strip_comments(html: str) -> str:
    return re.sub(r"<!--.*?-->", "", html, flags=re.S)


def fetch() -> str:
    req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("windows-1251", errors="replace")


def parse_cards(html: str) -> list[dict[str, Any]]:
    html = strip_comments(html)
    # Split by category headings (SIZE="5" underlined titles)
    parts = re.split(
        r'(?i)<font[^>]*size\s*=\s*["\']?5["\']?[^>]*>\s*<u>(.*?)</u>\s*</font>',
        html,
    )
    # parts[0]=preamble, then (heading, body, heading, body, ...)
    sections: list[tuple[str, str]] = []
    if len(parts) == 1:
        sections.append(("Yellow Pages", html))
    else:
        for i in range(1, len(parts), 2):
            heading = clean(parts[i])
            body = parts[i + 1] if i + 1 < len(parts) else ""
            sections.append((heading, body))

    cards: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for heading, body in sections:
        cat_slug, cat_label = map_category(heading)
        # Table rows with 3–4 tds
        for tr in re.findall(r"(?is)<tr\b[^>]*>(.*?)</tr>", body):
            tds = re.findall(r"(?is)<td\b[^>]*>(.*?)</td>", tr)
            if len(tds) < 3:
                continue
            # Usually: [icon?, name, phone, address] — take last 3 meaningful
            cells = [clean(td) for td in tds]
            cells = [c for c in cells if c and c != "&nbsp;"]
            if len(cells) < 2:
                continue

            # Heuristic: name cell is longest text without being only a phone
            name = ""
            phone_cell = ""
            addr_cell = ""
            for c in cells:
                if PHONE_RE.search(c) and not name:
                    # might be phone-only cell
                    if len(c) < 80 and not addr_cell:
                        phone_cell = phone_cell or c
                        continue
                if re.search(r"\bWA\b|\b\d{5}\b|Seattle|Bellevue|Avenue|Ave\.|Street|St\.", c, re.I):
                    if not addr_cell or len(c) > len(addr_cell):
                        addr_cell = c
                    continue
                if not name or (len(c) > len(name) and not PHONE_RE.fullmatch(c.replace(" ", ""))):
                    # prefer bold-looking early cell — already cleaned
                    if len(c) >= 3 and not c.lower().startswith("возврат"):
                        if not name:
                            name = c
                        elif len(c) > len(name) and "@" not in c:
                            # description often appended in same cell after name
                            pass

            # Better: use raw first content td after icon
            raw_cells = tds
            if len(raw_cells) >= 4:
                name_html, phone_html, addr_html = raw_cells[-3], raw_cells[-2], raw_cells[-1]
            elif len(raw_cells) == 3:
                name_html, phone_html, addr_html = raw_cells[0], raw_cells[1], raw_cells[2]
            else:
                continue

            name_text = clean(name_html)
            # Prefer <b>Name</b> for title; fall back to first line
            bold = re.search(r"(?is)<b[^>]*>(.*?)</b>", name_html)
            name_parts = re.split(r"<br\s*/?>", name_html, flags=re.I)
            head = clean(bold.group(1)) if bold else clean(name_parts[0] if name_parts else name_text)
            # Cut long marketing blurbs glued into the title
            head = re.split(r"[.!?]\s+", head, maxsplit=1)[0].strip()
            if len(head) > 70:
                head = head[:67].rstrip() + "…"
            if not head or len(head) < 2:
                continue
            if re.match(r"^(возврат|наименование|name of business|телефоны|адрес)", head, re.I):
                continue

            desc = clean(name_html)
            if desc.startswith(head.rstrip("…")):
                desc = desc[len(head.rstrip("…")) :].strip(" -—:")
            desc = desc[:800]

            phone_text = clean(phone_html)
            addr_text = clean(addr_html)

            phones: list[str] = []
            for raw in PHONE_RE.findall(phone_text + " " + name_text + " " + addr_text):
                p = normalize_phone(raw)
                if p and p not in phones:
                    phones.append(p)

            emails = []
            for raw in EMAIL_RE.findall(phone_text + " " + name_text + " " + addr_text + " " + tr):
                e = raw.lower()
                if e not in emails and "russianseattle" not in e:
                    emails.append(e)

            websites: list[str] = []
            for href in re.findall(r'href=["\']([^"\']+)["\']', tr, re.I):
                if href.lower().startswith("mailto:"):
                    continue
                w = normalize_website(urljoin(SOURCE_URL, href))
                if w and w not in websites:
                    websites.append(w)
            # bare www in text
            for m in re.findall(r"(?:https?://|www\.)[^\s<>\"']+", phone_text + " " + addr_text + " " + name_text):
                w = normalize_website(m)
                if w and w not in websites:
                    websites.append(w)

            city = None
            cm = CITY_RE.search(addr_text) or CITY_RE.search(name_text)
            if cm:
                city = cm.group(1)

            address = addr_text or None
            if address and len(address) > 160:
                address = address[:160]

            entity = guess_entity(head, desc)
            key_src = f"{head}|{phones[0] if phones else ''}|{address or ''}|{heading}"
            cluster = "rasea-" + hashlib.sha1(key_src.encode("utf-8")).hexdigest()[:16]
            if cluster in seen_keys:
                continue
            # Skip empty shells (no contact, no address, tiny name)
            if not phones and not emails and not websites and not address:
                if len(head) < 4:
                    continue

            seen_keys.add(cluster)
            cards.append(
                {
                    "cluster_key": cluster,
                    "display_name": head[:120],
                    "entity_type_guess": entity,
                    "target_bucket": "yellow_pages",
                    "directory_source": "russian_seattle",
                    "category_slug": cat_slug,
                    "category_guess": cat_label,
                    "city": city or "Seattle",
                    "address": address,
                    "phones": phones,
                    "emails": emails,
                    "instagram": [],
                    "websites": websites[:8],
                    "cover_image_url": None,
                    "images": [],
                    "short_description": (desc or cat_label)[:280],
                    "description": desc or head,
                    "source_url": f"{SOURCE_URL}#{cat_slug}",
                    "source_channel": "other",
                    "source_groups": [
                        "Russian America",
                        "Russian Seattle Yellow Pages",
                    ],
                    "region": "Seattle / Washington",
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                }
            )

    return cards


def main() -> int:
    html = fetch()
    cards = parse_cards(html)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "source": SOURCE_URL,
        "network": "russianamerica.com",
        "city_hub": "seattle",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cards),
        "cards": cards,
    }
    path = OUT / f"ra_seattle_{stamp}.json"
    latest = OUT / "ra_seattle_latest.json"
    # Also merge into a combined latest for import convenience
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    latest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    with_phone = sum(1 for c in cards if c["phones"])
    print(
        json.dumps(
            {
                "wrote": str(latest),
                "count": len(cards),
                "with_phone": with_phone,
                "with_web": sum(1 for c in cards if c["websites"]),
                "sample": [
                    {
                        "name": c["display_name"],
                        "cat": c["category_guess"],
                        "city": c["city"],
                        "phones": c["phones"][:1],
                    }
                    for c in cards[:8]
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
