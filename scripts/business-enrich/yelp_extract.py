#!/usr/bin/env python3
"""Extract profile fields from a Yelp /biz/ page (JSON-LD + light HTML).

Yelp often serves DataDome to datacenter IPs — then status is ``blocked``.
When HTML arrives (home IP, cool-down, browser session), we pull the same
shape as a website mine: phone, address, website, hours, rating, image.

Used by enrich_resource_queue (BFS) and fill_yelp_ratings.
"""

from __future__ import annotations

import html as html_lib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
TIMEOUT = 18
MAX_HTML = 1_800_000

RATING_VALUE_RE = re.compile(
    r'"ratingValue"\s*:\s*"?(?P<v>\d(?:\.\d+)?)"?',
    re.I,
)
REVIEW_COUNT_RE = re.compile(
    r'"reviewCount"\s*:\s*"?(?P<v>\d+)"?',
    re.I,
)
OG_RATING_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:rating|yelp:rating|rating)["\'][^>]+'
    r'content=["\'](?P<v>\d(?:\.\d+)?)["\']',
    re.I,
)
AGG_BLOCK_RE = re.compile(
    r'"aggregateRating"\s*:\s*\{(?P<body>[^}]{0,400})\}',
    re.I,
)
OG_TITLE_RE = re.compile(
    r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
    re.I,
)
OG_DESC_RE = re.compile(
    r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']',
    re.I,
)
OG_IMAGE_RE = re.compile(
    r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
    re.I,
)
TEL_HREF_RE = re.compile(r'href=["\']tel:([^"\']+)["\']', re.I)

_DAY_NAME_TO_JS = {
    "sunday": 0,
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6,
}


def normalize_yelp_url(url: str | None) -> str | None:
    raw = (url or "").strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = "https://" + raw.lstrip("/")
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if "yelp.com" not in host:
        return None
    path = parsed.path or ""
    m = re.search(r"/biz/([^/?#]+)", path, re.I)
    if not m:
        return None
    slug = urllib.parse.unquote(m.group(1)).strip("/")
    if not slug:
        return None
    return f"https://www.yelp.com/biz/{slug}"


def _is_datadome(html: str | None) -> bool:
    if not html:
        return True
    if len(html) < 8_000 and (
        "datadome" in html.lower() or "please enable" in html.lower()
    ):
        return True
    if len(html) < 3_000 and "yelp.com" in (html[:200].lower()):
        # Tiny interstitial shell, not a biz page.
        return True
    return False


def http_get_yelp(url: str) -> str | None:
    """Plain HTTP GET. Returns None on network error or DataDome shell."""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Accept": (
                    "text/html,application/xhtml+xml,application/xml;q=0.9,"
                    "image/avif,image/webp,*/*;q=0.8"
                ),
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Referer": "https://www.google.com/",
                "Upgrade-Insecure-Requests": "1",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(MAX_HTML + 1)
            if len(raw) > MAX_HTML:
                raw = raw[:MAX_HTML]
            charset = resp.headers.get_content_charset() or "utf-8"
            text = raw.decode(charset, errors="replace")
            if _is_datadome(text):
                return None
            return text
    except Exception:
        return None


