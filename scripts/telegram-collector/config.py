"""Shared config for Telegram collector scripts."""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv
import os

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
SESSION_NAME = str(SCRIPT_DIR / "telegram_business")

REQUIRED_VARS = ("TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_PHONE")

_ENV_LOADED = False


def load_env() -> None:
    """Load .env then .env.local from project root (local overrides).

    Idempotent: after the first successful load, later calls are no-ops so
    CLI overrides (e.g. --llm-provider openai) are not clobbered by .env.local
    when get_credentials() re-enters.
    """
    global _ENV_LOADED
    if _ENV_LOADED:
        return

    env_path = PROJECT_ROOT / ".env"
    env_local_path = PROJECT_ROOT / ".env.local"

    loaded_any = False
    if env_path.is_file():
        load_dotenv(env_path)
        loaded_any = True
    if env_local_path.is_file():
        load_dotenv(env_local_path, override=True)
        loaded_any = True

    if not loaded_any:
        print(
            "Ошибка: не найден файл .env или .env.local в корне проекта.",
            file=sys.stderr,
        )
        print(f"Ожидаемый путь: {PROJECT_ROOT}", file=sys.stderr)
        sys.exit(1)

    _ENV_LOADED = True


def get_credentials() -> tuple[int, str, str]:
    """Validate and return API_ID, API_HASH, PHONE. Never print secrets."""
    load_env()

    missing = [name for name in REQUIRED_VARS if not os.getenv(name, "").strip()]
    if missing:
        print(
            "Ошибка: отсутствуют обязательные переменные окружения: "
            + ", ".join(missing),
            file=sys.stderr,
        )
        print(
            "Добавьте их в .env или .env.local в корне проекта.",
            file=sys.stderr,
        )
        sys.exit(1)

    api_id_raw = os.environ["TELEGRAM_API_ID"].strip()
    api_hash = os.environ["TELEGRAM_API_HASH"].strip()
    phone = os.environ["TELEGRAM_PHONE"].strip()

    try:
        api_id = int(api_id_raw)
    except ValueError:
        print(
            "Ошибка: TELEGRAM_API_ID должен быть числом.",
            file=sys.stderr,
        )
        sys.exit(1)

    return api_id, api_hash, phone
