#!/usr/bin/env python3
"""Enrich approved professionals from their import sources (fill-empty only).

Sources (no invented data):
  1) import_review_items matched by source_url
     - preview_image_url, Facebook CDN photo URLs in source_media
     - phone / instagram / website / email / telegram / city / description
  2) Telegram photo re-download when photos_count>0 and no preview yet
  3) import_comment_recommendations clusters (name-compatible phone/IG/website)
  4) Website OG / Instagram profile image when contact URLs already exist

Usage:
  python3 scripts/business-enrich/enrich_professionals_from_sources.py --dry-run
  python3 scripts/business-enrich/enrich_professionals_from_sources.py --apply
  python3 scripts/business-enrich/enrich_professionals_from_sources.py --apply --skip-telegram-photos
  python3 scripts/business-enrich/enrich_professionals_from_sources.py --apply --skip-web-images
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "media-pipeline"))

from common import SupabaseRest, load_env  # noqa: E402
from contacts import (  # noqa: E402
    extract_emails,
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
    normalize_phone,
)

OUT = Path(__file__).resolve().parent / "data" / "professional_source_enrich"
OUT.mkdir(parents=True, exist_ok=True)

BUCKET = "business-images"
PLACEHOLDER_MARKERS = ("placeholder", "/images/categories/")
SKIP_WEB_HOSTS = {
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
    "yelp.com",
    "www.yelp.com",
    "turo.com",
    "www.turo.com",
}


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def empty_image(url: Any) -> bool:
    u = (url or "").strip()
    if not u:
        return True
    low = u.lower()
    if low.endswith(".svg"):
        return True
    return any(m in low for m in PLACEHOLDER_MARKERS)


def norm_url(u: str | None) -> str:
    if not u:
        return ""
    return (
        u.strip()
        .split("?")[0]
        .rstrip("/")
        .lower()
        .replace("https://www.", "https://")
        .replace("http://www.", "http://")
        .replace("http://", "https://")
    )


def normalize_instagram(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if not raw:
        return None
    v = str(raw).strip()
    m = re.search(r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})", v, re.I)
    handle = (m.group(1) if m else v.lstrip("@")).strip().strip("/")
    handle = handle.split("?")[0].split("/")[0]
    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", handle or ""):
        return None
    if handle.lower() in {"reel", "p", "stories", "explore", "accounts"}:
        return None
    return f"https://www.instagram.com/{handle}"


def ig_handle(value: str | None) -> str | None:
    url = normalize_instagram(value)
    if not url:
        return None
    return url.rstrip("/").split("/")[-1].lower()


def normalize_website(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if not raw:
        return None
    v = str(raw).strip()
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    low = v.lower()
    if any(
        x in low
        for x in (
            "instagram.com",
            "facebook.com",
            "fb.com",
            "t.me/",
            "telegram.me",
            "wa.me/",
        )
    ):
        return None
    try:
        host = (urlparse(v).hostname or "").lower()
    except Exception:
        return None
    if not host or "." not in host:
        return None
    return v.split("?")[0][:300]


# Telegram chat ids that sometimes leak into phone fields.
_BAD_PHONE_DIGITS = {
    "1333533747",
    "1955320601",
    "1001333533747",
    "1001955320601",
}


def plausible_phone(raw: str | None) -> str | None:
    """Accept NANP/RU-ish phones; reject chat ids and invalid US NPAs."""
    if not raw:
        return None
    ph = normalize_phone(raw) or (raw.strip() if raw.strip().startswith("+") else None)
    if not ph:
        return None
    digits = re.sub(r"\D", "", ph)
    if digits in _BAD_PHONE_DIGITS or digits.lstrip("1") in _BAD_PHONE_DIGITS:
        return None
    if len(digits) == 11 and digits.startswith("1"):
        # NANP: NPA and NXX cannot start with 0/1
        if digits[1] in "01" or digits[4] in "01":
            return None
    if len(digits) < 10 or len(digits) > 15:
        return None
    return ph if ph.startswith("+") else f"+{digits}"


def first_phone(raw: Any, text: str) -> str | None:
    cands: list[str] = []
    if isinstance(raw, list):
        cands.extend(str(x) for x in raw if x)
    elif raw:
        cands.append(str(raw))
    cands.extend(extract_phones(text or ""))
    for cand in cands:
        ph = plausible_phone(normalize_phone(cand) or cand)
        if ph:
            return ph
    return None


def is_ephemeral_image_url(url: str) -> bool:
    low = (url or "").lower()
    return any(
        x in low
        for x in (
            "fbcdn.net",
            "scontent",
            "cdninstagram.com",
            "instagram.com/",
        )
    )


def first_email(raw: Any, text: str) -> str | None:
    if isinstance(raw, list) and raw:
        return str(raw[0]).strip().lower()
    if isinstance(raw, str) and "@" in raw:
        return raw.strip().lower()
    emails = extract_emails(text or "")
    return emails[0] if emails else None


def name_tokens(value: str | None) -> set[str]:
    if not value:
        return set()
    cleaned = re.sub(r"[^\w\s]+", " ", value.lower(), flags=re.UNICODE)
    stop = {"llc", "inc", "the", "and", "для", "и", "studio", "service", "services"}
    return {t for t in cleaned.split() if len(t) >= 3 and t not in stop and not t.isdigit()}


def names_compatible(a: str | None, b: str | None) -> bool:
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return False
    if ta & tb:
        return True
    pa, pb = (a or "").lower(), (b or "").lower()
    for token in ta:
        if len(token) >= 4 and token in pb:
            return True
    for token in tb:
        if len(token) >= 4 and token in pa:
            return True
    return False


def clean_description(src: str) -> str | None:
    cleaned = src.strip()
    cleaned = re.sub(r"(?im)^(?:контакты|источник|telegram\s*id)\s*:.*$", "", cleaned)
    cleaned = re.sub(r"https?://\S+", " ", cleaned)
    for ph in extract_phones(cleaned):
        cleaned = cleaned.replace(ph, " ")
    cleaned = re.sub(
        r"(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})",
        " ",
        cleaned,
    )
    cleaned = re.sub(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", " ", cleaned)
    cleaned = re.sub(r"(?:^|[\s(,])@[A-Za-z0-9._]{3,30}\b", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 40:
        return None
    return cleaned[:4000]


def facebook_cdn_image(item: dict[str, Any]) -> str | None:
    for m in item.get("source_media") or []:
        if not isinstance(m, dict):
            continue
        url = (m.get("url") or m.get("thumbnail_url") or "").strip()
        if not url.startswith("http"):
            continue
        low = url.lower()
        if "fbcdn.net" in low or "scontent" in low:
            if any(x in low for x in (".jpg", ".jpeg", ".png", ".webp")) or "stp=" in low:
                return url[:500]
    return None


def fetch_all(
    client: SupabaseRest, path: str, select: str, extra: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        params: dict[str, str] = {
            "select": select,
            "order": "id.asc",
            "offset": str(offset),
            "limit": "1000",
        }
        if extra:
            params.update(extra)
        batch = client._request("GET", path, params=params) or []
        out.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return out


def needs_gap(pro: dict[str, Any]) -> bool:
    return (
        empty_image(pro.get("image_url"))
        or empty(pro.get("phone"))
        or empty(pro.get("instagram_url"))
        or empty(pro.get("website"))
        or empty(pro.get("email"))
        or empty(pro.get("telegram_url"))
        or empty(pro.get("city"))
        or len((pro.get("description") or "").strip()) < 60
        or empty(pro.get("short_description"))
        or empty(pro.get("headline"))
    )


def build_patch_from_item(pro: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    text = "\n".join(
        str(x)
        for x in (
            item.get("source_text"),
            item.get("description"),
            item.get("title"),
            item.get("person_name"),
            " ".join(item.get("services") or []),
        )
        if x
    )
    patch: dict[str, Any] = {}

    if empty(pro.get("phone")):
        ph = first_phone(item.get("phone"), text)
        if ph:
            patch["phone"] = ph

    if empty(pro.get("email")):
        em = first_email(item.get("email"), text)
        if em:
            patch["email"] = em

    if empty(pro.get("instagram_url")):
        ig = normalize_instagram(item.get("instagram"))
        if not ig:
            found = extract_instagram(text)
            ig = normalize_instagram(found[0] if found else None)
        if ig:
            patch["instagram_url"] = ig

    if empty(pro.get("website")):
        web = normalize_website(item.get("website"))
        if not web:
            webs = extract_websites(text)
            web = normalize_website(webs[0] if webs else None)
        if web:
            patch["website"] = web

    if empty(pro.get("telegram_url")):
        tg = item.get("telegram_username")
        if tg:
            h = str(tg).lstrip("@").strip()
            if re.fullmatch(r"[A-Za-z0-9_]{4,32}", h) and not h.isdigit():
                patch["telegram_url"] = f"https://t.me/{h}"
        if "telegram_url" not in patch:
            tgs = extract_telegram(text)
            if tgs:
                h = tgs[0].lstrip("@")
                if re.fullmatch(r"[A-Za-z0-9_]{4,32}", h) and not h.isdigit():
                    patch["telegram_url"] = f"https://t.me/{h}"

    if empty(pro.get("city")) and item.get("city"):
        city = str(item["city"]).strip()
        if 2 <= len(city) <= 80:
            patch["city"] = city

    if empty_image(pro.get("image_url")):
        preview = (item.get("preview_image_url") or "").strip()
        if preview.startswith("http"):
            patch["image_url"] = preview[:500]
        else:
            cdn = facebook_cdn_image(item)
            if cdn:
                patch["image_url"] = cdn

    desc = (pro.get("description") or "").strip()
    src_desc = (item.get("description") or item.get("source_text") or "").strip()
    if src_desc and len(desc) < 60:
        cleaned = clean_description(src_desc)
        if cleaned:
            patch["description"] = cleaned
            if empty(pro.get("short_description")):
                patch["short_description"] = cleaned[:240]

    services = [str(s).strip() for s in (item.get("services") or []) if str(s).strip()]
    if services and empty(pro.get("headline")):
        patch["headline"] = " · ".join(services[:3])[:160]
    if services and empty(pro.get("short_description")) and "short_description" not in patch:
        patch["short_description"] = ", ".join(services[:6])[:240]

    return patch


def enrich_from_description(pro: dict[str, Any]) -> dict[str, Any]:
    text = "\n".join(
        str(x)
        for x in (pro.get("description"), pro.get("short_description"), pro.get("headline"))
        if x
    )
    patch: dict[str, Any] = {}
    if empty(pro.get("phone")):
        ph = first_phone(None, text)
        if ph:
            patch["phone"] = ph
    if empty(pro.get("instagram_url")):
        found = extract_instagram(text)
        ig = normalize_instagram(found[0] if found else None)
        if ig:
            patch["instagram_url"] = ig
    if empty(pro.get("website")):
        webs = extract_websites(text)
        web = normalize_website(webs[0] if webs else None)
        if web:
            patch["website"] = web
    if empty(pro.get("email")):
        em = first_email(None, text)
        if em:
            patch["email"] = em
    return patch


def enrich_from_recs(
    pro: dict[str, Any],
    phone_idx: dict[str, dict[str, Any]],
    ig_idx: dict[str, dict[str, Any]],
    name_idx: list[dict[str, Any]],
) -> dict[str, Any]:
    """Fill gaps via phone/IG match, or careful full-name match (≥2 tokens)."""
    patch: dict[str, Any] = {}
    hits: list[dict[str, Any]] = []
    ph = plausible_phone(pro.get("phone"))
    if ph and ph in phone_idx:
        hits.append(phone_idx[ph])
    handle = ig_handle(pro.get("instagram_url"))
    if handle and handle in ig_idx:
        hits.append(ig_idx[handle])

    if not hits:
        pro_tokens = name_tokens(pro.get("display_name"))
        # Skip single-token names ("Alina", "Макс") — too many collisions
        if len(pro_tokens) >= 2:
            candidates = [
                r
                for r in name_idx
                if len(name_tokens(r.get("display_name"))) >= 2
                and names_compatible(pro.get("display_name"), r.get("display_name"))
            ]
            exact = [
                r
                for r in candidates
                if (r.get("display_name") or "").strip().lower()
                == (pro.get("display_name") or "").strip().lower()
            ]
            pool = exact or candidates
            if len(pool) == 1:
                hits = pool
            elif len(pool) > 1:
                # Same contact fingerprint → safe to take richest cluster
                def fingerprint(r: dict[str, Any]) -> tuple:
                    phones = tuple(
                        sorted(
                            {
                                plausible_phone(p)
                                for p in (r.get("phones") or [])
                                if plausible_phone(p)
                            }
                        )
                    )
                    igs = tuple(
                        sorted(
                            {
                                ig_handle(x)
                                for x in (r.get("instagram") or [])
                                if ig_handle(x)
                            }
                        )
                    )
                    return (phones, igs)

                fps = {fingerprint(r) for r in pool}
                if len(fps) == 1 and any(fps):
                    hits = [max(pool, key=lambda r: int(r.get("mention_count") or 0))]

    if not hits:
        return patch
    best = max(hits, key=lambda r: int(r.get("mention_count") or 0))
    # Reject contact hits with clearly incompatible names
    if (
        name_tokens(pro.get("display_name"))
        and name_tokens(best.get("display_name"))
        and not names_compatible(pro.get("display_name"), best.get("display_name"))
    ):
        return patch

    if empty(pro.get("phone")):
        for cand in best.get("phones") or []:
            good = plausible_phone(cand)
            if good:
                patch["phone"] = good
                break
    if empty(pro.get("instagram_url")):
        igs = best.get("instagram") or []
        ig = normalize_instagram(igs[0] if igs else None)
        if ig:
            patch["instagram_url"] = ig
    if empty(pro.get("website")):
        for w in best.get("websites") or []:
            web = normalize_website(w)
            if web:
                patch["website"] = web
                break
    return patch


def download_bytes(url: str, timeout: int = 25) -> bytes | None:
    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0 KrugiEnrich/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            if data and len(data) > 1500:
                return data
    except Exception:  # noqa: BLE001
        return None
    return None


def upload_professional_image(
    media_client: Any, professional_id: str, raw: bytes
) -> str | None:
    from validate import reencode_webp  # local import

    webp = reencode_webp(raw, max_edge=1600, quality=85)
    path = f"professional/{professional_id}/{webp.sha256[:16]}.webp"
    media_client.upload(
        BUCKET,
        path,
        webp.data,
        content_type="image/webp",
        upsert=True,
    )
    return media_client.public_url(BUCKET, path)


def try_web_or_ig_image(pro: dict[str, Any]) -> tuple[bytes | None, str | None]:
    from fetch_instagram import fetch_instagram_image_bytes
    from fetch_website import cover_image_urls, discover_website_images, download_image
    from validate import validate_image_bytes

    website = (pro.get("website") or "").strip()
    ig = (pro.get("instagram_url") or "").strip()

    if website:
        host = (urlparse(website).hostname or "").lower()
        if host and host not in SKIP_WEB_HOSTS and "instagram.com" not in host:
            disc = discover_website_images(website)
            for _label, url in cover_image_urls(disc):
                if not url:
                    continue
                data, err = download_image(url)
                if err or not data:
                    continue
                valid, _ = validate_image_bytes(data)
                if valid and valid.width >= 180 and valid.height >= 180:
                    return valid.data, "website"

    if ig:
        data, _disc = fetch_instagram_image_bytes(ig)
        if data:
            valid, _ = validate_image_bytes(data)
            if valid and valid.width >= 180 and valid.height >= 180:
                return valid.data, "instagram"
    return None, None


def try_telegram_photo(
    tg: Any, item: dict[str, Any], *, dry_run: bool
) -> bytes | None:
    chat_raw = item.get("source_chat_id")
    msg_ids = []
    for x in item.get("source_message_ids") or []:
        try:
            msg_ids.append(int(x))
        except (TypeError, ValueError):
            continue
    if not chat_raw or not msg_ids:
        return None
    try:
        chat_id = int(chat_raw)
    except (TypeError, ValueError):
        return None
    result = tg.fetch_photos(chat_id, msg_ids[:3], max_photos=1, dry_run=dry_run)
    if dry_run:
        return b"" if not (result.skipped or result.error) else None
    photos = getattr(result, "photos", None) or []
    for data in photos:
        if isinstance(data, (bytes, bytearray)) and len(data) > 1500:
            return bytes(data)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--skip-telegram-photos", action="store_true")
    parser.add_argument("--skip-web-images", action="store_true")
    parser.add_argument(
        "--category",
        default="",
        help="Only enrich this category slug (e.g. pro_other)",
    )
    args = parser.parse_args()
    if not args.apply and not args.dry_run:
        args.dry_run = True

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    extra: dict[str, str] = {"status": "eq.approved"}
    if args.category.strip():
        cats = (
            client._request(
                "GET",
                "/categories",
                params={"select": "id,slug", "slug": f"eq.{args.category.strip()}"},
            )
            or []
        )
        if not cats:
            print(f"category not found: {args.category}", file=sys.stderr)
            return 1
        extra["category_id"] = f"eq.{cats[0]['id']}"

    pros = [
        p
        for p in fetch_all(
            client,
            "/professionals",
            "id,display_name,slug,source_type,source_url,source_record_id,"
            "image_url,phone,email,website,instagram_url,telegram_url,"
            "description,short_description,headline,city,category_id",
            extra=extra,
        )
        if needs_gap(p)
    ]
    if args.limit and len(pros) > args.limit:
        pros = pros[: args.limit]
    items = fetch_all(
        client,
        "/import_review_items",
        "id,source,source_url,source_text,description,title,person_name,services,city,"
        "phone,email,website,instagram,telegram_username,preview_image_url,"
        "photos_count,source_media,source_chat_id,source_message_ids",
    )
    by_url = {
        norm_url(i.get("source_url")): i for i in items if i.get("source_url")
    }

    recs = fetch_all(
        client,
        "/import_comment_recommendations",
        "cluster_key,display_name,phones,instagram,websites,mention_count",
        extra={"order": "cluster_key.asc"},
    )
    phone_idx: dict[str, dict[str, Any]] = {}
    ig_idx: dict[str, dict[str, Any]] = {}
    for r in recs:
        for p in r.get("phones") or []:
            try:
                np = normalize_phone(p)
            except Exception:  # noqa: BLE001
                np = None
            if np:
                phone_idx[np] = r
        for ig in r.get("instagram") or []:
            h = ig_handle(ig)
            if h:
                ig_idx[h] = r

    media_client = None
    tg_client = None
    if args.apply:
        from storage_client import MediaSupabase

        media_client = MediaSupabase(url, key)
    if args.apply and not args.skip_telegram_photos:
        try:
            from telegram_photos import TelegramPhotoClient

            tg_client = TelegramPhotoClient()
            tg_client.connect()
        except Exception as exc:  # noqa: BLE001
            print(f"telegram client unavailable: {exc}")
            tg_client = None

    try:
        planned: list[dict[str, Any]] = []
        field_hits: dict[str, int] = {}
        matched_item = 0
        image_stats = {
            "from_preview": 0,
            "from_fbcdn": 0,
            "from_telegram": 0,
            "from_website": 0,
            "from_instagram": 0,
            "rehost_fail": 0,
        }

        for pro in pros:
            patch: dict[str, Any] = {}
            sources: list[str] = []
            item = by_url.get(norm_url(pro.get("source_url")))
            if item:
                matched_item += 1
                p1 = build_patch_from_item(pro, item)
                if p1:
                    patch.update(p1)
                    sources.append("import_review")

            p2 = enrich_from_description({**pro, **patch})
            for k, v in p2.items():
                if k not in patch:
                    patch[k] = v
                    sources.append("description")

            p3 = enrich_from_recs({**pro, **patch}, phone_idx, ig_idx, recs)
            for k, v in p3.items():
                if k not in patch:
                    patch[k] = v
                    sources.append("recommendations")

            # Telegram photo download into storage
            if (
                empty_image(patch.get("image_url") or pro.get("image_url"))
                and item
                and not args.skip_telegram_photos
                and int(item.get("photos_count") or 0) > 0
                and not (item.get("preview_image_url") or "").startswith("http")
                and str(item.get("source") or "").startswith("telegram")
            ):
                if args.dry_run:
                    patch["image_url"] = patch.get("image_url") or "__telegram_photo__"
                    sources.append("telegram_photo")
                    image_stats["from_telegram"] += 1
                elif tg_client and media_client:
                    raw = try_telegram_photo(tg_client, item, dry_run=False)
                    if raw:
                        public = upload_professional_image(media_client, pro["id"], raw)
                        if public:
                            patch["image_url"] = public
                            sources.append("telegram_photo")
                            image_stats["from_telegram"] += 1
                            try:
                                client._request(
                                    "PATCH",
                                    "/import_review_items",
                                    params={"id": f"eq.{item['id']}"},
                                    body={"preview_image_url": public},
                                    prefer="return=minimal",
                                )
                            except Exception:  # noqa: BLE001
                                pass

            # Website / Instagram image
            if (
                empty_image(patch.get("image_url") or pro.get("image_url"))
                and not args.skip_web_images
            ):
                probe = {**pro, **patch}
                if probe.get("website") or probe.get("instagram_url"):
                    if args.dry_run:
                        patch["image_url"] = patch.get("image_url") or "__web_or_ig__"
                        sources.append("web_or_ig")
                    elif media_client:
                        raw, label = try_web_or_ig_image(probe)
                        if raw:
                            public = upload_professional_image(
                                media_client, pro["id"], raw
                            )
                            if public:
                                patch["image_url"] = public
                                sources.append(label or "web_or_ig")
                                if label == "website":
                                    image_stats["from_website"] += 1
                                elif label == "instagram":
                                    image_stats["from_instagram"] += 1

            # Rehost ephemeral CDN URLs into our storage (apply only)
            img = patch.get("image_url")
            if (
                args.apply
                and isinstance(img, str)
                and img.startswith("http")
                and is_ephemeral_image_url(img)
                and media_client
            ):
                raw = download_bytes(img)
                if raw:
                    public = upload_professional_image(media_client, pro["id"], raw)
                    if public:
                        if is_ephemeral_image_url(img):
                            image_stats["from_fbcdn"] += 1
                        patch["image_url"] = public
                    else:
                        patch.pop("image_url", None)
                        image_stats["rehost_fail"] += 1
                else:
                    patch.pop("image_url", None)
                    image_stats["rehost_fail"] += 1
            elif (
                isinstance(img, str)
                and img.startswith("http")
                and not is_ephemeral_image_url(img)
                and "image_url" in patch
            ):
                image_stats["from_preview"] += 1

            if args.apply and patch.get("image_url") in {
                "__telegram_photo__",
                "__web_or_ig__",
            }:
                patch.pop("image_url", None)

            if not patch:
                continue
            for k in patch:
                field_hits[k] = field_hits.get(k, 0) + 1
            planned.append(
                {
                    "id": pro["id"],
                    "slug": pro.get("slug"),
                    "name": pro.get("display_name"),
                    "sources": sorted(set(sources)),
                    "review_id": item.get("id") if item else None,
                    "patch": patch,
                }
            )
            if args.limit and len(planned) >= args.limit:
                break

        applied = 0
        if args.apply:
            for row in planned:
                body = {
                    **row["patch"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                client._request(
                    "PATCH",
                    "/professionals",
                    params={"id": f"eq.{row['id']}"},
                    body=body,
                    prefer="return=minimal",
                )
                applied += 1
                if applied % 40 == 0:
                    print(f"  patched {applied}/{len(planned)}")
                print(
                    f"applied {row['name']} ← {','.join(row['sources'])} "
                    f"{','.join(row['patch'].keys())}"
                )
                time.sleep(0.02)

        report = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "mode": "apply" if args.apply else "dry-run",
            "needy": len(pros),
            "matched_import_item": matched_item,
            "updated": len(planned),
            "applied": applied,
            "field_hits": dict(sorted(field_hits.items(), key=lambda x: -x[1])),
            "image_stats": image_stats,
            "sample": planned[:50],
        }
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = OUT / f"{'apply' if args.apply else 'dry_run'}_{stamp}.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        (OUT / ("apply_latest.json" if args.apply else "dry_run_latest.json")).write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(
            json.dumps(
                {
                    k: report[k]
                    for k in (
                        "mode",
                        "needy",
                        "matched_import_item",
                        "updated",
                        "applied",
                        "field_hits",
                        "image_stats",
                    )
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        print("report", path)
        return 0
    finally:
        if tg_client is not None:
            try:
                tg_client.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    raise SystemExit(main())