def playwright_get_yelp(url: str) -> str | None:
    """Optional Chromium fetch (telegram-collector venv). DataDome → None."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=UA,
                locale="en-US",
                viewport={"width": 1280, "height": 900},
            )
            page = context.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            time.sleep(2.0)
            html = page.content()
            browser.close()
            if _is_datadome(html):
                return None
            return html
    except Exception:
        return None


def fetch_yelp_html(url: str) -> tuple[str | None, str | None]:
    """Return (html, error_tag). error_tag is blocked|fetch_failed|None."""
    html = http_get_yelp(url)
    if html:
        return html, None
    # urllib got nothing — try Playwright once (may still be DataDome).
    html = playwright_get_yelp(url)
    if html:
        return html, None
    # Distinguish blocked vs hard fail: tiny/403 shells count as blocked.
    return None, "blocked"


def _walk_json(node: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        found.append(node)
        for v in node.values():
            found.extend(_walk_json(v))
    elif isinstance(node, list):
        for item in node:
            found.extend(_walk_json(item))
    return found


def parse_json_ld_blocks(html: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.I | re.S,
    ):
        raw = html_lib.unescape(m.group(1)).strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        if isinstance(data, list):
            for item in data:
                blocks.extend(_walk_json(item))
        else:
            blocks.extend(_walk_json(data))
    return blocks


def _coerce_rating(value: Any) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n < 1 or n > 5:
        return None
    return round(n, 2)


def _coerce_count(value: Any) -> int | None:
    try:
        n = int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError):
        return None
    if n < 0 or n > 5_000_000:
        return None
    return n


def extract_yelp_rating(html: str) -> tuple[float | None, int | None, str | None]:
    """Return (rating, review_count, source_tag). Shared with fill_yelp_ratings."""
    for block in parse_json_ld_blocks(html):
        agg = block.get("aggregateRating")
        if isinstance(agg, dict):
            rating = _coerce_rating(agg.get("ratingValue"))
            count = _coerce_count(agg.get("reviewCount") or agg.get("ratingCount"))
            if rating is not None:
                return rating, count, "json_ld_aggregate"
        if block.get("ratingValue") is not None:
            rating = _coerce_rating(block.get("ratingValue"))
            count = _coerce_count(block.get("reviewCount") or block.get("ratingCount"))
            if rating is not None:
                return rating, count, "json_ld_direct"

    for m in AGG_BLOCK_RE.finditer(html):
        body = m.group("body")
        rv = RATING_VALUE_RE.search(body)
        if not rv:
            continue
        rating = _coerce_rating(rv.group("v"))
        if rating is None:
            continue
        rc = REVIEW_COUNT_RE.search(body)
        count = _coerce_count(rc.group("v")) if rc else None
        return rating, count, "embedded_aggregate"

    rv = RATING_VALUE_RE.search(html)
    if rv:
        rating = _coerce_rating(rv.group("v"))
        if rating is not None:
            window = html[max(0, rv.start() - 200) : rv.end() + 200]
            rc = REVIEW_COUNT_RE.search(window) or REVIEW_COUNT_RE.search(html)
            count = _coerce_count(rc.group("v")) if rc else None
            return rating, count, "regex_ratingValue"

    og = OG_RATING_RE.search(html)
    if og:
        rating = _coerce_rating(og.group("v"))
        if rating is not None:
            return rating, None, "og_rating"
    return None, None, None


def _type_names(block: dict[str, Any]) -> set[str]:
    raw = block.get("@type")
    if isinstance(raw, list):
        return {str(x).lower() for x in raw}
    if raw:
        return {str(raw).lower()}
    return set()


def _local_business_block(blocks: list[dict[str, Any]]) -> dict[str, Any] | None:
    preferred = (
        "localbusiness",
        "restaurant",
        "store",
        "foodestablishment",
        "healthandbeautybusiness",
        "sportsactivitylocation",
        "entertainmentbusiness",
        "professional service",
    )
    for block in blocks:
        types = _type_names(block)
        if any(t.replace(" ", "") in {p.replace(" ", "") for p in preferred} for t in types):
            return block
        if any("business" in t or "organization" in t for t in types) and (
            block.get("address") or block.get("telephone")
        ):
            return block
    for block in blocks:
        if block.get("address") or block.get("telephone") or block.get("aggregateRating"):
            return block
    return None


def _format_postal_address(addr: Any) -> tuple[str | None, str | None, str | None, str | None]:
    """Return (street_line, city, state, postal)."""
    if isinstance(addr, str):
        line = re.sub(r"\s+", " ", addr).strip()
        return (line[:300] if line else None), None, None, None
    if not isinstance(addr, dict):
        return None, None, None, None
    street = str(addr.get("streetAddress") or "").strip() or None
    city = str(addr.get("addressLocality") or "").strip() or None
    state = str(addr.get("addressRegion") or "").strip() or None
    postal = str(addr.get("postalCode") or "").strip() or None
    if street and city and state:
        line = f"{street}, {city}, {state}"
        if postal:
            line = f"{line} {postal}"
        return line[:300], city, state, postal
    if street:
        return street[:300], city, state, postal
    return None, city, state, postal


def _opening_hours_from_spec(specs: Any) -> dict[str, Any] | None:
    if not isinstance(specs, list) or not specs:
        return None
    weekly: dict[int, dict[str, Any]] = {
        d: {"day": d, "closed": True} for d in range(7)
    }
    found = False
    for spec in specs:
        if not isinstance(spec, dict):
            continue
        days_raw = spec.get("dayOfWeek")
        if isinstance(days_raw, str):
            days = [days_raw]
        elif isinstance(days_raw, list):
            days = [str(d) for d in days_raw]
        else:
            continue
        opens = str(spec.get("opens") or "").strip()
        closes = str(spec.get("closes") or "").strip()
        if not re.match(r"^\d{1,2}:\d{2}", opens) or not re.match(r"^\d{1,2}:\d{2}", closes):
            continue
        opens = opens[:5]
        closes = closes[:5]
        for dname in days:
            key = dname.split("/")[-1].lower()
            day = _DAY_NAME_TO_JS.get(key)
            if day is None:
                continue
            if opens == "00:00" and closes == "00:00":
                weekly[day] = {"day": day, "closed": True}
            else:
                weekly[day] = {"day": day, "open": opens, "close": closes}
            found = True
    if not found:
        return None
    return {"timezone": "America/Los_Angeles", "weekly": [weekly[d] for d in range(7)]}


def _normalize_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return None
    return f"+1{digits}"


def _website_from_block(block: dict[str, Any]) -> str | None:
    for key in ("url", "sameAs"):
        raw = block.get(key)
        candidates: list[str] = []
        if isinstance(raw, str):
            candidates = [raw]
        elif isinstance(raw, list):
            candidates = [str(x) for x in raw if x]
        for cand in candidates:
            low = cand.lower()
            if "yelp.com" in low or "facebook.com" in low or "instagram.com" in low:
                continue
            if cand.startswith("http"):
                return cand.split("?")[0][:300]
    return None


def parse_yelp_biz_html(html: str, page_url: str) -> dict[str, Any]:
    """Parse a fetched Yelp biz HTML into enrich fields (no network)."""
    out: dict[str, Any] = {
        "_status": "ok",
        "yelp_url": normalize_yelp_url(page_url) or page_url.split("?")[0][:300],
        "discovered_urls": [],
    }
    blocks = parse_json_ld_blocks(html)
    biz = _local_business_block(blocks)

    rating, count, _src = extract_yelp_rating(html)
    if rating is not None:
        out["yelp_rating"] = rating
    if count is not None:
        out["yelp_reviews_count"] = count

    if biz:
        name = str(biz.get("name") or "").strip()
        if name:
            out["site_name"] = name[:200]
        phone = _normalize_phone(str(biz.get("telephone") or ""))
        if phone:
            out["phone"] = phone
        email = str(biz.get("email") or "").strip().lower()
        if email and "@" in email and "yelp.com" not in email:
            out["email"] = email[:120]
        street, city, state, postal = _format_postal_address(biz.get("address"))
        if street:
            out["address"] = street
            out["address_line"] = (street.split(",")[0] or street)[:160]
        if city:
            out["city"] = city[:80]
        if state:
            st = state.upper()
            out["state"] = st if len(st) == 2 else st[:40]
        if postal:
            out["postal_code"] = postal[:16]
        website = _website_from_block(biz)
        if website:
            out["website"] = website
            out["discovered_urls"].append(website)
        hours = _opening_hours_from_spec(
            biz.get("openingHoursSpecification") or biz.get("openingHours")
        )
        if hours:
            out["opening_hours"] = hours
        image = biz.get("image")
        if isinstance(image, list) and image:
            image = image[0]
        if isinstance(image, dict):
            image = image.get("url") or image.get("contentUrl")
        if isinstance(image, str) and image.startswith("http"):
            out["image_url"] = image.split("?")[0][:500]
        desc = str(biz.get("description") or "").strip()
        if len(desc) >= 40:
            out["description"] = desc[:4000]

    if not out.get("phone"):
        for m in TEL_HREF_RE.finditer(html):
            phone = _normalize_phone(m.group(1))
            if phone:
                out["phone"] = phone
                break

    if not out.get("site_name"):
        og = OG_TITLE_RE.search(html)
        if og:
            title = html_lib.unescape(og.group(1)).split(" - ")[0].strip()
            if title and "yelp" not in title.lower():
                out["site_name"] = title[:200]

    if not out.get("description"):
        og = OG_DESC_RE.search(html)
        if og:
            desc = html_lib.unescape(og.group(1)).strip()
            if len(desc) >= 40 and "datadome" not in desc.lower():
                out["description"] = desc[:4000]

    if not out.get("image_url"):
        og = OG_IMAGE_RE.search(html)
        if og and og.group(1).startswith("http"):
            out["image_url"] = og.group(1).split("?")[0][:500]

    useful = [
        k
        for k in (
            "phone",
            "email",
            "address",
            "address_line",
            "city",
            "website",
            "opening_hours",
            "yelp_rating",
            "image_url",
            "description",
        )
        if out.get(k)
    ]
    if not useful:
        out["_status"] = "empty"
        out["_error"] = "ничего не извлечено"
    return out


def extract_yelp_biz_profile(url: str) -> dict[str, Any]:
    """Fetch + parse a Yelp /biz/ URL for enrich BFS."""
    normalized = normalize_yelp_url(url) or (url or "").split("?")[0][:300]
    out: dict[str, Any] = {
        "_url": normalized,
        "_kind": "yelp",
        "yelp_url": normalized,
        "discovered_urls": [],
        "social_links": [normalized] if normalized else [],
    }
    if not normalized or "/biz/" not in normalized:
        out["_status"] = "error"
        out["_error"] = "bad_yelp_url"
        return out

    html, err = fetch_yelp_html(normalized)
    if not html:
        out["_status"] = "unavailable" if err == "blocked" else "fetch_failed"
        out["_error"] = (
            "yelp_blocked (DataDome)" if err == "blocked" else (err or "fetch_failed")
        )
        return out

    parsed = parse_yelp_biz_html(html, normalized)
    out.update(parsed)
    out["_url"] = normalized
    out["_kind"] = "yelp"
    out.setdefault("social_links", [normalized])
    if normalized not in (out.get("social_links") or []):
        out["social_links"] = [normalized] + list(out.get("social_links") or [])
    return out
