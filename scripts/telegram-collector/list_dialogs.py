#!/usr/bin/env python3
"""List groups and channels visible to the authorized Telegram session.

Does not download messages or write to any database.
"""

from __future__ import annotations

import asyncio
import sys

from telethon import TelegramClient
from telethon.errors import (
    ApiIdInvalidError,
    ChannelPrivateError,
    FloodWaitError,
    UserNotParticipantError,
)
from telethon.tl.types import Channel, Chat

from config import SESSION_NAME, get_credentials


def dialog_type(entity) -> str | None:
    """Return group / supergroup / channel, or None for users/bots."""
    if isinstance(entity, Chat):
        return "group"
    if isinstance(entity, Channel):
        if entity.broadcast:
            return "channel"
        if entity.megagroup:
            return "supergroup"
        return "group"
    return None


async def main() -> int:
    api_id, api_hash, _phone = get_credentials()
    client = TelegramClient(SESSION_NAME, api_id, api_hash)

    try:
        await client.connect()

        if not await client.is_user_authorized():
            print(
                "Ошибка: сессия не авторизована. Сначала запустите auth.py.",
                file=sys.stderr,
            )
            return 1

        print("Группы и каналы, доступные аккаунту:\n")
        found = 0

        try:
            async for dialog in client.iter_dialogs():
                kind = dialog_type(dialog.entity)
                if kind is None:
                    continue

                found += 1
                username = getattr(dialog.entity, "username", None)
                username_line = f"@{username}" if username else "(нет)"
                print(f"— {dialog.title}")
                print(f"  id: {dialog.id}")
                print(f"  username: {username_line}")
                print(f"  тип: {kind}")
                print()
        except ChannelPrivateError:
            print(
                "Ошибка: нет доступа к частному каналу/группе "
                "(аккаунт не состоит в ней или был исключён).",
                file=sys.stderr,
            )
            return 1
        except UserNotParticipantError:
            print(
                "Ошибка: аккаунт не состоит в запрашиваемой частной группе.",
                file=sys.stderr,
            )
            return 1
        except FloodWaitError as exc:
            print(
                f"Ошибка: FloodWait — подождите {exc.seconds} сек. и повторите.",
                file=sys.stderr,
            )
            return 1

        if found == 0:
            print("Групп и каналов не найдено.")
        else:
            print(f"Всего: {found}")

        return 0

    except ApiIdInvalidError:
        print(
            "Ошибка: неверный TELEGRAM_API_ID или TELEGRAM_API_HASH.",
            file=sys.stderr,
        )
        return 1
    except FloodWaitError as exc:
        print(
            f"Ошибка: FloodWait — подождите {exc.seconds} сек. и повторите.",
            file=sys.stderr,
        )
        return 1
    except KeyboardInterrupt:
        print("\nПрервано пользователем.", file=sys.stderr)
        return 130
    finally:
        await client.disconnect()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
