#!/usr/bin/env python3
"""Enrich resource follow policy — single source of truth.

Product rules (must not regress):
  1. Never chase outbound related_websites from the card's own marketing site
     or social profiles — that pulls WordPress XFN / blogrolls / IndieWeb chrome
     (gmpg.org, tantek.com, …) into the BFS queue.
  2. related_websites may be followed only from directory / booking-SaaS /
     source pages, and only when the URL can be this card's own site.
  3. CMS / IndieWeb / license / feed chrome hosts are never identity URLs.

Used by enrich_resource_queue.py and web_enrichment.py. Drift-checked by
test_enrich_follow_policy.py (CI).
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

# Host fragments that are platform/CMS chrome — never a card's website.
CMS_CHROME_HOST_PARTS: tuple[str, ...] = (
    "gmpg.org",
    "creativecommons.org",
    "wordpress.org",
    "wordpress.com",
    "wp.com",
    "wp.me",
    "gravatar.com",
    "s0.wp.com",
    "i0.wp.com",
    "secure.gravatar.com",
    "indieweb.org",
    "indieauth.com",
    "webmention.io",
    "pubsubhubbub",
    "brid.gy",
    "micro.blog",
    "myopenid.com",
    "schema.org",
    "w3.org",
    "github.com",
    "gist.github.com",
    "codepen.io",
    "wikipedia.org",
    "wikimedia.org",
    "mastodon.social",
    "tumblr.com",
    "brew.sh",
    "andre-simon.de",
    # Classic XFN / IndieWeb example blogroll — never a КРУГИ card
    "tantek.com",
    "photomatt.net",
    "meyerweb.com",
    "zeldman.com",
    "ma.tt",
    "santaclaus.com",
    "atomicarchive.com",
    "cssday.nl",
)

# Booking SaaS — outbound "marketing site" links are allowed from tenant pages.
BOOKING_PLATFORM_HOSTS: tuple[str, ...] = (
    "dikidi.net",
    "dikidi.app",
    "glossgenius.com",
    "booksy.com",
    "vagaro.com",
    "squareup.com",
    "square.site",
    "calendly.com",
    "setmore.com",
)

DIRECTORY_HOSTS: tuple[str, ...] = (
    "svoi.us",
    "russianorangepages.com",
    "orange-pages",
    "yellowpages",
    "to4ka.us",
    "api.to4ka.us",
)

# Real advertisers / civic links that leak from ROP WordPress sidebars.
# Never *discover* them as a card's site (GLUED_CARDS_AUDIT). An admin may still
# set one as the card website — seed release bypasses this denylist.
DIRECTORY_SIDEBAR_HOSTS: tuple[str, ...] = (
    "fchconstruction.org",
    "liveattheshell.org",
    "art-a-fair.com",
    "ocparks.com",
    "themuck.org",
    # More ROP WordPress sidebar / footer advertisers (see Assanti enrich glue).
    "bike911.com",
    "lifespringhomeopathy.com",
    "rusoc.com",
    "documentheroes.com",
    # to4ka catalog ads / similarListings / stuffed listing.url placeholders.
    "bazar.club",
    "apteka03.online",
    "apteka03.com",
    "madbid.com",
)

# Paths that are metadata, not a business homepage.
_CMS_CHROME_PATH_RE = re.compile(
    r"(?:/xfn\b|/licenses?/|/license\b|/feed\b|/rss\b|/atom\b|"
    r"webmention|openid|indieauth|/token\b|/auth\b)",
    re.I,
)

# Kinds that never donate related_websites into the BFS queue.
_NO_RELATED_KINDS = frozenset(
    {"instagram", "tiktok", "facebook", "yelp", "other"}
)


def host_of(url: str | None) -> str:
    if not url:
        return ""
    try:
        return (urlparse(url).hostname or "").lower().replace("www.", "")
    except Exception:
        return ""


def is_cms_chrome_url(url: str | None) -> bool:
    """True for WordPress XFN / IndieWeb / license / CMS chrome URLs."""
    if not url:
        return True
    low = url.lower()
    if any(p in low for p in CMS_CHROME_HOST_PARTS):
        return True
    try:
        path = urlparse(url).path or "/"
    except Exception:
        return False
    return bool(_CMS_CHROME_PATH_RE.search(path))


def is_booking_platform_host(url: str | None) -> bool:
    h = host_of(url)
    if not h:
        return False
    return any(h == b or h.endswith(f".{b}") for b in BOOKING_PLATFORM_HOSTS)


def is_directory_host(url: str | None) -> bool:
    h = host_of(url)
    return any(d in h for d in DIRECTORY_HOSTS)


def is_directory_sidebar_host(url: str | None) -> bool:
    """True for ROP sidebar advertisers / civic chrome — not auto-discovered identity."""
    h = host_of(url)
    if not h:
        return False
    return any(h == s or h.endswith(f".{s}") for s in DIRECTORY_SIDEBAR_HOSTS)


def should_follow_related_websites(*, kind: str, page_url: str | None) -> bool:
    """Whether outbound related_websites from this page may enter the BFS queue.

    Allowed:
      - non-directory source pages (telegram/FB post HTML)
      - booking SaaS tenant / marketing pages (find Framer / real site)
    Forbidden:
      - directory listing pages (WordPress sidebar / blogroll of other ads)
      - the card's own website kind (unless that URL is itself a booking host)
      - Instagram / Facebook / TikTok / Yelp profile pages
    """
    k = (kind or "").strip().lower()
    if k in _NO_RELATED_KINDS:
        return False
    # Directory chrome links every other advertiser's site — never follow those.
    if is_directory_host(page_url):
        return False
    if k == "website":
        return is_booking_platform_host(page_url)
    if k == "source":
        return True
    if is_booking_platform_host(page_url):
        return True
    return False


def filter_related_websites_for_queue(
    related: list[str] | None,
    *,
    kind: str,
    page_url: str | None,
    can_be_own_website,
) -> list[str]:
    """Apply follow policy + own-site gate. `can_be_own_website` injected to
    avoid circular imports with enrich_resource_queue helpers."""
    if not should_follow_related_websites(kind=kind, page_url=page_url):
        return []
    out: list[str] = []
    for raw in related or []:
        s = str(raw).strip()
        if not s or is_cms_chrome_url(s):
            continue
        if not can_be_own_website(s):
            continue
        out.append(s)
    return out
