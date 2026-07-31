#!/usr/bin/env python3
"""Booking / SaaS hosts — mirror of lib/import-review/platform-saas-hosts.ts.

May yield booking_url (and tenant-matched services). Must never become the
card's phone / email / Instagram / website identity.

Keep in sync with lib/import-review/platform-saas-hosts.ts.
"""

from __future__ import annotations

from urllib.parse import urlparse

PLATFORM_SAAS_HOSTS: tuple[str, ...] = (
    "dikidi.net",
    "dikidi.app",
    "support.dikidi.app",
    "glossgenius.com",
    "fresha.com",
    "vagaro.com",
    "booksy.com",
    "mindbodyonline.com",
    "mindbody.io",
    "calendly.com",
    "setmore.com",
    "squareup.com",
    "square.site",
    "book.squareup.com",
    "acuityscheduling.com",
    "styleseat.com",
    "schedulicity.com",
    "gentlemint.com",
    "treatwell.com",
    "salonized.com",
    "phorest.com",
    "timely.com",
    "booker.com",
    "boulevard.io",
)


def host_only(raw: str | None) -> str:
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


def is_platform_saas_host(raw: str | None) -> bool:
    host = host_only(raw)
    if not host:
        return False
    return any(host == h or host.endswith(f".{h}") for h in PLATFORM_SAAS_HOSTS)


def booking_url_from_maybe_saas(url: str | None) -> str | None:
    trimmed = (url or "").strip()
    if not trimmed or not is_platform_saas_host(trimmed):
        return None
    return trimmed if trimmed.startswith("http") else f"https://{trimmed}"
