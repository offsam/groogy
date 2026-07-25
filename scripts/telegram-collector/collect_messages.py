#!/usr/bin/env python3
"""Collect messages from a Telegram group/channel into JSON.

Does not download media. Does not write to Supabase.
Uses the existing local Telethon session (no re-auth).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from telethon import TelegramClient
from telethon.errors import (
    ChannelPrivateError,
    FloodWaitError,
    UserNotParticipantError,
)
from telethon.tl.types import (
    MessageMediaContact,
    MessageMediaDocument,
    MessageMediaGeo,
    MessageMediaPhoto,
    MessageMediaPoll,
    MessageMediaWebPage,
    MessageService,
    User,
)

from config import SCRIPT_DIR, SESSION_NAME, get_credentials
from contacts import has_contact_signal
from merge import merge_logical_posts

DATA_DIR = SCRIPT_DIR / "data"
DEFAULT_OUTPUT = DATA_DIR / "fun_for_mom_raw.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Telegram group messages")
    parser.add_argument("--chat-id", type=int, required=True)
    parser.add_argument("--limit", type=int, default=None, help="Max messages to fetch")
    parser.add_argument("--days", type=int, default=None, help="Only messages newer than N days")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Output JSON path",
    )
    return parser.parse_args()


def media_type_of(message) -> str | None:
    media = message.media
    if media is None:
        return None
    if isinstance(media, MessageMediaPhoto):
        return "photo"
    if isinstance(media, MessageMediaDocument):
        mime = getattr(getattr(media, "document", None), "mime_type", "") or ""
        if mime.startswith("video/"):
            return "video"
        if mime.startswith("audio/") or mime == "application/ogg":
            return "audio"
        if "sticker" in mime or getattr(media.document, "attributes", None):
            attrs = getattr(media.document, "attributes", []) or []
            names = [type(a).__name__ for a in attrs]
            if any("Sticker" in n for n in names):
                return "sticker"
            if any("Animated" in n for n in names):
                return "animation"
        return "document"
    if isinstance(media, MessageMediaWebPage):
        return "webpage"
    if isinstance(media, MessageMediaGeo):
        return "geo"
    if isinstance(media, MessageMediaContact):
        return "contact"
    if isinstance(media, MessageMediaPoll):
        return "poll"
    return type(media).__name__


def private_message_link(chat_id: int, message_id: int) -> str | None:
    # Private/supergroup link form: https://t.me/c/<internal>/<msg_id>
    s = str(chat_id)
    if s.startswith("-100"):
        return f"https://t.me/c/{s[4:]}/{message_id}"
    return None


def sender_info(message) -> tuple[int | None, str | None]:
    sender = message.sender
    if sender is None:
        return None, None
    if isinstance(sender, User):
        name = " ".join(
            part for part in (sender.first_name, sender.last_name) if part
        ).strip() or None
        return sender.id, name
    title = getattr(sender, "title", None)
    return getattr(sender, "id", None), title


def should_skip_raw(text: str, has_media: bool, media_type: str | None, is_service: bool) -> bool:
    if is_service:
        return True
    cleaned = (text or "").strip()
    if not cleaned and media_type in {None, "sticker", "poll"}:
        return True
    if not cleaned and media_type in {"sticker", "animation"}:
        return True
    if not cleaned and not has_media:
        return True
    if cleaned and len(cleaned) < 10 and not has_contact_signal(cleaned):
        return True
    if not cleaned and has_media and media_type in {"photo", "video", "document"}:
        # Keep media-only posts — caption may be in album siblings.
        return False
    return False


async def collect(chat_id: int, limit: int | None, days: int | None) -> dict[str, Any]:
    api_id, api_hash, _phone = get_credentials()
    client = TelegramClient(SESSION_NAME, api_id, api_hash)
    collected_at = datetime.now(timezone.utc).isoformat()
    min_date = None
    if days is not None:
        min_date = datetime.now(timezone.utc) - timedelta(days=days)

    raw_messages: list[dict[str, Any]] = []
    skipped = 0

    try:
        await client.connect()
        if not await client.is_user_authorized():
            print(
                "Ошибка: сессия не авторизована. Сначала запустите auth.py.",
                file=sys.stderr,
            )
            sys.exit(1)

        try:
            entity = await client.get_entity(chat_id)
        except (ChannelPrivateError, UserNotParticipantError):
            print(
                "Ошибка: нет доступа к чату (частная группа / аккаунт не состоит).",
                file=sys.stderr,
            )
            sys.exit(1)

        chat_title = getattr(entity, "title", str(chat_id))
        print(f"Чат: {chat_title} ({chat_id})")

        fetch_kwargs: dict[str, Any] = {}
        if limit is not None:
            fetch_kwargs["limit"] = limit

        order = 0
        try:
            async for message in client.iter_messages(entity, **fetch_kwargs):
                if min_date is not None and message.date is not None:
                    msg_date = message.date
                    if msg_date.tzinfo is None:
                        msg_date = msg_date.replace(tzinfo=timezone.utc)
                    if msg_date < min_date:
                        break

                is_service = isinstance(message, MessageService)
                text = message.message or ""
                mtype = media_type_of(message)
                has_media = message.media is not None and mtype not in {None, "sticker"}

                if should_skip_raw(text, bool(message.media), mtype, is_service):
                    skipped += 1
                    continue

                sender_id, sender_name = sender_info(message)
                msg_id = message.id
                record = {
                    "chat_id": chat_id,
                    "chat_title": chat_title,
                    "message_id": msg_id,
                    "message_date": message.date.isoformat() if message.date else None,
                    "sender_id": sender_id,
                    "sender_name": sender_name,
                    "text": text,
                    "has_media": bool(has_media),
                    "media_type": mtype,
                    "grouped_id": message.grouped_id,
                    "reply_to_message_id": message.reply_to_msg_id,
                    "views": message.views,
                    "forwards": message.forwards,
                    "telegram_message_link": private_message_link(chat_id, msg_id),
                    "collected_at": collected_at,
                    "_order": order,
                }
                raw_messages.append(record)
                order += 1
        except FloodWaitError as exc:
            print(
                f"Ошибка: FloodWait — подождите {exc.seconds} сек. и повторите.",
                file=sys.stderr,
            )
            sys.exit(1)

        # Keep raw rows for advanced rematch/remerge; strip internal order field copy.
        raw_for_store = []
        for msg in raw_messages:
            row = dict(msg)
            row.pop("_order", None)
            raw_for_store.append(row)

        posts = merge_logical_posts(raw_for_store)
        cleaned: list[dict[str, Any]] = []
        for post in posts:
            text = (post.get("merged_text") or post.get("text") or "").strip()
            if not text and post.get("media_count", 0) == 0:
                skipped += 1
                continue
            if text and len(text) < 10 and not has_contact_signal(text):
                skipped += 1
                continue
            cleaned.append(post)

        return {
            "meta": {
                "chat_id": chat_id,
                "chat_title": chat_title,
                "collected_at": collected_at,
                "limit": limit,
                "days": days,
                "raw_message_rows": len(raw_for_store),
                "logical_posts": len(cleaned),
                "skipped": skipped,
                "merge_version": "v2_advanced",
            },
            "raw_messages": raw_for_store,
            "posts": cleaned,
        }
    finally:
        await client.disconnect()


def main() -> int:
    args = parse_args()
    if args.limit is None and args.days is None:
        print("Укажите --limit и/или --days.", file=sys.stderr)
        return 1

    output: Path = args.output
    if not output.is_absolute():
        output = (Path.cwd() / output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    payload = asyncio.run(collect(args.chat_id, args.limit, args.days))
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    meta = payload["meta"]
    print(f"Сохранено: {output}")
    print(f"Сырых сообщений (после skip): {meta['raw_message_rows']}")
    print(f"Логических публикаций: {meta['logical_posts']}")
    print(f"Пропущено: {meta['skipped']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
