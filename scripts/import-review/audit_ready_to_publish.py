#!/usr/bin/env python3
"""Audit ready_to_publish import-review queue (events / openings / quality).

Actions:
  add_location       — second branch of existing business → business_locations
  reclassify_business — mislabeled event that is actually a business/specialist
  reclassify_specialist
  keep_event         — real one-off event (leave notes; optional reject from ready)
  reject_junk        — empty / spam / non-entity
  needs_human        — ambiguous
  flag_weak          — marketplace/RE/specialist quality flags (report only unless --apply-weak)

Usage:
  python3 scripts/import-review/audit_ready_to_publish.py
  python3 scripts/import-review/audit_ready_to_publish.py --apply
  python3 scripts/import-review/audit_ready_to_publish.py --apply --only-events
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402
from eligibility import normalize_instagram, normalize_phone  # noqa: E402
from merge_queue_into_existing import (  # noqa: E402
    build_business_indexes,
    fetch_businesses,
    item_title,
    match_business,
    website_host,
)

OUT = (
    ROOT
    / "scripts"
    / "import-review"
    / "data"
    / "audit_ready_to_publish_report.json"
)

OPENING_RE = re.compile(
    r"("
    r"открыти[ея]|открываем|открыл[аи]?|"
    r"второй\s+(центр|филиал|офис|салон|кабинет|точк)|"
    r"новая\s+точк|новый\s+(адрес|кабинет|офис|филиал|салон)|"
    r"переехал[аи]?|переезд|"
    r"grand\s+opening|second\s+(location|center|branch)|"
    r"new\s+(location|address|office|studio)|"
    r"день\s+открытых\s+дверей|"
    r"набор\s+в\s+групп"
    r")",
    re.I,
)

ADDRESS_RE = re.compile(
    r"(?:"
    r"📍\s*([^\n]{10,120})"
    r"|"
    r"(?:адрес|address)\s*[:：]?\s*([^\n]{10,120})"
    r"|"
    r"(\d{2,5}\s+[A-Za-zА-Яа-я0-9 .#'\-]+(?:,\s*)?(?:Suite|Ste|Unit|#)?\s*[A-Za-z0-9\-]*"
    r",?\s*[A-Za-z .]+,?\s*CA\s*,?\s*\d{5})"
    r")",
    re.I,
)

JUNK_TITLE_RE = re.compile(
    r"^(messenger|gmail\.com|whatsapp|telegram|yahoo\.com|телефон|контакты|phone|contact)$",
    re.I,
)

REAL_EVENT_RE = re.compile(
    r"("
    r"мастер[\s-]?класс|workshop|вебинар|эфир|"
    r"квиз|quiz|концерт|фестиваль|meetup|митап|"
    r"приглашаем\s+на\s+(вечер|встречу|мероприят)|"
    r"регистрация\s+на\s+"
    r")",
    re.I,
)


def blob(item: dict[str, Any]) -> str:
    return "\n".join(
        str(item.get(k) or "")
        for k in (
            "title",
            "business_name",
            "person_name",
            "description",
            "source_text",
            "category",
        )
    )


def extract_address(text: str) -> dict[str, str] | None:
    if not text:
        return None
    m = ADDRESS_RE.search(text)
    if not m:
        return None
    raw = next((g for g in m.groups() if g), "").strip()
    raw = re.sub(r"\s+", " ", raw).strip(" .;")
    if len(raw) < 12:
        return None
    city = None
    postal = None
    state_code = "US-CA"
    cm = re.search(
        r",\s*([A-Za-z .]+?)\s*,?\s*(?:CA|California)\s*,?\s*(\d{5})?",
        raw,
        re.I,
    )
    if cm:
        city = cm.group(1).strip()
        postal = cm.group(2)
    # Prefer explicit city tokens
    for token in (
        "Laguna Hills",
        "Laguna Niguel",
        "Irvine",
        "Orange",
        "Anaheim",
        "Los Angeles",
        "San Diego",
        "Sacramento",
        "Glendale",
        "Burbank",
    ):
        if token.lower() in raw.lower():
            city = token
            break
    address_line = raw
    # Strip trailing city/state/zip for address_line when possible
    if city and city.lower() in raw.lower():
        idx = raw.lower().rfind(city.lower())
        if idx > 5:
            address_line = raw[:idx].rstrip(" ,")
    return {
        "raw": raw,
        "address_line": address_line[:160],
        "city": (city or "").strip() or "Unknown",
        "postal_code": postal or "",
        "state_code": state_code,
        "region": "CA",
    }


def fetch_ready(client: SupabaseRest) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": (
                        "id,title,business_name,person_name,description,source_text,"
                        "phone,whatsapp,instagram,website,email,city,state,category,"
                        "subcategory,entity_type,target_collection,telegram_username,"
                        "duplicate_status,price,currency,review_status,review_notes,"
                        "source_url,ai_confidence,occurrence_count"
                    ),
                    "review_status": "eq.ready_to_publish",
                    "order": "updated_at.desc",
                    "offset": str(offset),
                    "limit": "200",
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < 200:
            break
    return rows


def is_eventish(item: dict[str, Any]) -> bool:
    return (
        item.get("entity_type") == "event"
        or item.get("target_collection") == "events"
        or "событ" in (item.get("category") or "").lower()
    )


_GENERIC_BRAND = {
    "service",
    "services",
    "studio",
    "center",
    "центр",
    "education",
    "school",
    "online",
    "онлайн",
    "group",
    "группа",
}


def brand_tokens(name: str) -> list[str]:
    tokens = [
        t
        for t in re.split(r"[^\w]+", (name or "").lower(), flags=re.UNICODE)
        if len(t) >= 4 and t not in _GENERIC_BRAND
    ]
    return tokens[:6]


def soft_match_opening(
    item: dict[str, Any],
    text: str,
    by_phone: dict[str, list[dict[str, Any]]],
    by_ig: dict[str, list[dict[str, Any]]],
    by_host: dict[str, list[dict[str, Any]]],
) -> tuple[dict[str, Any] | None, str | None]:
    """Phone/IG/website match for openings when title is an IG handle (Jaccard fails)."""
    title = (item_title(item) or "").lower().replace(" ", "").replace("_", "").replace(".", "")
    blob_l = text.lower()

    def accept(biz: dict[str, Any], reason: str) -> tuple[dict[str, Any], str] | None:
        tokens = brand_tokens(str(biz.get("name") or ""))
        if not tokens:
            return biz, reason
        name_compact = re.sub(r"[^\w]+", "", str(biz.get("name") or "").lower())
        if any(t in blob_l for t in tokens) or any(t in title for t in tokens):
            return biz, reason
        if title and name_compact and (title in name_compact or name_compact in title):
            return biz, reason
        # Shared website host alone is strong for openings
        if reason.startswith("host:"):
            return biz, reason
        return None

    phones: list[str] = []
    for raw in list(item.get("phone") or []) + list(item.get("whatsapp") or []):
        n = normalize_phone(str(raw))
        if n and n not in phones:
            phones.append(n)
    for phone in phones:
        for hit in by_phone.get(phone) or []:
            found = accept(hit, f"phone_soft:{phone}")
            if found:
                return found

    for raw in item.get("instagram") or []:
        ig = normalize_instagram(str(raw) if raw else "")
        if not ig:
            continue
        for hit in by_ig.get(ig.lower()) or []:
            found = accept(hit, f"ig_soft:{ig}")
            if found:
                return found

    for raw in item.get("website") or []:
        host = website_host(raw)
        if not host:
            continue
        for hit in by_host.get(host) or []:
            found = accept(hit, f"host:{host}")
            if found:
                return found

    return None, None


def classify_item(
    item: dict[str, Any],
    by_phone: dict[str, list[dict[str, Any]]],
    by_ig: dict[str, list[dict[str, Any]]],
    by_host: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    text = blob(item)
    title = item_title(item)
    matched, reason = match_business(item, by_phone, by_ig, by_host)
    addr = extract_address(text)
    opening = bool(OPENING_RE.search(text))
    eventish = is_eventish(item)

    if not matched and opening:
        matched, reason = soft_match_opening(item, text, by_phone, by_ig, by_host)

    base: dict[str, Any] = {
        "id": item["id"],
        "title": title or item.get("title"),
        "entity_type": item.get("entity_type"),
        "target_collection": item.get("target_collection"),
        "category": item.get("category"),
        "city": item.get("city"),
        "duplicate_status": item.get("duplicate_status"),
        "opening_signal": opening,
        "eventish": eventish,
        "address": addr,
        "match_business_id": matched["id"] if matched else None,
        "match_business_name": matched.get("name") if matched else None,
        "match_reason": reason,
    }

    # Junk titles with no contacts
    phones = [normalize_phone(str(p)) for p in (item.get("phone") or []) if p]
    phones = [p for p in phones if p]
    igs = [
        normalize_instagram(str(x))
        for x in (item.get("instagram") or [])
        if x
    ]
    igs = [x for x in igs if x]
    if (not title or JUNK_TITLE_RE.match(title)) and not phones and not igs:
        base.update(
            {
                "action": "reject_junk",
                "confidence": "high",
                "note": "Пустой/мусорный заголовок без контактов",
            }
        )
        return base

    # Opening / second location + match → add_location
    if matched and (opening or (eventish and addr)):
        if addr or opening:
            base.update(
                {
                    "action": "add_location",
                    "confidence": "high" if (opening and addr and matched) else "medium",
                    "note": (
                        f"Второе расположение для «{matched.get('name')}» "
                        f"({reason}); не публиковать как event"
                    ),
                }
            )
            return base

    # Eventish without opening: real event vs misclassified business
    if eventish:
        if opening and not matched:
            base.update(
                {
                    "action": "reclassify_business",
                    "confidence": "medium",
                    "note": "Открытие/филиал без точного матча — переклассифицировать в business",
                    "new_entity_type": "business",
                    "new_target_collection": "businesses",
                }
            )
            return base
        if REAL_EVENT_RE.search(text) and not opening:
            base.update(
                {
                    "action": "keep_event",
                    "confidence": "medium",
                    "note": "Похоже на настоящее мероприятие — убрать из ready (events не autopublish)",
                }
            )
            return base
        # Default for eventish: often specialist/page promo mislabeled
        if phones or igs or item.get("website"):
            # Prefer specialist if person-ish title
            personish = bool(
                re.search(r"^[А-ЯA-Z][а-яa-z]+(\s+[А-ЯA-Z][а-яa-z]+)?$", title or "")
            )
            if personish and not opening:
                base.update(
                    {
                        "action": "reclassify_specialist",
                        "confidence": "medium",
                        "note": "Event → specialist (имя + контакт)",
                        "new_entity_type": "private_specialist",
                        "new_target_collection": "private_specialists",
                    }
                )
            else:
                base.update(
                    {
                        "action": "reclassify_business",
                        "confidence": "medium",
                        "note": "Event → business (контакты / бренд)",
                        "new_entity_type": "business",
                        "new_target_collection": "businesses",
                    }
                )
            return base
        base.update(
            {
                "action": "needs_human",
                "confidence": "low",
                "note": "Event без контактов и без явного сигнала",
            }
        )
        return base

    # Non-event quality flags
    et = item.get("entity_type")
    flags: list[str] = []
    if et == "marketplace_listing":
        if item.get("price") is None:
            flags.append("no_price")
        if not phones and not igs and not item.get("telegram_username"):
            flags.append("no_contact")
    if et == "real_estate" and not (item.get("city") or "").strip():
        flags.append("no_city")
    if et == "private_specialist" and not phones and not igs:
        flags.append("no_contact")
    if item.get("duplicate_status") in {"exact_duplicate", "likely_duplicate"}:
        flags.append(f"dup:{item.get('duplicate_status')}")
    if matched and et in {"business", "private_specialist", "marketplace_listing"}:
        flags.append(f"exists:{matched.get('slug') or matched.get('id')}")

    if flags:
        action = "needs_human" if "dup:" in "".join(flags) or "exists:" in "".join(flags) else "flag_weak"
        if matched and et in {"business", "private_specialist"} and opening:
            action = "add_location"
            base.update(
                {
                    "action": action,
                    "confidence": "medium",
                    "note": f"Opening + existing business; flags={flags}",
                }
            )
            return base
        base.update(
            {
                "action": action,
                "confidence": "low",
                "flags": flags,
                "note": "Качество / дубликат — на модерацию" if action == "needs_human" else "Слабые поля",
            }
        )
        return base

    base.update(
        {
            "action": "ok",
            "confidence": "high",
            "note": "Без замечаний",
        }
    )
    return base


def seed_primary_from_business(client: SupabaseRest, business_id: str) -> str | None:
    """If business has no locations yet, mirror businesses.* as primary row."""
    existing = (
        client._request(
            "GET",
            "/business_locations",
            params={
                "select": "id",
                "business_id": f"eq.{business_id}",
                "limit": "1",
            },
        )
        or []
    )
    if existing:
        return None
    biz = (
        client._request(
            "GET",
            "/businesses",
            params={
                "select": "id,name,address_line,city,region,state_code,latitude,longitude",
                "id": f"eq.{business_id}",
                "limit": "1",
            },
        )
        or []
    )
    if not biz:
        return None
    b = biz[0]
    if not (b.get("address_line") or b.get("city")):
        return None
    region = b.get("region") or "CA"
    postal = None
    m = re.search(r"\b(\d{5})\b", str(region))
    if m:
        postal = m.group(1)
        region = re.sub(r"\s*\d{5}\b", "", str(region)).strip() or "CA"
    rows = client._request(
        "POST",
        "/business_locations",
        body={
            "business_id": business_id,
            "label": b.get("city") or "Основной",
            "kind": "street" if b.get("address_line") else "city",
            "address_line": b.get("address_line"),
            "city": b.get("city"),
            "region": region,
            "state_code": b.get("state_code") or "US-CA",
            "postal_code": postal,
            "latitude": b.get("latitude"),
            "longitude": b.get("longitude"),
            "is_primary": True,
            "sort_order": 10,
            "source": "businesses_mirror",
            "status": "published",
            "location_precision": "street" if b.get("address_line") else "city",
        },
        prefer="return=representation",
    )
    if isinstance(rows, list) and rows:
        return rows[0].get("id")
    return None


def insert_location(
    client: SupabaseRest,
    business_id: str,
    addr: dict[str, str],
    *,
    source_url: str | None,
    label: str | None,
) -> str | None:
    seed_primary_from_business(client, business_id)
    # Skip if same address already exists
    existing = (
        client._request(
            "GET",
            "/business_locations",
            params={
                "select": "id,address_line,city",
                "business_id": f"eq.{business_id}",
                "limit": "50",
            },
        )
        or []
    )
    needle = (addr.get("address_line") or "").lower()
    city = (addr.get("city") or "").lower()
    for row in existing:
        if needle and needle[:20] in (row.get("address_line") or "").lower():
            return row["id"]
        if city and city == (row.get("city") or "").lower() and not needle:
            return row["id"]

    sort_order = 20 + len(existing) * 10
    body = {
        "business_id": business_id,
        "label": label or addr.get("city") or "Филиал",
        "kind": "street",
        "address_line": addr.get("address_line") or addr.get("raw"),
        "city": addr.get("city"),
        "region": addr.get("region") or "CA",
        "state_code": addr.get("state_code") or "US-CA",
        "postal_code": addr.get("postal_code") or None,
        "is_primary": False,
        "sort_order": sort_order,
        "source": "import_review",
        "source_url": source_url,
        "status": "published",
        "location_precision": "street" if addr.get("address_line") else "city",
    }
    rows = client._request(
        "POST",
        "/business_locations",
        body=body,
        prefer="return=representation",
    )
    if isinstance(rows, list) and rows:
        return rows[0].get("id")
    return None


def apply_action(
    client: SupabaseRest,
    item: dict[str, Any],
    decision: dict[str, Any],
) -> dict[str, Any]:
    action = decision["action"]
    item_id = item["id"]
    result = {"id": item_id, "action": action, "ok": False}

    if action == "add_location":
        biz_id = decision.get("match_business_id")
        if not biz_id:
            result["error"] = "no business match"
            return result
        addr = decision.get("address") or {
            "address_line": None,
            "city": item.get("city") or "Unknown",
            "state_code": "US-CA",
            "region": "CA",
            "postal_code": "",
            "raw": item.get("city") or "",
        }
        loc_id = insert_location(
            client,
            biz_id,
            addr,
            source_url=item.get("source_url"),
            label=addr.get("city"),
        )
        # Enrich empty fields on business from queue when possible
        try:
            client._request(
                "POST",
                "/rpc/service_enrich_business_from_queue",
                body={
                    "p_item_id": item_id,
                    "p_business_id": biz_id,
                    "p_note": decision.get("note") or "audit: second location",
                },
            )
        except Exception as exc:  # noqa: BLE001
            # Fallback: mark approved manually
            client._request(
                "PATCH",
                "/import_review_items",
                params={"id": f"eq.{item_id}"},
                body={
                    "review_status": "approved",
                    "published_entity_id": biz_id,
                    "published_entity_type": "business",
                    "entity_type": "business",
                    "target_collection": "businesses",
                    "review_notes": (decision.get("note") or "")[:500],
                    "city": addr.get("city") or item.get("city"),
                },
                prefer="return=minimal",
            )
            result["enrich_error"] = str(exc)[:200]
        result.update({"ok": True, "location_id": loc_id, "business_id": biz_id})
        return result

    if action in {"reclassify_business", "reclassify_specialist"}:
        patch = {
            "entity_type": decision.get("new_entity_type"),
            "target_collection": decision.get("new_target_collection"),
            "review_notes": (decision.get("note") or "")[:500],
        }
        if action == "reclassify_business" and not item.get("category"):
            patch["category"] = "other"
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{item_id}"},
            body=patch,
            prefer="return=minimal",
        )
        result["ok"] = True
        return result

    if action == "reject_junk":
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{item_id}"},
            body={
                "review_status": "rejected",
                "review_notes": (decision.get("note") or "audit junk")[:500],
            },
            prefer="return=minimal",
        )
        result["ok"] = True
        return result

    if action == "keep_event":
        # Remove from ready so they don't block autopublish; events have own pipeline
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{item_id}"},
            body={
                "review_status": "rejected",
                "review_notes": (
                    decision.get("note")
                    or "audit: event — не в ready_to_publish; смотреть /admin/events"
                )[:500],
            },
            prefer="return=minimal",
        )
        result["ok"] = True
        return result

    if action == "needs_human":
        notes = (decision.get("note") or "")[:500]
        flags = decision.get("flags") or []
        if flags:
            notes = (notes + " | flags: " + ",".join(flags))[:500]
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{item_id}"},
            body={"review_notes": notes},
            prefer="return=minimal",
        )
        result["ok"] = True
        return result

    # ok / flag_weak — optional notes only
    if action == "flag_weak" and decision.get("flags"):
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{item_id}"},
            body={
                "review_notes": (
                    "audit weak: " + ",".join(decision["flags"])
                )[:500],
            },
            prefer="return=minimal",
        )
        result["ok"] = True
        return result

    result["ok"] = True
    result["skipped"] = True
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--only-events",
        action="store_true",
        help="Only process eventish / opening candidates",
    )
    parser.add_argument(
        "--apply-confident",
        action="store_true",
        help="With --apply, only high/medium confident mutating actions",
    )
    args = parser.parse_args()
    # Default apply path uses confident filter; flag_weak is report-only
    if args.apply:
        args.apply_confident = True

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1

    client = SupabaseRest(url, key)
    print("Loading ready_to_publish…")
    items = fetch_ready(client)
    print(f"  items: {len(items)}")
    print("Loading businesses…")
    businesses = fetch_businesses(client)
    print(f"  businesses: {len(businesses)}")
    by_phone, by_ig, by_host = build_business_indexes(businesses)

    decisions: list[dict[str, Any]] = []
    for item in items:
        d = classify_item(item, by_phone, by_ig, by_host)
        if args.only_events and not (
            d.get("eventish") or d.get("opening_signal") or d["action"] == "add_location"
        ):
            continue
        decisions.append(d)

    by_action = Counter(d["action"] for d in decisions)
    print("actions:", dict(by_action))

    apply_results: list[dict[str, Any]] = []
    if args.apply:
        # Mutating apply: locations / reclassify / junk / true events out of ready.
        # flag_weak stays report-only (do not spam review_notes on hundreds of MP/RE).
        mutating = {
            "add_location",
            "reclassify_business",
            "reclassify_specialist",
            "reject_junk",
            "keep_event",
        }
        # Contactless leftover events → same as keep_event (out of ready)
        conf_ok = {"high", "medium"}
        by_id = {i["id"]: i for i in items}
        for d in decisions:
            item = by_id.get(d["id"])
            if not item:
                continue
            action = d["action"]
            if action == "needs_human" and d.get("eventish") and d.get("confidence") == "low":
                # Remove contactless eventish from ready so they don't block autopublish
                d = {
                    **d,
                    "action": "keep_event",
                    "confidence": "medium",
                    "note": d.get("note")
                    or "audit: event without contacts — removed from ready_to_publish",
                }
                action = "keep_event"
            if action not in mutating:
                continue
            if args.apply_confident and d.get("confidence") not in conf_ok:
                if action != "reject_junk":
                    continue
            res = apply_action(client, item, d)
            apply_results.append(res)
            print(
                f"  [{res.get('action')}] ok={res.get('ok')} "
                f"{(d.get('title') or '')[:50]} {res.get('error') or ''}"
            )

    # Rest-queue quality summary (no mass publish)
    rest_flags: Counter[str] = Counter()
    by_entity_action: dict[str, Counter[str]] = {}
    for d in decisions:
        et = str(d.get("entity_type") or "?")
        by_entity_action.setdefault(et, Counter())[d["action"]] += 1
        for f in d.get("flags") or []:
            rest_flags[f] += 1

    report = {
        "total_ready": len(items),
        "audited": len(decisions),
        "by_action": dict(by_action),
        "by_entity": dict(Counter(i.get("entity_type") for i in items)),
        "by_entity_action": {k: dict(v) for k, v in by_entity_action.items()},
        "quality_flags": dict(rest_flags),
        "moderation_queue": [
            {
                "id": d["id"],
                "title": d.get("title"),
                "entity_type": d.get("entity_type"),
                "action": d["action"],
                "flags": d.get("flags"),
                "note": d.get("note"),
                "match_business_name": d.get("match_business_name"),
            }
            for d in decisions
            if d["action"] in {"needs_human", "reject_junk", "add_location", "keep_event"}
            or (
                d["action"] == "flag_weak"
                and any(
                    f.startswith("dup:") or f.startswith("exists:")
                    for f in (d.get("flags") or [])
                )
            )
        ],
        "decisions": decisions,
        "apply_results": apply_results,
        "applied": bool(args.apply),
        "note": (
            "Do not mass-autopublish until moderation_queue and quality_flags are reviewed. "
            "Run: python3 scripts/import-review/autopublish_strong_accepted.py --from-queue --only-ready (dry-run)."
        ),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")

    # Spotlight Sunrise-like
    for d in decisions:
        if d["action"] == "add_location" or (
            d.get("title") and "sunrise" in str(d["title"]).lower()
        ):
            print(
                f"  ★ {d['action']} {d.get('title')} → {d.get('match_business_name')} "
                f"| {d.get('address')}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
