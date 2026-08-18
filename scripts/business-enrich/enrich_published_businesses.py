#!/usr/bin/env python3
"""Enrich already-published approved businesses (Veronica-style).

Sources (fill-empty only):
  1. Business website (JSON-LD + meta + services/pricing pages)
  2. Instagram (og tags) if URL known / found on site
  3. Nominatim geocode from street address → lat/lng + Google Maps URL
  4. Yelp search (name + city) → yelp_url when unique match
  5. Price lines from site → business_offers (service)

Never overwrites non-empty business fields — except the card's own website
street address, which replaces a different street already on the card
(telegram / party glue). Skips junk websites
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
from address_geo import (  # noqa: E402
    prefer_own_website_street,
    reconcile_state_code,
    resolve_address_geo,
    street_identity,
)
from web_enrichment import (  # noqa: E402
    extract_payment_methods,
    extract_instagram_profile,
    extract_website_profile,
    extract_website_profile_deep,
    is_plausible_service_title,
)
from website_assets import (  # noqa: E402
    linked_content_paths,
    looks_like_logo_url,
    merge_gallery,
    photo_from_website_profile,
    should_replace_cover,
)
from enrich_resource_queue import (  # noqa: E402
    _merge_fill_empty,
    _resource_outcome,
    _useful_fields,
    can_be_own_website,
    classify_resource,
    is_booking_marketing_page,
    is_booking_platform_host,
    is_directory_social,
    mine_resource,
    run_resource_bfs,
    sanitize_street_line,
    url_key,
)
from completeness_score import (  # noqa: E402
    clean_enrich_description,
    description_is_richer,
    is_weak_description,
    pick_richest_description,
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
    # to4ka catalog ads / stuffed listing.url
    "bazar.club",
    "apteka03.online",
    "apteka03.com",
    "madbid.com",
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

# Food venues: /menu HTML → menu_text for TS finalize (menu_item offers).
FOOD_CATEGORY_RE = re.compile(
    r"food|restaurant|cafe|café|bakery|кухн|ресторан|кафе|пекар|еда|deli|bistro|кулинар",
    re.I,
)


def is_food_category(slug: str | None, name: str | None = None) -> bool:
    blob = f"{slug or ''} {name or ''}"
    return bool(FOOD_CATEGORY_RE.search(blob))


def html_visible_text(html: str) -> str:
    text = html_lib.unescape(re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I))
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return "\n".join(lines)


def fetch_menu_page_text(
    website: str | None, homepage_html: str | None = None
) -> str | None:
    """GET {website}/menu only when the homepage actually links it."""
    base = normalize_website(website)
    if not base:
        return None
    html = homepage_html if homepage_html is not None else http_get(base)
    if not html:
        return None
    paths = linked_content_paths(html, base)
    if not any((p.rstrip("/") or "/") == "/menu" for p in paths):
        return None
    menu_url = base.rstrip("/") + "/menu"
    menu_html = http_get(menu_url)
    if not menu_html or len(menu_html) < 200:
        return None
    text = html_visible_text(menu_html)
    if len(text) < 80:
        return None
    priced = sum(1 for ln in text.splitlines() if "$" in ln or re.search(r"\d+[.,]\d{2}", ln))
    if priced < 2 and not re.search(r"\b(?:menu|меню|breakfast|salad|soup|coffee)\b", text, re.I):
        return None
    return text[:20000]


def resolve_business_category(
    client: Any, category_id: str | None
) -> tuple[str | None, str | None]:
    if not client or not category_id:
        return None, None
    try:
        rows = (
            client._request(
                "GET",
                "/categories",
                params={
                    "select": "slug,name",
                    "id": f"eq.{category_id}",
                    "limit": "1",
                },
            )
            or []
        )
        if not rows:
            return None, None
        return rows[0].get("slug"), rows[0].get("name")
    except Exception:
        return None, None


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
    try:
        from enrich_follow_policy import is_cms_chrome_url

        if is_cms_chrome_url(url):
            return True
    except Exception:
        pass
    low = url.lower()
    return any(p in low for p in JUNK_HOST_PARTS)


def normalize_extra_social_url(url: str | None, channel: str) -> str | None:
    """TikTok / Facebook / YouTube / Telegram URL for contact_links."""
    raw = (url or "").strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = "https://" + raw
    try:
        parts = urllib.parse.urlparse(raw)
    except Exception:
        return None
    host = (parts.hostname or "").lower().removeprefix("www.")
    path = (parts.path or "").rstrip("/")
    if channel == "tiktok":
        if host not in ("tiktok.com", "vm.tiktok.com") and not host.endswith(
            ".tiktok.com"
        ):
            return None
        if not path or path == "/":
            return None
        return f"https://www.tiktok.com{path}"[:300]
    if channel == "facebook":
        if host not in ("facebook.com", "fb.com", "fb.me", "m.facebook.com"):
            return None
        # Pixel / tracker — not a page profile.
        if path.startswith("/tr") or "facebook.com/tr" in raw.lower():
            return None
        if not path or path == "/":
            return None
        # Prefer the page root over /reviews /about chrome.
        for suffix in ("/reviews", "/about", "/photos", "/posts", "/reels"):
            if path.lower().endswith(suffix):
                path = path[: -len(suffix)]
                break
        if not path or path == "/":
            return None
        return f"https://www.facebook.com{path}"[:300]
    if channel == "youtube":
        if host not in ("youtube.com", "youtu.be", "m.youtube.com"):
            return None
        if host == "youtu.be":
            if not path or path == "/":
                return None
            return f"https://youtu.be{path}"[:300]
        # Prefer channel / @handle / watch — skip bare homepage.
        if not path or path == "/":
            return None
        return f"https://www.youtube.com{path}"[:300]
    if channel == "telegram":
        if host not in ("t.me", "telegram.me", "telegram.dog"):
            return None
        if not path or path == "/":
            return None
        # Skip joinchat chrome and message deep-links without a username.
        low = path.lower()
        if low.startswith("/joinchat") or low.startswith("/+"):
            return None
        handle = path.lstrip("/").split("/")[0]
        if not handle or handle.startswith("+"):
            return None
        return f"https://t.me/{handle}"[:300]
    if channel == "trustpilot":
        if host not in ("trustpilot.com",):
            return None
        if not path or path == "/":
            return None
        if "/review/" not in path.lower() and "/evaluate/" not in path.lower():
            # Keep review pages; bare homepage is useless.
            if path.strip("/") in ("", "users", "categories"):
                return None
        return f"https://www.trustpilot.com{path}"[:300]
    return None


def contact_links_has_channel(links: list[Any], channel: str) -> bool:
    for row in links or []:
        if not isinstance(row, dict):
            continue
        if row.get("channel") == channel and str(row.get("value") or "").strip():
            return True
    return False


def merge_contact_link(
    links: list[Any], channel: str, value: str
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in links or []:
        if isinstance(row, dict) and row.get("channel") and row.get("value"):
            out.append(
                {
                    "channel": row["channel"],
                    "value": str(row["value"])[:500],
                    "label": row.get("label"),
                }
            )
    if not contact_links_has_channel(out, channel):
        out.append({"channel": channel, "value": value[:500], "label": None})
    return out


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
    a = re.sub(r"\bStr\.?\b", "Street", a, flags=re.I)
    a = re.sub(r"\bAve\b", "Avenue", a, flags=re.I)
    a = re.sub(r"\bIndusrtial\b", "Industrial", a, flags=re.I)
    return a


# Template / docs placeholders — never a real inbox (Squarespace, forms, lorem).
_JUNK_EMAIL_LOCALS = frozenset(
    {
        "user",
        "username",
        "yourname",
        "name",
        "email",
        "test",
        "testing",
        "example",
        "sample",
        "noreply",
        "no-reply",
        "donotreply",
        "mail",
        "you",
        "me",
        "abc",
        "xyz",
    }
)
_JUNK_EMAIL_DOMAINS = frozenset(
    {
        "godaddy.com",
        "example.com",
        "email.com",
        "domain.com",
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
    }
)

# Exact inboxes that leaked across many unrelated cards (directory chrome / ads).
_POLLUTED_EMAILS = frozenset(
    {
        "cmi_detailing@yahoo.com",
    }
)


def is_junk_email(email: str) -> bool:
    e = (email or "").lower().strip()
    if not e or "@" not in e:
        return True
    if e in _POLLUTED_EMAILS:
        return True
    if re.search(r"@(?:dikidi|glossgenius|fresha|vagaro|booksy)\.", e):
        return True
    local, _, domain = e.partition("@")
    local = local.split("+", 1)[0]
    if local in _JUNK_EMAIL_LOCALS:
        return True
    if domain in _JUNK_EMAIL_DOMAINS or any(
        domain.endswith("." + b) for b in _JUNK_EMAIL_DOMAINS
    ):
        return True
    return False


def is_junk_image_url(url: Any) -> bool:
    """Favicons / builder defaults / logo files are not profile photos."""
    u = str(url or "").strip().lower().split("?")[0]
    if not u:
        return True
    if looks_like_logo_url(u):
        return True
    return any(
        x in u
        for x in (
            "telegram.org/img",
            "website_icon",
            "/static/images/wix",
            "assets.squarespace.com/universal/",
        )
    )


def _norm_state_code(value: Any) -> str | None:
    raw = str(value or "").strip().upper()
    if not raw:
        return None
    if raw.startswith("US-") and len(raw) == 5:
        return raw
    if re.fullmatch(r"[A-Z]{2}", raw):
        return f"US-{raw}"
    return raw


def apply_parsed_address_fields(
    report: dict[str, Any],
    biz: dict[str, Any],
    parts: dict[str, str | None],
    *,
    street_written: bool,
    street_replaced: bool,
    source: str,
) -> None:
    """Fill city / state / ZIP / region from the same parse as the street.

    When we write a new street onto a card that already has a default state
    (often US-CA), still align state_code with the address — otherwise Miami
    stays «CA» while region becomes «FL 33138».
    """
    align = street_written or street_replaced

    if parts.get("city") and not city_is_bogus(parts.get("city")):
        if (
            city_is_bogus(biz.get("city"))
            or not biz.get("city")
            or street_replaced
            or (
                align
                and str(biz.get("city") or "").strip().lower()
                != str(parts["city"]).strip().lower()
                and street_replaced
            )
        ):
            report["patch"]["city"] = parts["city"]
            report["sources"]["city"] = source

    parsed_state = _norm_state_code(parts.get("state_code"))
    existing_state = _norm_state_code(biz.get("state_code"))
    if parsed_state and (
        not existing_state
        or street_replaced
        or (street_written and existing_state != parsed_state)
    ):
        report["patch"]["state_code"] = parsed_state
        report["sources"]["state_code"] = source

    if parts.get("postal_code"):
        cur_zip = str(biz.get("postal_code") or "").strip()
        new_zip = str(parts["postal_code"]).strip()[:10]
        if not cur_zip or street_replaced or (street_written and cur_zip != new_zip):
            report["patch"]["postal_code"] = new_zip
            report["sources"]["postal_code"] = source

    if parts.get("region"):
        cur_region = str(biz.get("region") or "").strip()
        new_region = str(parts["region"]).strip()[:80]
        if (
            not cur_region
            or street_replaced
            or (street_written and cur_region != new_region)
        ):
            report["patch"]["region"] = new_region
            report["sources"]["region"] = source


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


BOGUS_CITIES = frozenset({"orange", "orange county", "oc"})
_SUITE_TOKEN_RE = re.compile(
    r"^(?:ste\.?|suite|unit|#)\s*([A-Za-z0-9\-]*)$",
    re.I,
)


def city_is_bogus(city: Any) -> bool:
    """ROP often stamps city=Orange (from «Orange Pages») on every card."""
    if city is None:
        return True
    label = str(city).strip().lower()
    if not label:
        return True
    if label in BOGUS_CITIES:
        return True
    # Parser mistakes («Ste.», «Ste. 403», bare ZIP).
    if _SUITE_TOKEN_RE.match(label):
        return True
    if re.fullmatch(r"\d{5}(?:-\d{4})?", label):
        return True
    return False


def parse_address_parts(address: str) -> dict[str, str | None]:
    """Best-effort split '25 Spectrum Pointe Drive, Ste. 403, Lake Forest, CA 92630'."""
    text = (address or "").replace("\xa0", " ").strip()
    text = re.sub(r"\s+", " ", text)
    out: dict[str, str | None] = {
        "address_line": None,
        "city": None,
        "region": None,
        "state_code": None,
        "postal_code": None,
    }
    if not text:
        return out

    # One-shot US mailing line.
    m = re.match(
        r"^(?P<street>\d{1,6}\s+.+?"
        r"(?:Street|Str|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|"
        r"Parkway|Pkwy|Court|Ct|Place|Pl|Highway|Hwy|Circle|Cir|Terrace|Ter)\.?)"
        r"(?P<suite>\s*,?\s*(?:Suite|Ste\.?|Unit|#)\s*[A-Za-z0-9\-]+)?"
        r"(?:\s*,\s*|\s+)"
        r"(?P<city>[A-Za-z][A-Za-z .'\-]{1,40}?)"
        r",\s*(?P<st>[A-Z]{2})\s*(?P<zip>\d{5}(?:-\d{4})?)?\s*$",
        text,
        re.I,
    )
    if m:
        street = m.group("street").strip(" ,")
        suite = (m.group("suite") or "").strip(" ,")
        if suite:
            street = f"{street}, {suite}"
        out["address_line"] = street[:160]
        out["city"] = m.group("city").strip()[:80]
        out["state_code"] = f"US-{m.group('st').upper()}"
        if m.group("zip"):
            out["postal_code"] = m.group("zip")[:10]
            out["region"] = f"{m.group('st').upper()} {m.group('zip')}"
        else:
            out["region"] = m.group("st").upper()
        return out

    parts = [p.strip() for p in text.split(",") if p.strip()]
    if not parts:
        return out

    street = parts[0]
    idx = 1
    if idx < len(parts):
        suite_m = _SUITE_TOKEN_RE.match(parts[idx])
        if suite_m:
            unit = suite_m.group(1)
            if unit:
                street = f"{street}, {parts[idx]}"
            # else dangling «Ste.» — drop
            idx += 1

    out["address_line"] = street[:160]
    if idx < len(parts):
        city_bit = parts[idx]
        # «Ste. 403 Lake Forest» or «Lake Forest CA 92630»
        suite_city = re.match(
            r"(?i)^(?:ste\.?|suite|unit|#)\s*[A-Za-z0-9\-]+\s+(.+)$",
            city_bit,
        )
        if suite_city:
            # Suite was glued into the city segment without a comma.
            unit_part = city_bit[: city_bit.lower().find(suite_city.group(1))].strip()
            if unit_part and unit_part.lower() not in street.lower():
                out["address_line"] = f"{street}, {unit_part}"[:160]
            city_bit = suite_city.group(1).strip()
        st_zip = re.search(
            r"^(.*?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)?\s*$",
            city_bit,
            re.I,
        )
        if st_zip and st_zip.group(1).strip():
            out["city"] = st_zip.group(1).strip()[:80]
            out["state_code"] = f"US-{st_zip.group(2).upper()}"
            if st_zip.group(3):
                out["postal_code"] = st_zip.group(3)[:10]
                out["region"] = f"{st_zip.group(2).upper()} {st_zip.group(3)}"
            else:
                out["region"] = st_zip.group(2).upper()
        elif not _SUITE_TOKEN_RE.match(city_bit) and not re.fullmatch(
            r"\d{5}(?:-\d{4})?", city_bit
        ):
            out["city"] = city_bit[:80]
        idx += 1

    if idx < len(parts):
        m2 = re.search(r"\b([A-Z]{2})\b(?:\s+(\d{5}(?:-\d{4})?))?", parts[idx])
        if m2:
            out["state_code"] = f"US-{m2.group(1)}"
            if m2.group(2):
                out["postal_code"] = m2.group(2)[:10]
                out["region"] = f"{m2.group(1)} {m2.group(2)}"
            else:
                out["region"] = m2.group(1)
        elif not out.get("city") and not _SUITE_TOKEN_RE.match(parts[idx]):
            out["city"] = parts[idx][:80]

    if out.get("city") and city_is_bogus(out["city"]):
        out["city"] = None
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
    # «From 9:00 AM to 5:00 PM» / «Working hours; From …»
    from_to_re = re.compile(
        r"(?:working\s*hours|business\s*hours|hours|open)?\s*[:;]?\s*"
        r"(?:from\s+)?(\d{1,2}:\d{2})\s*(AM|PM|am|pm)?\s*(?:to|–|-|—)\s*"
        r"(\d{1,2}:\d{2})\s*(AM|PM|am|pm)?",
        re.I,
    )
    weekly: dict[int, dict[str, Any]] = {d: {"day": d, "closed": True} for d in range(7)}
    tz = "America/Los_Angeles"

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
                return {"timezone": tz, "weekly": [weekly[d] for d in range(7)]}

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
        return {"timezone": tz, "weekly": [weekly[d] for d in range(7)]}

    # Day-less «From 9:00 AM to 5:00 PM» → Mon–Fri (office default).
    ft = from_to_re.search(text)
    if ft and not re.search(
        r"(?i)\b(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
        text,
    ):
        op = to_24(ft.group(1), ft.group(2))
        cl = to_24(ft.group(3), ft.group(4))
        if op and cl:
            for d in range(1, 6):
                weekly[d] = {"day": d, "open": op, "close": cl}
            return {"timezone": tz, "weekly": [weekly[d] for d in range(7)]}
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
        # Job-pay slogans («Earn $1800+/Week») are not services.
        if re.search(
            r"(?i)\b(?:earn\s+\$|vacanc|hiring|get\s+hired|per\s+week|/?\s*week)\b",
            ln,
        ) and not re.search(r"(?i)\b(?:course|training|class\s+[ab]|package|eldt)\b", ln):
            continue
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
        if re.search(
            r"(?i)\b(?:vacanc|hiring|earn\s+\$|get\s+hired|tired\s+of|"
            r"exam\s+fee|attempt|per\s+week)\b",
            title,
        ):
            continue
        if not is_plausible_service_title(
            title, has_price=True, typed_service=True
        ):
            continue
        p1 = float(m.group("p1"))
        p2 = float(m.group("p2")) if m.group("p2") else None
        if p1 < 15 or p1 > 5000:
            continue
        # Fee / attempt lines often price as $50–$350 — still not a service.
        if re.search(r"(?i)\b(?:fee|attempt|deposit|tax|tip)\b", title):
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
    # Course package titles without price on the same line.
    for ln in lines:
        t = re.sub(r"\s+", " ", ln).strip()
        if not re.match(
            r"(?i)^\s*(?:(?:experienced\s+driver\s+course|guaranteed\s+(?:training\s+)?course|"
            r"\d{2,3}\s*hour\s+course(?:\s+with\s+certificate)?)\s+class\s+[ab]"
            r"|eldt\s+online\s+course(?:\s+for\s+cdl\s+class\s+[ab])?"
            r"|cdl\s+class\s+[ab](?:\s+package|\s+training)?)\s*$",
            t,
        ):
            continue
        key = t.lower()
        if key in seen or not is_plausible_service_title(t, typed_service=True):
            continue
        seen.add(key)
        offers.append(
            {
                "title": t[:160],
                "offer_type": "service",
                "price_mode": "contact",
            }
        )
        if len(offers) >= 25:
            break
    return offers


def discover_service_pages(base_url: str) -> list[str]:
    """Homepage plus same-origin content paths that the site actually links."""
    base = normalize_website(base_url)
    if not base:
        return []
    parsed = urllib.parse.urlparse(base)
    root = f"{parsed.scheme}://{parsed.netloc}"
    home = root + "/"
    html = http_get(base)
    urls = [home]
    if html:
        for path in linked_content_paths(html, base):
            u = urllib.parse.urljoin(root + "/", path.lstrip("/"))
            if u not in urls:
                urls.append(u)
    if base.rstrip("/") not in {u.rstrip("/") for u in urls}:
        urls.insert(0, base)
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


def note_field_conflict(
    report: dict[str, Any],
    key: str,
    current: Any,
    candidate: Any,
    *,
    same: Any = None,
) -> None:
    """Record a found≠card value that fill-empty skipped — admin may replace."""
    if candidate in (None, "", [], {}):
        return
    cur_s = (
        str(current).strip()
        if current not in (None, "", [], {})
        else ""
    )
    cand_s = str(candidate).strip()
    if not cur_s or not cand_s:
        return
    if same is not None:
        try:
            if same(cur_s, cand_s):
                return
        except Exception:
            pass
    elif cur_s.lower() == cand_s.lower():
        return
    conflicts = report.setdefault("field_conflicts", [])
    if not isinstance(conflicts, list):
        conflicts = []
        report["field_conflicts"] = conflicts
    if any(isinstance(c, dict) and c.get("key") == key for c in conflicts):
        return
    conflicts.append(
        {
            "key": key,
            "current": cur_s[:300],
            "found": cand_s[:300],
        }
    )


def enrich_one(
    biz: dict[str, Any],
    *,
    on_event: Any = None,
    client: Any = None,
) -> dict[str, Any]:
    cat_slug, cat_name = resolve_business_category(client, biz.get("category_id"))
    food_venue = is_food_category(cat_slug, cat_name)
    report: dict[str, Any] = {
        "id": biz["id"],
        "name": biz.get("name"),
        "slug": biz.get("slug"),
        "website": biz.get("website"),
        "patch": {},
        "offers": [],
        "menu_text": None,
        "sources": {},
        "notes": [],
        "skipped": None,
        "bfs_steps": [],
        "category_slug": cat_slug,
        "food_venue": food_venue,
        "field_conflicts": [],
    }

    stored_website = biz.get("website")
    if is_shared_non_identity_host(stored_website):
        # A platform page (meetup / eventbrite / docs) is nobody's own site —
        # re-mining it would keep re-importing the platform's contacts.
        report["notes"].append(f"website_is_platform host={host_of(stored_website)}")
        if on_event:
            try:
                on_event(
                    {
                        "type": "resource",
                        "url": stored_website,
                        "kind": "website",
                        "status": "done",
                        "outcome": "empty",
                        "detail": "каталог/платформа — не сайт карточки",
                        "error": "shared_host",
                    }
                )
            except Exception:
                pass
        stored_website = None

    card_urls = [
        stored_website,
        biz.get("instagram_url"),
        biz.get("yelp_url"),
        biz.get("facebook_url") if "facebook_url" in biz else None,
        biz.get("tiktok_url") if "tiktok_url" in biz else None,
        biz.get("booking_url") if "booking_url" in biz else None,
    ]
    pref_host = host_of(stored_website) if stored_website else ""
    for extra in source_record_urls(client, biz.get("id")):
        # Origin rows often still hold the ROP WordPress sidebar. Never seed a
        # second marketing site — only the card's own host, or socials/booking.
        kind = classify_resource(extra)
        if kind == "website":
            if pref_host and host_of(extra) == pref_host:
                card_urls.append(extra)
            continue
        if kind in ("instagram", "tiktok", "facebook", "yelp"):
            if not is_directory_social(extra):
                card_urls.append(extra)
            continue
        # Booking / forms from origin rows (not a second website).
        if kind == "other" or "book" in str(extra).lower() or "forms.gle" in str(extra).lower():
            card_urls.append(extra)
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
            s = str(w)
            # With a card website set, do not chase other hosts from the text
            # (directory chrome / pasted sidebar leftovers).
            if pref_host:
                if host_of(s) == pref_host:
                    urls.append(s)
            elif can_be_own_website(s):
                urls.append(s)
        for ig in extract_instagram(blob) or []:
            if ig and not is_directory_social(str(ig)):
                urls.append(str(ig))
                if not found.get("instagram_url"):
                    found["instagram_url"] = str(ig).split("?")[0][:300]
        phones = extract_phones(blob) or []
        if phones and not found.get("phone"):
            found["phone"] = str(phones[0])[:40]
        emails = extract_emails(blob) or []
        if emails and not found.get("email"):
            try:
                from enrich_published_businesses import is_junk_email as _junk_em
            except Exception:  # pragma: no cover
                def _junk_em(_v: str) -> bool:
                    return False

            for cand in emails:
                em = str(cand).lower()[:120]
                if em and not _junk_em(em):
                    found["email"] = em
                    break
        return urls

    bfs = run_resource_bfs(
        source_url=biz.get("source_url"),
        card_urls=card_urls,
        max_resources=8,
        website_pages=6,
        on_event=on_event,
        sequential=True,
        after_resource=after_resource,
        preferred_website=stored_website,
    )
    report["bfs_steps"] = bfs.get("steps") or []
    found = dict(bfs.get("found") or {})

    source_failed = any(
        str(s.get("kind") or "") == "source"
        and str(s.get("outcome") or "") == "error"
        for s in (report["bfs_steps"] or [])
    )
    if source_failed and not stored_website:
        report["notes"].append(
            "source_unreachable_no_card_website — сохраните свой сайт в поле «Сайт» и повторите"
        )

    # If the card has a website that BFS never mined (empty deferred, source
    # died first, etc.), mine it explicitly so enrich still uses the site.
    if stored_website and not is_junk_website(stored_website):
        mined_keys = {
            url_key(str(s.get("url") or ""))
            for s in (report["bfs_steps"] or [])
            if s.get("url")
        }
        if url_key(stored_website) not in mined_keys:
            if on_event:
                try:
                    on_event(
                        {
                            "type": "resource",
                            "url": stored_website,
                            "kind": "website",
                            "status": "running",
                            "detail": "сайт с карточки",
                        }
                    )
                except Exception:
                    pass
            layer = mine_resource(stored_website, kind="website", website_pages=6)
            _merge_fill_empty(
                found,
                {
                    **{
                        kk: vv
                        for kk, vv in layer.items()
                        if not kk.startswith("_") and kk != "discovered_urls"
                    },
                    "_kind": "website",
                },
            )
            fields = _useful_fields(layer)
            outcome, err_reason = _resource_outcome(layer, fields)
            report["bfs_steps"].append(
                {
                    "url": stored_website,
                    "kind": "website",
                    "status": layer.get("_status"),
                    "outcome": outcome,
                    "error": err_reason,
                    "enqueued": [],
                    "fields": fields,
                }
            )
            if on_event:
                try:
                    on_event(
                        {
                            "type": "resource",
                            "url": stored_website,
                            "kind": "website",
                            "status": "error" if outcome == "error" else "done",
                            "outcome": outcome,
                            "fields": fields,
                            "error": err_reason,
                        }
                    )
                except Exception:
                    pass

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

    # Map BFS found → fill-empty patch (before deep-only path).
    # Descriptions are collected and the richest wins after website/IG below.
    desc_candidates: list[tuple[str | None, str | None]] = []
    if found.get("description"):
        desc_candidates.append(
            (
                str(found["description"]).strip(),
                str(found.get("_description_source") or "bfs"),
            )
        )
    if not biz.get("phone") and found.get("phone"):
        report["patch"]["phone"] = str(found["phone"])[:40]
        report["sources"]["phone"] = "bfs"
    elif biz.get("phone") and found.get("phone"):
        note_field_conflict(report, "phone", biz.get("phone"), found.get("phone"))
    if not biz.get("email") and found.get("email"):
        em = str(found["email"])
        if not is_junk_email(em):
            report["patch"]["email"] = em[:120]
            report["sources"]["email"] = "bfs"
    elif biz.get("email") and found.get("email"):
        em = str(found["email"])
        if not is_junk_email(em):
            note_field_conflict(report, "email", biz.get("email"), em)
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
    else:
        ig = found.get("instagram_url")
        if not ig:
            for link in found.get("social_links") or []:
                if "instagram.com" in str(link).lower() and not is_directory_social(
                    str(link)
                ):
                    ig = link
                    break
        if ig and not is_directory_social(str(ig)):
            note_field_conflict(
                report,
                "instagram_url",
                biz.get("instagram_url"),
                str(ig).split("?")[0][:300],
            )

    # TikTok / Facebook / YouTube / Telegram → contact_links (fill-empty).
    links = list(
        report["patch"].get("contact_links")
        if isinstance(report["patch"].get("contact_links"), list)
        else (biz.get("contact_links") or [])
    )
    if not isinstance(links, list):
        links = []
    tt = found.get("tiktok_url")
    if not tt:
        for link in found.get("social_links") or []:
            if "tiktok.com" in str(link).lower():
                tt = link
                break
    tt_n = normalize_extra_social_url(str(tt) if tt else None, "tiktok")
    if tt_n and not contact_links_has_channel(links, "tiktok"):
        links = merge_contact_link(links, "tiktok", tt_n)
        report["sources"]["tiktok_url"] = "bfs"
    fb = found.get("facebook_url")
    if not fb:
        for link in found.get("social_links") or []:
            if "facebook.com" in str(link).lower() or "fb.com" in str(link).lower():
                fb = link
                break
    fb_n = normalize_extra_social_url(str(fb) if fb else None, "facebook")
    if fb_n and not contact_links_has_channel(links, "facebook"):
        links = merge_contact_link(links, "facebook", fb_n)
        report["sources"]["facebook_url"] = "bfs"
    yt = found.get("youtube_url")
    if not yt:
        for link in found.get("social_links") or []:
            low = str(link).lower()
            if "youtube.com" in low or "youtu.be" in low:
                yt = link
                break
    yt_n = normalize_extra_social_url(str(yt) if yt else None, "youtube")
    if yt_n and not contact_links_has_channel(links, "youtube"):
        links = merge_contact_link(links, "youtube", yt_n)
        report["sources"]["youtube_url"] = "bfs"
    tg = found.get("telegram_url")
    if not tg:
        for link in found.get("social_links") or []:
            low = str(link).lower()
            if "t.me/" in low or "telegram.me/" in low:
                tg = link
                break
    tg_n = normalize_extra_social_url(str(tg) if tg else None, "telegram")
    if tg_n and not contact_links_has_channel(links, "telegram"):
        links = merge_contact_link(links, "telegram", tg_n)
        report["sources"]["telegram_url"] = "bfs"
    # Dedicated telegram_url column when empty.
    if tg_n and not biz.get("telegram_url") and "telegram_url" not in report["patch"]:
        report["patch"]["telegram_url"] = tg_n
        report["sources"]["telegram_url"] = report["sources"].get("telegram_url") or "bfs"
    tp = found.get("trustpilot_url")
    if not tp:
        for link in found.get("social_links") or []:
            if "trustpilot.com" in str(link).lower():
                tp = link
                break
    tp_n = normalize_extra_social_url(str(tp) if tp else None, "trustpilot")
    if tp_n and not contact_links_has_channel(links, "trustpilot"):
        links = merge_contact_link(links, "trustpilot", tp_n)
        report["sources"]["trustpilot_url"] = "bfs"
    if tp_n and not biz.get("trustpilot_url") and "trustpilot_url" not in report["patch"]:
        report["patch"]["trustpilot_url"] = tp_n
        report["sources"]["trustpilot_url"] = report["sources"].get("trustpilot_url") or "bfs"
    if found.get("trustpilot_rating") is not None:
        existing_tp = biz.get("trustpilot_rating")
        empty_tp = existing_tp is None or float(existing_tp or 0) <= 0
        if empty_tp and "trustpilot_rating" not in report["patch"]:
            report["patch"]["trustpilot_rating"] = float(found["trustpilot_rating"])
            report["sources"]["trustpilot_rating"] = "bfs"
            tp_count = found.get("trustpilot_reviews_count")
            if (
                tp_count is not None
                and int(biz.get("trustpilot_reviews_count") or 0) == 0
                and "trustpilot_reviews_count" not in report["patch"]
            ):
                report["patch"]["trustpilot_reviews_count"] = int(tp_count)
                report["sources"]["trustpilot_reviews_count"] = "bfs"
    if links and links != list(biz.get("contact_links") or []):
        report["patch"]["contact_links"] = links

    if found.get("yelp_url") and not biz.get("yelp_url"):
        report["patch"]["yelp_url"] = str(found["yelp_url"]).split("?")[0][:300]
        report["sources"]["yelp_url"] = "bfs"
    # Yelp biz page fields (when DataDome did not block the fetch).
    if found.get("yelp_rating") is not None:
        existing_rating = biz.get("yelp_rating")
        empty_rating = existing_rating is None or float(existing_rating or 0) <= 0
        if empty_rating and "yelp_rating" not in report["patch"]:
            report["patch"]["yelp_rating"] = float(found["yelp_rating"])
            report["sources"]["yelp_rating"] = "bfs"
            count = found.get("yelp_reviews_count")
            if (
                count is not None
                and int(biz.get("yelp_reviews_count") or 0) == 0
                and "yelp_reviews_count" not in report["patch"]
            ):
                report["patch"]["yelp_reviews_count"] = int(count)
                report["sources"]["yelp_reviews_count"] = "bfs"
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
    elif (
        website
        and stored_website
        and not is_shared_non_identity_host(website)
        and not is_junk_website(website)
        and normalize_website(website) != normalize_website(stored_website)
    ):
        note_field_conflict(report, "website", stored_website, website)

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
    addr_src = str(found.get("_address_source") or "bfs").strip().lower()
    if addr:
        street, parts = scraped_address(addr)
        street_line = parts.get("address_line") or street
        existing_street = biz.get("address_line")
        # Own-website street wins over telegram / party glue already on the card.
        take_street = bool(street_line) and (
            not existing_street
            or (
                addr_src == "website"
                and prefer_own_website_street(existing_street, street_line)
            )
        )
        if take_street and street_line:
            report["patch"]["address_line"] = street_line
            report["sources"]["address_line"] = addr_src if addr_src == "website" else "bfs"
        elif existing_street and street_line:
            note_field_conflict(
                report,
                "address_line",
                existing_street,
                street_line,
                same=lambda a, b: street_identity(a) == street_identity(b),
            )
        street_written = bool(report["patch"].get("address_line"))
        street_replaced = bool(
            street_written
            and existing_street
            and street_identity(report["patch"]["address_line"])
            != street_identity(existing_street)
        )
        if street_written or parts.get("city") or parts.get("state_code"):
            apply_parsed_address_fields(
                report,
                biz,
                parts,
                street_written=street_written,
                street_replaced=street_replaced,
                source=addr_src if addr_src == "website" else "bfs",
            )

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
            # Junk / empty card title → take the site brand (JSON-LD / og:site_name).
            cur_name = str(biz.get("name") or "").strip()
            site_brand = str(site_name or "").strip()
            if site_brand and (
                not cur_name
                or is_weak_description(cur_name)
                or re.match(r"^(?:src|href|alt|class)\s*=", cur_name, re.I)
                or cur_name.lower() in {"src=", "null", "undefined", "n/a"}
                or "base64," in cur_name.lower()
                or "data:image" in cur_name.lower()
            ):
                report["patch"]["name"] = site_brand[:160]
                report["sources"]["name"] = "website"

            if profile.get("description"):
                desc_candidates.append(
                    (str(profile.get("description") or "").strip(), "website")
                )

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

            # Website footer socials → contact_links.
            web_links = list(
                report["patch"].get("contact_links")
                if isinstance(report["patch"].get("contact_links"), list)
                else (biz.get("contact_links") or [])
            )
            if not isinstance(web_links, list):
                web_links = []
            for link in profile.get("social_links") or []:
                low = str(link).lower()
                if "tiktok.com" in low:
                    nu = normalize_extra_social_url(str(link), "tiktok")
                    if nu and not contact_links_has_channel(web_links, "tiktok"):
                        web_links = merge_contact_link(web_links, "tiktok", nu)
                        report["sources"]["tiktok_url"] = "website"
                elif "facebook.com" in low or "fb.com" in low:
                    nu = normalize_extra_social_url(str(link), "facebook")
                    if nu and not contact_links_has_channel(web_links, "facebook"):
                        web_links = merge_contact_link(web_links, "facebook", nu)
                        report["sources"]["facebook_url"] = "website"
                elif "youtube.com" in low or "youtu.be" in low:
                    nu = normalize_extra_social_url(str(link), "youtube")
                    if nu and not contact_links_has_channel(web_links, "youtube"):
                        web_links = merge_contact_link(web_links, "youtube", nu)
                        report["sources"]["youtube_url"] = "website"
                elif "t.me/" in low or "telegram.me/" in low:
                    nu = normalize_extra_social_url(str(link), "telegram")
                    if nu and not contact_links_has_channel(web_links, "telegram"):
                        web_links = merge_contact_link(web_links, "telegram", nu)
                        report["sources"]["telegram_url"] = "website"
                    if (
                        nu
                        and not biz.get("telegram_url")
                        and "telegram_url" not in report["patch"]
                    ):
                        report["patch"]["telegram_url"] = nu
                elif "trustpilot.com" in low:
                    nu = normalize_extra_social_url(str(link), "trustpilot")
                    if nu and not contact_links_has_channel(web_links, "trustpilot"):
                        web_links = merge_contact_link(web_links, "trustpilot", nu)
                        report["sources"]["trustpilot_url"] = "website"
                    if (
                        nu
                        and not biz.get("trustpilot_url")
                        and "trustpilot_url" not in report["patch"]
                    ):
                        report["patch"]["trustpilot_url"] = nu
                        report["sources"]["trustpilot_url"] = (
                            report["sources"].get("trustpilot_url") or "website"
                        )
            if web_links and web_links != list(biz.get("contact_links") or []):
                report["patch"]["contact_links"] = web_links

            addr2 = profile.get("address")
            extra_addrs = [
                str(x).strip()
                for x in (profile.get("addresses") or [])
                if str(x).strip()
            ]
            if addr2 and addr2 not in extra_addrs:
                extra_addrs.insert(0, str(addr2).strip())
            if extra_addrs:
                report["extra_addresses"] = extra_addrs[:8]
            if addr2:
                street2, parts = scraped_address(addr2)
                street_line2 = parts.get("address_line") or street2
                existing_street = report["patch"].get("address_line") or biz.get(
                    "address_line"
                )
                take_web = bool(street_line2) and prefer_own_website_street(
                    existing_street, street_line2
                )
                if take_web and street_line2:
                    report["patch"]["address_line"] = street_line2
                    report["sources"]["address_line"] = "website"
                street_written = bool(
                    take_web and street_line2 and report["patch"].get("address_line")
                )
                street_replaced = bool(
                    take_web
                    and existing_street
                    and street_line2
                    and street_identity(street_line2)
                    != street_identity(existing_street)
                )
                if street_line2 or parts.get("city") or parts.get("state_code"):
                    # LA is often a leftover hub default — allow city replace.
                    if (
                        parts.get("city")
                        and not city_is_bogus(parts.get("city"))
                        and str(biz.get("city") or "").lower() in {"los angeles"}
                    ):
                        report["patch"]["city"] = parts["city"]
                        report["sources"]["city"] = "website"
                    apply_parsed_address_fields(
                        report,
                        biz,
                        parts,
                        street_written=street_written or street_replaced,
                        street_replaced=street_replaced,
                        source="website",
                    )

            if not biz.get("opening_hours"):
                weekly = parse_hours_spec_blob(profile.get("hours")) or parse_hours_to_weekly(
                    profile.get("hours")
                )
                if weekly:
                    # Prefer East-coast TZ when the card is already NJ/NY/PA.
                    st = str(
                        report["patch"].get("state_code")
                        or biz.get("state_code")
                        or ""
                    ).upper()
                    if any(x in st for x in ("NJ", "NY", "PA", "CT", "MA", "MD", "DE")):
                        weekly = {**weekly, "timezone": "America/New_York"}
                    report["patch"]["opening_hours"] = weekly
                    report["sources"]["opening_hours"] = "website"

            # Food venues: capture /menu text for TS finalize → menu_item.
            # Do not treat dish prices as generic «service» offers.
            if food_venue:
                menu_text = fetch_menu_page_text(website)
                if menu_text:
                    report["menu_text"] = menu_text
                    report["sources"]["menu_text"] = "website:/menu"
                    report["notes"].append(f"menu_text_chars={len(menu_text)}")
            # HTML heuristic offers for ordinary (non-food) websites only.
            elif not is_booking_marketing_page(website):
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
    # Food venues keep dishes for menu_text / TS finalize, not service offers.
    if not report.get("offers") and not food_venue:
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

    portrait, certs = photo_from_website_profile(profile if profile.get("status") == "ok" else None)
    current_image = str(
        report["patch"].get("image_url") or biz.get("image_url") or ""
    ).strip()
    if portrait and should_replace_cover(current_image):
        report["patch"]["image_url"] = portrait[:500]
        report["sources"]["image_url"] = "website"
        current_image = portrait
    gallery = merge_gallery(
        biz.get("gallery_urls"),
        list(certs) + [str(x).strip() for x in (found.get("gallery_urls") or []) if str(x).strip()],
    )
    if gallery and gallery != list(biz.get("gallery_urls") or []):
        report["patch"]["gallery_urls"] = gallery
        report["sources"]["gallery_urls"] = "website"

    if (
        found.get("image_url")
        and should_replace_cover(current_image)
        and not is_junk_image_url(found.get("image_url"))
    ):
        report["patch"]["image_url"] = str(found["image_url"])[:500]
        report["sources"]["image_url"] = "bfs"

    # Instagram bio as another description candidate (richest wins below).
    existing_desc = (biz.get("description") or "").strip() or None
    need_description = is_weak_description(existing_desc) or len(
        str(existing_desc or "").strip()
    ) < 120
    ig = report["patch"].get("instagram_url") or biz.get("instagram_url")
    if ig and need_description:
        igp = extract_instagram_profile(ig)
        if igp.get("status") == "ok" and (igp.get("description") or igp.get("bio")):
            desc_candidates.append(
                (str(igp.get("description") or igp.get("bio") or "").strip(), "instagram")
            )

    pick_list = list(desc_candidates)
    if existing_desc:
        pick_list.append((existing_desc, "existing"))
    # Normalize candidates (dedupe truncated + strip builder chrome).
    normalized: list[tuple[str, str]] = []
    for raw, src in pick_list:
        cleaned = clean_enrich_description(raw) or str(raw or "").strip()
        if cleaned:
            normalized.append((cleaned, src))
    winner, winner_src = pick_richest_description(normalized)
    existing_clean = clean_enrich_description(existing_desc) or existing_desc
    if (
        winner
        and winner_src
        and winner_src != "existing"
        and description_is_richer(
            winner,
            existing_clean,
            new_source=winner_src,
            current_source="existing",
        )
    ):
        report["patch"]["description"] = winner[:4000]
        report["sources"]["description"] = winner_src or "bfs"
    elif (
        existing_desc
        and existing_clean
        and existing_clean != existing_desc
        and "description" not in report["patch"]
    ):
        # Same source text, but chrome / duplicate paragraphs cleaned.
        report["patch"]["description"] = existing_clean[:4000]
        report["sources"]["description"] = "cleanup"
    if winner and not (biz.get("short_description") or "").strip():
        report["patch"]["short_description"] = winner[:180]
        report["sources"]["short_description"] = winner_src or "bfs"

    # Address found → geo step (shared contract: coords + precision together).
    # Re-geocode when the street itself changed (website replaced telegram glue).
    street = report["patch"].get("address_line") or biz.get("address_line")
    city = report["patch"].get("city") or biz.get("city")
    if city_is_bogus(city):
        city = report["patch"].get("city")  # only trust a freshly patched real city
    state = report["patch"].get("state_code") or biz.get("state_code")
    postal = report["patch"].get("postal_code") or biz.get("postal_code")
    region = report["patch"].get("region") or biz.get("region")
    # ZIP / region beat a leftover hub default (US-CA) before Nominatim.
    reconciled = reconcile_state_code(state, postal, region)
    if reconciled and _norm_state_code(reconciled) != _norm_state_code(state):
        report["patch"]["state_code"] = reconciled
        report["sources"]["state_code"] = "zip_region"
        state = reconciled
    street_changed = bool(
        report["patch"].get("address_line")
        and biz.get("address_line")
        and street_identity(report["patch"]["address_line"])
        != street_identity(biz.get("address_line"))
    )
    need_geo = bool(street) and (
        biz.get("latitude") is None or street_changed
    )
    if need_geo:
        street_q = clean_street_typos(str(street))
        geo = resolve_address_geo(
            street_q, city, state, postal, region=region
        )
        if not geo.ok and "Parkway" in street_q:
            geo = resolve_address_geo(
                street_q.replace("Parkway", "Pkwy"),
                city,
                state,
                postal,
                region=region,
            )
        for key, value in geo.patch.items():
            if (
                key == "google_maps_url"
                and biz.get("google_maps_url")
                and not street_changed
            ):
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
        "google_reviews_count,yelp_url,yelp_rating,yelp_reviews_count,"
        "trustpilot_url,trustpilot_rating,trustpilot_reviews_count,"
        "latitude,longitude,"
        "location_precision,opening_hours,image_url,gallery_urls,booking_url,source_url,payment_methods,"
        "status,category_id,contact_links"
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
                        "menu_text": rep.get("menu_text") or None,
                        "field_conflicts": rep.get("field_conflicts") or [],
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
