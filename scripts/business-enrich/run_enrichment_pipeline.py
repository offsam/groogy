#!/usr/bin/env python3
"""Universal enrichment pipeline for the import_review_items queue.

Takes queue records (pending / in_review / needs_more_info) for one entity
type and fills EMPTY fields only, in this fixed order:

  step 1  source_text  — extract phone/email/website/instagram/telegram/
                         street address from the record's own source_text
                         + description
  step 2  website      — if the record has (or step 1 found) a website,
                         fetch the site and fill still-empty phone/email/
                         instagram/facebook/yelp/tiktok/description/
                         preview image/city/services (fill-empty only)
  step 3  directories  — match against local directory dumps
                         (data/yellow_pages/*_latest.json: svoi, rop,
                         boston, echoru) by phone or exact name; fill
                         phone/email/instagram/city/preview image

After each record the completeness score is recomputed (before → after) so
the effect of the run is visible per record and in totals.

Safe by design:
  * dry-run is the DEFAULT — nothing is written without --apply
  * fill-empty only — a non-empty queue field is never overwritten
  * review fields (status, notes, decisions) are never touched

Usage (run these exactly; nothing else is required):

  # test on 5 records, no writes
  python3 scripts/business-enrich/run_enrichment_pipeline.py --entity business --limit 5

  # real run, writes to the queue, batches of 50
  python3 scripts/business-enrich/run_enrichment_pipeline.py --entity business --apply

  # other entity types
  python3 scripts/business-enrich/run_enrichment_pipeline.py --entity professional --limit 5
  python3 scripts/business-enrich/run_enrichment_pipeline.py --entity listing --limit 5

  # offline mode (skip the website-fetch step)
  python3 scripts/business-enrich/run_enrichment_pipeline.py --entity business --no-website --limit 5

Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
(load_env() picks them up automatically, same as the other scripts here).

A JSON report is written to data/enrichment_pipeline/ after every run.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from contacts import (  # noqa: E402
    extract_emails,
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
    normalize_phone,
)
from completeness_score import calculate_completeness_score  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "enrichment_pipeline"
OUT.mkdir(parents=True, exist_ok=True)

DIRECTORY_DUMPS = [
    ROOT / "scripts" / "business-enrich" / "data" / "yellow_pages" / name
    for name in (
        "svoi_cards_latest.json",
        "rop_cards_latest.json",
        "boston_pages_latest.json",
        "echoru_latest.json",
    )
]

# --entity value → import_review_items.entity_type
ENTITY_MAP = {
    "business": "business",
    "professional": "private_specialist",
    "listing": "marketplace_listing",
    "event": "event",
}

QUEUE_STATUSES = "(pending,in_review,needs_more_info)"

QUEUE_SELECT = (
    "id,entity_type,review_status,title,business_name,person_name,category,"
    "description,source_text,source_url,source,source_group,city,state,price,currency,"
    "address_line,postal_code,"
    "payment_methods,"
    "phone,whatsapp,email,website,instagram,telegram_username,telegram_user_id,"
    "services,preview_image_url,photos_count,raw_payload,review_notes"
)


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def empty_str(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def empty_list(v: Any) -> bool:
    return not (isinstance(v, list) and len(v) > 0)


def phone_digits(raw: str) -> str:
    """Last 10 digits — the US-local key used for matching."""
    d = re.sub(r"\D", "", raw or "")
    return d[-10:] if len(d) >= 10 else ""


def norm_name(raw: str) -> str:
    return re.sub(r"[^a-zа-я0-9]", "", (raw or "").lower())


def norm_instagram(raw: Any) -> str | None:
    """Any instagram spelling → bare handle, or None if it isn't one."""
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if not raw:
        return None
    v = str(raw).strip()
    m = re.search(r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})", v, re.I)
    handle = (m.group(1) if m else v.lstrip("@")).split("?")[0].split("/")[0]
    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", handle or ""):
        return None
    if handle.lower() in {"reel", "p", "stories", "explore", "accounts"}:
        return None
    return handle


def norm_website(raw: Any) -> str | None:
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if not raw:
        return None
    v = str(raw).strip()
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    low = v.lower()
    if any(
        x in low
        for x in (
            "instagram.com",
            "facebook.com",
            "fb.com",
            "t.me/",
            "telegram.me",
            "wa.me/",
            "yelp.com",
            "tiktok.com",
        )
    ):
        return None
    if "." not in v.split("//", 1)[-1]:
        return None
    return v.split("?")[0].rstrip("/")[:300]


def norm_http_url(raw: Any) -> str | None:
    """Normalize any http(s) URL (including social) for storage."""
    if not raw:
        return None
    v = str(raw).strip()
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    if "." not in v.split("//", 1)[-1]:
        return None
    return v.split("?")[0].rstrip("/")[:500]


def websites_of(item: dict[str, Any], patch: dict[str, Any]) -> list[str]:
    if "website" in patch:
        return [str(x) for x in (patch.get("website") or []) if x]
    return [str(x) for x in (item.get("website") or []) if x]


def _site_mine_priority(url: str) -> int:
    """Lower = mine earlier. Prefer own marketing sites over booking/PDF hosts."""
    low = url.lower()
    if any(h in low for h in ("gumroad.com", "etsy.com", "paypal.com")):
        return 80
    if any(
        h in low
        for h in (
            "glossgenius.com",
            "square.site",
            "squareup.com",
            "booksy.com",
            "vagaro.com",
            "calendly.com",
        )
    ):
        return 40
    if any(h in low for h in ("framer.website", "wixsite.com", "webflow.io", "carrd.co")):
        return 5
    return 20


