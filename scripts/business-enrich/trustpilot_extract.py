#!/usr/bin/env python3
"""Extract TrustScore from a Trustpilot /review/ page (light HTML).

Trustpilot often serves CloudFront / AWS WAF interstitials to bots — then
status is ``blocked``. When HTML arrives, we pull TrustScore + review count
the same way as Yelp ratings.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

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
TRUSTSCORE_RE = re.compile(
    r"(?:TrustScore|trustScore)\s*(?:of\s*)?(?P<v>\d(?:\.\d+)?)\s*(?:out\s*of\s*5)?",
    re.I,
)
STARS_ALT_RE = re.compile(
    r'TrustScore\s+(?P<v>\d(?:\.\d+)?)\s+out\s+of\s+5',
    re.I,
)
REVIEWS_LABEL_RE = re.compile(
    r"(?:Reviews?|отзыв(?:ов|а)?)\s*(?P<v>\d{1,7})",
    re.I,
)
AGG_BLOCK_RE = re.compile(
    r'"aggregateRating"\s*:\s*\{(?P<body>[^}]{0,400})\}',
    re.I,
)


def normalize_trustpilot_url(url: str | None) -> str | None:
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
    if host.endswith(".trustpilot.com"):
        host = "trustpilot.com"
    if host != "trustpilot.com":
        return None
    path = parsed.path or ""
    m = re.search(r"/review/([^/?#]+)", path, re.I)
    if not m:
        return None
    slug = urllib.parse.unquote(m.group(1)).strip("/")
    if not slug:
        return None
    return f"https://www.trustpilot.com/review/{slug}"


def _is_waf_shell(html: str | None) -> bool:
    if not html:
        return True
    low = html.lower()
    if "verifying your connection" in low or "verifying connection" in low:
        return True
    if "awswaf" in low or "challenge.js" in low:
        return True
    if len(html) < 8_000 and (
        "cloudfront" in low or "access denied" in low or "captcha" in low
    ):
        return True
    return False


def http_get_trustpilot(url: str) -> str | None:
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Accept": (
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(MAX_HTML + 1)
            if len(raw) > MAX_HTML:
                raw = raw[:MAX_HTML]
            charset = "utf-8"
            ctype = resp.headers.get("Content-Type") or ""
            if "charset=" in ctype.lower():
                charset = ctype.lower().split("charset=", 1)[1].split(";")[0].strip() or charset
            html = raw.decode(charset, errors="replace")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        return None
    if _is_waf_shell(html):
        return None
    return html


def _coerce_rating(value: Any) -> float | None:
    try:
        r = float(str(value).replace(",", ".").strip())
    except (TypeError, ValueError):
        return None
    if r < 1 or r > 5:
        return None
    return round(r * 10) / 10


def _coerce_count(value: Any) -> int | None:
    try:
        n = int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError):
        return None
    if n < 0 or n > 5_000_000:
        return None
    return n


def parse_json_ld_blocks(html: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.I | re.S,
    ):
        raw = (m.group(1) or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            blocks.extend(x for x in data if isinstance(x, dict))
        elif isinstance(data, dict):
            if "@graph" in data and isinstance(data["@graph"], list):
                blocks.extend(x for x in data["@graph"] if isinstance(x, dict))
            else:
                blocks.append(data)
    return blocks


def extract_trustpilot_rating(
    html: str,
) -> tuple[float | None, int | None, str | None]:
    """Return (rating, review_count, source_tag)."""
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

    for re_pat in (STARS_ALT_RE, TRUSTSCORE_RE):
        m = re_pat.search(html)
        if not m:
            continue
        rating = _coerce_rating(m.group("v"))
        if rating is None:
            continue
        window = html[max(0, m.start() - 120) : m.end() + 220]
        rc = REVIEW_COUNT_RE.search(window) or REVIEWS_LABEL_RE.search(window)
        count = _coerce_count(rc.group("v")) if rc else None
        return rating, count, "trustscore_text"

    return None, None, None


def extract_trustpilot_profile(url: str) -> dict[str, Any]:
    """Mine one Trustpilot review page. Always keeps normalized URL."""
    clean = normalize_trustpilot_url(url) or (url.split("?")[0][:300] if url else None)
    out: dict[str, Any] = {
        "_url": url,
        "_kind": "trustpilot",
        "trustpilot_url": clean,
        "social_links": [clean] if clean else [],
        "discovered_urls": [],
    }
    if not clean:
        out["_status"] = "error"
        out["_error"] = "bad_trustpilot_url"
        return out

    html = http_get_trustpilot(clean)
    if not html:
        out["_status"] = "blocked"
        out["_error"] = "waf_or_fetch"
        return out

    rating, count, src = extract_trustpilot_rating(html)
    out["_status"] = "ok"
    if rating is not None:
        out["trustpilot_rating"] = rating
        out["_rating_source"] = src
    if count is not None:
        out["trustpilot_reviews_count"] = count
    if rating is None and count is None:
        out["_status"] = "empty"
    return out
