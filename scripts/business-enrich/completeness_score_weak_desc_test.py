#!/usr/bin/env python3
"""Weak-description contracts for enrich fill-empty / replace gates.

Run: python3 scripts/business-enrich/completeness_score_weak_desc_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from completeness_score import is_weak_description  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


AVAGYAN_TG = (
    "Как и обещали, выкладываем запись эфира с иммиграционным адвокатом "
    "Антоном Всеволодовым 👇 Разобрали темы, которые сейчас волнуют очень "
    "многих: - habeas corpus и практические условия его применения"
)
AVAGYAN_SHORT = (
    'display" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAY'
    "CAMAAADXqc3KAAAAOVBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
)

assert_true(is_weak_description(AVAGYAN_TG), "TG stream / эфир dump must be weak")
assert_true(is_weak_description(AVAGYAN_SHORT), "base64/HTML short_description must be weak")
assert_true(is_weak_description(""), "empty is weak")
assert_true(is_weak_description(None), "None is weak")
assert_true(
    is_weak_description("Выкладываем запись прямого эфира с юристом"),
    "запись прямого эфира must be weak",
)
assert_true(
    not is_weak_description(
        "Avagyan Law — иммиграционные адвокаты в Калифорнии. "
        "Помогаем с визами, грин-картами и защитой в суде."
    ),
    "real firm bio must stay strong",
)
assert_true(
    is_weak_description(
        "Introducing a rich text editor to format and generate text, "
        "Telegram Communities linking together several groups, channels and bots, ephemeral…"
    ),
    "Telegram product chrome must be weak",
)

print("OK: completeness_score weak-description contracts")