def fetchable_sites(item: dict[str, Any], patch: dict[str, Any]) -> list[str]:
    """All fetchable websites on the card, marketing sites first."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in websites_of(item, patch):
        site = prefer_location_website(raw) or norm_website(raw)
        if not site or not is_fetchable_business_site(site):
            continue
        key = site.lower().rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        out.append(site)
    out.sort(key=_site_mine_priority)
    return out


def pick_fetchable_site(item: dict[str, Any], patch: dict[str, Any]) -> str | None:
    sites = fetchable_sites(item, patch)
    return sites[0] if sites else None


def has_url_host(urls: list[str], *needles: str) -> bool:
    low = " ".join(u.lower() for u in urls)
    return any(n in low for n in needles)


_ADDRESS_JUNK_RE = re.compile(
    r"\b(minutes?|hours?|days?|click|learn\s+more|sign\s*up|register)\b",
    re.I,
)
_STREET_SUFFIX_RE = re.compile(
    r"\b(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|"
    r"Parkway|Pkwy|Court|Ct|Place|Pl|Highway|Hwy|Circle|Cir|Terrace|Ter)\.?\b",
    re.I,
)
_BOOKING_LEAF_RE = re.compile(
    r"/(?:sign-?up|register|book(?:-?now|ing)?|schedule|enroll)(?:/|$)",
    re.I,
)


def prefer_location_website(url: str) -> str | None:
    """Drop booking/sign-up leaf so location pages (with real address) are fetched."""
    import urllib.parse

    site = norm_website(url)
    if not site:
        return None
    parsed = urllib.parse.urlparse(site)
    path = parsed.path or "/"
    if _BOOKING_LEAF_RE.search(path):
        parent = re.sub(
            r"/(?:sign-?up|register|book(?:-?now|ing)?|schedule|enroll)/?$",
            "",
            path.rstrip("/"),
            flags=re.I,
        )
        if not parent:
            parent = "/"
        site = urllib.parse.urlunparse(
            (parsed.scheme, parsed.netloc, parent, "", "", "")
        ).rstrip("/")
    return site or None


_STREET_CORE_RE = re.compile(
    r"\b(?P<street>\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9 .#'\-]{2,40}\s"
    r"(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|"
    r"Lane|Ln|Court|Ct|Place|Pl|Highway|Hwy|Parkway|Pkwy|Way)\.?)\b",
    re.I,
)

_CITY_STATE_RE = re.compile(
    r"(?<![A-Za-z])(?P<city>[A-Za-z][A-Za-z .'\-]{1,40}?)\s*,\s*"
    r"(?P<state>CA|California|WA|Washington|NY|New\s*York|FL|Florida|"
    r"OR|Oregon|TX|Texas|CO|Colorado|NV|Nevada|AZ|Arizona)"
    r"(?:\s+(?P<zip>\d{5})(?:-\d{4})?)?\b",
    re.I,
)

_STATE_ZIP_RE = re.compile(
    r"\b(?P<state>[A-Z]{2})\s+(?P<zip>\d{5})(?:-\d{4})?\b"
)


def is_plausible_street_address(address: str | None) -> bool:
    a = (address or "").strip()
    if len(a) < 10:
        return False
    if _ADDRESS_JUNK_RE.search(a):
        return False
    if not re.match(r"^\d{1,6}\s+\S", a):
        return False
    if _STREET_SUFFIX_RE.search(a):
        return True
    return bool(re.search(r",\s*[A-Za-z .'\-]{2,40}\s*,\s*[A-Z]{2}\b", a))


def _normalize_us_state(raw: str | None) -> str | None:
    if not raw:
        return None
    key = re.sub(r"\s+", " ", raw.strip()).lower()
    mapping = {
        "ca": "CA",
        "california": "CA",
        "wa": "WA",
        "washington": "WA",
        "ny": "NY",
        "new york": "NY",
        "fl": "FL",
        "florida": "FL",
        "or": "OR",
        "oregon": "OR",
        "tx": "TX",
        "texas": "TX",
        "co": "CO",
        "colorado": "CO",
        "nv": "NV",
        "nevada": "NV",
        "az": "AZ",
        "arizona": "AZ",
    }
    return mapping.get(key) or (raw.strip().upper()[:2] if len(raw.strip()) == 2 else None)


def split_us_address(address: str | None) -> dict[str, str | None]:
    """Split '1200 Irvine Blvd, Tustin, CA 92780' → street / city / state / zip.

    Never treats the house number as a ZIP.
    """
    out: dict[str, str | None] = {
        "address_line": None,
        "city": None,
        "state": None,
        "postal_code": None,
    }
    if not address or not str(address).strip():
        return out
    text = re.sub(r"\s+", " ", str(address).strip())
    m = re.search(
        r"^(.*?),\s*([A-Za-z .'\-]{2,40})\s*,\s*([A-Z]{2})\s*,?\s*(\d{5})(?:-\d{4})?\s*$",
        text,
    )
    if m:
        street = m.group(1).strip(" ,")
        out["address_line"] = street[:160] if street else None
        out["city"] = m.group(2).strip(" ,")[:80]
        out["state"] = m.group(3).upper()
        out["postal_code"] = m.group(4)
        return out
    m2 = re.search(
        r"^(.*?),\s*([A-Za-z .'\-]{2,40})\s*,?\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$",
        text,
    )
    if m2:
        street = m2.group(1).strip(" ,")
        out["address_line"] = street[:160] if street else None
        out["city"] = m2.group(2).strip(" ,")[:80]
        out["state"] = m2.group(3).upper()
        out["postal_code"] = m2.group(4)
        return out
    cm = re.search(
        r"^(?P<street>.*?),\s*(?P<city>[A-Za-z .'\-]{2,40})\s*,\s*(?P<state>[A-Z]{2})\b",
        text,
    )
    if cm:
        city = cm.group("city").strip(" ,")
        state = cm.group("state").upper()
        street = cm.group("street").strip(" ,")
        if city and city.lower() not in {"usa", "united states"}:
            out["city"] = city[:80]
            out["state"] = state
            if street and is_plausible_street_address(street):
                out["address_line"] = street[:160]
    # ZIP only after a state abbr — never the leading house number (18062 …).
    zm = _STATE_ZIP_RE.search(text)
    if zm:
        out["postal_code"] = zm.group("zip")
        if not out["state"]:
            out["state"] = zm.group("state").upper()
    if not out["address_line"] and is_plausible_street_address(text):
        # Strip trailing ", City, ST" if present so street stays clean.
        street_only = re.sub(
            r",\s*[A-Za-z .'\-]{2,40}\s*,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?\s*$",
            "",
            text,
        ).strip(" ,")
        out["address_line"] = (street_only or text)[:160]
    return out


def extract_us_address_from_text(text: str | None) -> dict[str, str | None]:
    """Pull street + City, ST from free text (incl. multiline «Адрес» blocks).

    Example:
      18062 Irvine Blvd,
      Tustin, CA
    → street=18062 Irvine Blvd, city=Tustin, state=CA
    """
    out: dict[str, str | None] = {
        "address_line": None,
        "city": None,
        "state": None,
        "postal_code": None,
    }
    blob = text or ""
    if not blob.strip():
        return out

    street_m = _STREET_CORE_RE.search(blob)
    if street_m:
        street = re.sub(r"\s+", " ", street_m.group("street")).strip(" .")
        if is_plausible_street_address(street):
            out["address_line"] = street[:160]
            # Prefer locality after the street (next ~120 chars / couple lines).
            tail = blob[street_m.end() : street_m.end() + 160]
            city_m = _CITY_STATE_RE.search(tail)
            if city_m:
                out["city"] = re.sub(r"\s+", " ", city_m.group("city")).strip(" ,")[:80]
                out["state"] = _normalize_us_state(city_m.group("state"))
                if city_m.group("zip"):
                    out["postal_code"] = city_m.group("zip")
            else:
                # Same-line: "18062 Irvine Blvd, Tustin, CA"
                window = blob[street_m.start() : street_m.end() + 80]
                parts = split_us_address(re.sub(r"\s+", " ", window))
                for key in ("city", "state", "postal_code"):
                    if parts.get(key) and not out.get(key):
                        out[key] = parts[key]

    if not out["city"]:
        # Labeled block or any clear "City, ST" that isn't a street fragment.
        for city_m in _CITY_STATE_RE.finditer(blob):
            city = re.sub(r"\s+", " ", city_m.group("city")).strip(" ,")
            # Skip "Blvd, Tustin" false starts — city must not end with street suffix.
            if _STREET_SUFFIX_RE.search(city):
                continue
            # Skip county labels used as city.
            if re.search(r"\bcounty\b", city, re.I):
                continue
            out["city"] = city[:80]
            out["state"] = _normalize_us_state(city_m.group("state"))
            if city_m.group("zip"):
                out["postal_code"] = city_m.group("zip")
            break

    if out["address_line"] and not out["city"]:
        parts = split_us_address(out["address_line"])
        for key in ("city", "state", "postal_code"):
            if parts.get(key) and not out.get(key):
                out[key] = parts[key]
    return out


def parse_city_state_from_address(address: str | None) -> tuple[str | None, str | None]:
    """Best-effort US city/state from a free-form address string."""
    parts = split_us_address(address)
    return parts.get("city"), parts.get("state")


def _city_is_street_token(city: str | None, street: str | None) -> bool:
    """True when city looks stolen from the street name (Irvine ⊂ Irvine Blvd)."""
    c = (city or "").strip().lower()
    s = (street or "").strip().lower()
    if not c or not s or c not in s:
        return False
    return bool(
        re.search(
            rf"\b{re.escape(c)}\b\s+(?:street|st|avenue|ave|boulevard|blvd|road|rd|"
            rf"drive|dr|lane|ln|court|ct|place|pl|highway|hwy|parkway|pkwy|way)\b",
            s,
            re.I,
        )
    )


def item_text(item: dict[str, Any]) -> str:
    return "\n".join(
        str(x)
        for x in (item.get("source_text"), item.get("description"), item.get("title"), item.get("business_name"))
        if x
    )


# ---------------------------------------------------------------------------
# step 1 — source_text
# ---------------------------------------------------------------------------

def step_source_text(item: dict[str, Any], patch: dict[str, Any]) -> list[str]:
    """Extract contacts from the record's own text. Fill-empty only."""
    text = item_text(item)
    if not text.strip():
        return []
    filled: list[str] = []

    if empty_list(item.get("phone")) and "phone" not in patch:
        phones = []
        for p in extract_phones(text):
            np = normalize_phone(p) or p
            if phone_digits(np) and np not in phones:
                phones.append(np)
        if phones:
            patch["phone"] = phones[:3]
            filled.append("phone")

    if empty_list(item.get("email")) and "email" not in patch:
        emails = extract_emails(text)
        if emails:
            patch["email"] = [e.lower() for e in emails[:3]]
            filled.append("email")

    if empty_list(item.get("website")) and "website" not in patch:
        web = norm_website((extract_websites(text) or [None])[0])
        if web:
            patch["website"] = [web]
            filled.append("website")

    if empty_list(item.get("instagram")) and "instagram" not in patch:
        ig = norm_instagram((extract_instagram(text) or [None])[0])
        if ig:
            patch["instagram"] = [ig]
            filled.append("instagram")

    if empty_str(item.get("telegram_username")) and "telegram_username" not in patch:
        tgs = extract_telegram(text)
        if tgs:
            h = tgs[0].lstrip("@")
            if re.fullmatch(r"[A-Za-z0-9_]{4,32}", h) and not h.isdigit():
                patch["telegram_username"] = h
                filled.append("telegram_username")

    cur_street = (
        patch.get("address_line")
        if "address_line" in patch
        else item.get("address_line")
    )
    cur_city = patch.get("city") if "city" in patch else item.get("city")
    cur_state = patch.get("state") if "state" in patch else item.get("state")
    cur_zip = (
        patch.get("postal_code") if "postal_code" in patch else item.get("postal_code")
    )
    parsed = extract_us_address_from_text(text)
    parsed_street = (parsed.get("address_line") or "").strip() or None
    parsed_city = (parsed.get("city") or "").strip() or None
    parsed_state = (parsed.get("state") or "").strip() or None
    parsed_zip = (parsed.get("postal_code") or "").strip() or None

    if empty_str(cur_street) and "address_line" not in patch and parsed_street:
        patch["address_line"] = parsed_street[:160]
        filled.append("address_line")
        cur_street = parsed_street

    # Fill city from the address block. Also repair when the current city was
    # stolen from the street name (Irvine ⊂ «18062 Irvine Blvd»).
    city_needs_fill = empty_str(cur_city) and "city" not in patch
    city_needs_repair = (
        parsed_city
        and not empty_str(cur_city)
        and parsed_city.lower() != str(cur_city).strip().lower()
        and _city_is_street_token(str(cur_city), cur_street or parsed_street)
    )
    if parsed_city and (city_needs_fill or city_needs_repair):
        patch["city"] = parsed_city[:80]
        if "city" not in filled:
            filled.append("city")
        cur_city = parsed_city

    if parsed_state and (
        (empty_str(cur_state) and "state" not in patch)
        or city_needs_repair
        or (
            cur_state
            and re.search(r"county", str(cur_state), re.I)
            and parsed_state
        )
    ):
        patch["state"] = parsed_state
        if "state" not in filled:
            filled.append("state")

    if parsed_zip and empty_str(cur_zip) and "postal_code" not in patch:
        patch["postal_code"] = parsed_zip
        filled.append("postal_code")

    return filled


