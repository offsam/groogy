#!/usr/bin/env python3
"""Controlled autopublish of strong import-review cards.

Usage:
  # Legacy: Reviewer JSON accepted posts
  python3 scripts/import-review/autopublish_strong_accepted.py --dry-run
  python3 scripts/import-review/autopublish_strong_accepted.py --apply --limit 10

  # Queue: complete cards with phone (business / marketplace / profi services)
  python3 scripts/import-review/autopublish_strong_accepted.py --from-queue --dry-run
  python3 scripts/import-review/autopublish_strong_accepted.py --from-queue --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from itertools import groupby
from pathlib import Path
from typing import Any

from category_map import resolve_category_id, resolve_service_listing_category_id
from common import (
    DEFAULT_REVIEWER_SOURCE,
    SPECIALIST_AUTOPUBLISH_TARGETS,
    SupabaseRest,
    load_env,
    map_post,
)
from eligibility import (
    evaluate_eligibility,
    extract_direct_contacts,
    has_direct_contact,
    normalize_phone,
)
from source_kind import resolve_source_kind
from entity_routing import has_street_address

ROOT = Path(__file__).resolve().parents[2]
AUTO_NOTE = "Автоматическая публикация: accepted + прямой контакт"
COMPLETE_NOTE = (
    "Автопостинг готовой карточки: телефон + описание "
    "(бизнес / marketplace / услуги-профи)"
)
OPEN_QUEUE_STATUSES = ("pending", "in_review", "ready_to_publish", "needs_more_info")
QUEUE_SELECT = (
    "id,source_fingerprint,title,business_name,person_name,description,category,"
    "entity_type,target_collection,city,state,phone,whatsapp,instagram,website,email,"
    "telegram_username,telegram_user_id,ai_confidence,ai_decision,source_posted_at,"
    "photos_count,review_status,duplicate_status,source_text,raw_payload,"
    "published_entity_id,preview_image_url,source_url,source,source_author_id,"
    "source_author_username,address_line,postal_code"
)


def slugify(text: str, *, phone: str | None = None) -> str:
    """ASCII-only slug — Cyrillic paths 404 in Next.js dynamic routes."""
    import secrets
    import unicodedata

    normalized = unicodedata.normalize("NFKD", (text or "").lower())
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    base = re.sub(r"[^a-z0-9\s-]", "", ascii_text)
    base = re.sub(r"[\s_-]+", "-", base).strip("-")[:50]
    if not base or not re.search(r"[a-z0-9]", base):
        digits = re.sub(r"\D", "", phone or "")[-10:] or "biz"
        base = f"business-{digits}"
    stamp = datetime.now(timezone.utc).strftime("%H%M%S")
    # Extra entropy avoids slug collisions when many Cyrillic titles collapse
    # to the same ASCII fallback within the same second.
    return f"{base}-{stamp}-{secrets.token_hex(2)}"


def load_accepted_posts(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [p for p in data.get("posts") or [] if p.get("decision") == "accepted"]


def contact_kind_label(contacts: dict[str, Any]) -> str:
    if contacts.get("phone") and any(
        contacts.get(k)
        for k in ("whatsapp", "instagram", "website", "email", "telegram_username", "facebook")
    ):
        return "phone+extras"
    if contacts.get("phone"):
        return "phone"
    if contacts.get("whatsapp"):
        return "whatsapp"
    if contacts.get("instagram"):
        return "instagram"
    if contacts.get("facebook"):
        return "facebook"
    if contacts.get("website"):
        return "website"
    if contacts.get("email"):
        return "email"
    if contacts.get("telegram_username"):
        return "telegram_username"
    if contacts.get("telegram_user_id"):
        return "telegram_user_id"
    if contacts.get("source_url"):
        return "source_url"
    return "none"


def primary_exclusion_reason(reasons: list[str]) -> str:
    """Pick one primary reason for coarse buckets (priority order)."""
    priority = [
        ("неподдерживаемый тип", "неподдерживаемые типы"),
        ("неопределённый тип", "неподдерживаемые типы"),
        ("возможный дубликат", "дубликаты"),
        ("устаревшая запись", "устаревшие"),
        ("нет телефона", "нет телефона"),
        ("нет контакта", "нет контакта"),
        ("контакт только в исходном тексте", "нет контакта"),
        ("нет title", "нет title"),
        ("мусорный title", "нет title"),
        ("нет description", "нет description"),
        ("короткое description", "нет description"),
        ("нет category", "нет category"),
        ("низкая confidence", "низкая confidence"),
        ("конфликтующая классификация", "требуется ручная проверка"),
        ("похоже на запрос", "требуется ручная проверка"),
        ("некорректный Instagram", "некорректный контакт"),
        ("решение не для автопостинга", "не accepted"),
        ("не accepted", "не accepted"),
        ("уже опубликовано", "уже опубликовано"),
    ]
    for needle, label in priority:
        if any(needle in r for r in reasons):
            return label
    return "другое"


def append_contact_footer(description: str, contacts: dict[str, Any]) -> str:
    lines = [description.rstrip()]
    bits: list[str] = []
    if contacts.get("phone"):
        bits.append(f"тел: {contacts['phone'][0]}")
    if contacts.get("whatsapp"):
        bits.append(f"WhatsApp: {contacts['whatsapp'][0]}")
    if contacts.get("instagram"):
        bits.append(f"IG: @{contacts['instagram'][0]}")
    if contacts.get("telegram_username"):
        bits.append(f"Telegram: @{contacts['telegram_username']}")
    elif contacts.get("telegram_user_id"):
        bits.append(f"Telegram ID: {contacts['telegram_user_id']}")
    if contacts.get("facebook"):
        bits.append(f"Facebook: {contacts['facebook'][0]}")
    if contacts.get("website"):
        bits.append(f"сайт: {contacts['website'][0]}")
    if contacts.get("email"):
        bits.append(f"email: {contacts['email'][0]}")
    # source_url lives on entity.source_url — do not append into description
    if bits:
        lines.append("")
        lines.append("Контакты: " + " · ".join(bits))
    return "\n".join(lines).strip()


def source_kind_from_row(row: dict[str, Any]) -> str | None:
    return resolve_source_kind(row.get("source_url"), row.get("source"))


def apply_entity_source(
    client: SupabaseRest,
    *,
    entity_type: str,
    entity_id: str,
    row: dict[str, Any],
    also_business_id: str | None = None,
) -> None:
    source_url = (row.get("source_url") or "").strip() or None
    if not source_url:
        return
    payload = {
        "source_url": source_url,
        "source_kind": source_kind_from_row(row),
    }
    table = "businesses" if entity_type == "business" else "listings"
    client.patch(table, {"id": f"eq.{entity_id}"}, payload)
    if also_business_id:
        client.patch("businesses", {"id": f"eq.{also_business_id}"}, payload)


def build_candidates(
    posts: list[dict[str, Any]],
    client: SupabaseRest | None,
    *,
    source_key: str | None = None,
    mode: str = "accepted",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    rows = [
        map_post(p, review_status="ready_to_publish", source_key=source_key)
        for p in posts
    ]
    return _evaluate_rows(rows, client, mode=mode)


def build_candidates_from_queue(
    client: SupabaseRest,
    *,
    mode: str = "complete_card",
    review_statuses: tuple[str, ...] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    statuses = review_statuses or OPEN_QUEUE_STATUSES
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    last_id = "00000000-0000-0000-0000-000000000000"
    while True:
        batch = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": QUEUE_SELECT,
                    "review_status": f"in.({','.join(statuses)})",
                    "published_entity_id": "is.null",
                    "target_collection": (
                        "in.(businesses,private_specialists,services,"
                        "marketplace,organizations)"
                    ),
                    "id": f"gt.{last_id}",
                    "order": "id.asc",
                    "limit": "500",
                },
            )
            or []
        )
        if not batch:
            break
        for row in batch:
            rid = str(row.get("id") or "")
            if not rid or rid in seen:
                continue
            seen.add(rid)
            rows.append(row)
            last_id = rid
        if len(batch) < 500:
            break
    return _evaluate_rows(rows, client, mode=mode, already_in_queue=True)


def _evaluate_rows(
    rows: list[dict[str, Any]],
    client: SupabaseRest | None,
    *,
    mode: str,
    already_in_queue: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    all_phones: list[str] = []
    for row in rows:
        contacts = extract_direct_contacts(row)
        all_phones.extend(contacts.get("phone") or [])

    known_phones: set[str] = set()
    existing_fp: dict[str, dict[str, Any]] = {}
    if client is not None:
        try:
            if mode == "complete_card":
                raw_known = client.fetch_all_business_phones()
                known_phones = {normalize_phone(p) or p for p in raw_known if p}
                known_phones = {p for p in known_phones if p}
            else:
                known_phones = client.fetch_business_phones(
                    list(dict.fromkeys(all_phones))
                )
        except Exception as exc:  # noqa: BLE001
            print(f"warn: business phone lookup failed: {exc}", file=sys.stderr)
        if not already_in_queue:
            try:
                fps = [
                    r["source_fingerprint"]
                    for r in rows
                    if r.get("source_fingerprint")
                ]
                existing_fp = client.fetch_existing(fps)
            except Exception as exc:  # noqa: BLE001
                print(f"warn: fingerprint lookup failed: {exc}", file=sys.stderr)

    eligible: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []

    for row in rows:
        fp = row.get("source_fingerprint")
        existing = existing_fp.get(fp) if fp else None
        if existing:
            row["id"] = existing.get("id")
            row["review_status"] = existing.get("review_status") or row.get(
                "review_status"
            )
            row["published_entity_id"] = existing.get("published_entity_id")

        result = evaluate_eligibility(
            row, known_business_phones=known_phones, mode=mode
        )
        item = {
            "row": row,
            "result": result,
            "already_in_queue": already_in_queue or bool(existing),
            "contact_kind": contact_kind_label(result["contacts"]),
        }
        if result["eligible"]:
            eligible.append(item)
        else:
            blocked.append(item)

    regrouped: list[dict[str, Any]] = []
    eligible.sort(
        key=lambda item: (
            item["result"]["contact_bucket"],
            -float(item["result"]["confidence"]),
            -int(item["result"]["completeness"]),
        )
    )
    for _, group in groupby(
        eligible,
        key=lambda item: (
            item["result"]["contact_bucket"],
            -float(item["result"]["confidence"]),
            -int(item["result"]["completeness"]),
        ),
    ):
        chunk = list(group)
        chunk.sort(
            key=lambda item: item["row"].get("source_posted_at") or "",
            reverse=True,
        )
        regrouped.extend(chunk)
    eligible = regrouped

    # One publish per phone within this run (keep highest-ranked).
    if mode == "complete_card":
        seen_phones: set[str] = set()
        deduped: list[dict[str, Any]] = []
        for item in eligible:
            phones = item["result"]["contacts"].get("phone") or []
            key = phones[0] if phones else item["row"].get("id")
            if key in seen_phones:
                item["result"]["reasons"] = list(
                    dict.fromkeys(
                        [*item["result"]["reasons"], "дубликат телефона в этой партии"]
                    )
                )
                item["result"]["eligible"] = False
                blocked.append(item)
                continue
            if key:
                seen_phones.add(str(key))
            deduped.append(item)
        eligible = deduped

    stats = summarize(rows, eligible, blocked)
    stats["mode"] = mode
    return eligible, blocked, stats


def summarize(
    rows: list[dict[str, Any]],
    eligible: list[dict[str, Any]],
    blocked: list[dict[str, Any]],
) -> dict[str, Any]:
    with_direct = 0
    for row in rows:
        if has_direct_contact(extract_direct_contacts(row)):
            with_direct += 1

    primary_counts: Counter[str] = Counter()
    reason_tag_counts: Counter[str] = Counter()
    for item in blocked:
        reasons = item["result"]["reasons"]
        primary_counts[primary_exclusion_reason(reasons)] += 1
        for r in reasons:
            if r.startswith("устаревшая запись"):
                reason_tag_counts["устаревшая запись"] += 1
            elif r.startswith("низкая confidence"):
                reason_tag_counts["низкая confidence"] += 1
            elif r.startswith("неподдерживаемый тип"):
                reason_tag_counts["неподдерживаемый тип"] += 1
            elif r.startswith("короткое description"):
                reason_tag_counts["короткое description"] += 1
            else:
                reason_tag_counts[r] += 1

    entity_dist = Counter((r.get("entity_type") or "null") for r in rows)
    target_dist = Counter((r.get("target_collection") or "null") for r in rows)
    contact_dist = Counter(
        contact_kind_label(extract_direct_contacts(r)) for r in rows
    )
    eligible_contact = Counter(i["contact_kind"] for i in eligible)
    eligible_target = Counter(
        (i["row"].get("target_collection") or "null") for i in eligible
    )

    return {
        "accepted_total": len(rows),
        "with_direct_contact": with_direct,
        "eligible": len(eligible),
        "blocked": len(blocked),
        "blocked_duplicates": primary_counts.get("дубликаты", 0),
        "blocked_stale": primary_counts.get("устаревшие", 0),
        "blocked_unsupported": primary_counts.get("неподдерживаемые типы", 0),
        "blocked_no_contact": primary_counts.get("нет контакта", 0)
        + primary_counts.get("нет телефона", 0),
        "blocked_no_title": primary_counts.get("нет title", 0),
        "blocked_no_description": primary_counts.get("нет description", 0),
        "blocked_no_category": primary_counts.get("нет category", 0),
        "blocked_no_city": primary_counts.get("нет города", 0),
        "blocked_low_confidence": primary_counts.get("низкая confidence", 0),
        "blocked_manual": primary_counts.get("требуется ручная проверка", 0),
        "entity_type": dict(entity_dist),
        "target_collection": dict(target_dist),
        "eligible_target_collection": dict(eligible_target),
        "contacts_all_accepted": dict(contact_dist),
        "contacts_eligible": dict(eligible_contact),
        "exclusion_primary": dict(primary_counts),
        "exclusion_reason_tags": dict(reason_tag_counts),
    }


def print_report(
    stats: dict[str, Any],
    eligible: list[dict[str, Any]],
    blocked: list[dict[str, Any]],
    limit: int | None,
) -> None:
    show = eligible[: limit or 30]
    print("=== Autopublish dry-run / report ===")
    print(f"mode:                        {stats.get('mode')}")
    print(f"queue/source total:          {stats['accepted_total']}")
    print(f"with direct contact:         {stats['with_direct_contact']}")
    print(f"passed all criteria:         {stats['eligible']}")
    print(
        "eligible by target:",
        json.dumps(stats.get("eligible_target_collection") or {}, ensure_ascii=False),
    )
    print()
    print("Exclusion by primary reason:")
    for key, val in sorted(
        (stats.get("exclusion_primary") or {}).items(), key=lambda kv: -kv[1]
    ):
        print(f"  {key}: {val}")
    print()
    print("Exclusion reason tags (a card may have several):")
    for key, val in sorted(
        (stats.get("exclusion_reason_tags") or {}).items(), key=lambda kv: -kv[1]
    ):
        print(f"  {key}: {val}")
    print()
    print("entity_type:", json.dumps(stats["entity_type"], ensure_ascii=False))
    print(
        "target_collection:",
        json.dumps(stats["target_collection"], ensure_ascii=False),
    )
    print(
        "contacts (all):",
        json.dumps(stats["contacts_all_accepted"], ensure_ascii=False),
    )
    print(
        "contacts (eligible):",
        json.dumps(stats["contacts_eligible"], ensure_ascii=False),
    )
    print()
    print(f"TOP candidates (showing {len(show)}):")
    for i, item in enumerate(show, 1):
        row = item["row"]
        c = item["result"]["contacts"]
        title = row.get("title") or row.get("business_name") or row.get("person_name")
        route = (
            "services/profi"
            if row.get("target_collection") in SPECIALIST_AUTOPUBLISH_TARGETS
            else row.get("target_collection")
        )
        print(
            f"{i:02d}. [{item['contact_kind']}] conf={item['result']['confidence']:.2f} "
            f"{row.get('entity_type')}/{row.get('target_collection')} → {route} | "
            f"{title!r} | city={row.get('city')!r} phone={c.get('phone')} "
            f"ig={c.get('instagram')} web={c.get('website')} "
            f"tg={c.get('telegram_username')!r} posted={row.get('source_posted_at')}"
        )
    if blocked:
        print()
        print("Sample blocked (first 8):")
        for item in blocked[:8]:
            title = (
                item["row"].get("title")
                or item["row"].get("business_name")
                or item["row"].get("person_name")
            )
            print(f"  - {title!r}: {item['result']['reasons'][:3]}")


def upsert_ready_rows(
    client: SupabaseRest, items: list[dict[str, Any]]
) -> dict[str, str]:
    """Insert/update import_review_items as ready_to_publish. Returns fingerprint→id."""
    fp_to_id: dict[str, str] = {}
    to_insert: list[dict[str, Any]] = []
    for item in items:
        row = dict(item["row"])
        fp = row.get("source_fingerprint")
        if not fp:
            continue
        if row.get("id"):
            fp_to_id[fp] = row["id"]
            continue
        row["review_status"] = "ready_to_publish"
        for k in list(row.keys()):
            if k.startswith("_"):
                row.pop(k, None)
        to_insert.append(row)

    chunk_size = 25
    for i in range(0, len(to_insert), chunk_size):
        chunk = to_insert[i : i + chunk_size]
        fps = [r["source_fingerprint"] for r in chunk]
        existing = client.fetch_existing(fps)
        remaining: list[dict[str, Any]] = []
        for row in chunk:
            fp = row["source_fingerprint"]
            if fp in existing:
                fp_to_id[fp] = existing[fp]["id"]
                status = (existing[fp].get("review_status") or "").lower()
                if status not in {"approved", "rejected", "duplicate"}:
                    client.patch(
                        "import_review_items",
                        {"id": f"eq.{existing[fp]['id']}"},
                        {"review_status": "ready_to_publish"},
                    )
            else:
                clean = {
                    k: v
                    for k, v in row.items()
                    if k
                    in {
                        "source_key",
                        "source_fingerprint",
                        "source_url",
                        "source_chat_id",
                        "source_message_id",
                        "source_posted_at",
                        "source_text",
                        "ai_decision",
                        "ai_confidence",
                        "ai_rationale",
                        "entity_type",
                        "target_collection",
                        "category",
                        "subcategory",
                        "title",
                        "business_name",
                        "person_name",
                        "description",
                        "services",
                        "price",
                        "currency",
                        "city",
                        "state",
                        "phone",
                        "whatsapp",
                        "telegram_username",
                        "telegram_user_id",
                        "instagram",
                        "website",
                        "email",
                        "photos_count",
                        "duplicate_status",
                        "raw_payload",
                        "review_status",
                    }
                }
                remaining.append(clean)
        if remaining:
            created = client.insert_many("import_review_items", remaining) or []
            for row, created_row in zip(remaining, created):
                fp_to_id[row["source_fingerprint"]] = created_row["id"]
    return fp_to_id


def publish_one(
    client: SupabaseRest,
    item: dict[str, Any],
    item_id: str,
    *,
    categories: list[dict[str, Any]] | None = None,
    listing_categories: list[dict[str, Any]] | None = None,
    note: str = AUTO_NOTE,
) -> dict[str, Any]:
    row = item["row"]
    # Single publish gate — same DB function the human approve path uses
    # (import_review_publish_gate_check). Fail BEFORE creating any entity so
    # nothing is orphaned; mark_autopublished re-checks as a backstop.
    gate_errors = (
        client.rpc_call("import_review_publish_gate_check", {"p_item_id": item_id})
        or []
    )
    if gate_errors:
        raise RuntimeError("publish gate failed: " + "; ".join(gate_errors))
    contacts = item["result"]["contacts"]
    title = (
        row.get("title")
        or row.get("business_name")
        or row.get("person_name")
        or "Untitled"
    ).strip()
    if len(title) < 3:
        cat = (row.get("category") or "").strip() or "услуги"
        title = f"{title} · {cat}".strip()
        if len(title) < 3:
            title = "Услуги специалиста"
    if len(title) > 120:
        title = title[:120].rstrip()
    target = row.get("target_collection")
    description = row.get("description") or ""
    source_posted = row.get("source_posted_at")
    cats = categories if categories is not None else client.fetch_categories()
    svc_cats = (
        listing_categories
        if listing_categories is not None
        else client.fetch_listing_categories(listing_type="service")
    )
    cat_match = resolve_category_id(row.get("category"), cats)
    publish_note = note
    if cat_match.get("needs_manual"):
        publish_note = (
            f"{note}. Требуется ручной выбор категории "
            f"(AI: {row.get('category') or '—'})"
        )

    if target in {"businesses", "organizations"} and not has_street_address(
        row.get("address_line"),
        postal_code=row.get("postal_code"),
    ):
        publish_note = (
            f"{publish_note}. Нет улицы — опубликовано как специалист "
            f"(private_specialists)"
        )
        target = "private_specialists"

    if target in SPECIALIST_AUTOPUBLISH_TARGETS:
        # Profi.ru / TaskRabbit style: самозанятый business + /services listing
        admins = client._request(
            "GET",
            "/profiles",
            params={"select": "id", "role": "eq.admin", "limit": "1"},
        )
        if not admins:
            raise RuntimeError("No admin profile to own autopublished service")
        owner_id = admins[0]["id"]
        svc_match = resolve_service_listing_category_id(row.get("category"), svc_cats)
        phone = (contacts.get("phone") or [None])[0]
        website = (contacts.get("website") or [None])[0]
        if not website and contacts.get("facebook"):
            website = contacts["facebook"][0]
        # Never put source post URL into website — it goes to source_url.
        full_desc = append_contact_footer(description, contacts)
        if source_posted:
            full_desc = f"{full_desc}\n\nИсточник: Telegram, дата: {source_posted}"
        result = client.rpc_call(
            "service_autopublish_specialist_service",
            {
                "p_owner_id": owner_id,
                "p_name": title,
                "p_slug": slugify(title, phone=phone),
                "p_description": full_desc,
                "p_short_description": (description[:240] or None),
                "p_phone": phone,
                "p_website": website,
                "p_instagram_url": (
                    f"https://instagram.com/{contacts['instagram'][0]}"
                    if contacts.get("instagram")
                    else None
                ),
                "p_email": (contacts.get("email") or [None])[0],
                "p_city": row.get("city") or None,
                "p_state": row.get("state") or None,
                "p_business_category_id": cat_match.get("category_id"),
                "p_service_category_id": svc_match.get("category_id"),
                "p_service_area": row.get("city") or None,
                "p_published_at": source_posted,
            },
        )
        if isinstance(result, list):
            result = result[0] if result else {}
        if not isinstance(result, dict):
            raise RuntimeError(f"unexpected specialist RPC result: {result!r}")
        entity_id = result.get("listing_id")
        business_id = result.get("business_id")
        if not entity_id:
            raise RuntimeError(
                "service_autopublish_specialist_service returned no listing_id"
            )
        entity_type = "listing"
        apply_entity_source(
            client,
            entity_type="listing",
            entity_id=str(entity_id),
            row=row,
            also_business_id=str(business_id) if business_id else None,
        )
        publish_note = (
            f"{publish_note}. Профи/услуги: listing={entity_id}, "
            f"самозанятый business={business_id}"
        )
    elif target in {"businesses", "organizations"}:
        website = (contacts.get("website") or [None])[0]
        if not website and contacts.get("facebook"):
            website = contacts["facebook"][0]
        state = row.get("state") or None
        # Never put source post URL into website — it goes to source_url.
        payload = {
            "name": title,
            "slug": slugify(title, phone=(contacts.get("phone") or [None])[0]),
            "short_description": description[:240] or None,
            "description": (
                append_contact_footer(description, contacts)
                + (
                    f"\n\nИсточник: Telegram, дата: {source_posted}"
                    if source_posted
                    else ""
                )
            ),
            "phone": (contacts.get("phone") or [None])[0],
            "website": website,
            "instagram_url": (
                f"https://instagram.com/{contacts['instagram'][0]}"
                if contacts.get("instagram")
                else None
            ),
            "city": row.get("city") or None,
            "status": "approved",
            "state_code": f"US-{state}" if state else None,
            "region": state,
            "category_id": cat_match.get("category_id"),
            "source_url": (row.get("source_url") or "").strip() or None,
            "source_kind": source_kind_from_row(row),
        }
        created = client.insert_many("businesses", [payload])
        entity_id = created[0]["id"]
        entity_type = "business"
    elif target in {"marketplace", "real_estate"}:
        admins = client._request(
            "GET",
            "/profiles",
            params={"select": "id", "role": "eq.admin", "limit": "1"},
        )
        if not admins:
            raise RuntimeError("No admin profile to own autopublished listing")
        owner_id = admins[0]["id"]
        market_desc = append_contact_footer(description, contacts)
        if source_posted:
            market_desc = f"{market_desc}\n\nИсточник: Telegram, дата: {source_posted}"
        entity_id = client.rpc_call(
            "service_autopublish_marketplace_listing",
            {
                "p_owner_id": owner_id,
                "p_title": title,
                "p_description": market_desc,
                "p_price_amount": row.get("price"),
                "p_price_currency": row.get("currency") or "USD",
                "p_city": row.get("city") or None,
                "p_state": row.get("state") or None,
                "p_published_at": source_posted,
                "p_condition": "good",
                "p_transaction_type": "sell",
            },
        )
        if isinstance(entity_id, list):
            entity_id = entity_id[0] if entity_id else None
        if isinstance(entity_id, dict):
            entity_id = entity_id.get("id") or entity_id.get(
                "service_autopublish_marketplace_listing"
            )
        if not entity_id:
            raise RuntimeError("service_autopublish_marketplace_listing returned no id")
        entity_type = "listing"
        apply_entity_source(
            client,
            entity_type="listing",
            entity_id=str(entity_id),
            row=row,
        )
    else:
        raise RuntimeError(f"Unsupported target for publish: {target}")

    client.rpc_call(
        "service_import_review_mark_autopublished",
        {
            "p_item_id": item_id,
            "p_published_entity_type": entity_type,
            "p_published_entity_id": entity_id,
            "p_note": publish_note,
        },
    )
    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "category_match": cat_match,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--source", type=Path, default=DEFAULT_REVIEWER_SOURCE)
    parser.add_argument(
        "--from-queue",
        action="store_true",
        help="Autopublish complete cards from import_review_items (phone + body)",
    )
    parser.add_argument(
        "--only-ready",
        action="store_true",
        help="With --from-queue: only review_status=ready_to_publish",
    )
    parser.add_argument(
        "--source-key",
        type=str,
        default=None,
        help="Override source namespace, e.g. telegram:la_orange_county",
    )
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    if args.dry_run and args.apply:
        print("Use only one of --dry-run / --apply", file=sys.stderr)
        return 2

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        return 1

    client = SupabaseRest(url, key)
    mode = "complete_card" if args.from_queue else "accepted"
    note = COMPLETE_NOTE if args.from_queue else AUTO_NOTE

    if args.from_queue:
        statuses = ("ready_to_publish",) if args.only_ready else None
        eligible, blocked, stats = build_candidates_from_queue(
            client, mode=mode, review_statuses=statuses
        )
    else:
        source_key = args.source_key
        if not source_key:
            sp = str(args.source)
            if "la_orange_county" in sp:
                source_key = "telegram:la_orange_county"
            elif "fun_for_mom" in sp:
                source_key = "telegram:fun_for_mom"
        posts = load_accepted_posts(args.source)
        eligible, blocked, stats = build_candidates(
            posts, client, source_key=source_key, mode=mode
        )

    print_report(stats, eligible, blocked, 30 if args.dry_run else args.limit)

    if args.dry_run:
        print()
        print("DRY-RUN complete. No writes performed. Apply was NOT run.")
        out = ROOT / "scripts/import-review/data"
        out.mkdir(parents=True, exist_ok=True)
        report_path = out / (
            "autopublish_queue_dry_run_report.json"
            if args.from_queue
            else "autopublish_dry_run_report.json"
        )
        report_path.write_text(
            json.dumps(
                {
                    "stats": stats,
                    "candidates": [
                        {
                            "id": i["row"].get("id"),
                            "fingerprint": i["row"].get("source_fingerprint"),
                            "title": i["row"].get("title")
                            or i["row"].get("business_name")
                            or i["row"].get("person_name"),
                            "target_collection": i["row"].get("target_collection"),
                            "entity_type": i["row"].get("entity_type"),
                            "route": (
                                "services/profi"
                                if i["row"].get("target_collection")
                                in SPECIALIST_AUTOPUBLISH_TARGETS
                                else i["row"].get("target_collection")
                            ),
                            "contact_kind": i["contact_kind"],
                            "confidence": i["result"]["confidence"],
                            "contacts": i["result"]["contacts"],
                            "source_posted_at": i["row"].get("source_posted_at"),
                        }
                        for i in eligible
                    ],
                    "blocked_sample": [
                        {
                            "title": i["row"].get("title")
                            or i["row"].get("business_name")
                            or i["row"].get("person_name"),
                            "reasons": i["result"]["reasons"],
                            "target_collection": i["row"].get("target_collection"),
                        }
                        for i in blocked[:100]
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"Wrote {report_path}")
        return 0

    # APPLY
    if args.from_queue:
        fp_to_id = {
            (i["row"].get("source_fingerprint") or i["row"]["id"]): i["row"]["id"]
            for i in eligible
            if i["row"].get("id")
        }
    else:
        all_items = eligible + blocked
        safe_items: list[dict[str, Any]] = []
        for item in all_items:
            status = (item["row"].get("review_status") or "").lower()
            if status in {"approved", "rejected", "duplicate"} and item["row"].get(
                "published_entity_id"
            ):
                continue
            if not item["result"]["eligible"]:
                item["row"]["review_status"] = "ready_to_publish"
            safe_items.append(item)
        fp_to_id = upsert_ready_rows(client, safe_items)
        for item in eligible:
            fp = item["row"].get("source_fingerprint")
            if fp and fp not in fp_to_id and item["row"].get("id"):
                fp_to_id[fp] = item["row"]["id"]

    categories = client.fetch_categories()
    listing_categories = client.fetch_listing_categories(listing_type="service")
    to_publish = eligible[: args.limit] if args.limit else eligible
    published = 0
    skipped = 0
    errors: list[str] = []
    category_mapped = 0
    category_manual: list[str] = []
    for item in to_publish:
        fp = item["row"].get("source_fingerprint") or item["row"].get("id")
        item_id = fp_to_id.get(fp) or item["row"].get("id")
        if not item_id:
            errors.append(f"missing id for {fp}")
            continue
        existing = client._request(
            "GET",
            "/import_review_items",
            params={
                "select": "id,review_status,published_entity_id",
                "id": f"eq.{item_id}",
            },
        )
        if (
            existing
            and existing[0].get("review_status") == "approved"
            and existing[0].get("published_entity_id")
        ):
            skipped += 1
            continue
        try:
            result = publish_one(
                client,
                item,
                item_id,
                categories=categories,
                listing_categories=listing_categories,
                note=note,
            )
            published += 1
            if result["category_match"].get("category_id"):
                category_mapped += 1
            if result["category_match"].get("needs_manual"):
                category_manual.append(
                    f"{item['row'].get('title')}: {result['category_match'].get('reason')}"
                )
            print(
                f"published {item_id} → {result['entity_type']}/{result['entity_id']} "
                f"({item['row'].get('target_collection')})"
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{item_id}: {exc}")
            print(f"ERROR {item_id}: {exc}", file=sys.stderr)

    print()
    print(f"Published: {published}, skipped: {skipped}, errors: {len(errors)}")
    print(f"Category mapped: {category_mapped}, needs manual: {len(category_manual)}")
    for line in category_manual[:20]:
        print(f"  manual cat: {line}")
    for err in errors[:20]:
        print(f"  err: {err}")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
