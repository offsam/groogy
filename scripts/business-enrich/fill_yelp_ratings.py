#!/usr/bin/env python3
"""Fill-empty Yelp ratings from public yelp_url pages.

Parses JSON-LD AggregateRating / ratingValue and og meta on biz pages.
Never overwrites an existing yelp_rating. No Google Places.

Note: Yelp often serves DataDome challenges to plain urllib/curl. When
`http_get` fails, re-run after a cool-down, or seed ratings from a browser
session (JSON-LD on the live page) and patch via this script's apply path
once fetches succeed. For one-off fills, patch `yelp_rating` /
`yelp_reviews_count` with service role as done in apply reports under
`scripts/business-enrich/data/yelp_ratings/`.

Usage:
  python3 scripts/business-enrich/fill_yelp_ratings.py --dry-run
  python3 scripts/business-enrich/fill_yelp_ratings.py --apply
  python3 scripts/business-enrich/fill_yelp_ratings.py --apply --limit 20
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
TIMEOUT = 14
MAX_HTML = 1_200_000
OUT_DIR = ROOT / "scripts" / "business-enrich" / "data" / "yelp_ratings"

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
# Yelp sometimes embeds: "aggregateRating":{"@type":"AggregateRating","ratingValue":4.5,...}
AGG_BLOCK_RE = re.compile(
    r'"aggregateRating"\s*:\s*\{(?P<body>[^}]{0,400})\}',
    re.I,
)


def http_get(url: str) -> str | None:
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
            # DataDome interstitial is tiny and useless.
            if len(text) < 8_000 and (
                "datadome" in text.lower() or "Please enable" in text
            ):
                return None
            return text
    except Exception:
        return None


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


def _parse_json_ld_blocks(html: str) -> list[dict[str, Any]]:
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
    """Return (rating, review_count, source_tag)."""
    for block in _parse_json_ld_blocks(html):
        agg = block.get("aggregateRating")
        if isinstance(agg, dict):
            rating = _coerce_rating(agg.get("ratingValue"))
            count = _coerce_count(
                agg.get("reviewCount") or agg.get("ratingCount")
            )
            if rating is not None:
                return rating, count, "json_ld_aggregate"
        # Direct on LocalBusiness
        if block.get("ratingValue") is not None:
            rating = _coerce_rating(block.get("ratingValue"))
            count = _coerce_count(
                block.get("reviewCount") or block.get("ratingCount")
            )
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

    # Fallback: first ratingValue near reviewCount in page
    rv = RATING_VALUE_RE.search(html)
    if rv:
        rating = _coerce_rating(rv.group("v"))
        if rating is not None:
            # Prefer a nearby reviewCount
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


def normalize_yelp_url(url: str) -> str | None:
    raw = (url or "").strip()
    if not raw:
        return None
    if not raw.startswith("http"):
        raw = "https://" + raw.lstrip("/")
    try:
        parsed = urllib.parse.urlparse(raw)
    except Exception:
        return None
    host = (parsed.netloc or "").lower()
    if "yelp.com" not in host:
        return None
    path = parsed.path or ""
    if "/biz/" not in path and "/biz_redir" not in path:
        # Still allow — some short links redirect
        pass
    # Strip tracking query
    clean = urllib.parse.urlunparse(
        (parsed.scheme or "https", host, path, "", "", "")
    )
    return clean


def empty_rating(row: dict[str, Any]) -> bool:
    v = row.get("yelp_rating")
    if v is None or v == "":
        return True
    try:
        return float(v) <= 0
    except (TypeError, ValueError):
        return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=1.2)
    parser.add_argument("--slug", type=str, default="")
    args = parser.parse_args()
    apply = bool(args.apply)
    dry_run = not apply

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    sb = SupabaseRest(url, key)

    select = "id,slug,name,status,yelp_url,yelp_rating,yelp_reviews_count"
    if args.slug:
        rows = sb._request(
            "GET",
            "/businesses",
            params={
                "select": select,
                "slug": f"eq.{args.slug}",
                "limit": "1",
            },
        )
    else:
        # Approved with yelp_url and empty rating
        rows = sb._request(
            "GET",
            "/businesses",
            params={
                "select": select,
                "status": "eq.approved",
                "yelp_url": "not.is.null",
                "or": "(yelp_rating.is.null,yelp_rating.eq.0)",
                "order": "name.asc",
                "limit": str(args.limit or 500),
            },
        )

    candidates = [
        r
        for r in (rows or [])
        if r.get("yelp_url") and empty_rating(r)
    ]
    if args.limit and not args.slug:
        candidates = candidates[: args.limit]

    reports: list[dict[str, Any]] = []
    applied = 0
    found = 0
    failed = 0

    for i, row in enumerate(candidates):
        url = normalize_yelp_url(str(row.get("yelp_url") or ""))
        report: dict[str, Any] = {
            "id": row["id"],
            "slug": row.get("slug"),
            "name": row.get("name"),
            "yelp_url": url,
            "ok": False,
        }
        if not url:
            report["error"] = "bad_yelp_url"
            failed += 1
            reports.append(report)
            continue

        html = http_get(url)
        if not html:
            report["error"] = "fetch_failed"
            failed += 1
            reports.append(report)
            time.sleep(args.sleep)
            continue

        rating, count, source = extract_yelp_rating(html)
        if rating is None:
            report["error"] = "no_rating_found"
            # Hint: blocked / captcha pages often short
            report["html_len"] = len(html)
            failed += 1
            reports.append(report)
            time.sleep(args.sleep)
            continue

        patch: dict[str, Any] = {"yelp_rating": rating}
        if count is not None and int(row.get("yelp_reviews_count") or 0) == 0:
            patch["yelp_reviews_count"] = count

        report["ok"] = True
        report["source"] = source
        report["patch"] = patch
        found += 1

        if apply:
            try:
                sb.patch("businesses", {"id": f"eq.{row['id']}"}, patch)
                applied += 1
                report["applied"] = True
            except Exception as exc:
                report["applied"] = False
                report["error"] = f"patch_failed:{exc}"
                failed += 1

        reports.append(report)
        print(
            f"[{i + 1}/{len(candidates)}] {row.get('slug')} → "
            f"{rating}"
            + (f" ({count} reviews)" if count is not None else "")
            + f" via {source}"
            + (" [applied]" if apply and report.get("applied") else "")
        )
        time.sleep(args.sleep)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if apply else "dry_run"
    out_path = OUT_DIR / f"{mode}_{stamp}.json"
    summary = {
        "mode": mode,
        "candidates": len(candidates),
        "found": found,
        "applied": applied,
        "failed": failed,
        "reports": reports,
    }
    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    latest = OUT_DIR / f"{mode}_latest.json"
    latest.write_text(json.dumps(summary, ensure_ascii=False, indent=2))

    print(
        f"\nDone ({mode}): candidates={len(candidates)} found={found} "
        f"applied={applied} failed={failed}\nWrote {out_path}"
    )
    return 0 if found or not candidates else 1


if __name__ == "__main__":
    raise SystemExit(main())