# ---------------------------------------------------------------------------
# step 1b — source group → city / region (fill-empty)
# ---------------------------------------------------------------------------

def step_group_location(item: dict[str, Any], patch: dict[str, Any]) -> list[str]:
    """Attach city/region from description text, then Telegram/Facebook group."""
    from group_location import merge_city_with_group

    cur_city = patch.get("city") if "city" in patch else item.get("city")
    cur_state = patch.get("state") if "state" in patch else item.get("state")
    cur_street = (
        patch.get("address_line")
        if "address_line" in patch
        else item.get("address_line")
    )
    # Address block already gave a real city — don't invent from group / Irvine Blvd.
    if not empty_str(cur_city) and not _city_is_street_token(cur_city, cur_street):
        # Still normalize county-as-state when we already have a city.
        if (
            cur_state
            and re.search(r"county", str(cur_state), re.I)
            and "state" not in patch
        ):
            text = item_text(item)
            parsed = extract_us_address_from_text(text)
            if parsed.get("state"):
                patch["state"] = parsed["state"]
                return ["state"]
        return []

    text = item_text(item)
    merged = merge_city_with_group(
        city=None if _city_is_street_token(cur_city, cur_street) else cur_city,
        state=cur_state,
        source_group=item.get("source_group"),
        source=item.get("source"),
        chat_title=item.get("source_group"),
        text=text,
        address_line=cur_street,
    )
    filled: list[str] = []
    new_city = (merged.get("city") or "").strip() or None
    new_state = (merged.get("state") or "").strip() or None
    # Prefer CA over county label when we resolved a real city.
    if new_city and new_state and re.search(r"county", new_state, re.I):
        new_state = "CA"
    # County-only (Orange County in description / Fun for Mom): use as place label.
    place = new_city or new_state
    if place and (empty_str(cur_city) or _city_is_street_token(cur_city, cur_street)) and "city" not in patch:
        patch["city"] = place
        filled.append("city")
    if (
        empty_str(cur_state)
        and "state" not in patch
        and new_state
        and new_state != place
    ):
        patch["state"] = new_state
        filled.append("state")
    elif empty_str(cur_state) and "state" not in patch and place and not new_city:
        patch["state"] = "CA"
        filled.append("state")
    return filled


