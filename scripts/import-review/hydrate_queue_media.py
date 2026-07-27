#!/usr/bin/env python3
"""Hydrate import-review queue cards with Telegram post photos + contact backfill.

Downloads the first photo from the source Telegram message into
business-images/import-review/{item_id}/{sha}.webp and sets preview_image_url.

Also backfills:
  - telegram_username from source_author_username when empty
  - telegram_user_id from source_author_id when empty
  - whatsapp from phone when text mentions WhatsApp

Usage:
  python3 scripts/import-review/hydrate_queue_media.py --dry-run --limit 20
  python3 scripts/import-review/hydrate_queue_media.py --apply --limit 50
  python3 scripts/import-review/hydrate_queue_media.py --apply
  python3 scripts/import-review/hydrate_queue_media.py --apply --contacts-only
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = ROOT / "scripts" / "media-pipeline"
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(MEDIA_DIR))

from common import load_env  # noqa: E402
from storage_client import MediaSupabase  # noqa: E402
from telegram_photos import TelegramPhotoClient  # noqa: E402
from validate import reencode_webp, validate_image_bytes  # noqa: E402

QUEUE_STATUSES = ("pending", "in_review", "needs_more_info", "ready_to_publish")
SOURCES = ("telegram", "telegram:la_orange_county")
BUCKET = "business-images"
WA_RE = re.compile(r"whats\s*app|ватсап|вацап|wa\.me", re.I)


def _message_ids(value: Any) -> list[int]:
    out: list[int] = []
    for x in value or []:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def _clean_username(value: Any) -> str | None:
    if not value:
        return None
    cleaned = str(value).strip().lstrip("@")
    return cleaned or None


def contact_patch(item: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    tg_user = _clean_username(item.get("telegram_username"))
    author = _clean_username(item.get("source_author_username"))
    if not tg_user and author:
        patch["telegram_username"] = author

    tg_uid = str(item.get("telegram_user_id") or "").strip()
    author_id = str(item.get("source_author_id") or "").strip()
    if not tg_uid and author_id:
        patch["telegram_user_id"] = author_id

    phones = [str(p).strip() for p in (item.get("phone") or []) if str(p).strip()]
    whatsapp = [str(w).strip() for w in (item.get("whatsapp") or []) if str(w).strip()]
    text = f"{item.get('description') or ''}\n{item.get('source_text') or ''}"
    if not whatsapp and phones and WA_RE.search(text):
        patch["whatsapp"] = [phones[0]]

    return patch


def fetch_queue_items(client: MediaSupabase, *, limit: int | None) -> list[dict[str, Any]]:
    """Fetch open queue rows that still need a preview image (or contact backfill)."""
    rows: list[dict[str, Any]] = []
    select = (
        "id,title,review_status,source,source_chat_id,"
        "source_message_ids,photos_count,preview_image_url,"
        "source_media,phone,whatsapp,telegram_username,"
        "telegram_user_id,source_author_username,source_author_id,"
        "description,source_text"
    )
    for source in SOURCES:
        offset = 0
        while True:
            batch = (
                client.rest_request(
                    "GET",
                    "/import_review_items",
                    params={
                        "select": select,
                        "source": f"eq.{source}",
                        "review_status": f"in.({','.join(QUEUE_STATUSES)})",
                        "photos_count": "gt.0",
                        "preview_image_url": "is.null",
                        "order": "source_posted_at.desc",
                        "offset": str(offset),
                        "limit": "100",
                    },
                )
                or []
            )
            if not batch:
                break
            rows.extend(batch)
            offset += len(batch)
            if limit is not None and len(rows) >= limit:
                return rows[:limit]
            if len(batch) < 100:
                break
    return rows


def fetch_contact_backfill_items(
    client: MediaSupabase, *, limit: int | None
) -> list[dict[str, Any]]:
    """Rows where TG username/id or WhatsApp can be filled from author/text."""
    rows: list[dict[str, Any]] = []
    select = (
        "id,phone,whatsapp,telegram_username,telegram_user_id,"
        "source_author_username,source_author_id,description,source_text"
    )
    for source in SOURCES:
        offset = 0
        while True:
            batch = (
                client.rest_request(
                    "GET",
                    "/import_review_items",
                    params={
                        "select": select,
                        "source": f"eq.{source}",
                        "review_status": f"in.({','.join(QUEUE_STATUSES)})",
                        "order": "updated_at.desc",
                        "offset": str(offset),
                        "limit": "100",
                    },
                )
                or []
            )
            if not batch:
                break
            for item in batch:
                if contact_patch(item):
                    rows.append(item)
                    if limit is not None and len(rows) >= limit:
                        return rows
            offset += len(batch)
            if len(batch) < 100:
                break
    return rows


def needs_photo(item: dict[str, Any]) -> bool:
    if item.get("preview_image_url") is not None:
        # null = not tried; "" = permanently skipped; url = done
        return False
    if int(item.get("photos_count") or 0) <= 0:
        return False
    if not item.get("source_chat_id"):
        return False
    if not _message_ids(item.get("source_message_ids")):
        return False
    media = item.get("source_media") or []
    statuses = [
        str(m.get("download_status") or "")
        for m in media
        if isinstance(m, dict)
    ]
    if statuses and all(s in {"failed", "skipped"} for s in statuses):
        return False
    return True


def _mark_media_failed(client: MediaSupabase, item: dict[str, Any], reason: str) -> None:
    msg_ids = _message_ids(item.get("source_message_ids"))
    media = list(item.get("source_media") or [])
    updated = False
    for entry in media:
        if not isinstance(entry, dict):
            continue
        entry["download_status"] = "failed"
        entry["fail_reason"] = reason
        updated = True
    if not updated and msg_ids:
        media.append(
            {
                "telegram_message_id": msg_ids[0],
                "media_type": "photo",
                "download_status": "failed",
                "fail_reason": reason,
            }
        )
    try:
        # Empty string (not null) drops the row out of preview_image_url=is.null queries.
        client.rest_request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{item['id']}"},
            body={"source_media": media, "preview_image_url": ""},
            prefer="return=minimal",
        )
    except Exception:
        pass


def apply_photo(
    client: MediaSupabase,
    tg: TelegramPhotoClient,
    item: dict[str, Any],
    *,
    dry_run: bool,
) -> dict[str, Any]:
    chat_id = int(item["source_chat_id"])
    msg_ids = _message_ids(item.get("source_message_ids"))
    result = tg.fetch_photos(chat_id, msg_ids, max_photos=1, dry_run=dry_run)
    if result.skipped or result.error:
        err = result.error or "skipped"
        if not dry_run and err in {"no_photos", "chat_not_allowed", "no_message_ids"}:
            _mark_media_failed(client, item, err)
        return {"ok": False, "error": err}
    if dry_run:
        return {"ok": True, "dry_run": True, "photos_found": len(result.photos)}
    if not result.photos or not result.photos[0]:
        _mark_media_failed(client, item, "no_photo_bytes")
        return {"ok": False, "error": "no_photo_bytes"}

    raw = result.photos[0]
    valid, reason = validate_image_bytes(raw)
    if not valid:
        # try reencode anyway if PIL can open
        try:
            encoded = reencode_webp(raw)
        except Exception:
            return {"ok": False, "error": reason or "invalid_image"}
    else:
        encoded = reencode_webp(raw)

    path = f"import-review/{item['id']}/{encoded.sha256[:16]}.webp"
    client.upload(BUCKET, path, encoded.data, content_type="image/webp", upsert=True)
    public_url = client.public_url(BUCKET, path)

    media = list(item.get("source_media") or [])
    updated_media = False
    for entry in media:
        if not isinstance(entry, dict):
            continue
        mid = entry.get("telegram_message_id")
        if mid is not None and int(mid) == int(msg_ids[0]):
            entry["download_status"] = "downloaded"
            entry["storage_path"] = path
            entry["width"] = encoded.width
            entry["height"] = encoded.height
            updated_media = True
            break
    if not updated_media:
        media.append(
            {
                "telegram_message_id": msg_ids[0],
                "media_type": "photo",
                "download_status": "downloaded",
                "storage_path": path,
                "width": encoded.width,
                "height": encoded.height,
            }
        )

    client.rest_request(
        "PATCH",
        "/import_review_items",
        params={"id": f"eq.{item['id']}"},
        body={"preview_image_url": public_url, "source_media": media},
        prefer="return=minimal",
    )
    return {"ok": True, "url": public_url, "path": path, "bytes": len(encoded.data)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Hydrate queue preview photos + contacts")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--contacts-only",
        action="store_true",
        help="Only backfill telegram/whatsapp fields, skip photo download",
    )
    parser.add_argument(
        "--photos-only",
        action="store_true",
        help="Only download photos, skip contact backfill",
    )
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    if args.dry_run and args.apply:
        print("Use only one of --dry-run / --apply", file=sys.stderr)
        return 2

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    client = MediaSupabase(url, key)
    photo_items = [] if args.contacts_only else fetch_queue_items(client, limit=args.limit)
    contact_items = (
        []
        if args.photos_only
        else fetch_contact_backfill_items(client, limit=args.limit)
    )

    photo_candidates = [i for i in photo_items if needs_photo(i)]
    contact_candidates = contact_items

    print(
        json.dumps(
            {
                "photo_fetched": len(photo_items),
                "contact_backfill_candidates": len(contact_candidates),
                "photo_candidates": len(photo_candidates),
                "mode": "dry_run" if args.dry_run else "apply",
            },
            ensure_ascii=False,
        )
    )

    stats = {
        "contacts_updated": 0,
        "photos_ok": 0,
        "photos_fail": 0,
        "errors": [],
    }

    if not args.photos_only:
        for item in contact_candidates:
            patch = contact_patch(item)
            if not patch:
                continue
            if args.dry_run:
                stats["contacts_updated"] += 1
                continue
            try:
                client.rest_request(
                    "PATCH",
                    "/import_review_items",
                    params={"id": f"eq.{item['id']}"},
                    body=patch,
                    prefer="return=minimal",
                )
                stats["contacts_updated"] += 1
            except Exception as exc:
                stats["errors"].append({"id": item["id"], "stage": "contacts", "error": str(exc)[:200]})

    if not args.contacts_only:
        tg: TelegramPhotoClient | None = None
        try:
            if photo_candidates:
                tg = TelegramPhotoClient()
                tg.connect()
            for item in photo_candidates:
                try:
                    res = apply_photo(client, tg, item, dry_run=args.dry_run)  # type: ignore[arg-type]
                    if res.get("ok"):
                        stats["photos_ok"] += 1
                    else:
                        stats["photos_fail"] += 1
                        stats["errors"].append(
                            {"id": item["id"], "stage": "photo", "error": res.get("error")}
                        )
                except Exception as exc:
                    stats["photos_fail"] += 1
                    stats["errors"].append(
                        {"id": item["id"], "stage": "photo", "error": str(exc)[:200]}
                    )
        finally:
            if tg is not None:
                tg.close()

    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0 if stats["photos_fail"] == 0 or args.dry_run else 0


if __name__ == "__main__":
    raise SystemExit(main())
