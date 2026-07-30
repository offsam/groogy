"""Contacts that belong to the channel, not to the advertiser.

Telegram and Facebook group admins sign every post they publish: «По вопросам
рекламы пишите мне», an affiliate link, a sponsor handle. The importer used to
read those as the advertiser's own contacts, which is how one card ends up
looking like two businesses.

Two rules live here:

- a text rule for ad-manager footers, which is exact and needs no corpus;
- a frequency list built from the corpus by `build_channel_noise.py`, applied
  only where the contact is *not* the subject of the card. `@best_tint` stays
  on the Best Tint card and is stripped from the other 194.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "telegram-collector"))

from contacts import AD_FOOTER_RE  # noqa: E402

NOISE_FILE = Path(__file__).resolve().parent / "data" / "channel_noise_contacts.json"


def letters(value: str) -> str:
    return re.sub(r"[^a-z0-9а-яё]+", "", (value or "").lower())


def load_noise() -> dict[str, set[str]]:
    if not NOISE_FILE.exists():
        return {"instagram": set(), "domains": set(), "phones": set()}
    raw = json.loads(NOISE_FILE.read_text(encoding="utf-8"))
    return {
        key: {str(entry["value"]).lower() for entry in raw.get(key, [])}
        for key in ("instagram", "domains", "phones")
    }


def ad_footer_lines(text: str) -> list[str]:
    return [m.group(0).strip() for m in AD_FOOTER_RE.finditer(text or "")]


def strip_ad_footer(text: str) -> str:
    """Drop «по вопросам рекламы …» lines from public copy."""
    cleaned = AD_FOOTER_RE.sub("", text or "")
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def is_subject(contact: str, *names: str) -> bool:
    """True when the contact is the card itself, not a passenger on it."""
    key = letters(contact.rsplit(".", 1)[0] if "." in contact else contact)
    if len(key) < 4:
        return False
    for name in names:
        other = letters(name or "")
        if not other:
            continue
        if key in other or other in key:
            return True
    return False


def is_noise(
    contact: str,
    kind: str,
    *,
    noise: dict[str, set[str]],
    names: tuple[str, ...] = (),
    footer_text: str = "",
) -> bool:
    value = (contact or "").strip().lower().lstrip("@")
    if not value:
        return False
    if any(value in letters(line) or value in line.lower() for line in ad_footer_lines(footer_text)):
        return True
    if value not in noise.get(kind, set()):
        return False
    return not is_subject(value, *names)


def clean_contact_list(
    values: Any,
    kind: str,
    *,
    noise: dict[str, set[str]],
    names: tuple[str, ...] = (),
    footer_text: str = "",
) -> list[str]:
    if not isinstance(values, list):
        return []
    return [
        str(v)
        for v in values
        if not is_noise(
            str(v), kind, noise=noise, names=names, footer_text=footer_text
        )
    ]
