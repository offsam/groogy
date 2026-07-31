"""Download photos from specific Telegram messages (Telethon)."""

from __future__ import annotations

import asyncio
import io
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Allow importing collector config without installing as package
import sys

COLLECTOR_DIR = Path(__file__).resolve().parents[1] / "telegram-collector"
if str(COLLECTOR_DIR) not in sys.path:
    sys.path.insert(0, str(COLLECTOR_DIR))

ALLOWED_CHATS = {-1001333533747, -1001955320601}  # Fun for Mom, LA Orange County


@dataclass
class TelegramPhotoResult:
    chat_id: int
    message_id: int
    photos: list[bytes] = field(default_factory=list)
    error: str | None = None
    skipped: bool = False


@dataclass
class TelegramProfilePhotoResult:
    user_ref: str
    photo: bytes | None = None
    error: str | None = None
    skipped: bool = False


class TelegramPhotoClient:
    def __init__(self) -> None:
        self._client: Any = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def connect(self) -> None:
        from telethon import TelegramClient
        from config import SESSION_NAME, get_credentials

        api_id, api_hash, _ = get_credentials()
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._client = TelegramClient(SESSION_NAME, api_id, api_hash)
        self._loop.run_until_complete(self._client.connect())
        if not self._loop.run_until_complete(self._client.is_user_authorized()):
            raise RuntimeError("Telegram session not authorized")

    def close(self) -> None:
        if self._client and self._loop:
            try:
                disco = self._client.disconnect()
                if disco is not None and self._loop.is_running() is False:
                    self._loop.run_until_complete(disco)
            except Exception:
                pass
        if self._loop:
            try:
                self._loop.close()
            except Exception:
                pass
        self._client = None
        self._loop = None

    def fetch_photos(
        self,
        chat_id: int | str,
        message_ids: list[int],
        *,
        max_photos: int = 3,
        dry_run: bool = False,
    ) -> TelegramPhotoResult:
        chat = int(chat_id)
        if chat not in ALLOWED_CHATS:
            return TelegramPhotoResult(
                chat_id=chat,
                message_id=message_ids[0] if message_ids else 0,
                error="chat_not_allowed",
                skipped=True,
            )
        if not message_ids:
            return TelegramPhotoResult(chat_id=chat, message_id=0, skipped=True, error="no_message_ids")
        assert self._client and self._loop
        return self._loop.run_until_complete(
            self._fetch_async(chat, message_ids, max_photos=max_photos, dry_run=dry_run)
        )

    async def _fetch_async(
        self,
        chat_id: int,
        message_ids: list[int],
        *,
        max_photos: int,
        dry_run: bool,
    ) -> TelegramPhotoResult:
        from telethon.tl.types import MessageMediaDocument, MessageMediaPhoto

        primary_id = int(message_ids[0])
        result = TelegramPhotoResult(chat_id=chat_id, message_id=primary_id)
        try:
            messages = await self._client.get_messages(chat_id, ids=[int(x) for x in message_ids])
        except Exception as exc:
            result.error = type(exc).__name__
            return result

        if not isinstance(messages, list):
            messages = [messages]

        def _is_image_media(media: Any) -> bool:
            if isinstance(media, MessageMediaPhoto):
                return True
            if isinstance(media, MessageMediaDocument):
                doc = getattr(media, "document", None)
                mime = (getattr(doc, "mime_type", None) or "").lower()
                return mime.startswith("image/")
            return False

        for msg in messages:
            if not msg or not getattr(msg, "media", None):
                continue
            media = msg.media
            if not _is_image_media(media):
                continue
            if dry_run:
                result.photos.append(b"")
                if len(result.photos) >= max_photos:
                    break
                continue
            try:
                buf = io.BytesIO()
                await self._client.download_media(msg, file=buf)
                data = buf.getvalue()
                if data:
                    result.photos.append(data)
            except Exception as exc:
                result.error = type(exc).__name__
                continue
            if len(result.photos) >= max_photos:
                break

        if not result.photos and not result.error:
            result.error = "no_photos"
            result.skipped = True
        return result

    def fetch_profile_photo(
        self,
        *,
        user_id: int | str | None = None,
        username: str | None = None,
        chat_id: int | str | None = None,
        message_id: int | None = None,
        dry_run: bool = False,
    ) -> TelegramProfilePhotoResult:
        """Download a Telegram user profile photo by id, @username, or chat message sender."""
        ref = ""
        entity_key: Any = None
        if user_id is not None and str(user_id).strip():
            raw = str(user_id).strip()
            try:
                entity_key = int(raw)
                ref = str(entity_key)
            except ValueError:
                entity_key = raw
                ref = raw
        elif username:
            handle = str(username).strip().lstrip("@")
            if not handle:
                return TelegramProfilePhotoResult(
                    user_ref="", skipped=True, error="no_user_ref"
                )
            entity_key = handle
            ref = handle
        elif chat_id is not None and message_id is not None:
            ref = f"msg:{chat_id}/{message_id}"
        else:
            return TelegramProfilePhotoResult(
                user_ref="", skipped=True, error="no_user_ref"
            )

        assert self._client and self._loop
        return self._loop.run_until_complete(
            self._fetch_profile_async(
                entity_key,
                ref,
                chat_id=int(chat_id) if chat_id is not None else None,
                message_id=int(message_id) if message_id is not None else None,
                dry_run=dry_run,
            )
        )

    async def _fetch_profile_async(
        self,
        entity_key: Any,
        ref: str,
        *,
        chat_id: int | None,
        message_id: int | None,
        dry_run: bool,
    ) -> TelegramProfilePhotoResult:
        result = TelegramProfilePhotoResult(user_ref=ref)
        entity: Any = None

        # Prefer resolving via the source message (users often aren't in global
        # cache). Unlike post-media downloads, this is not limited to the two
        # legacy chats: import_review already supplies the exact collected
        # source message, and new collector groups must work without updating a
        # hard-coded allowlist.
        if chat_id is not None and message_id is not None:
            try:
                msg = await self._client.get_messages(chat_id, ids=message_id)
                if msg:
                    entity = await msg.get_sender()
            except Exception as exc:  # noqa: BLE001
                result.error = f"msg_sender:{type(exc).__name__}"

        if entity is None and entity_key is not None:
            try:
                entity = await self._client.get_entity(entity_key)
            except Exception as exc:  # noqa: BLE001
                if not result.error:
                    result.error = type(exc).__name__
                result.skipped = True
                return result

        if entity is None:
            result.error = result.error or "no_entity"
            result.skipped = True
            return result

        if dry_run:
            result.photo = b""
            return result

        try:
            buf = io.BytesIO()
            downloaded = await self._client.download_profile_photo(entity, file=buf)
            data = buf.getvalue()
            if downloaded is None and not data:
                result.error = "no_profile_photo"
                result.skipped = True
                return result
            if data and len(data) > 800:
                result.photo = data
                result.error = None
            else:
                result.error = "empty_profile_photo"
                result.skipped = True
        except Exception as exc:  # noqa: BLE001
            result.error = type(exc).__name__
            result.skipped = True
        return result
