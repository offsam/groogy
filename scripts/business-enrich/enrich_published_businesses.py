#!/usr/bin/env python3
"""Enrich already-published approved businesses (Veronica-style).

Sources (fill-empty only):
  1. Business website (JSON-LD + meta + services/pricing pages)
  2. Instagram (og tags) if URL known / found on site
  3. Nominatim geocode from street address → lat/lng + Google Maps URL
  4. Yelp search (name + city) → yelp_url when unique match
  5. Price lines from site → business_offers (service)

Never overwrites non-empty business fields. Skips junk websites
(Etsy, Turo, Apple Maps deep links, Instagram-as-website, etc.).

Usage:
  python3 scripts/business-enrich/enrich_published_businesses.py --dry-run --limit 5
  python3 scripts/business-enrich/enrich_published_businesses.py --apply --limit 5
  python3 scripts/business-enrich/enrich_published_businesses.py --apply --slug russ-flooring
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from address_geo import resolve_address_geo  # noqa: E402
from web_enrichment import (  # noqa: E402
    extract_payment_methods,
    extract_instagram_profile,
    extract_website_profile,
    extract_website_profile_deep,
    is_plausible_service_title,
)
from enrich_resource_queue import (  # noqa: E402
    is_booking_marketing_page,
    is_booking_platform_host,
    is_directory_social,
    run_resource_bfs,
    sanitize_street_line,
)
from shared_hosts import is_shared_non_identity_host  # noqa: E402
from platform_saas_hosts import (  # noqa: E402
    booking_url_from_maybe_saas,
    is_platform_saas_host,
)
from source_record_urls import source_record_urls  # noqa: E402

UA = "Mozilla/5.0 (compatible; KrugiBizEnrich/1.0; +https://krugi.app)"
TIMEOUT = 12
MAX_HTML = 900_000

JUNK_HOST_PARTS = (
    "etsy.com",
    "turo.com",
    "girlscouts.org",
    "digitalcookie.",
    "maps.apple",
    "maps.app.goo.gl",
    "goo.gl/",
    "instagram.com",
    "facebook.com",
    "fb.com",
    "t.me/",
    "wa.me/",
    "linktr.ee",
    "eventbrite.com",
    "vagaro.com/upgradepilates/deals",
    "mercedesbenz",
    "showingnew.com",
    "threadssequins",
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "mama-print.ru",
    "alter.tax",
    "dreem-world.ai",
    "openai.com",
    "book.squareup.com",
    "legalshieldassociate.com",
    "skinovationcleaning.com",  # typo/parked; real clinic is separate
)

PRICE_LINE_RE = re.compile(
    r"(?P<title>[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 &/\-]{2,60}?)\s*"
    r"(?:[-–—:·]|from)?\s*\$?\s*(?P<p1>\d{2,4})(?:\s*[-–—to]+\s*\$?(?P<p2>\d{2,4}))?",
    re.I | re.UNICODE,
)
SERVICE_PATHS = (
    "",
    "/services",
    "/service",
    "/pricing",
    "/prices",
    "/price-list",
    "/menu",
    "/treatments",
    "/our-services",
    "/book-online",
)


def http_get(url: str) -> str | None:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(MAX_HTML + 1)
            if len(raw) > MAX_HTML:
                raw = raw[:MAX_HTML]
            return raw.decode("utf-8", errors="ignore")
    except Exception:
        return None


def host_of(url: str | None) -> str:
    if not url:
        return ""
    raw = url.strip()
    if "://" not in raw:
        raw = "https://" + raw
    try:
        return (urllib.parse.urlparse(raw).hostname or "").lower().removeprefix("www.")
    except Exception:
        return ""


def is_junk_website(url: str | None) -> bool:
    if not url:
        return True
    low = url.lower()
    return any(p in low for p in JUNK_HOST_PARTS)


def normalize_website(url: str | None) -> str | None:
    if not url or is_junk_website(url):
        return None
    u = url.strip()
    if "://" not in u:
        u = "https://" + u
    try:
        p = urllib.parse.urlparse(u)
    except ValueError:
        return None
    if not p.netloc or "." not in p.netloc:
        return None
    return u


def looks_like_street(address: str | None) -> bool:
    if not address:
        return False
    # A blob that still carries a phone or e-mail is a contact line, not a street
    if not sanitize_street_line(address):
        return False
    if re.fullmatch(r"[A-Za-z .'-]+,\s*[A-Z]{2}(,\s*\d{5})?", address.strip()):
        return False
    return True


def scraped_address(raw: Any) -> tuple[str | None, dict[str, str | None]]:
    """(street line, parts) for a scraped address; contacts stripped out.

    Returns (None, {}) for contact blobs, (None, parts) for city-only values so
    city / state are still usable without inventing a street.
    """
    value = str(raw or "").strip()
    if not value:
        return None, {}
    street = sanitize_street_line(value)
    if street:
        return clean_street_typos(street), parse_address_parts(street)
    if re.search(r"@|\+?\d[\d()\-.\s]{7,}\d", value):
        return None, {}
    return None, parse_address_parts(value)


def clean_street_typos(address: str) -> str:
    a = address
    a = re.sub(r"\bPrkw\b", "Parkway", a, flags=re.I)
    a = re.sub(r"\bPkwy\b", "Parkway", a, flags=re.I)
    a = re.sub(r"\bAve\b", "Avenue", a, flags=re.I)
    return a


def is_junk_email(email: str) -> bool:
    e = (email or "").lower().strip()
    if not e or "@" not in e:
        return True
    if re.search(r"@(?:dikidi|glossgenius|fresha|vagaro|booksy)\.", e):
        return True
    bad = (
        "godaddy.com",
        "example.com",
        "email.com",
        "sentry.io",
        "wixpress.com",
        "squarespace.com",
        "eyebytes.com",
        "ndiscovered.com",
        # Booking / directory SaaS corporate inboxes — never the salon's.
        "dikidi.net",
        "dikidi.app",
        "glossgenius.com",
        "booksy.com",
        "vagaro.com",
        "squareup.com",
        "calendly.com",
        "fresha.com",
    )
    domain = e.split("@", 1)[-1]
    return any(domain == b or domain.endswith("." + b) for b in bad)


def parse_hours_spec_blob(hours_raw: str | None) -> dict[str, Any] | None:
    """Parse stringified OpeningHoursSpecification chunks from web_enrichment."""
    if not hours_raw or "OpeningHoursSpecification" not in hours_raw:
        return None
    day_map = {
        "sunday": 0,
        "monday": 1,
        "tuesday": 2,
        "wednesday": 3,
        "thursday": 4,
        "friday": 5,
        "saturday": 6,
    }
    weekly: dict[int, dict[str, Any]] = {d: {"day": d, "closed": True} for d in range(7)}
    found = False
    # crude: dayOfWeek': ['Monday'...] opens': '09:00' closes': '17:00'
    for chunk in hours_raw.split("};"):
        days = re.findall(
            r"'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)'",
            chunk,
            re.I,
        )
        op = re.search(r"'opens':\s*'(\d{2}:\d{2})'", chunk)
        cl = re.search(r"'closes':\s*'(\d{2}:\d{2})'", chunk)
        if not days or not op or not cl:
            continue
        opens, closes = op.group(1), cl.group(1)
        if opens == "00:00" and closes == "00:00":
            for dname in days:
                weekly[day_map[dname.lower()]] = {"day": day_map[dname.lower()], "closed": True}
                found = True
            continue
        for dname in days:
            weekly[day_map[dname.lower()]] = {
                "day": day_map[dname.lower()],
                "open": opens,
                "close": closes,
            }
            found = True
    if not found:
        return None
    return {"timezone": "America/Los_Angeles", "weekly": [weekly[d] for d in range(7)]}


def parse_address_parts(address: str) -> dict[str, str | None]:
    """Best-effort split '230 E 17th St #150, Costa Mesa, CA 92627'."""
    parts = [p.strip() for p in address.split(",") if p.strip()]
    out: dict[str, str | None] = {
        "address_line": None,
        "city": None,
        "region": None,
        "state_code": None,
    }
    if not parts:
        return out
    out["address_line"] = parts[0][:160]
    if len(parts) >= 2:
        out["city"] = parts[1][:80]
    if len(parts) >= 3:
        m = re.search(r"\b([A-Z]{2})\b(?:\s+(\d{5}(?:-\d{4})?))?", parts[2])
        if m:
            out["state_code"] = f"US-{m.group(1)}"
            if m.group(2):
                out["region"] = f"{m.group(1)} {m.group(2)}"
            else:
                out["region"] = m.group(1)
        else:
            out["region"] = parts[2][:80]
    return out


def parse_hours_to_weekly(hours_raw: str | None) -> dict[str, Any] | None:
    """Parse simple phrases like 'Monday to Friday, 10:00 AM – 6:00 PM'."""
    if not hours_raw:
        return None
    text = hours_raw.strip()
    # Mon–Fri 10:00 AM–7:00 PM, Sat 09:00 AM–6:00 PM
    day_map = {
        "sun": 0,
        "sunday": 0,
        "mon": 1,
        "monday": 1,
        "tue": 2,
        "tuesday": 2,
        "wed": 3,
        "wednesday": 3,
        "thu": 4,
        "thursday": 4,
        "fri": 5,
        "friday": 5,
        "sat": 6,
        "saturday": 6,
    }

    def to_24(h: str, ampm: str | None) -> str | None:
        try:
            hh, mm = h.split(":")
            hour = int(hh)
            minute = int(mm)
        except Exception:
            return None
        ap = (ampm or "").lower()
        if ap == "pm" and hour < 12:
            hour += 12
        if ap == "am" and hour == 12:
            hour = 0
        if not ampm and hour <= 7:
            # bare "10:00-19:00" already 24h
            pass
        return f"{hour:02d}:{minute:02d}"

    time_re = re.compile(
        r"(\d{1,2}:\d{2})\s*(AM|PM|am|pm)?\s*[-–—]\s*(\d{1,2}:\d{2})\s*(AM|PM|am|pm)?",
        re.I,
    )
    weekly: dict[int, dict[str, Any]] = {d: {"day": d, "closed": True} for d in range(7)}

    # Range: Monday to Friday, 10:00 AM – 6:00 PM
    m = re.search(
        r"(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)"
        r".{0,12}?(?:to|–|-|through)\s*"
        r"(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)"
        r".{0,40}?" + time_re.pattern,
        text,
        re.I,
    )
    if m:
        d1 = day_map[m.group(1).lower()[:3] if len(m.group(1)) > 3 else m.group(1).lower()]
        # map full names
        d1 = day_map.get(m.group(1).lower(), day_map.get(m.group(1).lower()[:3]))
        d2 = day_map.get(m.group(2).lower(), day_map.get(m.group(2).lower()[:3]))
        tm = time_re.search(m.group(0))
        if d1 is not None and d2 is not None and tm:
            op = to_24(tm.group(1), tm.group(2))
            cl = to_24(tm.group(3), tm.group(4))
            if op and cl:
                a, b = sorted([d1, d2])
                for d in range(a, b + 1):
                    weekly[d] = {"day": d, "open": op, "close": cl}
                return {"timezone": "America/Los_Angeles", "weekly": [weekly[d] for d in range(7)]}

    # Per-day snippets
    found = False
    for chunk in re.split(r"[;\n]|,\s*(?=[A-Za-z])", text):
        dm = re.search(
            r"(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)",
            chunk,
            re.I,
        )
        tm = time_re.search(chunk)
        if not dm or not tm:
            continue
        key = dm.group(1).lower()
        day = day_map.get(key) or day_map.get(key[:3])
        op = to_24(tm.group(1), tm.group(2))
        cl = to_24(tm.group(3), tm.group(4))
        if day is None or not op or not cl:
            continue
        weekly[day] = {"day": day, "open": op, "close": cl}
        found = True
    if found:
        return {"timezone": "America/Los_Angeles", "weekly": [weekly[d] for d in range(7)]}
    return None


def search_yelp(name: str, city: str | None) -> str | None:
    loc = (city or "Orange County, CA").strip()
    if loc.lower() in {"orange county", "oc"}:
        loc = "Orange County, CA"
    q = urllib.parse.urlencode({"find_desc": name, "find_loc": loc})
    url = f"https://www.yelp.com/search?{q}"
    html = http_get(url)
    if not html:
        return None
    # biz links
    links = re.findall(r'href="(/biz/[^"?#]+)', html)
    if not links:
        links = re.findall(r"https://www\.yelp\.com(/biz/[^\"?#]+)", html)
    # dedupe
    seen: list[str] = []
    for path in links:
        path = path.split("?")[0]
        if path not in seen:
            seen.append(path)
    if not seen:
        return None
    # Prefer slug that shares tokens with business name
    tokens = [t for t in re.split(r"[^a-z0-9]+", name.lower()) if len(t) >= 4]
    scored: list[tuple[int, str]] = []
    for path in seen[:8]:
        slug = path.rsplit("/", 1)[-1]
        score = sum(1 for t in tokens if t in slug)
        scored.append((score, path))
    scored.sort(key=lambda x: -x[0])
    if scored[0][0] == 0 and len(tokens) >= 2:
        return None  # no token overlap — refuse weak match
    return "https://www.yelp.com" + scored[0][1]


def extract_services_from_html(html: str) -> list[dict[str, Any]]:
    """Heuristic price/service lines from visible text."""
    text = html_lib.unescape(re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I))
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    offers: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ln in lines:
        if "$" not in ln and not re.search(r"\d{2,4}\s*(?:USD|usd)", ln):
            continue
        if len(ln) > 120 or len(ln) < 6:
            continue
        m = PRICE_LINE_RE.search(ln)
        if not m:
            continue
        title = m.group("title").strip(" -–—:·|")
        if len(title) < 3:
            continue
        junk = {"price", "from", "only", "now", "sale", "total", "tax", "usd"}
        if title.lower() in junk:
            continue
        p1 = float(m.group("p1"))
        p2 = float(m.group("p2")) if m.group("p2") else None
        if p1 < 15 or p1 > 5000:
            continue
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        if p2 and p2 > p1:
            offers.append(
                {
                    "title": title[:160],
                    "offer_type": "service",
                    "price_mode": "range",
                    "price_min": p1,
                    "price_max": p2,
                    "short_description": ln[:300],
                }
            )
        else:
            offers.append(
                {
                    "title": title[:160],
                    "offer_type": "service",
                    "price_mode": "fixed",
                    "price_amount": p1,
                    "short_description": ln[:300],
                }
            )
        if len(offers) >= 25:
            break
    return offers


def discover_service_pages(base_url: str) -> list[str]:
    base = normalize_website(base_url)
    if not base:
        return []
    parsed = urllib.parse.urlparse(base)
    root = f"{parsed.scheme}://{parsed.netloc}"
    urls = []
    for path in SERVICE_PATHS:
        urls.append(urllib.parse.urljoin(root + "/", path.lstrip("/")) if path else root + "/")
    # also keep original path
    if base.rstrip("/") not in {u.rstrip("/") for u in urls}:
        urls.insert(0, base)
    # unique preserve order
    out: list[str] = []
    for u in urls:
        if u not in out:
            out.append(u)
    return out[:8]


def slugify(title: str) -> str:
    table = str.maketrans(
        "абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ",
        "abvgdeejzijklmnoprstufhccss y euaABVGDEEJZIJKLMNOPRSTUFHCCSS Y EUA",
    )
    s = title.translate(table).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return (s or "offer")[:50]


def fold_name(s: str) -> str:
    table = str.maketrans(
        "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
        "abvgdeezziyklmnoprstufhccss y eua",
    )
    t = (s or "").lower().replace("ё", "е").translate(table)
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def name_website_compatible(name: str, website: str, site_name: str | None) -> bool:
    """Avoid attaching Skinovation Clinic data onto a random person's card."""
    n = fold_name(name)
    sn = fold_name(site_name or "")
    host = host_of(website).replace("-", " ").replace(".", " ")
    host_compact = host_of(website).replace("-", "").replace(".", "")
    n_tok = {t for t in n.split() if len(t) >= 3}
    s_tok = {t for t in sn.split() if len(t) >= 3}
    h_tok = {
        t
        for t in host.split()
        if len(t) >= 3 and t not in {"https", "http", "www", "com", "net", "org", "edu", "gov"}
    }

    if n and sn:
        if n == sn or n in sn or sn in n:
            return True
        # token overlap after transliteration
        if n_tok & s_tok:
            return True
        # similarity of full strings
        from description_merge import similarity

        if similarity(n, sn) >= 0.55:
            return True

    if n_tok & h_tok:
        return True
    for t in n_tok:
        if len(t) >= 4 and t in host_compact:
            return True
    for t in h_tok:
        if len(t) >= 4 and t in n.replace(" ", ""):
            return True
    return False