# ---------------------------------------------------------------------------
# step 2 — website
# ---------------------------------------------------------------------------

# Big platforms/marketplaces whose contact pages describe THE PLATFORM, not the
# queue record's business (found in testing: a post recommending vistaprint.com
# pulled Vistaprint's own support phone). Extends JUNK_HOST_PARTS from
# enrich_published_businesses.py, which is also applied below.
PLATFORM_HOSTS = (
    "vistaprint.com",
    "wix.com",
    "squarespace.com",
    "godaddy.com",
    "weebly.com",
    "canva.com",
    "amazon.com",
    "ebay.com",
    "walmart.com",
    "google.com",
    "yelp.com",
    "zillow.com",
    "craigslist.org",
    "avito.ru",
    "wildberries.ru",
    "ozon.ru",
)


def is_fetchable_business_site(url: str) -> bool:
    return fetch_skip_reason(url) is None


def fetch_skip_reason(url: str | None) -> str | None:
    """Human-readable reason a URL is not crawled, or None if fetchable."""
    if not url or not str(url).strip():
        return "пустая ссылка"
    from enrich_published_businesses import is_junk_website

    low = str(url).lower().strip()
    if is_junk_website(low):
        if any(
            p in low
            for p in (
                "maps.app.goo.gl",
                "goo.gl/",
                "maps.apple",
                "maps.google",
            )
        ):
            return "ссылка на карту, не сайт бизнеса"
        if any(
            p in low
            for p in (
                "instagram.com",
                "facebook.com",
                "fb.com",
                "t.me/",
                "wa.me/",
                "tiktok.com",
                "youtube.com",
                "youtu.be",
            )
        ):
            return "соцсеть / мессенджер — не сайт для обхода"
        if any(p in low for p in ("linktr.ee", "forms.gle", "docs.google")):
            return "форма / link-in-bio — не сайт бизнеса"
        return "служебная / каталожная ссылка"
    for host in PLATFORM_HOSTS:
        if host in low:
            return f"платформа {host} — не сайт карточки"
    return None


