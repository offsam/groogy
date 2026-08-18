#!/usr/bin/env python3
"""Enrich admin recommendation cards (import_comment_recommendations).

Fill-empty only:
  1) phones / Instagram / websites mined from comment_texts + request_snippets
  2) cover_image_url from matched approved professionals (phone/IG)
  3) cover from linked import_review_items preview / FB CDN
  4) Telegram author profile photo when name-compatible or self-promo
  5) website OG / Instagram profile image

Usage:
  ./scripts/telegram-collector/.venv/bin/python \\
    scripts/business-enrich/enrich_recommendation_cards.py --dry-run
  ./scripts/telegram-collector/.venv/bin/python \\
    scripts/business-enrich/enrich_recommendation_cards.py --apply
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
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
    normalize_phone,
)

OUT = Path(__file__).resolve().parent / "data" / "recommendation_card_enrich"
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
}


def empty_image(url: Any) -> bool:
    u = (url or "").strip()
    if not u:
        return True
    low = u.lower()
    if low.endswith(".svg"):
        return True
    return any(m in low for m in PLACEHOLDER_MARKERS)


def name_tokens(value: str | None) -> set[str]:
    if not value:
        return set()
    cleaned = re.sub(r"[^\w\s]+", " ", value.lower(), flags=re.UNICODE)
    stop = {"llc", "inc", "the", "and", "для", "и", "studio", "service", "services"}
    return {t for t in cleaned.split() if len(t) >= 3 and t not in stop and not t.isdigit()}


def names_compatible(a: str | None, b: str | None) -> bool:
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        aa = (a or "").strip().lower()
        bb = (b or "").strip().lower()
        return bool(aa and bb and aa == bb)
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


_BAD_PHONE = {"1333533747", "1955320601", "1001333533747", "1001955320601"}


def plausible_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    ph = normalize_phone(raw) or (raw.strip() if str(raw).strip().startswith("+") else None)
    if not ph:
        return None
    digits = re.sub(r"\D", "", ph)
    if digits in _BAD_PHONE or digits.lstrip("1") in _BAD_PHONE:
        return None
    if len(digits) == 11 and digits.startswith("1"):
        if digits[1] in "01" or digits[4] in "01":
            return None
    if len(digits) < 10 or len(digits) > 15:
        return None
    return ph if ph.startswith("+") else f"+{digits}"


def ig_handle(raw: Any) -> str | None:
    if raw is None:
        return None
    v = str(raw).strip().lstrip("@")
    m = re.search(r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})", v, re.I)
    handle = (m.group(1) if m else v).split("?")[0].split("/")[0]
    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", handle or ""):
        return None
    if handle.lower() in {"reel", "p", "stories", "explore", "accounts"}:
        return None
    return handle.lower()


def normalize_website(raw: Any) -> str | None:
    if not raw:
        return None
    v = str(raw).strip()
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    low = v.lower()
    if any(x in low for x in ("instagram.com", "facebook.com", "fb.com", "wa.me/")):
        return None
    try:
        host = (urlparse(v).hostname or "").lower()
    except Exception:
        return None
    if not host or "." not in host:
        return None
    return v.split("?")[0][:300]


def tg_handle(raw: Any) -> str | None:
    if not raw:
        return None
    v = str(raw).strip()
    m = re.search(r"(?:t\.me|telegram\.me)/([A-Za-z0-9_]{4,32})", v, re.I)
    if m:
        h = m.group(1)
        if h.lower() in {"c", "s", "joinchat"} or h.isdigit():
            return None
        return h
    h = v.lstrip("@")
    if re.fullmatch(r"[A-Za-z0-9_]{4,32}", h) and not h.isdigit():
        return h
    return None


def parse_tg_post(url: str) -> tuple[int, int] | None:
    m = re.search(r"t\.me/c/(\d+)/(\d+)", url or "")
    if not m:
        return None
    chat = int(m.group(1))
    msg = int(m.group(2))
    # private supergroup form uses -100 prefix
    return (-1000000000000 - chat if chat < 10**12 else -chat), msg


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


def download_bytes(url: str, timeout: int = 25) -> bytes | None:
    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0 KrugiRecEnrich/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            if data and len(data) > 1500:
                return data
    except Exception:  # noqa: BLE001
        return None
    return None


def upload_cover(media_client: Any, rec_id: str, raw: bytes) -> str | None:
    from validate import reencode_webp

    try:
        webp = reencode_webp(raw, max_edge=1200, quality=85)
    except Exception:  # noqa: BLE001
        return None
    path = f"recommendation/{rec_id}/cover_{webp.sha256[:16]}.webp"
    try:
        media_client.upload(
            BUCKET,
            path,
            webp.data,
            content_type="image/webp",
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        # Transient SSL / storage blips — skip this image rather than abort the run
        time.sleep(0.4)
        try:
            media_client.upload(
                BUCKET,
                path,
                webp.data,
                content_type="image/webp",
                upsert=True,
            )
        except Exception:  # noqa: BLE001
            return None
    return media_client.public_url(BUCKET, path)


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


def merge_unique(existing: list[Any], new_vals: list[str], *, limit: int = 8) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in list(existing or []) + new_vals:
        s = str(v).strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= limit:
            break
    return out


def contact_patch_from_text(rec: dict[str, Any]) -> dict[str, Any]:
    text = "\n".join(
        str(x)
        for x in (
            *(rec.get("comment_texts") or []),
            *(rec.get("request_snippets") or []),
            rec.get("display_name"),
            rec.get("notes"),
        )
        if x
    )
    patch: dict[str, Any] = {}
    phones = list(rec.get("phones") or [])
    if not phones:
        found = []
        for cand in extract_phones(text):
            ph = plausible_phone(cand)
            if ph:
                found.append(ph)
        if found:
            patch["phones"] = merge_unique([], found)

    igs = list(rec.get("instagram") or [])
    if not igs:
        found = []
        for cand in extract_instagram(text):
            h = ig_handle(cand)
            if h:
                found.append(h)
        if found:
            patch["instagram"] = merge_unique([], found)

    webs = list(rec.get("websites") or [])
    if not webs:
        found = []
        for cand in extract_websites(text):
            w = normalize_website(cand)
            if w:
                found.append(w)
        for tg in extract_telegram(text):
            h = tg_handle(tg)
            if h:
                found.append(f"https://t.me/{h}")
        if found:
            patch["websites"] = merge_unique([], found)
    return patch


def build_item_indexes(items: list[dict[str, Any]]) -> dict[tuple[str, int], dict[str, Any]]:
    by_msg: dict[tuple[str, int], dict[str, Any]] = {}
    for item in items:
        for url in [item.get("source_url"), *((item.get("source_media") or []) and [])]:
            pass
        u = item.get("source_url") or ""
        m = re.search(r"t\.me/c/(\d+)/(\d+)", u)
        if m:
            by_msg[(m.group(1), int(m.group(2)))] = item
        chat = item.get("source_chat_id")
        for mid in item.get("source_message_ids") or []:
            try:
                by_msg[(str(chat), int(mid))] = item
                # also bare chat without -100
                s = str(chat)
                if s.startswith("-100"):
                    by_msg[(s[4:], int(mid))] = item
            except (TypeError, ValueError):
                continue
    return by_msg


def find_linked_item(
    rec: dict[str, Any], by_msg: dict[tuple[str, int], dict[str, Any]]
) -> dict[str, Any] | None:
    for url in rec.get("source_post_urls") or []:
        m = re.search(r"t\.me/c/(\d+)/(\d+)", url or "")
        if not m:
            continue
        chat, msg = m.group(1), int(m.group(2))
        item = by_msg.get((chat, msg)) or by_msg.get((f"-100{chat}", msg))
        if item:
            return item
        parsed = parse_tg_post(url)
        if parsed:
            chat_id, msg_id = parsed
            item = by_msg.get((str(chat_id), msg_id))
            if item:
                return item
    return None


def should_use_author_avatar(rec: dict[str, Any], item: dict[str, Any]) -> bool:
    author = item.get("source_author_display_name")
    if names_compatible(rec.get("display_name"), author):
        return True
    self_ad = int(rec.get("self_ad_mention_count") or 0)
    third = int(rec.get("third_party_mention_count") or 0)
    if self_ad > 0 and third == 0:
        return True
    # TG handle on websites matches author username
    author_user = (item.get("source_author_username") or item.get("telegram_username") or "").lstrip(
        "@"
    ).lower()
    if author_user:
        for w in rec.get("websites") or []:
            h = tg_handle(w)
            if h and h.lower() == author_user:
                return True
    return False


def try_web_or_ig_image(rec: dict[str, Any]) -> bytes | None:
    from fetch_instagram import fetch_instagram_image_bytes
    from fetch_website import cover_image_urls, discover_website_images, download_image
    from validate import validate_image_bytes

    for w in rec.get("websites") or []:
        web = normalize_website(w)
        if not web:
            continue
        host = (urlparse(web).hostname or "").lower()
        if host in SKIP_WEB_HOSTS or "instagram.com" in host:
            continue
        disc = discover_website_images(web)
        for _label, url in cover_image_urls(disc):
            if not url:
                continue
            data, err = download_image(url)
            if err or not data:
                continue
            valid, _ = validate_image_bytes(data)
            if valid and valid.width >= 180 and valid.height >= 180:
                return valid.data

    for ig in rec.get("instagram") or []:
        h = ig_handle(ig)
        if not h:
            continue
        data, _ = fetch_instagram_image_bytes(f"https://www.instagram.com/{h}")
        if data:
            valid, _ = validate_image_bytes(data)
            if valid and valid.width >= 180 and valid.height >= 180:
                return valid.data
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--skip-telegram-avatars", action="store_true")
    parser.add_argument("--skip-web-images", action="store_true")
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

    recs = [
        r
        for r in fetch_all(
            client,
            "/import_comment_recommendations",
            "id,cluster_key,display_name,kind,phones,instagram,websites,comment_texts,"
            "request_snippets,source_post_urls,recommender_names,notes,cover_image_url,"
            "source_channel,status,self_ad_mention_count,third_party_mention_count",
            extra={"status": "in.(pending,approved)"},
        )
        if empty_image(r.get("cover_image_url"))
        or not (r.get("phones") or [])
        or not (r.get("instagram") or [])
        or not (r.get("websites") or [])
    ]

    items = fetch_all(
        client,
        "/import_review_items",
        "id,source,source_url,source_chat_id,source_message_ids,source_author_id,"
        "source_author_username,source_author_display_name,telegram_username,"
        "preview_image_url,source_media,photos_count",
    )
    by_msg = build_item_indexes(items)

    pros = fetch_all(
        client,
        "/professionals",
        "id,display_name,phone,instagram_url,image_url,website,telegram_url",
        extra={"status": "eq.approved"},
    )
    phone_pro: dict[str, dict[str, Any]] = {}
    ig_pro: dict[str, dict[str, Any]] = {}
    for p in pros:
        if empty_image(p.get("image_url")):
            continue
        if p.get("phone"):
            ph = plausible_phone(p["phone"])
            if ph:
                phone_pro[ph] = p
        h = ig_handle(p.get("instagram_url"))
        if h:
            ig_pro[h] = p

    media_client = None
    tg_client = None
    if args.apply:
        from storage_client import MediaSupabase

        if not args.skip_telegram_avatars:
            try:
                from telegram_photos import TelegramPhotoClient

                tg_client = TelegramPhotoClient()
                tg_client.connect()
            except Exception as exc:  # noqa: BLE001
                print(f"telegram client unavailable: {exc}")
                tg_client = None
        load_env()
        media_client = MediaSupabase(
            os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or url,
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or key,
        )

    planned: list[dict[str, Any]] = []
    field_hits: dict[str, int] = {}
    image_stats: dict[str, int] = {
        "from_professional": 0,
        "from_preview": 0,
        "from_fbcdn": 0,
        "from_telegram_avatar": 0,
        "from_website": 0,
        "from_instagram": 0,
        "rehost_fail": 0,
    }
    avatar_cache: dict[str, bytes | None] = {}

    try:
        for rec in recs:
            patch: dict[str, Any] = {}
            sources: list[str] = []

            c1 = contact_patch_from_text(rec)
            if c1:
                patch.update(c1)
                sources.append("comment_text")

            merged = {**rec, **patch}
            item = find_linked_item(rec, by_msg)

            # Image: professional match
            if empty_image(merged.get("cover_image_url")):
                hit = None
                for ph in merged.get("phones") or []:
                    np = plausible_phone(ph)
                    if np and np in phone_pro:
                        hit = phone_pro[np]
                        break
                if not hit:
                    for ig in merged.get("instagram") or []:
                        h = ig_handle(ig)
                        if h and h in ig_pro:
                            hit = ig_pro[h]
                            break
                if hit and hit.get("image_url"):
                    patch["cover_image_url"] = hit["image_url"]
                    sources.append("professional")
                    image_stats["from_professional"] += 1

            # Image: import preview / FB CDN
            if empty_image(patch.get("cover_image_url") or merged.get("cover_image_url")) and item:
                preview = (item.get("preview_image_url") or "").strip()
                if preview.startswith("http"):
                    patch["cover_image_url"] = preview[:500]
                    sources.append("import_preview")
                    image_stats["from_preview"] += 1
                else:
                    cdn = facebook_cdn_image(item)
                    if cdn:
                        patch["cover_image_url"] = cdn
                        sources.append("fbcdn")
                        image_stats["from_fbcdn"] += 1

            # Image: telegram author avatar
            need_img = empty_image(patch.get("cover_image_url") or merged.get("cover_image_url"))
            if (
                need_img
                and not args.skip_telegram_avatars
                and rec.get("source_channel") == "telegram"
                and item
                and should_use_author_avatar(merged, item)
            ):
                uid = str(item.get("source_author_id") or "").strip() or None
                uname = (
                    str(item.get("source_author_username") or item.get("telegram_username") or "")
                    .strip()
                    .lstrip("@")
                    or None
                )
                chat_id = item.get("source_chat_id")
                msg_ids = item.get("source_message_ids") or []
                msg_id = None
                try:
                    msg_id = int(msg_ids[0]) if msg_ids else None
                except (TypeError, ValueError, IndexError):
                    msg_id = None
                if args.dry_run:
                    if uid or uname or (chat_id and msg_id):
                        patch["cover_image_url"] = patch.get("cover_image_url") or "__tg_avatar__"
                        sources.append("telegram_avatar")
                        image_stats["from_telegram_avatar"] += 1
                elif tg_client and media_client and (uid or uname or (chat_id and msg_id)):
                    cache_key = f"id:{uid}" if uid else f"u:{uname}"
                    if cache_key in avatar_cache:
                        raw = avatar_cache[cache_key]
                    else:
                        res = tg_client.fetch_profile_photo(
                            user_id=uid,
                            username=uname,
                            chat_id=int(chat_id) if chat_id is not None else None,
                            message_id=msg_id,
                            dry_run=False,
                        )
                        raw = res.photo if res.photo and len(res.photo) > 800 else None
                        avatar_cache[cache_key] = raw
                    if raw:
                        public = upload_cover(media_client, rec["id"], raw)
                        if public:
                            patch["cover_image_url"] = public
                            sources.append("telegram_avatar")
                            image_stats["from_telegram_avatar"] += 1

            # Image: website / IG
            need_img = empty_image(patch.get("cover_image_url") or merged.get("cover_image_url"))
            probe = {**merged, **patch}
            if need_img and not args.skip_web_images and (
                probe.get("websites") or probe.get("instagram")
            ):
                if args.dry_run:
                    patch["cover_image_url"] = patch.get("cover_image_url") or "__web_or_ig__"
                    sources.append("web_or_ig")
                elif media_client:
                    raw = try_web_or_ig_image(probe)
                    if raw:
                        public = upload_cover(media_client, rec["id"], raw)
                        if public:
                            patch["cover_image_url"] = public
                            sources.append("web_or_ig")
                            # coarse: website preferred inside try_
                            image_stats["from_website"] += 1

            # Rehost ephemeral CDN on apply
            img = patch.get("cover_image_url")
            if (
                args.apply
                and isinstance(img, str)
                and img.startswith("http")
                and any(x in img.lower() for x in ("fbcdn.net", "scontent"))
                and media_client
            ):
                raw = download_bytes(img)
                if raw:
                    public = upload_cover(media_client, rec["id"], raw)
                    if public:
                        patch["cover_image_url"] = public
                    else:
                        patch.pop("cover_image_url", None)
                        image_stats["rehost_fail"] += 1
                else:
                    patch.pop("cover_image_url", None)
                    image_stats["rehost_fail"] += 1

            if args.apply and patch.get("cover_image_url") in {
                "__tg_avatar__",
                "__web_or_ig__",
            }:
                patch.pop("cover_image_url", None)

            if not patch:
                continue
            for k in patch:
                field_hits[k] = field_hits.get(k, 0) + 1
            planned.append(
                {
                    "id": rec["id"],
                    "name": rec.get("display_name"),
                    "channel": rec.get("source_channel"),
                    "sources": sorted(set(sources)),
                    "patch": {
                        k: (v if k != "cover_image_url" or not isinstance(v, str) or len(v) < 120 else v[:100] + "…")
                        for k, v in patch.items()
                    },
                    "_full_patch": patch,
                }
            )
            if args.limit and len(planned) >= args.limit:
                break

        applied = 0
        if args.apply:
            for row in planned:
                body = {
                    **row["_full_patch"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                client._request(
                    "PATCH",
                    "/import_comment_recommendations",
                    params={"id": f"eq.{row['id']}"},
                    body=body,
                    prefer="return=minimal",
                )
                applied += 1
                print(
                    f"applied {row['name']} ← {','.join(row['sources'])} "
                    f"{','.join(row['_full_patch'].keys())}"
                )
                time.sleep(0.03)

        # strip internal from report
        sample = []
        for row in planned[:40]:
            sample.append({k: v for k, v in row.items() if k != "_full_patch"})

        report = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "mode": "apply" if args.apply else "dry-run",
            "needy": len(recs),
            "updated": len(planned),
            "applied": applied,
            "field_hits": dict(sorted(field_hits.items(), key=lambda x: -x[1])),
            "image_stats": image_stats,
            "sample": sample,
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
