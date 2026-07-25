"""Merge Telegram messages into logical posts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from contacts import has_contact_signal

PRICE_HINT = ("$", "цена", "прайс", "price", "/час", "/hour", "usd")


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _has_continuation_signal(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if has_contact_signal(t):
        return True
    lower = t.lower()
    if any(h in lower for h in PRICE_HINT):
        return True
    if len(t) >= 40:
        return True
    return False


def _is_self_reply_enrichment(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if has_contact_signal(t):
        return True
    lower = t.lower()
    if any(h in lower for h in PRICE_HINT):
        return True
    if any(k in lower for k in ("адрес", "address", "услуг", "запись", "меню", "прайс")):
        return True
    return False


def merge_logical_posts(raw_messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build logical publications from raw message rows (newest-first or any order).

    Input rows should include message_id, sender_id, message_date, text,
    grouped_id, reply_to_message_id, and other collect fields.
    """
    # Work oldest -> newest for sequential merge, then reverse for output.
    msgs = sorted(raw_messages, key=lambda m: (m.get("message_date") or "", m.get("message_id") or 0))

    # 1) Album merge by grouped_id
    albums: dict[str, list[dict[str, Any]]] = {}
    singles: list[dict[str, Any]] = []
    for msg in msgs:
        gid = msg.get("grouped_id")
        if gid is None:
            singles.append(msg)
            continue
        albums.setdefault(str(gid), []).append(msg)

    units: list[dict[str, Any]] = []
    for gid, items in albums.items():
        items = sorted(items, key=lambda m: m["message_id"])
        texts = [m.get("text") or "" for m in items if (m.get("text") or "").strip()]
        merged_text = "\n".join(dict.fromkeys(texts))
        first, last = items[0], items[-1]
        units.append(_unit_from_items(items, merged_text, "album_grouped_id"))

    for msg in singles:
        units.append(_unit_from_items([msg], msg.get("text") or "", "single"))

    units.sort(key=lambda u: (u["message_date_start"] or "", u["primary_message_id"]))

    # Index by primary message id for reply linking
    by_primary: dict[int, int] = {u["primary_message_id"]: i for i, u in enumerate(units)}
    # Also index all source ids -> unit index
    by_any_id: dict[int, int] = {}
    for i, u in enumerate(units):
        for mid in u["source_message_ids"]:
            by_any_id[mid] = i

    consumed: set[int] = set()
    merged_units: list[dict[str, Any]] = []

    for i, unit in enumerate(units):
        if i in consumed:
            continue

        # 3) Self-reply enrichment: if this unit replies to own earlier unit with contact/price
        reply_to = unit.get("reply_to_message_id")
        if reply_to is not None and reply_to in by_any_id:
            parent_idx = by_any_id[reply_to]
            if parent_idx not in consumed and parent_idx < i:
                parent = units[parent_idx]
                same_sender = (
                    parent.get("sender_id") is not None
                    and parent.get("sender_id") == unit.get("sender_id")
                )
                if same_sender and _is_self_reply_enrichment(unit.get("merged_text") or ""):
                    combined = _combine_units(parent, unit, "self_reply_enrichment")
                    # replace parent placeholder later
                    consumed.add(i)
                    # update parent slot
                    units[parent_idx] = combined
                    # refresh indexes for this parent
                    for mid in combined["source_message_ids"]:
                        by_any_id[mid] = parent_idx
                    continue

        merged_units.append(unit)

    # Rebuild list without consumed-as-child units; keep updated parents
    final_candidates = [u for idx, u in enumerate(units) if idx not in consumed]
    final_candidates.sort(key=lambda u: (u["message_date_start"] or "", u["primary_message_id"]))

    # 2) Sequential same-sender within 3 minutes
    result: list[dict[str, Any]] = []
    for unit in final_candidates:
        if not result:
            result.append(unit)
            continue
        prev = result[-1]
        if _can_sequential_merge(prev, unit):
            result[-1] = _combine_units(prev, unit, "sequential_same_sender")
        else:
            result.append(unit)

    # Newest first for analyzer convenience
    result.sort(key=lambda u: (u["message_date_end"] or "", u["primary_message_id"]), reverse=True)
    return result


