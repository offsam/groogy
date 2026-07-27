#!/usr/bin/env python3
"""Fill missing professional images from Telegram author / profile avatars.

Rules (fill-empty only, no invented data):
  - Skip Facebook sources for this pass (post media / CDN already handled elsewhere).
  - Prefer the Telegram profile photo of the message author when the listing looks
    like it belongs to that author:
      * display_name compatible with source_author_display_name, OR
      * telegram handle on the pro matches author username, OR
      * self-promo only (self_ad>0 and third_party==0) with a known author id/username
  - Also try professionals.telegram_url / import telegram_username when no author.

Usage:
  ./scripts/telegram-collector/.venv/bin/python \\
    scripts/business-enrich/enrich_professional_avatars.py --dry-run
  ./scripts/telegram-collector/.venv/bin/python \\
    scripts/business-enrich/enrich_professional_avatars.py --apply
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

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "media-pipeline"))

from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "professional_avatar_enrich"
OUT.mkdir(parents=True, exist_ok=True)

BUCKET = "business-images"
PLACEHOLDER_MARKERS = ("placeholder", "/images/categories/")


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


def name_tokens(value: str | None) -> set[str]:
    if not value:
        return set()
    cleaned = re.sub(r"[^\w\s]+", " ", value.lower(), flags=re.UNICODE)
    stop = {
        "llc",
        "inc",
        "the",
        "and",
        "для",
        "и",
        "studio",
        "service",
        "services",
        "психолог",
        "гипнотерапевт",
    }
    return {t for t in cleaned.split() if len(t) >= 3 and t not in stop and not t.isdigit()}


def names_compatible(a: str | None, b: str | None) -> bool:
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        # Single short names: exact casefold match
        aa = (a or "").strip().lower()
        bb = (b or "").strip().lower()
        if aa and bb and aa == bb:
            return True
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


def tg_handle_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = re.search(r"(?:t\.me|telegram\.me)/([A-Za-z0-9_]{4,32})", url, re.I)
    if not m:
        return None
    h = m.group(1)
    if h.lower() in {"c", "s", "joinchat", "addstickers"}:
        return None
    if h.isdigit():
        return None
    return h


def clean_username(raw: Any) -> str | None:
    if not raw:
        return None
    h = str(raw).strip().lstrip("@")
    if re.fullmatch(r"[A-Za-z0-9_]{4,32}", h) and not h.isdigit():
        return h
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


def upload_professional_image(media_client: Any, professional_id: str, raw: bytes) -> str | None:
    from validate import reencode_webp

    webp = reencode_webp(raw, max_edge=1200, quality=85)
    path = f"professional/{professional_id}/avatar_{webp.sha256[:16]}.webp"
    media_client.upload(
        BUCKET,
        path,
        webp.data,
        content_type="image/webp",
        upsert=True,
    )
    return media_client.public_url(BUCKET, path)


def author_refs(item: dict[str, Any]) -> tuple[str | None, str | None]:
    uid = str(item.get("source_author_id") or item.get("telegram_user_id") or "").strip() or None
    uname = clean_username(
        item.get("source_author_username") or item.get("telegram_username")
    )
    return uid, uname


def should_use_author_avatar(pro: dict[str, Any], item: dict[str, Any]) -> tuple[bool, str]:
    """Return (ok, reason). Never use a third-party recommender's face blindly."""
    author_name = item.get("source_author_display_name")
    uid, uname = author_refs(item)
    if not uid and not uname:
        return False, "no_author_ref"

    pro_handle = tg_handle_from_url(pro.get("telegram_url"))
    if pro_handle and uname and pro_handle.lower() == uname.lower():
        return True, "telegram_handle_match"

    if names_compatible(pro.get("display_name"), author_name):
        return True, "name_compatible"

    # person_name/title must also agree with the author (not just the listing title)
    for field in ("person_name", "title"):
        field_val = item.get(field)
        if names_compatible(pro.get("display_name"), field_val) and names_compatible(
            field_val, author_name
        ):
            return True, f"via_{field}"

    return False, "no_match"


