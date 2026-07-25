#!/usr/bin/env python3
"""Controlled autopublish of strong Reviewer v1 accepted cards.

Usage:
  python3 scripts/import-review/autopublish_strong_accepted.py --dry-run
  python3 scripts/import-review/autopublish_strong_accepted.py --apply --limit 10
  python3 scripts/import-review/autopublish_strong_accepted.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import (
    DEFAULT_REVIEWER_SOURCE,
    SupabaseRest,
    load_env,
    map_post,
)
from category_map import resolve_category_id
from eligibility import (
    evaluate_eligibility,
    extract_direct_contacts,
    has_direct_contact,
)

ROOT = Path(__file__).resolve().parents[2]
AUTO_NOTE = "Автоматическая публикация: accepted + прямой контакт"


def slugify(text: str) -> str:
    base = re.sub(r"[^\w\s-]", "", text.lower(), flags=re.UNICODE)
    base = re.sub(r"[\s_-]+", "-", base).strip("-")[:50] or "import"
    stamp = datetime.now(timezone.utc).strftime("%H%M%S")
    return f"{base}-{stamp}"


def load_accepted_posts(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [p for p in data.get("posts") or [] if p.get("decision") == "accepted"]


def contact_kind_label(contacts: dict[str, Any]) -> str:
    if contacts.get("phone") and any(
        contacts.get(k)
        for k in ("whatsapp", "instagram", "website", "email", "telegram_username")
    ):
        return "phone+extras"
    if contacts.get("phone"):
        return "phone"
    if contacts.get("whatsapp"):
        return "whatsapp"
    if contacts.get("instagram"):
        return "instagram"
    if contacts.get("website"):
        return "website"
    if contacts.get("email"):
        return "email"
    if contacts.get("telegram_username"):
        return "telegram_username"
    return "none"


def primary_exclusion_reason(reasons: list[str]) -> str:
    """Pick one primary reason for coarse buckets (priority order)."""
    priority = [
        ("неподдерживаемый тип", "неподдерживаемые типы"),
        ("неопределённый тип", "неподдерживаемые типы"),
        ("возможный дубликат", "дубликаты"),
        ("устаревшая запись", "устаревшие"),
        ("нет контакта", "нет контакта"),
        ("контакт только в исходном тексте", "нет контакта"),
        ("нет title", "нет title"),
        ("нет description", "нет description"),
        ("нет category", "нет category"),
        ("нет города", "нет города"),
        ("низкая confidence", "низкая confidence"),
        ("конфликтующая классификация", "требуется ручная проверка"),
        ("похоже на запрос", "требуется ручная проверка"),
        ("некорректный Instagram", "некорректный контакт"),
        ("уже опубликовано", "уже опубликовано"),
    ]
    for needle, label in priority:
        if any(needle in r for r in reasons):
            return label
    return "другое"


def build_candidates(
    posts: list[dict[str, Any]],
    client: SupabaseRest | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    rows = [
        map_post(p, review_status="ready_to_publish")
        for p in posts
    ]

    # Collect phones for duplicate lookup
    all_phones: list[str] = []
    for row in rows:
        contacts = extract_direct_contacts(row)
        all_phones.extend(contacts.get("phone") or [])
    known_phones: set[str] = set()
    existing_fp: dict[str, dict[str, Any]] = {}
    if client is not None:
        try:
            known_phones = client.fetch_business_phones(list(dict.fromkeys(all_phones)))
        except Exception as exc:  # noqa: BLE001
            print(f"warn: business phone lookup failed: {exc}", file=sys.stderr)
        try:
            existing_fp = client.fetch_existing([r["source_fingerprint"] for r in rows])
        except Exception as exc:  # noqa: BLE001
            print(f"warn: fingerprint lookup failed: {exc}", file=sys.stderr)

    eligible: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []

    for row in rows:
        fp = row["source_fingerprint"]
        existing = existing_fp.get(fp)
        if existing:
            row["id"] = existing.get("id")
            row["review_status"] = existing.get("review_status") or row["review_status"]
            row["published_entity_id"] = existing.get("published_entity_id")

        result = evaluate_eligibility(row, known_business_phones=known_phones)
        item = {
            "row": row,
            "result": result,
            "already_in_queue": bool(existing),
            "contact_kind": contact_kind_label(result["contacts"]),
        }
        if result["eligible"]:
            eligible.append(item)
        else:
            blocked.append(item)

    # Sort eligible by publish priority
    def sort_key(item: dict[str, Any]) -> tuple:
        r = item["result"]
        posted = item["row"].get("source_posted_at") or ""
        return (
            r["contact_bucket"],
            -float(r["confidence"]),
            -int(r["completeness"]),
            # newer first => reverse ISO by negating via invert string isn't easy; use empty last
            "" if not posted else posted,
        )

    eligible.sort(key=sort_key)
    # For posted_at we want newer first: reverse within same bucket by posted
    eligible.sort(
        key=lambda item: (
            item["result"]["contact_bucket"],
            -float(item["result"]["confidence"]),
            -int(item["result"]["completeness"]),
            item["row"].get("source_posted_at") or "",
        ),
        reverse=False,
    )
    # Fix date: within same keys, newer should be first — use secondary reverse on date
    from itertools import groupby

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
        chunk.sort(key=lambda item: item["row"].get("source_posted_at") or "", reverse=True)
        regrouped.extend(chunk)
    eligible = regrouped

    stats = summarize(rows, eligible, blocked)
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
            # Normalize age reason to one key for reporting
            if r.startswith("устаревшая запись"):
                reason_tag_counts["устаревшая запись"] += 1
            elif r.startswith("низкая confidence"):
                reason_tag_counts["низкая confidence"] += 1
            elif r.startswith("неподдерживаемый тип"):
                reason_tag_counts["неподдерживаемый тип"] += 1
            else:
                reason_tag_counts[r] += 1

    entity_dist = Counter((r.get("entity_type") or "null") for r in rows)
    target_dist = Counter((r.get("target_collection") or "null") for r in rows)
    contact_dist = Counter(
        contact_kind_label(extract_direct_contacts(r)) for r in rows
    )
    eligible_contact = Counter(i["contact_kind"] for i in eligible)

    return {
        "accepted_total": len(rows),
        "with_direct_contact": with_direct,
        "eligible": len(eligible),
        "blocked": len(blocked),
        "blocked_duplicates": primary_counts.get("дубликаты", 0),
        "blocked_stale": primary_counts.get("устаревшие", 0),
        "blocked_unsupported": primary_counts.get("неподдерживаемые типы", 0),
        "blocked_no_contact": primary_counts.get("нет контакта", 0),
        "blocked_no_title": primary_counts.get("нет title", 0),
        "blocked_no_description": primary_counts.get("нет description", 0),
        "blocked_no_category": primary_counts.get("нет category", 0),
        "blocked_no_city": primary_counts.get("нет города", 0),
        "blocked_low_confidence": primary_counts.get("низкая confidence", 0),
        "blocked_manual": primary_counts.get("требуется ручная проверка", 0),
        "entity_type": dict(entity_dist),
        "target_collection": dict(target_dist),
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
    print(f"accepted total:              {stats['accepted_total']}")
    print(f"with direct contact:         {stats['with_direct_contact']}")
    print(f"passed all criteria:         {stats['eligible']}")
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
    print("target_collection:", json.dumps(stats["target_collection"], ensure_ascii=False))
    print("contacts (all accepted):", json.dumps(stats["contacts_all_accepted"], ensure_ascii=False))
    print("contacts (eligible):", json.dumps(stats["contacts_eligible"], ensure_ascii=False))
    print()
    print(f"TOP candidates (showing {len(show)}):")
    for i, item in enumerate(show, 1):
        row = item["row"]
        c = item["result"]["contacts"]
        title = row.get("title") or row.get("business_name") or row.get("person_name")
        print(
            f"{i:02d}. [{item['contact_kind']}] conf={item['result']['confidence']:.2f} "
            f"{row.get('entity_type')}/{row.get('target_collection')} | {title!r} | "
            f"city={row.get('city')!r} phone={c.get('phone')} ig={c.get('instagram')} "
            f"web={c.get('website')} tg={c.get('telegram_username')!r} "
            f"posted={row.get('source_posted_at')}"
        )

    print()
    print("Exclusion reason samples (up to 15 unique reason sets):")
    seen: set[str] = set()
    shown = 0
    for item in blocked:
        key = " | ".join(item["result"]["reasons"])
        if key in seen:
            continue
        seen.add(key)
        title = (
            item["row"].get("title")
            or item["row"].get("business_name")
            or item["row"].get("person_name")
        )
        print(f"- {title!r}: {key}")
        shown += 1
        if shown >= 15:
            break


def upsert_ready_rows(
    client: SupabaseRest, items: list[dict[str, Any]]
) -> dict[str, str]:
    """Insert/update import_review_items as ready_to_publish. Returns fingerprint→id."""
    fp_to_id: dict[str, str] = {}
    to_insert: list[dict[str, Any]] = []
    for item in items:
        row = dict(item["row"])
        row.pop("_raw_post", None)
        existing_id = row.get("id")
        contacts = item["result"]["contacts"]
        # persist normalized contacts
        row["phone"] = contacts.get("phone") or []
        row["whatsapp"] = contacts.get("whatsapp") or []
        row["instagram"] = contacts.get("instagram") or []
        row["website"] = contacts.get("website") or []
        row["email"] = contacts.get("email") or []
        row["telegram_username"] = contacts.get("telegram_username")
        row["review_status"] = "ready_to_publish"
        row["review_notes"] = (
            None
            if item["result"]["eligible"]
            else "Не прошла автопубликацию: " + "; ".join(item["result"]["reasons"])
        )
        if existing_id:
            existing_status = (item["row"].get("review_status") or "").lower()
            if existing_status in {"approved", "rejected", "duplicate"}:
                fp_to_id[row["source_fingerprint"]] = existing_id
                continue
            patch_body = {
                k: v
                for k, v in row.items()
                if k
                not in {
                    "raw_payload",
                    "source_fingerprint",
                    "id",
                    "published_entity_id",
                    "published_entity_type",
                    "published_at",
                    "approved_at",
                }
            }
            client.patch(
                "import_review_items",
                {"id": f"eq.{existing_id}"},
                patch_body,
            )
            fp_to_id[row["source_fingerprint"]] = existing_id
        elif not existing_id:
            to_insert.append(row)

    # mark blocked ones similarly when inserting all accepted
    if to_insert:
        # strip non-table fields
        clean = []
        for row in to_insert:
            r = {k: v for k, v in row.items() if not k.startswith("_")}
            clean.append(r)
        # batch insert
        for i in range(0, len(clean), 50):
            chunk = clean[i : i + 50]
            created = client.insert_many("import_review_items", chunk) or []
            for row, created_row in zip(chunk, created):
                fp_to_id[row["source_fingerprint"]] = created_row["id"]
    return fp_to_id


def publish_one(
    client: SupabaseRest,
    item: dict[str, Any],
    item_id: str,
    *,
    categories: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    row = item["row"]
    contacts = item["result"]["contacts"]
    title = (
        row.get("title")
        or row.get("business_name")
        or row.get("person_name")
        or "Untitled"
    ).strip()
    target = row.get("target_collection")
    description = row.get("description") or ""
    source_posted = row.get("source_posted_at")
    cats = categories if categories is not None else client.fetch_categories()
    cat_match = resolve_category_id(row.get("category"), cats)
    note = AUTO_NOTE
    if cat_match.get("needs_manual"):
        note = (
            f"{AUTO_NOTE}. Требуется ручной выбор категории "
            f"(AI: {row.get('category') or '—'})"
        )

    if target in {
        "businesses",
        "private_specialists",
        "services",
        "organizations",
    }:
        payload = {
            "name": title,
            "slug": slugify(title),
            "short_description": description[:240] or None,
            "description": (
                description
                + (
                    f"\n\nИсточник: Telegram, дата: {source_posted}"
                    if source_posted
                    else ""
                )
            ),
            "phone": (contacts.get("phone") or [None])[0],
            "website": (contacts.get("website") or [None])[0],
            "instagram_url": (
                f"https://instagram.com/{contacts['instagram'][0]}"
                if contacts.get("instagram")
                else None
            ),
            "city": row.get("city") or "Orange County",
            "status": "approved",
            "state_code": "US-CA",
            "region": row.get("state") or "CA",
            "category_id": cat_match.get("category_id"),
        }
        created = client.insert_many("businesses", [payload])
        entity_id = created[0]["id"]
        entity_type = "business"
    elif target in {"marketplace", "real_estate"}:
        # Need an owner — use first admin profile
        admins = client._request(
            "GET",
            "/profiles",
            params={"select": "id", "role": "eq.admin", "limit": "1"},
        )
        if not admins:
            raise RuntimeError("No admin profile to own autopublished listing")
        owner_id = admins[0]["id"]
        entity_id = client.rpc_call(
            "service_autopublish_marketplace_listing",
            {
                "p_owner_id": owner_id,
                "p_title": title,
                "p_description": (
                    description
                    + (
                        f"\n\nИсточник: Telegram, дата: {source_posted}"
                        if source_posted
                        else ""
                    )
                ),
                "p_price_amount": row.get("price"),
                "p_price_currency": row.get("currency") or "USD",
                "p_city": row.get("city") or "Orange County",
                "p_state": row.get("state") or "CA",
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
    else:
        raise RuntimeError(f"Unsupported target for publish: {target}")

    # mark approved + audit (idempotent RPC)
    client.rpc_call(
        "service_import_review_mark_autopublished",
        {
            "p_item_id": item_id,
            "p_published_entity_type": entity_type,
            "p_published_entity_id": entity_id,
            "p_note": note,
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
        print("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    posts = load_accepted_posts(args.source)
    client = SupabaseRest(url, key)
    eligible, blocked, stats = build_candidates(posts, client)

    # Always print report
    print_report(stats, eligible, blocked, 30 if args.dry_run else args.limit)

    if args.dry_run:
        print()
        print("DRY-RUN complete. No writes performed. Apply was NOT run.")
        out = ROOT / "scripts/import-review/data"
        out.mkdir(parents=True, exist_ok=True)
        report_path = out / "autopublish_dry_run_report.json"
        report_path.write_text(
            json.dumps(
                {
                    "stats": stats,
                    "candidates": [
                        {
                            "fingerprint": i["row"]["source_fingerprint"],
                            "title": i["row"].get("title"),
                            "target_collection": i["row"].get("target_collection"),
                            "entity_type": i["row"].get("entity_type"),
                            "contact_kind": i["contact_kind"],
                            "confidence": i["result"]["confidence"],
                            "contacts": i["result"]["contacts"],
                            "source_posted_at": i["row"].get("source_posted_at"),
                        }
                        for i in eligible
                    ],
                    "blocked_sample": [
                        {
                            "title": i["row"].get("title"),
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
    # Only upsert queue rows that are not already terminal (approved/rejected/duplicate).
    all_items = eligible + blocked
    safe_items: list[dict[str, Any]] = []
    for item in all_items:
        status = (item["row"].get("review_status") or "").lower()
        if status in {"approved", "rejected", "duplicate"} and item["row"].get(
            "published_entity_id"
        ):
            # Keep terminal published rows untouched.
            continue
        if not item["result"]["eligible"]:
            item["row"]["review_status"] = "ready_to_publish"
        safe_items.append(item)
    fp_to_id = upsert_ready_rows(client, safe_items)

    # Prefer existing ids for already-published rows (idempotent skip path).
    for item in eligible:
        fp = item["row"]["source_fingerprint"]
        if fp not in fp_to_id and item["row"].get("id"):
            fp_to_id[fp] = item["row"]["id"]

    categories = client.fetch_categories()
    to_publish = eligible[: args.limit] if args.limit else eligible
    published = 0
    skipped = 0
    errors: list[str] = []
    category_mapped = 0
    category_manual: list[str] = []
    for item in to_publish:
        fp = item["row"]["source_fingerprint"]
        item_id = fp_to_id.get(fp) or item["row"].get("id")
        if not item_id:
            errors.append(f"missing id for {fp}")
            continue
        # idempotent: if already approved with entity, skip
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
            result = publish_one(client, item, item_id, categories=categories)
            published += 1
            cm = result.get("category_match") or {}
            if cm.get("needs_manual"):
                category_manual.append(
                    f"{item['row'].get('title')}: AI={item['row'].get('category')}"
                )
            else:
                category_mapped += 1
            print(
                f"published {published}: {item['row'].get('title')} "
                f"category={cm.get('name') or 'MANUAL'}"
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{item['row'].get('title')}: {exc}")

    print(
        f"APPLY done: published={published} skipped_existing={skipped} "
        f"errors={len(errors)} ready_queue_upserted={len(fp_to_id)} "
        f"category_mapped={category_mapped} category_manual={len(category_manual)}"
    )
    for line in category_manual[:20]:
        print(f"  needs category: {line}")
    for e in errors[:20]:
        print(f"  error: {e}")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
