"""Fill an empty queue-card image from a self-promoter's Telegram avatar."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = ROOT / "scripts" / "media-pipeline"
if str(MEDIA_DIR) not in sys.path:
    sys.path.insert(0, str(MEDIA_DIR))

BUCKET = "business-images"


def _load_media_module(name: str) -> Any:
    """Load scripts/media-pipeline/{name}.py by path.

    Enrich puts facebook-collector ahead of media-pipeline on sys.path, so a
    plain ``import validate`` resolves to facebook-collector/validate.py and
    breaks reencode_webp.
    """
    mod_name = f"krugi_media_pipeline_{name}"
    existing = sys.modules.get(mod_name)
    if existing is not None:
        return existing
    path = MEDIA_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(mod_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load media-pipeline module {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


def _clean_handle(value: Any) -> str | None:
    handle = str(value or "").strip().lstrip("@")
    if re.fullmatch(r"[A-Za-z0-9_]{4,32}", handle) and not handle.isdigit():
        return handle
    return None


def _tokens(value: Any) -> set[str]:
    text = re.sub(r"[^\w\s]+", " ", str(value or "").lower(), flags=re.UNICODE)
    stop = {"llc", "inc", "the", "and", "для", "service", "services"}
    return {word for word in text.split() if len(word) >= 3 and word not in stop}


def _names_compatible(left: Any, right: Any) -> bool:
    a, b = _tokens(left), _tokens(right)
    if a and b and a & b:
        return True
    left_s = str(left or "").strip().casefold()
    right_s = str(right or "").strip().casefold()
    return bool(left_s and right_s and left_s == right_s)


def self_promo_avatar_target(item: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    """Return the Telegram identity only when the post advertises its sender."""
    if not str(item.get("source") or "").lower().startswith("telegram"):
        return None, "not_telegram"
    if str(item.get("preview_image_url") or "").strip():
        return None, "image_exists"

    author_id = str(item.get("source_author_id") or "").strip() or None
    author_handle = _clean_handle(item.get("source_author_username"))
    contact_handle = _clean_handle(item.get("telegram_username"))
    author_name = item.get("source_author_display_name")

    reason: str | None = None
    if author_handle and contact_handle and author_handle.casefold() == contact_handle.casefold():
        reason = "author_is_contact"
    elif author_name and any(
        _names_compatible(author_name, item.get(field))
        for field in ("person_name", "business_name", "title")
    ):
        reason = "author_name_matches_card"
    else:
        ai_reason = str(item.get("ai_reason") or "")
        if (author_id or author_handle) and re.search(
            r"(?:direct|self)[ -]?(?:advertisement|promotion)|"
            r"advertis(?:es|ing).{0,30}(?:sender|their own)|"
            r"прямая реклама|самореклам",
            ai_reason,
            re.I,
        ):
            reason = "ai_self_promo"

    if not reason:
        return None, "self_promo_not_confirmed"

    message_ids = item.get("source_message_ids") or []
    message_id: int | None = None
    try:
        message_id = int(message_ids[0]) if message_ids else None
    except (TypeError, ValueError, IndexError):
        pass
    chat_id: int | None = None
    try:
        raw_chat = item.get("source_chat_id")
        chat_id = int(raw_chat) if raw_chat is not None else None
    except (TypeError, ValueError):
        pass

    # The source message is preferred by TelegramPhotoClient. It resolves the
    # actual sender even when a channel-wide numeric id leaked into old rows.
    username = author_handle or contact_handle
    if not author_id and not username and (chat_id is None or message_id is None):
        return None, "no_author_reference"
    return {
        "user_id": author_id,
        "username": username,
        "chat_id": chat_id,
        "message_id": message_id,
    }, reason


class TelegramQueueAvatarEnricher:
    """Lazy Telegram connection shared by all items in one enrich run."""

    def __init__(self, supabase_url: str, service_key: str) -> None:
        self.supabase_url = supabase_url
        self.service_key = service_key
        self._telegram: Any = None
        self._storage: Any = None

    def close(self) -> None:
        if self._telegram:
            self._telegram.close()
        self._telegram = None

    def enrich(
        self, item: dict[str, Any], *, apply: bool
    ) -> tuple[str | None, str, str | None]:
        """Return (public_url, outcome, error). Never raises into main enrich."""
        target, reason = self_promo_avatar_target(item)
        if not target:
            return None, reason, None
        if not apply:
            return None, f"candidate:{reason}", None

        try:
            if self._telegram is None:
                MediaSupabase = _load_media_module("storage_client").MediaSupabase
                TelegramPhotoClient = _load_media_module(
                    "telegram_photos"
                ).TelegramPhotoClient

                self._telegram = TelegramPhotoClient()
                self._telegram.connect()
                # Keep credentials captured by the parent process. Telegram's
                # config loader may reload dotenv; never print either value.
                self._storage = MediaSupabase(self.supabase_url, self.service_key)

            result = self._telegram.fetch_profile_photo(
                user_id=target.get("user_id"),
                username=target.get("username"),
                chat_id=target.get("chat_id"),
                message_id=target.get("message_id"),
                dry_run=False,
            )
            raw = result.photo if result.photo and len(result.photo) > 800 else None
            if not raw:
                return None, reason, result.error or "no_profile_photo"

            reencode_webp = _load_media_module("validate").reencode_webp

            webp = reencode_webp(raw, max_edge=1200, quality=85)
            item_id = str(item["id"])
            path = f"import-review/{item_id}/telegram_avatar_{webp.sha256[:16]}.webp"
            self._storage.upload(
                BUCKET,
                path,
                webp.data,
                content_type="image/webp",
                upsert=True,
            )
            return self._storage.public_url(BUCKET, path), reason, None
        except (Exception, SystemExit) as exc:  # noqa: BLE001 — optional step
            msg = str(exc).strip()
            return None, reason, f"{type(exc).__name__}: {msg}" if msg else type(exc).__name__