def step_website(
    item: dict[str, Any],
    patch: dict[str, Any],
    max_pages: int,
    *,
    on_resource: Any | None = None,
) -> list[str]:
    """BFS-mine every fetchable website on the card, then fill gaps.

    Walks each host (page budget) and merges before fill-empty / weak-description
    rules. Does not stop after the first site once contacts appear.

    on_resource: optional callback for admin UI NDJSON resource events.
    """
    cur_websites = websites_of(item, patch)
    from completeness_score import is_weak_description

    def _emit_resource(ev: dict[str, Any]) -> None:
        if not on_resource:
            return
        try:
            on_resource(ev)
        except Exception:
            pass

    # Always log why card URLs were skipped — empty history is confusing.
    for raw in cur_websites:
        reason = fetch_skip_reason(prefer_location_website(raw) or norm_website(raw) or raw)
        if reason:
            _emit_resource(
                {
                    "type": "resource",
                    "url": str(raw),
                    "kind": "website",
                    "status": "skipped",
                    "outcome": "skipped",
                    "fields": [],
                    "error": reason,
                }
            )

    still_missing = (
        (empty_list(item.get("phone")) and "phone" not in patch)
        or (empty_list(item.get("email")) and "email" not in patch)
        or (empty_list(item.get("instagram")) and "instagram" not in patch)
        or (
            is_weak_description(item.get("description"))
            and "description" not in patch
        )
        or (empty_str(item.get("preview_image_url")) and "preview_image_url" not in patch)
        or (empty_str(item.get("city")) and "city" not in patch)
        or (empty_str(item.get("address_line")) and "address_line" not in patch)
        or (empty_list(item.get("services")) and "services" not in patch)
        or (
            empty_list(item.get("payment_methods"))
            and "payment_methods" not in patch
        )
        or not has_url_host(cur_websites, "facebook.com", "fb.com")
        or not has_url_host(cur_websites, "yelp.com")
        or not has_url_host(cur_websites, "tiktok.com")
    )
    if not still_missing:
        return []
    sites = fetchable_sites(item, patch)
    if not sites:
        if not cur_websites:
            _emit_resource(
                {
                    "type": "resource",
                    "url": "(нет ссылок)",
                    "kind": "website",
                    "status": "skipped",
                    "outcome": "skipped",
                    "fields": [],
                    "error": "на карточке нет сайта для обхода",
                }
            )
        return []

    from web_enrichment import (  # slow import — only when needed
        extract_website_profile_deep,
        merge_website_profiles,
        website_profile_gaps,
    )

    profile: dict[str, Any] | None = None
    for site in sites[:5]:
        try:
            next_prof = extract_website_profile_deep(
                site,
                max_pages=max_pages,
                on_page=lambda p: _emit_resource(
                    {
                        "type": "resource",
                        "url": p.get("url"),
                        "kind": p.get("kind") or "website",
                        "status": p.get("status"),
                        "outcome": p.get("outcome"),
                        "fields": p.get("fields"),
                        "error": p.get("error"),
                    }
                ),
            )
        except Exception as exc:  # network errors must never kill the batch
            print(f"    website fetch failed ({site}): {exc}")
            _emit_resource(
                {
                    "type": "resource",
                    "url": site,
                    "kind": "website",
                    "status": "error",
                    "outcome": "error",
                    "error": str(exc)[:200],
                }
            )
            continue
        if next_prof.get("status") != "ok":
            _emit_resource(
                {
                    "type": "resource",
                    "url": site,
                    "kind": "website",
                    "status": "error",
                    "outcome": "error",
                    "error": str(next_prof.get("error") or next_prof.get("status") or "error")[
                        :200
                    ],
                }
            )
            continue
        profile = merge_website_profiles(profile, next_prof)
        gaps = website_profile_gaps(profile)
        card_still_needs_site = (
            (empty_list(item.get("phone")) and "phone" not in patch and "phone" in gaps)
            or (empty_list(item.get("email")) and "email" not in patch and "email" in gaps)
            or (
                empty_list(item.get("instagram"))
                and "instagram" not in patch
                and "instagram" in gaps
            )
            or (
                is_weak_description(item.get("description"))
                and "description" not in patch
                and "description" in gaps
            )
            or (
                empty_str(item.get("preview_image_url"))
                and "preview_image_url" not in patch
                and "logo" in gaps
            )
            or (
                empty_list(item.get("services"))
                and "services" not in patch
                and "services" in gaps
            )
            or (
                empty_list(item.get("payment_methods"))
                and "payment_methods" not in patch
                and "payment_methods" in gaps
            )
            or (
                empty_str(item.get("address_line"))
                and "address_line" not in patch
                and "address" in gaps
            )
        )
        # Keep mining other hosts while the card still needs fields those hosts
        # might provide. Only stop the host loop when nothing is left to find.
        if not card_still_needs_site and not gaps:
            break

    if not profile or profile.get("status") != "ok":
        return []

    filled: list[str] = []
    if empty_list(item.get("phone")) and "phone" not in patch and profile.get("phone"):
        phones = [normalize_phone(p) or p for p in profile["phone"] if phone_digits(p)]
        if phones:
            patch["phone"] = phones[:3]
            filled.append("phone")
    if empty_list(item.get("email")) and "email" not in patch and profile.get("email"):
        patch["email"] = [str(e).lower() for e in profile["email"][:3]]
        filled.append("email")
    if (
        empty_list(item.get("payment_methods"))
        and "payment_methods" not in patch
        and profile.get("payment_methods")
    ):
        patch["payment_methods"] = [
            str(method).strip()
            for method in profile["payment_methods"]
            if str(method).strip()
        ][:12]
        filled.append("payment_methods")
    if empty_list(item.get("instagram")) and "instagram" not in patch:
        for link in profile.get("social_links") or []:
            ig = norm_instagram(link)
            if ig:
                patch["instagram"] = [ig]
                filled.append("instagram")
                break

    # Description / photo / services — fill empty or replace weak (links/comments)
    desc = (profile.get("description") or "").strip()
    if (
        "description" not in patch
        and len(desc) >= 40
        and is_weak_description(item.get("description"))
        and not is_weak_description(desc)
    ):
        patch["description"] = desc[:2000]
        filled.append("description")
    logo = (profile.get("logo") or "").strip()
    if (
        empty_str(item.get("preview_image_url"))
        and "preview_image_url" not in patch
        and logo.startswith("http")
    ):
        patch["preview_image_url"] = logo[:500]
        filled.append("preview_image_url")
    if empty_list(item.get("services")) and "services" not in patch:
        svcs = [str(s).strip() for s in (profile.get("services") or []) if str(s).strip()]
        if svcs:
            patch["services"] = svcs[:20]
            filled.append("services")

    # Street address from site (shared workplace OK) + city/state/zip
    addr_parts = split_us_address(profile.get("address"))
    raw_addr = (profile.get("address") or "").strip()
    if (
        empty_str(item.get("address_line"))
        and "address_line" not in patch
        and is_plausible_street_address(raw_addr)
    ):
        street = (addr_parts.get("address_line") or raw_addr).strip()
        if street and is_plausible_street_address(street):
            patch["address_line"] = street[:160]
            filled.append("address_line")
    if (
        empty_str(item.get("postal_code"))
        and "postal_code" not in patch
        and addr_parts.get("postal_code")
    ):
        patch["postal_code"] = str(addr_parts["postal_code"])[:10]
        filled.append("postal_code")

    city_from_addr = addr_parts.get("city")
    state_from_addr = addr_parts.get("state")
    if not city_from_addr and not state_from_addr:
        city_from_addr, state_from_addr = parse_city_state_from_address(raw_addr)
    cur_city = patch.get("city") if "city" in patch else item.get("city")
    cur_state = patch.get("state") if "state" in patch else item.get("state")
    if empty_str(cur_city) and "city" not in patch and city_from_addr:
        patch["city"] = city_from_addr
        filled.append("city")
    if empty_str(cur_state) and "state" not in patch and state_from_addr:
        patch["state"] = state_from_addr
        filled.append("state")

    # Append Facebook / Yelp / TikTok into website[] (queue has no dedicated columns)
    social_add: list[str] = []
    for link in profile.get("social_links") or []:
        u = norm_http_url(link)
        if not u:
            continue
        low = u.lower()
        if "instagram.com" in low:
            continue
        if any(h in low for h in ("facebook.com", "fb.com", "yelp.com", "tiktok.com")):
            social_add.append(u)
    if social_add:
        existing = websites_of(item, patch)
        existing_low = {e.lower().rstrip("/") for e in existing}
        merged = list(existing)
        added = False
        for u in social_add:
            key = u.lower().rstrip("/")
            if key in existing_low:
                continue
            existing_low.add(key)
            merged.append(u)
            added = True
        if added:
            patch["website"] = merged[:12]
            if "website" not in filled:
                filled.append("website")

    return filled


