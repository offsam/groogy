"""Public Instagram profile image probe (no login, no cookies)."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass

from fetch_website import USER_AGENT, TIMEOUT, absolute_url, download_image

_ig_cache: dict[str, "InstagramDiscovery"] = {}


@dataclass
class InstagramDiscovery:
    username: str
    profile_image_url: str | None = None
    error: str | None = None
    unavailable: bool = False


def normalize_username(raw: str) -> str | None:
    value = (raw or "").strip()
    if not value:
        return None
    value = value.lstrip("@")
    if "instagram.com/" in value.lower():
        value = value.split("instagram.com/")[-1].split("?")[0].strip("/")
        value = value.split("/")[0]
    value = value.strip().strip("/")
    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", value):
        return None
    if value.lower() in {"p", "reel", "reels", "stories", "explore"}:
        return None
    return value


def discover_instagram_profile(username_or_url: str) -> InstagramDiscovery:
    username = normalize_username(username_or_url)
    if not username:
        return InstagramDiscovery(username="", error="bad_username", unavailable=True)
    if username in _ig_cache:
        return _ig_cache[username]

    disc = InstagramDiscovery(username=username)
    url = f"https://www.instagram.com/{username}/"
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            html = resp.read(500_000).decode("utf-8", errors="ignore")
        # og:image
        m = re.search(
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
            html,
            re.I,
        )
        if not m:
            m = re.search(
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
                html,
                re.I,
            )
        if m:
            disc.profile_image_url = absolute_url(url, m.group(1))
        else:
            disc.unavailable = True
            disc.error = "no_og_image"
    except urllib.error.HTTPError as exc:
        disc.unavailable = True
        disc.error = f"http_{exc.code}"
    except Exception as exc:
        disc.unavailable = True
        disc.error = type(exc).__name__

    _ig_cache[username] = disc
    return disc


def fetch_instagram_image_bytes(username_or_url: str) -> tuple[bytes | None, InstagramDiscovery]:
    disc = discover_instagram_profile(username_or_url)
    if not disc.profile_image_url:
        return None, disc
    data, err = download_image(disc.profile_image_url)
    if err:
        disc.error = err
        disc.unavailable = True
        return None, disc
    return data, disc
