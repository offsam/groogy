"""Provenance classifier shared by import / publish scripts.

Python mirror of `resolveSourceKind` in `lib/business/presence.ts`. Keep the two
in sync: a card that carries an external link is never «created on КРУГИ», and
an unresolved origin stays None rather than falling back to 'platform'.
"""
from __future__ import annotations

import re

FACEBOOK_URL_RE = re.compile(r"facebook\.com|fb\.com", re.I)
TELEGRAM_URL_RE = re.compile(r"t\.me/|telegram\.me", re.I)
DIRECTORY_URL_RE = re.compile(
    r"svoi\.us|orange.?pages|yellow.?pages|to4ka|echoru|zerkalo", re.I
)
DIRECTORY_HINT_RE = re.compile(
    r"directory|svoi|orange.?pages|yellow.?pages|to4ka|echoru|zerkalo|ruspages"
    r"|slavic.?seattle|russian.?seattle|boston.?pages|our.?texas",
    re.I,
)
PLATFORM_HINTS = {"platform", "krugi", "user", "owner", "admin", "manual"}


def resolve_source_kind(
    source_url: str | None, raw_source: str | None = None
) -> str | None:
    """Return 'telegram' | 'facebook' | 'directory' | 'platform' | None."""
    url = (source_url or "").strip()
    hint = (raw_source or "").strip().lower()

    if url:
        if FACEBOOK_URL_RE.search(url):
            return "facebook"
        if TELEGRAM_URL_RE.search(url):
            return "telegram"
        if DIRECTORY_URL_RE.search(url):
            return "directory"

    if hint.startswith("facebook"):
        return "facebook"
    if "telegram" in hint:
        return "telegram"
    if DIRECTORY_HINT_RE.search(hint):
        return "directory"

    # An unknown external link is still not ours — leave the kind unresolved
    # and let the UI label it by hostname.
    if url:
        return None
    if hint in PLATFORM_HINTS:
        return "platform"
    return None


def source_type_from_kind(kind: str | None) -> str:
    """professionals / jobs keep provenance in an uppercase source_type."""
    if kind == "telegram":
        return "TELEGRAM"
    if kind == "facebook":
        return "FACEBOOK"
    if kind == "platform":
        return "ADMIN"
    return "IMPORT"