def fill_empty(dst: dict[str, Any], field: str, value: Any, sources: dict[str, str]) -> None:
    cur = dst.get(field) if field in dst else None
    # for patch dict we only set new keys; caller passes existing separately
    if value is None or value == "" or value == [] or value == {}:
        return
    if field in sources:
        return
    sources[field] = "set"


def enrich_one(
    biz: dict[str, Any],
    *,
    on_event: Any = None,
    client: Any = None,
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "id": biz["id"],
        "name": biz.get("name"),
        "slug": biz.get("slug"),
        "website": biz.get("website"),
        "patch": {},
        "offers": [],
        "sources": {},
        "notes": [],
        "skipped": None,
        "bfs_steps": [],
    }

    stored_website = biz.get("website")
    if is_shared_non_identity_host(stored_website):
        # A platform page (meetup / eventbrite / docs) is nobody's own site —
        # re-mining it would keep re-importing the platform's contacts.
        report["notes"].append(f"website_is_platform host={host_of(stored_website)}")
        stored_website = None

    card_urls = [
        stored_website,
        biz.get("instagram_url"),
        biz.get("yelp_url"),
        biz.get("facebook_url") if "facebook_url" in biz else None,
        biz.get("tiktok_url") if "tiktok_url" in biz else None,
        biz.get("booking_url") if "booking_url" in biz else None,
    ]
    card_urls.extend(source_record_urls(client, biz.get("id")))
    card_blob = "\n".join(
        str(x)
        for x in (biz.get("name"), biz.get("short_description"), biz.get("description"))
        if x
    )

    def after_resource(
        found: dict[str, Any], layer: dict[str, Any]
    ) -> list[str]:
        """Pull URLs/contacts from narrative after source (and later pages)."""
        try:
            from contacts import (  # type: ignore
                extract_emails,
                extract_instagram,
                extract_phones,
                extract_websites,
            )
        except Exception:
            return []

        blob = "\n".join(
            str(x)
            for x in (
                card_blob,
                found.get("description"),
                layer.get("description") if isinstance(layer, dict) else None,
            )
            if x
        )
        if not blob or len(blob.strip()) < 8:
            return []
        urls: list[str] = []
        for w in extract_websites(blob) or []:
            urls.append(str(w))
        for ig in extract_instagram(blob) or []:
            if ig:
                urls.append(str(ig))
                if not found.get("instagram_url"):
                    found["instagram_url"] = str(ig).split("?")[0][:300]
        phones = extract_phones(blob) or []
        if phones and not found.get("phone"):
            found["phone"] = str(phones[0])[:40]
        emails = extract_emails(blob) or []
        if emails and not found.get("email"):
            found["email"] = str(emails[0]).lower()[:120]
        return urls

    bfs = run_resource_bfs(
        source_url=biz.get("source_url"),
        card_urls=card_urls,
        max_resources=8,
        website_pages=6,
        on_event=on_event,
        sequential=True,
        after_resource=after_resource,
    )
    report["bfs_steps"] = bfs.get("steps") or []
    found = dict(bfs.get("found") or {})
    discovered_payments: list[str] = []
    for method in list(found.get("payment_methods") or []) + extract_payment_methods(
        card_blob
    ):
        label = str(method).strip()
        if label and label not in discovered_payments:
            discovered_payments.append(label)
    if not (biz.get("payment_methods") or []) and discovered_payments:
        report["patch"]["payment_methods"] = discovered_payments
        report["sources"]["payment_methods"] = "bfs"

    website = normalize_website(found.get("website") or stored_website)
    if not website and not biz.get("source_url") and not report["patch"]:
        report["skipped"] = "no_or_junk_website"
        return report

    # Map BFS found → fill-empty patch (before deep-only path)
    if found.get("description") and (
        not (biz.get("description") or "").strip()
        or len(biz.get("description") or "") < 120
    ):
        desc = str(found["description"]).strip()
        if len(desc) >= 80:
            report["patch"]["description"] = desc[:4000]
            report["sources"]["description"] = "bfs"
    if found.get("description") and not (biz.get("short_description") or "").strip():
        report["patch"]["short_description"] = str(found["description"]).strip()[:180]
        report["sources"]["short_description"] = "bfs"
    if not biz.get("phone") and found.get("phone"):
        report["patch"]["phone"] = str(found["phone"])[:40]
        report["sources"]["phone"] = "bfs"
    if not biz.get("email") and found.get("email"):
        em = str(found["email"])
        if not is_junk_email(em):
            report["patch"]["email"] = em[:120]
            report["sources"]["email"] = "bfs"
    if not biz.get("instagram_url"):
        ig = found.get("instagram_url")
        if not ig:
            for link in found.get("social_links") or []:
                if "instagram.com" in str(link).lower() and not is_directory_social(
                    str(link)
                ):
                    ig = link
                    break
        if ig and not is_directory_social(str(ig)):
            report["patch"]["instagram_url"] = str(ig).split("?")[0][:300]
            report["sources"]["instagram_url"] = "bfs"
    if found.get("yelp_url") and not biz.get("yelp_url"):
        report["patch"]["yelp_url"] = str(found["yelp_url"]).split("?")[0][:300]
        report["sources"]["yelp_url"] = "bfs"
    if (
        website
        and not is_shared_non_identity_host(website)
        and (not normalize_website(stored_website) or is_junk_website(stored_website))
    ):
        if is_platform_saas_host(website):
            book = booking_url_from_maybe_saas(website)
            if book and not (biz.get("booking_url") or "").strip():
                report["patch"]["booking_url"] = book.split("?")[0][:500]
                report["sources"]["booking_url"] = "bfs"
        else:
            report["patch"]["website"] = website
            report["sources"]["website"] = "bfs"

    if not (biz.get("booking_url") or "").strip():
        book = (found.get("booking_url") or "").strip() or None
        if not book:
            try:
                from booking_extract import resolve_booking_url, is_booking_platform_url
                from dikidi_extract import is_dikidi_company_page, booking_url_for_company, dikidi_company_id

                seed = website or biz.get("website")
                if is_dikidi_company_page(seed):
                    book = booking_url_for_company(dikidi_company_id(seed) or "")
                else:
                    book = resolve_booking_url(seed) if seed else None
                    if not book and is_booking_platform_url(seed):
                        book = normalize_website(seed)
            except Exception:
                book = None
        if book:
            report["patch"]["booking_url"] = str(book)[:500]
            report["sources"]["booking_url"] = "bfs"

    addr = found.get("address_line") or found.get("address")
    if addr:
        street, parts = scraped_address(addr)
        if street:
            if not biz.get("address_line") and parts.get("address_line"):
                report["patch"]["address_line"] = parts["address_line"]
                report["sources"]["address_line"] = "bfs"
        if not biz.get("city") and parts.get("city"):
            report["patch"]["city"] = parts["city"]
            report["sources"]["city"] = "bfs"
        if not biz.get("state_code") and parts.get("state_code"):
            report["patch"]["state_code"] = parts["state_code"]
            report["sources"]["state_code"] = "bfs"

    # Continue with website-deep offers / hours / yelp / geo using resolved website
    profile: dict[str, Any] = {"status": "skipped"}
    try:
        from dikidi_extract import is_dikidi_company_page as _is_dikidi_co
    except Exception:  # pragma: no cover
        def _is_dikidi_co(_u: str | None) -> bool:
            return False

    # Tenant Dikidi pages are fully mined in BFS — skip generic HTML crawl
    # (it only pulls SaaS chrome and app-store «services»).
    if website and not _is_dikidi_co(website):
        profile = extract_website_profile_deep(website)
        report["website_profile_status"] = profile.get("status")
        if profile.get("pages_tried"):
            report["pages_tried"] = profile["pages_tried"]
        if profile.get("status") != "ok":
            report["notes"].append(
                f"website:{profile.get('error') or profile.get('status')}"
            )
        else:
            site_name = profile.get("name")
            compatible = name_website_compatible(
                str(biz.get("name") or ""), website, site_name
            )
            if not compatible:
                report["notes"].append(
                    f"name_website_soft_mismatch name={biz.get('name')!r} "
                    f"site_name={site_name!r} host={host_of(website)}"
                )

            if "description" not in report["patch"]:
                if not (biz.get("description") or "").strip() or len(
                    biz.get("description") or ""
                ) < 120:
                    desc = (profile.get("description") or "").strip()
                    if len(desc) >= 80:
                        report["patch"]["description"] = desc[:4000]
                        report["sources"]["description"] = "website"

            if "short_description" not in report["patch"] and not (
                biz.get("short_description") or ""
            ).strip():
                desc = (profile.get("description") or biz.get("description") or "").strip()
                if desc:
                    report["patch"]["short_description"] = desc[:180]
                    report["sources"]["short_description"] = "website"

            if "phone" not in report["patch"] and not biz.get("phone"):
                # Marketing SaaS landings expose vendor support numbers, not the salon.
                # Tenant Dikidi company pages already contributed phone via BFS.
                if not is_booking_marketing_page(website):
                    phones = profile.get("phone") or []
                    if phones:
                        report["patch"]["phone"] = phones[0][:40]
                        report["sources"]["phone"] = "website"
            if "email" not in report["patch"] and not biz.get("email"):
                emails = [e for e in (profile.get("email") or []) if not is_junk_email(e)]
                if emails:
                    report["patch"]["email"] = emails[0][:120]
                    report["sources"]["email"] = "website"
            if "instagram_url" not in report["patch"] and not biz.get("instagram_url"):
                for link in profile.get("social_links") or []:
                    if "instagram.com" in link.lower() and not is_directory_social(link):
                        report["patch"]["instagram_url"] = link.split("?")[0][:300]
                        report["sources"]["instagram_url"] = "website"
                        break

            addr2 = profile.get("address")
            if addr2 and "address_line" not in report["patch"]:
                street2, parts = scraped_address(addr2)
                if street2:
                    if not biz.get("address_line") and parts.get("address_line"):
                        report["patch"]["address_line"] = parts["address_line"]
                        report["sources"]["address_line"] = "website"
                if (
                    not biz.get("city")
                    or str(biz.get("city")).lower()
                    in {"orange county", "oc", "los angeles"}
                ) and parts.get("city"):
                    if "city" not in report["patch"]:
                        report["patch"]["city"] = parts["city"]
                        report["sources"]["city"] = "website"
                if street2:
                    if not biz.get("state_code") and parts.get("state_code"):
                        if "state_code" not in report["patch"]:
                            report["patch"]["state_code"] = parts["state_code"]
                            report["sources"]["state_code"] = "website"
                    if not biz.get("region") and parts.get("region"):
                        report["patch"]["region"] = parts["region"]
                        report["sources"]["region"] = "website"

            if not biz.get("opening_hours"):
                weekly = parse_hours_spec_blob(profile.get("hours")) or parse_hours_to_weekly(
                    profile.get("hours")
                )
                if weekly:
                    report["patch"]["opening_hours"] = weekly
                    report["sources"]["opening_hours"] = "website"

            # HTML heuristic offers for ordinary websites only.
            if not is_booking_marketing_page(website):
                collected_html: list[dict[str, Any]] = []
                for page in discover_service_pages(website):
                    html = http_get(page)
                    if not html:
                        continue
                    for o in extract_services_from_html(html):
                        key = o["title"].lower()
                        if any(x["title"].lower() == key for x in collected_html):
                            continue
                        collected_html.append(o)
                    if len(collected_html) >= 20:
                        break
                    time.sleep(0.15)
                for title in profile.get("services") or []:
                    t = str(title).strip()
                    if not is_plausible_service_title(t):
                        continue
                    key = t.lower()
                    if any(x["title"].lower() == key for x in collected_html):
                        continue
                    collected_html.append(
                        {
                            "title": t[:120],
                            "price_mode": "contact",
                            "currency": "USD",
                        }
                    )
                if collected_html:
                    report["offers"] = collected_html[:40]
                    report["sources"]["offers"] = f"website:{len(collected_html)}"

    # Structured offers from BFS (Dikidi company API, etc.) — even when the
    # generic website crawl was skipped for the tenant booking page.
    if not report.get("offers"):
        collected: list[dict[str, Any]] = []
        for raw_off in found.get("service_offers") or found.get("offers") or []:
            if not isinstance(raw_off, dict):
                continue
            t = str(raw_off.get("title") or "").strip()
            if not t or not is_plausible_service_title(
                t,
                has_price=raw_off.get("price_amount") is not None
                or raw_off.get("price") is not None,
                has_duration=bool(raw_off.get("duration_minutes")),
                typed_service=True,
            ):
                continue
            entry: dict[str, Any] = {
                "title": t[:160],
                "price_mode": raw_off.get("price_mode") or "contact",
                "currency": raw_off.get("currency") or "USD",
            }
            if raw_off.get("price_amount") is not None:
                entry["price_amount"] = raw_off["price_amount"]
                entry["price_mode"] = raw_off.get("price_mode") or "fixed"
            elif raw_off.get("price") is not None:
                entry["price_amount"] = raw_off["price"]
                entry["price_mode"] = "fixed"
            if raw_off.get("price_min") is not None:
                entry["price_min"] = raw_off["price_min"]
                entry["price_mode"] = "range"
            if raw_off.get("price_max") is not None:
                entry["price_max"] = raw_off["price_max"]
                entry["price_mode"] = "range"
            if raw_off.get("duration_minutes"):
                entry["duration_minutes"] = raw_off["duration_minutes"]
            collected.append(entry)
        if collected:
            report["offers"] = collected[:40]
            report["sources"]["offers"] = f"bfs:{len(collected)}"

    if (
        found.get("opening_hours")
        and not biz.get("opening_hours")
        and "opening_hours" not in report["patch"]
    ):
        report["patch"]["opening_hours"] = found["opening_hours"]
        report["sources"]["opening_hours"] = "bfs"

    if found.get("image_url") and not (biz.get("image_url") or "").strip():
        report["patch"]["image_url"] = str(found["image_url"])[:500]
        report["sources"]["image_url"] = "bfs"

    # Instagram enrich description if still empty
    ig = report["patch"].get("instagram_url") or biz.get("instagram_url")
    if ig and (
        not (biz.get("description") or "").strip()
        or len(biz.get("description") or "") < 120
    ) and "description" not in report["patch"]:
        igp = extract_instagram_profile(ig)
        if igp.get("status") == "ok" and (igp.get("description") or igp.get("bio")):
            report["patch"]["description"] = str(
                igp.get("description") or igp.get("bio")
            )[:4000]
            report["sources"]["description"] = "instagram"

    # Address found → geo step (shared contract: coords + precision together).
    street = report["patch"].get("address_line") or biz.get("address_line")
    city = report["patch"].get("city") or biz.get("city")
    state = report["patch"].get("state_code") or biz.get("state_code")
    if street and biz.get("latitude") is None:
        street_q = clean_street_typos(str(street))
        postal = report["patch"].get("postal_code") or biz.get("postal_code")
        geo = resolve_address_geo(street_q, city, state, postal)
        if not geo.ok and "Parkway" in street_q:
            geo = resolve_address_geo(
                street_q.replace("Parkway", "Pkwy"), city, state, postal
            )
        for key, value in geo.patch.items():
            if key == "google_maps_url" and biz.get("google_maps_url"):
                continue
            report["patch"][key] = value
        if geo.ok:
            report["sources"]["geo"] = "nominatim"
            report["sources"]["google_maps_url"] = "address_query"
    elif (
        street
        and biz.get("latitude") is not None
        and biz.get("longitude") is not None
        and biz.get("location_precision") != "street"
        and "location_precision" not in report["patch"]
    ):
        if sanitize_street_line(str(street)):
            report["patch"]["location_precision"] = "street"
            report["sources"]["location_precision"] = "street_coords_present"

    # Yelp
    if not biz.get("yelp_url") and "yelp_url" not in report["patch"]:
        yelp = search_yelp(str(biz.get("name") or ""), city if isinstance(city, str) else None)
        time.sleep(0.4)
        if yelp:
            report["patch"]["yelp_url"] = yelp
            report["sources"]["yelp_url"] = "yelp_search"

    return report


