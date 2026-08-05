#!/usr/bin/env python3
"""Mine a to4ka.us catalog listing via the JSON API — never the HTML page.

The public catalog HTML (and the full API envelope) carry siteContext.ads,
similarListings and banners (Apteka03, Bazar Club, trucking jobs, …). Whole-page
scrapes folded those into description / website / Instagram. This module reads
only ``data.listing`` (attributes + contacts embedded in links.canonical).
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from html import unescape
from typing import Any

DETAIL = "https://api.to4ka.us/api/listings"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

UUID_RE = re.compile(
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.I,
)
PHONE_RE = re.compile(
    r"(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-]\d{3}[\s\-]\d{4}|\(\d{3}\)\s*\d{3}[\-\s]?\d{4}|\d{3}[\-\s]\d{3}[\-\s]\d{4})"
)

# Websites stuffed into many unrelated to4ka listings (platform ads / placeholders).
TO4KA_JUNK_WEBSITE_PARTS = (
    "bazar.club",
    "bazarclub",
    "apteka03",
    "madbid.com",
    "to4ka.us",
    "api.to4ka",
)


def clean_html_text(s: str | None) -> str:
    t = unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", t).strip()


def listing_uuid_from_url(url: str | None) -> str | None:
    raw = (url or "").strip()
    if not raw:
        return None
    m = UUID_RE.search(raw)
    return m.group(1).lower() if m else None


def is_to4ka_junk_website(url: str | None) -> bool:
    low = (url or "").strip().lower()
    if not low:
        return True
    return any(p in low for p in TO4KA_JUNK_WEBSITE_PARTS)


def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def _get_json(url: str, timeout: float = 25) -> dict[str, Any]:
    last: Exception | None = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(0.35 * (attempt + 1))
    raise RuntimeError(f"GET {url}: {last}")


def _website_from_canonical(canon: str) -> str | None:
    url_m = re.search(r'"url":"(https?:\\/\\/[^"]+)"', canon or "")
    if not url_m:
        return None
    website = url_m.group(1).replace("\\/", "/")
    if is_to4ka_junk_website(website):
        return None
    return website


def _phone_area(digits: str) -> str:
    if digits.startswith("1") and len(digits) == 11:
        return digits[1:4]
    return digits[:3]


def _phone_from_canonical(canon: str) -> str | None:
    # Prefer structured contacts.primary_phone inside the embedded JSON blob.
    m = re.search(r'"primary_phone":"([^"]+)"', canon or "")
    if m:
        p = normalize_phone(m.group(1))
        if p:
            digits = re.sub(r"\D", "", p)
            # to4ka placeholder +1 (000) 000 0000
            if _phone_area(digits) not in {"000", "555"}:
                return p
    for raw in PHONE_RE.findall(canon or ""):
        p = normalize_phone(raw)
        if not p:
            continue
        digits = re.sub(r"\D", "", p)
        if _phone_area(digits) in {"000", "555"}:
            continue
        return p
    return None


def enrich_to4ka_listing(url: str) -> dict[str, Any]:
    """Return a directory-mine dict shaped like enrich_svoi_page / orange pages."""
    out: dict[str, Any] = {
        "phones": [],
        "emails": [],
        "instagram": [],
        "websites": [],
        "description": None,
        "address_line": None,
        "city": None,
        "postal_code": None,
        "cover_image_url": None,
        "source_url": url,
        "directory_source": "to4ka",
    }
    uid = listing_uuid_from_url(url)
    if not uid:
        out["_svoi_error"] = "to4ka_no_listing_uuid"
        return out
    try:
        data = _get_json(f"{DETAIL}/{uid}")
    except Exception as exc:  # noqa: BLE001
        out["_svoi_error"] = f"to4ka_fetch:{exc}"[:200]
        return out

    # CRITICAL: only data.listing — never siteContext / similarListings / banners.
    listing = ((data.get("data") or {}).get("listing")) or {}
    if not listing:
        out["_svoi_error"] = "to4ka_empty_listing"
        return out

    attrs = listing.get("attributes") or {}
    links = listing.get("links") or {}
    canon = links.get("canonical") or ""

    desc = clean_html_text(attrs.get("description"))
    if desc:
        out["description"] = desc[:4000]

    addr = attrs.get("address") or {}
    if isinstance(addr, str):
        try:
            addr = json.loads(addr)
        except json.JSONDecodeError:
            addr = {"full": addr}
    if isinstance(addr, dict):
        full = clean_html_text(addr.get("full") or "")
        city = clean_html_text(addr.get("city") or "") or None
        building = clean_html_text(addr.get("building") or "")
        street = clean_html_text(addr.get("street") or "")
        postal = clean_html_text(addr.get("postal_code") or "") or None
        if building and street:
            out["address_line"] = f"{building} {street}"[:160]
        elif full:
            # Prefer street-ish part before city when full is "1200 South Central Avenue, Glendale, CA, USA"
            out["address_line"] = full.split(",")[0].strip()[:160] if "," in full else full[:160]
        if city:
            out["city"] = city[:80]
        if postal:
            out["postal_code"] = postal[:16]

    phone = _phone_from_canonical(canon)
    if phone:
        out["phones"] = [phone]

    website = _website_from_canonical(canon)
    if website:
        out["websites"] = [website]

    # Never pull socials / emails from siteContext or similarListings.
    # Listing contacts rarely have email; leave empty rather than guess from chrome.
    return out
