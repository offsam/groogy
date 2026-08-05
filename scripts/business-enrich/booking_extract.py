"""Shared booking-URL helpers for business / professional enrich."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from scrape_booking_urls import (  # noqa: E402
    BOOK_HOSTS,
    extract_booking_url,
    fetch_html,
    normalize,
)

# Hosts that are themselves the booking product (URL is the CTA).
_BOOKING_PLATFORM_RE = re.compile(
    r"(?i)("
    + "|".join(re.escape(h) for h in BOOK_HOSTS)
    + r"|glossgenius\.com|square\.site|book\.squareup\.com"
    + r")"
)

_PLATFORM_CHROME_RE = re.compile(
    r"(?i)how-buynow|help\.|/support|/blog|/pricing|/about|/careers|"
    r"glossgenius\.com/?$|glossgenius\.com/how-"
)


def is_junk_booking_url(url: str | None) -> bool:
    """Platform marketing pages mistaken for a booking CTA."""
    if not url or not str(url).strip():
        return True
    return bool(_PLATFORM_CHROME_RE.search(str(url)))


def is_booking_platform_url(url: str | None) -> bool:
    if not url or not str(url).strip():
        return False
    low = str(url).lower()
    try:
        host = (urlparse(low if "://" in low else f"https://{low}").hostname or "").removeprefix(
            "www."
        )
    except Exception:
        return False
    if not host:
        return False
    return bool(_BOOKING_PLATFORM_RE.search(host)) or any(h in host for h in BOOK_HOSTS)


def resolve_booking_url(
    page_url: str | None,
    *,
    html: str | None = None,
) -> str | None:
    """Return a booking CTA URL from a page URL (and optional HTML).

    Artist booking subdomains (vitaliia.glossgenius.com) are used as-is.
    Otherwise prefers Book Now / provider links found on the page.
    """
    base = normalize(page_url) if page_url else None
    if not base:
        return None

    try:
        host = (urlparse(base).hostname or "").lower().removeprefix("www.")
    except Exception:
        host = ""

    # Subdomain booking apps — the page itself is the CTA.
    if host and host.count(".") >= 2 and is_booking_platform_url(base):
        return base.rstrip("/")[:500]
    if host in {
        "calendly.com",
        "cal.com",
        "booksy.com",
        "vagaro.com",
        "fresha.com",
        "styleseat.com",
        "square.site",
        "book.squareup.com",
    } or any(
        host.endswith("." + h)
        for h in (
            "calendly.com",
            "cal.com",
            "booksy.com",
            "vagaro.com",
            "fresha.com",
            "styleseat.com",
            "square.site",
        )
    ):
        return base.rstrip("/")[:500]

    body = html if html is not None else (fetch_html(base) or "")
    if body:
        hit = extract_booking_url(base, body)
        if hit and hit.get("url"):
            cand = str(hit["url"]).strip()
            if cand and not _PLATFORM_CHROME_RE.search(cand):
                return cand[:500]
        # CRA/Vite: Calendly etc. only in /static/js — scan same-origin bundles.
        try:
            from web_enrichment import _spa_booking_url_from_page  # type: ignore

            spa = _spa_booking_url_from_page(body, base)
            if spa and not _PLATFORM_CHROME_RE.search(spa):
                return spa[:500]
        except Exception:
            pass

    if is_booking_platform_url(base):
        return base.rstrip("/")[:500]
    return None


def prefer_marketing_website(
    website: str | None,
    booking: str | None,
    candidates: list[str | None],
) -> str | None:
    """If website is a booking host, prefer a non-booking candidate as website."""
    if website and not is_booking_platform_url(website):
        return None  # keep current
    for raw in candidates:
        n = normalize(raw) if raw else None
        if not n or is_booking_platform_url(n):
            continue
        if booking and n.rstrip("/").lower() == booking.rstrip("/").lower():
            continue
        return n
    return None