def resolve_avatar_target(
    pro: dict[str, Any], item: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Pick user_id / username to download, with reason."""
    if item and str(item.get("source") or "").startswith("facebook"):
        return None

    if item and str(item.get("source") or "").startswith("telegram"):
        ok, reason = should_use_author_avatar(pro, item)
        if ok:
            uid, uname = author_refs(item)
            msg_ids = item.get("source_message_ids") or []
            msg_id = None
            try:
                msg_id = int(msg_ids[0]) if msg_ids else None
            except (TypeError, ValueError, IndexError):
                msg_id = None
            chat_raw = item.get("source_chat_id")
            chat_id = None
            try:
                chat_id = int(chat_raw) if chat_raw is not None else None
            except (TypeError, ValueError):
                chat_id = None
            return {
                "user_id": uid,
                "username": uname,
                "chat_id": chat_id,
                "message_id": msg_id,
                "reason": reason,
                "via": "import_author",
            }

    # Fallback: public @username on the professional card only (never tg://user?id=)
    handle = tg_handle_from_url(pro.get("telegram_url"))
    if handle:
        return {
            "user_id": None,
            "username": handle,
            "chat_id": None,
            "message_id": None,
            "reason": "pro_telegram_url",
            "via": "telegram_url",
        }

    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
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

    pros = [
        p
        for p in fetch_all(
            client,
            "/professionals",
            "id,display_name,slug,source_url,image_url,telegram_url,"
            "self_ad_mention_count,third_party_mention_count",
            extra={"status": "eq.approved"},
        )
        if empty_image(p.get("image_url"))
    ]
    items = fetch_all(
        client,
        "/import_review_items",
        "id,source,source_url,title,person_name,"
        "source_author_id,source_author_username,source_author_display_name,"
        "telegram_username,telegram_user_id,source_chat_id,source_message_ids",
    )
    by_url = {
        norm_url(i.get("source_url")): i for i in items if i.get("source_url")
    }

    candidates: list[dict[str, Any]] = []
    skip_reasons: dict[str, int] = {}
    for pro in pros:
        item = by_url.get(norm_url(pro.get("source_url")))
        target = resolve_avatar_target(pro, item)
        if not target:
            key = "no_target"
            if item and str(item.get("source") or "").startswith("facebook"):
                key = "skip_facebook"
            skip_reasons[key] = skip_reasons.get(key, 0) + 1
            continue
        candidates.append(
            {
                "pro": pro,
                "item": item,
                "target": target,
            }
        )
        if args.limit and len(candidates) >= args.limit:
            break

    print(
        json.dumps(
            {
                "needy_images": len(pros),
                "candidates": len(candidates),
                "skip_reasons": skip_reasons,
                "mode": "apply" if args.apply else "dry-run",
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    if args.dry_run:
        report = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "mode": "dry-run",
            "needy_images": len(pros),
            "candidates": len(candidates),
            "skip_reasons": skip_reasons,
            "sample": [
                {
                    "id": c["pro"]["id"],
                    "name": c["pro"].get("display_name"),
                    "author": (c["item"] or {}).get("source_author_display_name"),
                    "target": c["target"],
                }
                for c in candidates[:40]
            ],
        }
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = OUT / f"dry_run_{stamp}.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        (OUT / "dry_run_latest.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print("report", path)
        return 0

    from storage_client import MediaSupabase
    from telegram_photos import TelegramPhotoClient

    # Connect Telegram first — its dotenv reload can touch env; refresh storage creds after.
    tg = TelegramPhotoClient()
    tg.connect()
    load_env()
    # Re-read in case telegram config dotenv mutated env (do not print values)
    url2 = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or url
    key2 = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or key
    # Prefer key captured before connect if lengths look healthier
    if key and key.count(".") == 2 and (not key2 or key2.count(".") != 2):
        key2 = key
    media_client = MediaSupabase(url2, key2)

    applied = 0
    failed = 0
    photo_cache: dict[str, bytes | None] = {}
    results: list[dict[str, Any]] = []

    try:
        for c in candidates:
            pro = c["pro"]
            target = c["target"]
            cache_key = (
                f"id:{target.get('user_id')}"
                if target.get("user_id")
                else f"u:{target.get('username')}"
            )
            raw: bytes | None
            if cache_key in photo_cache:
                raw = photo_cache[cache_key]
            else:
                res = tg.fetch_profile_photo(
                    user_id=target.get("user_id"),
                    username=target.get("username"),
                    chat_id=target.get("chat_id"),
                    message_id=target.get("message_id"),
                    dry_run=False,
                )
                raw = res.photo if res.photo and len(res.photo) > 800 else None
                photo_cache[cache_key] = raw
                if not raw:
                    failed += 1
                    results.append(
                        {
                            "id": pro["id"],
                            "name": pro.get("display_name"),
                            "ok": False,
                            "error": res.error or "no_photo",
                            "target": target,
                        }
                    )
                    print(
                        f"fail {pro.get('display_name')} ← {target.get('reason')} "
                        f"{res.error or 'no_photo'}"
                    )
                    continue

            try:
                public = upload_professional_image(media_client, pro["id"], raw)
            except Exception as exc:  # noqa: BLE001
                failed += 1
                results.append(
                    {
                        "id": pro["id"],
                        "name": pro.get("display_name"),
                        "ok": False,
                        "error": f"upload:{exc}",
                        "target": target,
                    }
                )
                print(f"fail {pro.get('display_name')} upload {exc}")
                continue

            if not public:
                failed += 1
                continue

            client._request(
                "PATCH",
                "/professionals",
                params={"id": f"eq.{pro['id']}"},
                body={
                    "image_url": public,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                prefer="return=minimal",
            )
            applied += 1
            results.append(
                {
                    "id": pro["id"],
                    "name": pro.get("display_name"),
                    "ok": True,
                    "image_url": public,
                    "target": target,
                }
            )
            print(
                f"ok {pro.get('display_name')} ← {target.get('reason')} "
                f"{target.get('via')} {cache_key}"
            )
            time.sleep(0.08)
    finally:
        tg.close()

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply",
        "needy_images": len(pros),
        "candidates": len(candidates),
        "applied": applied,
        "failed": failed,
        "unique_profiles_fetched": sum(1 for v in photo_cache.values() if v),
        "skip_reasons": skip_reasons,
        "results": results[:80],
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"apply_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "apply_latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                k: report[k]
                for k in (
                    "mode",
                    "needy_images",
                    "candidates",
                    "applied",
                    "failed",
                    "unique_profiles_fetched",
                )
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print("report", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