def _unit_from_items(items: list[dict[str, Any]], merged_text: str, reason: str) -> dict[str, Any]:
    items = sorted(items, key=lambda m: m["message_id"])
    first, last = items[0], items[-1]
    media_count = sum(1 for m in items if m.get("has_media"))
    return {
        "chat_id": first.get("chat_id"),
        "chat_title": first.get("chat_title"),
        "primary_message_id": first["message_id"],
        "source_message_ids": [m["message_id"] for m in items],
        "merged_text": merged_text,
        "text": merged_text,  # alias for analyzers
        "merge_reason": reason,
        "sender_id": first.get("sender_id"),
        "sender_name": first.get("sender_name"),
        "message_date": first.get("message_date"),
        "message_date_start": first.get("message_date"),
        "message_date_end": last.get("message_date"),
        "has_media": any(m.get("has_media") for m in items),
        "media_type": first.get("media_type"),
        "media_count": media_count,
        "grouped_id": first.get("grouped_id"),
        "reply_to_message_id": first.get("reply_to_message_id"),
        "views": first.get("views"),
        "forwards": first.get("forwards"),
        "telegram_message_link": first.get("telegram_message_link"),
        "collected_at": first.get("collected_at"),
        "message_id": first["message_id"],  # backward compatible
    }


def _can_sequential_merge(prev: dict[str, Any], cur: dict[str, Any]) -> bool:
    if prev.get("sender_id") is None or prev.get("sender_id") != cur.get("sender_id"):
        return False
    # Don't merge different albums unless same sender sequential enrichment
    t0 = _parse_dt(prev.get("message_date_end") or prev.get("message_date_start"))
    t1 = _parse_dt(cur.get("message_date_start") or cur.get("message_date_end"))
    if not t0 or not t1:
        return False
    delta = abs((t1 - t0).total_seconds())
    if delta > 180:
        return False
    # Nearby: message ids not too far apart
    prev_ids = prev.get("source_message_ids") or [prev["primary_message_id"]]
    cur_ids = cur.get("source_message_ids") or [cur["primary_message_id"]]
    if min(cur_ids) - max(prev_ids) > 5:
        return False
    if not (
        _has_continuation_signal(prev.get("merged_text") or "")
        or _has_continuation_signal(cur.get("merged_text") or "")
    ):
        return False
    return True


def _combine_units(a: dict[str, Any], b: dict[str, Any], reason: str) -> dict[str, Any]:
    ids = sorted(set((a.get("source_message_ids") or []) + (b.get("source_message_ids") or [])))
    texts = []
    for part in (a.get("merged_text") or "", b.get("merged_text") or ""):
        part = part.strip()
        if part and part not in texts:
            texts.append(part)
    merged_text = "\n".join(texts)
    start = a.get("message_date_start") or a.get("message_date")
    end = b.get("message_date_end") or b.get("message_date") or a.get("message_date_end")
    # chronological start/end
    dates = [d for d in [a.get("message_date_start"), a.get("message_date_end"), b.get("message_date_start"), b.get("message_date_end")] if d]
    if dates:
        start = min(dates)
        end = max(dates)
    reasons = []
    for r in (a.get("merge_reason"), b.get("merge_reason"), reason):
        if r and r not in reasons and r != "single":
            reasons.append(r)
    out = dict(a)
    out.update(
        {
            "primary_message_id": ids[0],
            "message_id": ids[0],
            "source_message_ids": ids,
            "merged_text": merged_text,
            "text": merged_text,
            "merge_reason": "+".join(reasons) if reasons else reason,
            "message_date_start": start,
            "message_date_end": end,
            "message_date": start,
            "has_media": bool(a.get("has_media") or b.get("has_media")),
            "media_count": int(a.get("media_count") or 0) + int(b.get("media_count") or 0),
            "telegram_message_link": a.get("telegram_message_link") or b.get("telegram_message_link"),
        }
    )
    return out
