"""Quality gate for import_review_items.review_status = ready_to_publish.

Mirror of lib/import-review/ready-to-publish-gate.ts — keep the rules in sync.
"""

from __future__ import annotations

import re
from typing import Any

READY_DUPLICATE_BLOCKLIST = frozenset(
    {"recurring_ad", "exact_duplicate", "likely_duplicate"}
)
LOCKED_STATUSES = frozenset({"approved", "rejected", "duplicate", "quarantine"})

HANDLE_TOKEN_RE = re.compile(
    r"\b@?[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+){1,}\b"
)
BARE_USERNAME_RE = re.compile(r"^@?[A-Za-z][A-Za-z0-9._]{2,31}$")
LETTER_RE = re.compile(r"[A-Za-zА-Яа-яЁё]")

JUNK_TITLES = {
    "messenger",
    "whatsapp",
    "telegram",
    "gmail.com",
    "yahoo.com",
    "mail.com",
    "instagram",
    "facebook",
    "unknown",
    "user",
    "admin",
    "null",
    "none",
    "n/a",
    "без названия",
}


def _first_filled(*values: Any) -> str:
    for raw in values:
        t = re.sub(r"\s+", " ", str(raw or "")).strip()
        if t:
            return t
    return ""


def _has_nonempty(value: Any) -> bool:
    if isinstance(value, list):
        return any(str(x or "").strip() for x in value)
    return bool(str(value or "").strip())


def display_title(row: dict[str, Any]) -> str:
    return _first_filled(
        row.get("title"), row.get("business_name"), row.get("person_name")
    )


def is_unusable_ready_title(
    raw: str | None,
    *,
    description: str | None = None,
    source_text: str | None = None,
) -> bool:
    t = re.sub(r"\s+", " ", raw or "").strip()
    if not t or len(t) <= 1:
        return True
    if len(LETTER_RE.findall(t)) < 3:
        return True
    if t.lower() in JUNK_TITLES:
        return True
    if "@" in t:
        return True
    if BARE_USERNAME_RE.match(t) and ("." in t or "_" in t):
        return True
    if HANDLE_TOKEN_RE.search(t) and len(t.split()) <= 5:
        return True
    if len(t) > 90:
        return True
    blob = _first_filled(description, source_text)
    if blob and len(t) >= 48:
        compact = t[:80]
        if blob.startswith(compact) or compact in blob:
            return True
    return False


def qualifies_ready_to_publish(row: dict[str, Any]) -> tuple[bool, str | None]:
    has_phone = _has_nonempty(row.get("phone"))
    has_city = bool(str(row.get("city") or "").strip())
    if not has_phone and not has_city:
        return False, "no_phone_or_city"

    dup = str(row.get("duplicate_status") or "").strip().lower()
    if dup in READY_DUPLICATE_BLOCKLIST:
        return False, "duplicate"

    title = display_title(row)
    if is_unusable_ready_title(
        title,
        description=row.get("description"),
        source_text=row.get("source_text"),
    ):
        return False, "unusable_title"
    return True, None


def status_after_ready_gate(
    row: dict[str, Any],
    requested: str | None = None,
    *,
    prefer_ready: bool = False,
) -> str:
    wanted = (requested or row.get("review_status") or "pending" or "pending")
    wanted = str(wanted).strip() or "pending"
    if wanted in LOCKED_STATUSES:
        return wanted

    wants_ready = wanted == "ready_to_publish" or prefer_ready
    if not wants_ready:
        return wanted

    ok, reason = qualifies_ready_to_publish(row)
    if ok:
        return "ready_to_publish"
    if reason == "no_phone_or_city":
        return "needs_more_info"
    return "pending"