# ---------------------------------------------------------------------------
# step 3 — directories (local dumps, no network)
# ---------------------------------------------------------------------------

def load_directory_index() -> tuple[dict[str, dict], dict[str, dict]]:
    """Index all local directory cards by phone digits and by normalized name."""
    by_phone: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    for path in DIRECTORY_DUMPS:
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        cards = data.get("cards") or [] if isinstance(data, dict) else data
        for card in cards:
            if not isinstance(card, dict):
                continue
            for p in card.get("phones") or []:
                key = phone_digits(str(p))
                if key and key not in by_phone:
                    by_phone[key] = card
            name = norm_name(card.get("display_name") or "")
            if len(name) >= 6 and name not in by_name:
                by_name[name] = card
    return by_phone, by_name


def step_directories(
    item: dict[str, Any],
    patch: dict[str, Any],
    by_phone: dict[str, dict],
    by_name: dict[str, dict],
) -> tuple[list[str], str | None]:
    """Match a directory card by phone (strong) or exact name (weaker)."""
    card = None
    match_kind = None
    for p in (item.get("phone") or []) + (patch.get("phone") or []):
        card = by_phone.get(phone_digits(str(p)))
        if card:
            match_kind = "phone"
            break
    if not card:
        for raw in (item.get("business_name"), item.get("person_name"), item.get("title")):
            name = norm_name(raw or "")
            if len(name) >= 6 and name in by_name:
                card = by_name[name]
                match_kind = "name"
                break
    if not card:
        return [], None

    filled: list[str] = []
    if empty_list(item.get("phone")) and "phone" not in patch and card.get("phones"):
        phones = [normalize_phone(str(p)) or str(p) for p in card["phones"] if phone_digits(str(p))]
        if phones:
            patch["phone"] = phones[:3]
            filled.append("phone")
    if empty_list(item.get("email")) and "email" not in patch and card.get("emails"):
        patch["email"] = [str(e).lower() for e in card["emails"][:3]]
        filled.append("email")
    if empty_list(item.get("instagram")) and "instagram" not in patch:
        ig = norm_instagram(card.get("instagram"))
        if ig:
            patch["instagram"] = [ig]
            filled.append("instagram")
    if empty_str(item.get("city")) and "city" not in patch and (card.get("city") or "").strip():
        patch["city"] = str(card["city"]).strip()
        filled.append("city")
    if empty_str(item.get("preview_image_url")) and "preview_image_url" not in patch:
        cover = (card.get("cover_image_url") or "").strip()
        if cover.startswith("http"):
            patch["preview_image_url"] = cover[:500]
            filled.append("preview_image_url")
    return filled, match_kind


