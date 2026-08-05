#!/usr/bin/env python3
"""Hosts that belong to a platform, not to one card.

Python mirror of lib/import-review/shared-hosts.ts, extended with media and
community platforms that appear in directory chrome (blogroll, «our meetup»,
news widgets). A card must never adopt one of these as its own website,
Instagram or contact source: svoi.us linking to meetup.com/SVOIUS does not make
Meetup the nail salon's website.

Keep in sync with lib/import-review/shared-hosts.ts.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

SHARED_HOSTS: tuple[str, ...] = (
    # Socials / messengers
    "instagram.com",
    "facebook.com",
    "fb.com",
    "fb.me",
    "t.me",
    "telegram.me",
    "tiktok.com",
    "yelp.com",
    "youtube.com",
    "youtu.be",
    "twitter.com",
    "x.com",
    "linkedin.com",
    "wa.me",
    "whatsapp.com",
    "vk.com",
    "vk.ru",
    "ok.ru",
    # Link-in-bio, shorteners, forms, shared Google surfaces
    "linktr.ee",
    "taplink.cc",
    "beacons.ai",
    "bit.ly",
    "goo.gl",
    "maps.app.goo.gl",
    "maps.apple.com",
    "forms.gle",
    "docs.google.com",
    "sites.google.com",
    "drive.google.com",
    # Flipbook / catalog viewers
    "fliphtml5.com",
    "pubhtml5.com",
    "anyflip.com",
    "issuu.com",
    "calameo.com",
    "joomag.com",
    # Ticketing / events shared by many organizers
    "eventbrite.com",
    "loveoverse.com",
    "meetup.com",
    "eventful.com",
    # App stores / OS vendor chrome (footer of booking SaaS like Dikidi)
    "apps.apple.com",
    "itunes.apple.com",
    "apple.com",
    "apple.com.cn",
    "apple.co",
    "icloud.com",
    "play.google.com",
    "appgallery.huawei.com",
    "huawei.com",
    "rustore.ru",
    "bendingspoons.com",
    # Booking SaaS support / marketing (not the salon’s own site)
    "support.dikidi.app",
    "dikidi.app",
    "dikidi.net",
    "glossgenius.com",
    "fresha.com",
    "vagaro.com",
    "booksy.com",
    "calendly.com",
    "mindbodyonline.com",
    "mindbody.io",
    # Russian-speaking directories we import from
    "svoi.us",
    "russianorangepages.com",
    "bostonrussianpages.com",
    "yellowpages.com",
    "to4ka.us",
    "api.to4ka.us",
    # Media / community portals linked from directory pages
    "forumdaily.com",
    "rus.ru",
    "kommersant.ru",
    "medium.com",
    "substack.com",
    "livejournal.com",
    "blogspot.com",
    "wordpress.com",
    "dzen.ru",
    "zen.yandex.ru",
    # Civic / park portals that appear in ROP chrome — never a card's site.
    # Real businesses that once leaked from the same sidebar (FCH Construction,
    # Live at the Shell, Art-A-Fair) stay out of this list: if an admin sets
    # them as the card website we must mine them. Directory BFS still refuses
    # to follow related links from ROP/Svoi (enrich_follow_policy).
    "ocparks.com",
    "themuck.org",
    # to4ka catalog ads stuffed into listing.url / page chrome
    "bazar.club",
    "apteka03.online",
    "madbid.com",
)

SHARED_HOSTS_EXACT: tuple[str, ...] = ("etsy.com",)

SHARED_HOST_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?:yellow|orange|russian).{0,3}pages\.", re.I),
)

_EDITORIAL_PATH_RE = re.compile(
    r"/(?:blog|news|article|articles|posts?|stories|stati|novosti|press|"
    r"legal|privacy|confidential|terms|policy|cookies?|tos|eula)(?:/|$)",
    re.I,
)


def host_only(raw: str | None) -> str:
    """Hostname without www, accepting both bare hosts and full URLs."""
    value = (raw or "").strip().lower()
    if not value:
        return ""
    if "://" in value or value.startswith("//") or "/" in value:
        candidate = value if "://" in value else f"https://{value.lstrip('/')}"
        try:
            value = (urlparse(candidate).hostname or "").lower()
        except ValueError:
            return ""
    return value[4:] if value.startswith("www.") else value


def is_shared_non_identity_host(raw: str | None) -> bool:
    """True when the host is shared by many cards and identifies none of them."""
    host = host_only(raw)
    if not host:
        return False
    if any(host == h or host.endswith(f".{h}") for h in SHARED_HOSTS):
        return True
    if host in SHARED_HOSTS_EXACT:
        return True
    return any(pattern.search(host) for pattern in SHARED_HOST_PATTERNS)


def is_editorial_url(raw: str | None) -> bool:
    """Article / blog pages carry the author's contacts, never the card's."""
    value = (raw or "").strip()
    if not value:
        return False
    candidate = value if "://" in value else f"https://{value}"
    try:
        path = urlparse(candidate).path or ""
    except ValueError:
        return False
    if _EDITORIAL_PATH_RE.search(path):
        return True
    # Long dashed slug is a headline: /pochemu-amerikanczy-chashhe-vybirayut-…
    slug = path.rstrip("/").rsplit("/", 1)[-1]
    return len(slug) > 30 and slug.count("-") >= 4
