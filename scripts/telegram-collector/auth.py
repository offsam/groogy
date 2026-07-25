#!/usr/bin/env python3
"""Authorize a Telegram user account via Telethon (MTProto, not Bot API).

On first run, prompts for the login code (and 2FA password if enabled).
Saves a local session file. Prints only account name and user id.

Optional non-interactive flags (do not log these values):
  --code CODE
  --password 2FA_PASSWORD
  --request-code-only   send login code and save phone_code_hash, then exit
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import (
    ApiIdInvalidError,
    FloodWaitError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberInvalidError,
    SessionPasswordNeededError,
)

from config import SESSION_NAME, get_credentials

HASH_FILE = Path(__file__).resolve().parent / "telegram_business.phone_code_hash"


def mask_phone(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 4:
        return "***"
    return f"+***{digits[-4:]}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Authorize Telegram via Telethon")
    parser.add_argument("--code", help="Login code from Telegram (non-interactive)")
    parser.add_argument("--password", help="2FA password if enabled (non-interactive)")
    parser.add_argument(
        "--request-code-only",
        action="store_true",
        help="Only send the login code and save phone_code_hash",
    )
    return parser.parse_args()


def save_phone_code_hash(phone_code_hash: str) -> None:
    HASH_FILE.write_text(phone_code_hash, encoding="utf-8")


def load_phone_code_hash() -> str | None:
    if not HASH_FILE.is_file():
        return None
    value = HASH_FILE.read_text(encoding="utf-8").strip()
    return value or None


def clear_phone_code_hash() -> None:
    if HASH_FILE.exists():
        HASH_FILE.unlink()


async def main() -> int:
    args = parse_args()
    api_id, api_hash, phone = get_credentials()
    client = TelegramClient(SESSION_NAME, api_id, api_hash)

    # Prefer CLI flag, then env (avoids putting secrets in shell history unnecessarily).
    code = (args.code or os.getenv("TELEGRAM_LOGIN_CODE") or "").strip() or None
    password = (args.password or os.getenv("TELEGRAM_2FA_PASSWORD") or "").strip() or None

    try:
        await client.connect()

        if await client.is_user_authorized():
            me = await client.get_me()
            name = " ".join(
                part for part in (me.first_name, me.last_name) if part
            ).strip() or "(без имени)"
            print("Уже авторизован.")
            print(f"Аккаунт: {name}")
            print(f"User ID: {me.id}")
            if me.username:
                print(f"Username: @{me.username}")
            clear_phone_code_hash()
            return 0

        phone_code_hash = load_phone_code_hash()

        # Need a fresh code request unless we already have a hash and a code to redeem.
        need_request = args.request_code_only or not (phone_code_hash and code)
        if need_request:
            print(f"Отправка кода подтверждения на {mask_phone(phone)}…")
            try:
                sent = await client.send_code_request(phone)
            except PhoneNumberInvalidError:
                print("Ошибка: неверный номер телефона (TELEGRAM_PHONE).", file=sys.stderr)
                return 1
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

            phone_code_hash = sent.phone_code_hash
            save_phone_code_hash(phone_code_hash)
            print("Код отправлен. phone_code_hash сохранён локально.")

            if args.request_code_only:
                print("Запустите снова с --code <код_из_Telegram>.")
                return 0

        if not code:
            code = input("Введите код из Telegram: ").strip()

        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except PhoneCodeInvalidError:
            print("Ошибка: неверный код подтверждения.", file=sys.stderr)
            return 1
        except PhoneCodeExpiredError:
            clear_phone_code_hash()
            print(
                "Ошибка: код подтверждения истёк. Запустите скрипт снова.",
                file=sys.stderr,
            )
            return 1
        except SessionPasswordNeededError:
            if not password:
                password = input(
                    "Введите пароль двухэтапной аутентификации: "
                ).strip()
            try:
                await client.sign_in(password=password)
            except Exception:
                print(
                    "Ошибка: неверный пароль двухэтапной аутентификации.",
                    file=sys.stderr,
                )
                return 1
        except FloodWaitError as exc:
            print(
                f"Ошибка: FloodWait — подождите {exc.seconds} сек. и повторите.",
                file=sys.stderr,
            )
            return 1
        except ApiIdInvalidError:
            print(
                "Ошибка: неверный TELEGRAM_API_ID или TELEGRAM_API_HASH.",
                file=sys.stderr,
            )
            return 1

        clear_phone_code_hash()
        me = await client.get_me()
        name = " ".join(
            part for part in (me.first_name, me.last_name) if part
        ).strip() or "(без имени)"
        print("Авторизация успешна.")
        print(f"Аккаунт: {name}")
        print(f"User ID: {me.id}")
        if me.username:
            print(f"Username: @{me.username}")
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