# ---------------------------------------------------------------------------
# completeness score on a queue record
# ---------------------------------------------------------------------------

LISTING_WEIGHTS = {"title": 20, "price": 20, "description": 20, "image": 15, "city": 10, "contact": 15}
EVENT_WEIGHTS = {
    "title": 15,
    "when": 20,
    "where": 15,
    "price": 10,
    "description": 15,
    "contact": 15,
    "image": 10,
}


def score_queue_item(entity: str, item: dict[str, Any], patch: dict[str, Any]) -> int:
    """Completeness of the queue record with `patch` applied on top.

    business/professional reuse calculate_completeness_score() with queue
    fields mapped into the scorer's shape (queue has no hours/offers/etc.,
    so this is a floor, not the final published score). `category` presence
    stands in for category_id. Listings use the small table above.
    """
    row = {**item, **patch}

    def first(key: str) -> Any:
        v = row.get(key)
        return v[0] if isinstance(v, list) and v else (v if not isinstance(v, list) else None)

    has_contact = any(
        (row.get(k) if not isinstance(row.get(k), list) else row.get(k))
        for k in ("phone", "whatsapp", "email", "website", "instagram", "telegram_username")
    )

    if entity == "listing":
        s = 0
        if (row.get("title") or row.get("business_name") or "").strip():
            s += LISTING_WEIGHTS["title"]
        if row.get("price") is not None:
            s += LISTING_WEIGHTS["price"]
        if ((row.get("description") or row.get("source_text") or "").strip()):
            s += LISTING_WEIGHTS["description"]
        if (row.get("preview_image_url") or "").strip() or (row.get("photos_count") or 0) > 0:
            s += LISTING_WEIGHTS["image"]
        if (row.get("city") or "").strip():
            s += LISTING_WEIGHTS["city"]
        if has_contact:
            s += LISTING_WEIGHTS["contact"]
        return s

    if entity == "event":
        s = 0
        if (row.get("title") or row.get("business_name") or "").strip():
            s += EVENT_WEIGHTS["title"]
        raw = row.get("raw_payload") if isinstance(row.get("raw_payload"), dict) else {}
        ev = (raw or {}).get("event_structure") if isinstance(raw, dict) else {}
        if not isinstance(ev, dict):
            ev = {}
        notes = row.get("review_notes") or ""
        if (
            (ev.get("event_at_label") or ev.get("starts_at") or "").strip()
            or "event_at:" in notes
            or "[event_date_confirmed]" in notes
        ):
            s += EVENT_WEIGHTS["when"]
        if (row.get("address_line") or row.get("city") or "").strip():
            s += EVENT_WEIGHTS["where"]
        if row.get("price") is not None or (ev.get("price_label") or "").strip() or "price_label:" in notes:
            s += EVENT_WEIGHTS["price"]
        if ((row.get("description") or "").strip()):
            s += EVENT_WEIGHTS["description"]
        if has_contact:
            s += EVENT_WEIGHTS["contact"]
        if (row.get("preview_image_url") or "").strip() or (row.get("photos_count") or 0) > 0:
            s += EVENT_WEIGHTS["image"]
        return s

    mapped = {
        "city": row.get("city"),
        "phone": first("phone"),
        "website": first("website"),
        "email": first("email"),
        "instagram_url": first("instagram"),
        "telegram_url": row.get("telegram_username"),
        "description": row.get("description") or row.get("source_text"),
        "image_url": row.get("preview_image_url"),
        "source_url": row.get("source_url"),
        "category_id": row.get("category"),  # presence proxy
    }
    if entity == "business":
        mapped["name"] = row.get("business_name") or row.get("title")
        return calculate_completeness_score("business", mapped)["score"]
    mapped["display_name"] = row.get("person_name") or row.get("title")
    return calculate_completeness_score("professional", mapped)["score"]


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def fetch_batch(client: SupabaseRest, entity_type: str, offset: int, size: int) -> list[dict[str, Any]]:
    return client._request(
        "GET",
        "/import_review_items",
        params={
            "select": QUEUE_SELECT,
            "entity_type": f"eq.{entity_type}",
            "review_status": f"in.{QUEUE_STATUSES}",
            "order": "id.asc",
            "limit": str(size),
            "offset": str(offset),
        },
    ) or []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--entity", choices=sorted(ENTITY_MAP), required=True)
    parser.add_argument("--apply", action="store_true", help="write patches (default: dry-run)")
    parser.add_argument("--limit", type=int, default=0, help="max records total (0 = all)")
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--no-website", action="store_true", help="skip the website-fetch step (offline)")
    parser.add_argument(
        "--website-pages",
        type=int,
        default=10,
        help="max same-host pages per website BFS",
    )
    args = parser.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    entity_type = ENTITY_MAP[args.entity]
    by_phone, by_name = load_directory_index()
    print(f"entity={args.entity} ({entity_type})  mode={'APPLY' if args.apply else 'dry-run'}")
    print(f"directory index: {len(by_phone)} phones, {len(by_name)} names")

    results: list[dict[str, Any]] = []
    step_hits = {"source_text": 0, "website": 0, "directories": 0}
    field_hits: dict[str, int] = {}
    processed = updated = 0
    offset = 0
    batch_no = 0

    while True:
        size = args.batch_size
        if args.limit:
            size = min(size, args.limit - processed)
            if size <= 0:
                break
        batch = fetch_batch(client, entity_type, offset, size)
        if not batch:
            break
        batch_no += 1
        print(f"\n— batch {batch_no}: {len(batch)} records (offset {offset})")

        for item in batch:
            processed += 1
            patch: dict[str, Any] = {}
            score_before = score_queue_item(args.entity, item, {})

            f1 = step_source_text(item, patch)
            f1b = step_group_location(item, patch)
            f2 = [] if args.no_website else step_website(item, patch, args.website_pages)
            f3, match_kind = step_directories(item, patch, by_phone, by_name)

            score_after = score_queue_item(args.entity, item, patch)
            label = (item.get("business_name") or item.get("person_name") or item.get("title") or item["id"])[:60]

            if patch:
                updated += 1
                for step_name, fields in (
                    ("source_text", f1),
                    ("group_location", f1b),
                    ("website", f2),
                    ("directories", f3),
                ):
                    if fields:
                        step_hits[step_name] += 1
                for k in patch:
                    field_hits[k] = field_hits.get(k, 0) + 1
                if args.apply:
                    client.patch(
                        "import_review_items",
                        {"id": f"eq.{item['id']}"},
                        {**patch, "updated_at": datetime.now(timezone.utc).isoformat()},
                    )
                steps_str = " ".join(
                    f"{n}({','.join(f)})" for n, f in (("source_text", f1), ("website", f2), ("directories", f3)) if f
                )
                if match_kind:
                    steps_str += f" [dir match: {match_kind}]"
                print(f"  {'APPLIED' if args.apply else 'would fill'}  {label}: {steps_str}  score {score_before}→{score_after}")
            else:
                print(f"  no gaps fillable  {label}  score {score_before}")

            results.append(
                {
                    "id": item["id"],
                    "label": label,
                    "score_before": score_before,
                    "score_after": score_after,
                    "patch": patch,
                    "steps": {"source_text": f1, "website": f2, "directories": f3},
                    "directory_match": match_kind,
                }
            )

        offset += len(batch)
        if len(batch) < size:
            break

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "entity": args.entity,
        "processed": processed,
        "updated": updated,
        "step_hits": step_hits,
        "field_hits": dict(sorted(field_hits.items(), key=lambda x: -x[1])),
        "avg_score_before": round(sum(r["score_before"] for r in results) / len(results), 1) if results else None,
        "avg_score_after": round(sum(r["score_after"] for r in results) / len(results), 1) if results else None,
        "records": results,
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if args.apply else 'dry_run'}_{args.entity}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"{'apply' if args.apply else 'dry_run'}_{args.entity}_latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("\n" + json.dumps({k: report[k] for k in ("mode", "entity", "processed", "updated", "step_hits", "field_hits", "avg_score_before", "avg_score_after")}, ensure_ascii=False, indent=2))
    print("report", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