def fetch_targets(client: SupabaseRest, *, limit: int | None, slug: str | None, id_: str | None = None) -> list[dict[str, Any]]:
    select = (
        "id,name,slug,website,instagram_url,phone,email,city,region,state_code,"
        "address_line,description,short_description,google_maps_url,google_rating,"
        "google_reviews_count,yelp_url,latitude,longitude,location_precision,"
        "opening_hours,image_url,booking_url,source_url,payment_methods,status"
    )
    if id_ or slug:
        params: dict[str, str] = {"select": select, "limit": "1"}
        if id_:
            params["id"] = f"eq.{id_}"
        else:
            params["slug"] = f"eq.{slug}"
        return client._request("GET", "/businesses", params=params) or []

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/businesses",
                params={
                    "select": select,
                    "status": "eq.approved",
                    "website": "not.is.null",
                    "order": "updated_at.asc",
                    "offset": str(offset),
                    "limit": "100",
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < 100:
            break

    # Prefer thin + non-junk
    def gap_count(b: dict[str, Any]) -> int:
        g = 0
        if len((b.get("description") or "").strip()) < 180:
            g += 1
        if not b.get("yelp_url"):
            g += 1
        if b.get("latitude") is None and not b.get("google_maps_url"):
            g += 1
        if not b.get("opening_hours"):
            g += 1
        if not b.get("address_line"):
            g += 1
        if not b.get("phone"):
            g += 1
        return g

    rows = [
        b
        for b in rows
        if not is_junk_website(b.get("website"))
        and b.get("slug") != "beauty-studio-by-veronika"
    ]
    rows.sort(key=lambda b: -gap_count(b))
    if limit is not None:
        rows = rows[:limit]
    return rows


def apply_report(client: SupabaseRest, report: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"business_ok": False, "offers_ok": 0, "errors": []}
    patch = report.get("patch") or {}
    if patch:
        try:
            client._request(
                "PATCH",
                "/businesses",
                params={"id": f"eq.{report['id']}"},
                body=patch,
                prefer="return=minimal",
            )
            out["business_ok"] = True
        except Exception as exc:
            out["errors"].append(str(exc)[:300])
    else:
        out["business_ok"] = True

    # existing offers count — only add if zero active offers
    existing = (
        client._request(
            "GET",
            "/business_offers",
            params={
                "select": "id",
                "business_id": f"eq.{report['id']}",
                "status": "eq.active",
                "limit": "1",
            },
        )
        or []
    )
    if existing:
        out["offers_skipped"] = "already_has_offers"
        return out

    for off in report.get("offers") or []:
        slug = slugify(off["title"])
        # unique slug
        for n in range(0, 8):
            candidate = slug if n == 0 else f"{slug}-{n}"
            clash = (
                client._request(
                    "GET",
                    "/business_offers",
                    params={
                        "select": "id",
                        "business_id": f"eq.{report['id']}",
                        "slug": f"eq.{candidate}",
                        "limit": "1",
                    },
                )
                or []
            )
            if not clash:
                slug = candidate
                break
        body = {
            "business_id": report["id"],
            "offer_type": off.get("offer_type") or "service",
            "title": off["title"],
            "slug": slug,
            "short_description": off.get("short_description"),
            "status": "active",
            "visibility": "public",
            "price_mode": off.get("price_mode") or "contact",
            "price_amount": off.get("price_amount"),
            "price_min": off.get("price_min"),
            "price_max": off.get("price_max"),
            "currency": "USD",
            "attributes": (
                {"duration": f"{int(off['duration_minutes'])} мин"}
                if off.get("duration_minutes")
                else (off.get("attributes") if isinstance(off.get("attributes"), dict) else {})
            )
            or {},
            "is_available": True,
            "published_at": "now()",
        }
        # published_at now() via omit — trigger sets on active
        body.pop("published_at", None)
        try:
            client._request("POST", "/business_offers", body=body, prefer="return=minimal")
            out["offers_ok"] += 1
        except Exception as exc:
            out["errors"].append(f"offer {off['title'][:40]}: {str(exc)[:200]}")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich published businesses Veronica-style")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--slug", type=str, default=None)
    parser.add_argument("--id", type=str, default=None, help="Single business id (preferred)")
    parser.add_argument(
        "--ndjson",
        action="store_true",
        help="Stream started/resource/finished NDJSON for admin UI",
    )
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    if args.ndjson and not (args.id or args.slug):
        print("--ndjson requires --id or --slug", file=sys.stderr)
        return 2

    def emit(obj: dict[str, Any]) -> None:
        if args.ndjson:
            print(json.dumps(obj, ensure_ascii=False), flush=True)

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    targets = fetch_targets(
        client,
        limit=None if (args.slug or args.id) else args.limit,
        slug=args.slug,
        id_=args.id,
    )
    if (args.slug or args.id) and not targets:
        msg = f"Business not found id={args.id!r} slug={args.slug!r}"
        if args.ndjson:
            emit({"type": "error", "message": msg})
        else:
            print(msg, file=sys.stderr)
        return 1
    if not args.ndjson:
        print(
            json.dumps(
                {
                    "targets": len(targets),
                    "mode": "dry_run" if args.dry_run else "apply",
                },
                ensure_ascii=False,
            )
        )

    reports: list[dict[str, Any]] = []
    for biz in targets:
        label = f"Обогащение бизнеса «{biz.get('slug') or biz.get('id')}»"
        if args.ndjson:
            emit(
                {
                    "type": "started",
                    "id": biz.get("id"),
                    "label": label,
                    "mode": "apply" if args.apply else "dry-run",
                }
            )
        else:
            print(f"… {biz.get('name')} ({biz.get('website')})", flush=True)

        def on_event(ev: dict[str, Any]) -> None:
            if args.ndjson:
                emit(ev)

        rep = enrich_one(biz, on_event=on_event, client=client)
        steps = rep.get("bfs_steps") or []
        ok_n = sum(1 for s in steps if s.get("outcome") == "ok")
        fail_n = sum(1 for s in steps if s.get("outcome") in ("empty", "error"))
        if args.apply and not rep.get("skipped"):
            rep["apply_result"] = apply_report(client, rep)
        reports.append(rep)
        if args.ndjson:
            emit(
                {
                    "type": "finished",
                    "result": {
                        "id": biz.get("id"),
                        "label": label,
                        "skipped": bool(rep.get("skipped")),
                        "reason": (
                            f"Пропуск: {rep.get('skipped')}"
                            if rep.get("skipped")
                            else (
                                None
                                if rep.get("patch")
                                else "Готово — новых полей не нашлось (fill-empty)."
                            )
                        ),
                        "patch": rep.get("patch") or {},
                        "resources": steps,
                        "resources_ok": ok_n,
                        "resources_failed": fail_n,
                    },
                }
            )
        time.sleep(0.2)

    if args.ndjson:
        return 0

    out_path = ROOT / "scripts" / "business-enrich" / "data" / "enrich_published_report.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    summary = {
        "mode": "dry_run" if args.dry_run else "apply",
        "count": len(reports),
        "skipped": sum(1 for r in reports if r.get("skipped")),
        "with_patch": sum(1 for r in reports if r.get("patch")),
        "with_offers": sum(1 for r in reports if r.get("offers")),
        "reports": reports,
    }
    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("mode", "count", "skipped", "with_patch", "with_offers")}, ensure_ascii=False, indent=2))
    print(f"Wrote {out_path}")
    # sample
    for r in reports[:5]:
        print(
            "-",
            r.get("name"),
            "skip="+str(r.get("skipped")),
            "fields="+",".join((r.get("sources") or {}).keys()),
            "offers="+str(len(r.get("offers") or [])),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
