#!/usr/bin/env python3
"""Backfill quality cover images for approved businesses from website/Instagram.

Only accepts real photos/logos that pass size/aspect checks.
Skips favicons, category placeholders, and marketplace OG branding.

Usage:
  python3 scripts/media-pipeline/backfill_business_images.py --dry-run
  python3 scripts/media-pipeline/backfill_business_images.py --apply --limit 30
  python3 scripts/media-pipeline/backfill_business_images.py --apply
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import load_env  # noqa: E402
from fetch_instagram import fetch_instagram_image_bytes  # noqa: E402
from fetch_website import discover_website_images, download_image  # noqa: E402
from storage_client import MediaSupabase  # noqa: E402
from validate import reencode_webp, validate_image_bytes  # noqa: E402

BUCKET = "business-images"

# Aggregators whose OG image is platform branding, not the business.
SKIP_WEBSITE_HOSTS = {
    "etsy.com",
    "www.etsy.com",
    "eventbrite.com",
    "www.eventbrite.com",
    "facebook.com",
    "www.facebook.com",
    "fb.com",
    "t.me",
    "telegram.me",
    "wa.me",
    "linktr.ee",
    "www.linktr.ee",
    "bit.ly",
    "maps.google.com",
    "www.google.com",
    "goo.gl",
    "yelp.com",
    "www.yelp.com",
    "turo.com",
    "www.turo.com",
    "girlscouts.org",
    "digitalcookie.girlscouts.org",
    "threads.net",
    "www.threads.net",
}

# Quality bar: covers/photos stricter; logos may be square ~180–256.
MIN_EDGE_PHOTO = 320
MIN_EDGE_LOGO = 180
MIN_BYTES_QUALITY = 6_000


def host_of(url: str) -> str:
    try:
        return urlparse(url if "://" in url else f"https://{url}").netloc.lower()
    except Exception:
        return ""


def is_instagram_url(url: str) -> bool:
    h = host_of(url)
    return h.endswith("instagram.com")


def is_skip_website(url: str) -> bool:
    h = host_of(url)
    if not h:
        return True
    if is_instagram_url(url):
        return True
    if h in SKIP_WEBSITE_HOSTS:
        return True
    # skip generic square booking landing pages (often no brand mark)
    if "squareup.com" in h or h.endswith("square.site"):
        return True
    return False


def quality_ok(
    data: bytes, *, min_edge: int = MIN_EDGE_PHOTO
) -> tuple[bool, str, object | None]:
    valid, reason = validate_image_bytes(data)
    if not valid:
        return False, reason or "invalid", None
    if valid.width < min_edge or valid.height < min_edge:
        return False, f"below_quality_edge:{valid.width}x{valid.height}", None
    if len(valid.data) < MIN_BYTES_QUALITY:
        return False, "too_light", None
    return True, "ok", valid


def load_targets(client: MediaSupabase, *, limit: int | None) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    page = 100
    while True:
        batch = (
            client.rest_request(
                "GET",
                "/businesses",
                params={
                    "select": "id,slug,name,website,instagram_url,image_url,status",
                    "status": "eq.approved",
                    "or": "(website.not.is.null,instagram_url.not.is.null)",
                    "order": "name.asc",
                    "offset": str(offset),
                    "limit": str(page),
                },
            )
            or []
        )
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page

    out: list[dict] = []
    for r in rows:
        url = (r.get("image_url") or "").strip()
        real = bool(url) and "/placeholder.svg" not in url and "/images/categories/" not in url
        if real:
            continue
        website = (r.get("website") or "").strip() or None
        ig = (r.get("instagram_url") or "").strip() or None
        if not website and not ig:
            continue
        out.append(r)
        if limit is not None and len(out) >= limit:
            break
    return out


def try_website(website: str) -> tuple[bytes | None, str | None, str | None]:
    """Return (bytes, source_label, source_url)."""
    if is_skip_website(website):
        return None, None, None
    disc = discover_website_images(website)
    # Prefer OG (photo) then logo / apple-touch — never tiny favicon.ico.
    attempts: list[tuple[str, str | None, int]] = [
        ("website_og", disc.og_image, MIN_EDGE_PHOTO),
        ("website_logo", disc.logo, MIN_EDGE_LOGO),
    ]
    fav = (disc.favicon or "").lower()
    if fav and ("apple-touch" in fav or "android-chrome" in fav or "192" in fav or "512" in fav):
        attempts.append(("website_icon", disc.favicon, MIN_EDGE_LOGO))

    for label, url, edge in attempts:
        if not url:
            continue
        # Skip obvious stock/CDN placeholders from builders when labeled as getty.
        if "getty" in url.lower() or "/stock/" in url.lower():
            continue
        data, err = download_image(url)
        if err or not data:
            continue
        ok, _reason, valid = quality_ok(data, min_edge=edge)
        if not ok:
            continue
        assert valid is not None
        return valid.data, label, url  # type: ignore[union-attr]

    return None, None, None


def try_instagram(ig: str) -> tuple[bytes | None, str | None, str | None]:
    data, disc = fetch_instagram_image_bytes(ig)
    if not data:
        return None, None, None
    ok, _reason, valid = quality_ok(data, min_edge=MIN_EDGE_LOGO)
    if not ok:
        return None, None, None
    assert valid is not None
    return valid.data, "instagram_profile", getattr(disc, "profile_image_url", None)


def apply_image(client: MediaSupabase, business_id: str, raw: bytes) -> str:
    webp = reencode_webp(raw, max_edge=1600, quality=85)
    path = f"business/{business_id}/{webp.sha256}.webp"
    client.upload(
        BUCKET,
        path,
        webp.data,
        content_type="image/webp",
        upsert=True,
    )
    public = client.public_url(BUCKET, path)
    client.rpc(
        "service_set_business_auto_image",
        {
            "p_business_id": business_id,
            "p_image_url": public,
            "p_only_if_empty": True,
        },
    )
    return public


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1

    client = MediaSupabase(url, key)
    targets = load_targets(client, limit=args.limit)
    print(f"targets without real image: {len(targets)}")

    stats = {"ok": 0, "skip": 0, "fail": 0}
    for i, biz in enumerate(targets, 1):
        name = (biz.get("name") or biz.get("slug") or "")[:60]
        website = (biz.get("website") or "").strip()
        ig = (biz.get("instagram_url") or "").strip()
        # If website field is Instagram, treat as IG.
        if website and is_instagram_url(website) and not ig:
            ig = website
            website = ""

        data = None
        source = None
        src_url = None

        if website:
            data, source, src_url = try_website(website)
        if not data and ig:
            data, source, src_url = try_instagram(ig)
        # website field pointing at IG already handled; also try website as IG username page
        if not data and website and is_instagram_url(website):
            data, source, src_url = try_instagram(website)

        if not data or not source:
            stats["skip"] += 1
            print(f"[{i}/{len(targets)}] SKIP  {name}")
            continue

        print(
            f"[{i}/{len(targets)}] {source:18} {name}  ← {(src_url or '')[:70]}"
        )
        if args.dry_run:
            stats["ok"] += 1
            continue

        try:
            public = apply_image(client, biz["id"], data)
            stats["ok"] += 1
            print(f"         saved {public[-60:]}")
        except Exception as exc:
            stats["fail"] += 1
            print(f"         FAIL {type(exc).__name__}: {exc}")
        time.sleep(0.35)

    print("stats", stats)
    return 0 if stats["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
