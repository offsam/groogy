#!/usr/bin/env python3
"""Enqueue Telegram event_ad posts → import_comment_recommendations (pending).

Telegram events also arrive via import_review_items (entity_type=event) and
appear in Inbox Events view. This script mirrors reviewer JSON event_ad rows
into the recommendation pending channel used by Eventbrite/FB.

Never publishes to public.events.

Usage:
  python3 scripts/telegram-collector/enqueue_telegram_events.py path/to/reviewer.json
  python3 scripts/telegram-collector/enqueue_telegram_events.py path/to/reviewer.json --apply
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402

CITY_BY_GROUP = {
    "fun_for_mom": "Лос-Анджелес",
    "la_orange_county": "Лос-Анджелес",
    "irvine": "Ирвайн",
    "russians_in_la": "Лос-Анджелес",
    "la_rent": "Лос-Анджелес",
    "sacramento": "Сакраменто",
    "san_francisco": "Сан-Франциско",
    "sf_": "Сан-Франциско",
    "san_diego": "Сан-Диего",
    "sd_": "Сан-Диего",
    "ny_": "Нью-Йорк",
    "newyork": "Нью-Йорк",
    "seattle": "Сиэтл",
    "miami": "Майами",
    "houston": "Хьюстон",
    "chicago": "Чикаго",
    "atlanta": "Атланта",
    "denver": "Денвер",
    "philadelphia": "Филадельфия",
    "phoenix": "Финикс",
    "boston": "Бостон",
}


def city_for_source(source: str | None, chat_title: str | None) -> str | None:
    blob = f"{source or ''} {chat_title or ''}".lower()
    for key, city in CITY_BY_GROUP.items():
        if key in blob.replace("-", "_"):
            return city
    return None


def extract_posts(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [p for p in payload if isinstance(p, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("posts", "items", "results", "reviewed_posts"):
        val = payload.get(key)
        if isinstance(val, list):
            return [p for p in val if isinstance(p, dict)]
    return []


def is_event_post(post: dict[str, Any]) -> bool:
    classification = str(post.get("classification") or "").lower()
    if classification == "event_ad":
        return True
    entity = post.get("extracted_entity") or {}
    if isinstance(entity, dict):
        if str(entity.get("entity_type") or "").lower() == "event":
            return True
        if str(entity.get("target_collection") or "").lower() == "events":
            return True
    return False


def cluster_key_for(post: dict[str, Any]) -> str:
    chat = post.get("source_chat_id") or post.get("chat_id") or "tg"
    mid = (
        post.get("primary_message_id")
        or post.get("message_id")
        or (post.get("source_message_ids") or [None])[0]
    )
    if mid is not None:
        return f"tg-event:{chat}:{mid}"
    text = (post.get("merged_text") or post.get("text") or "")[:120]
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]
    return f"tg-event:{chat}:{digest}"


def normalize_post(post: dict[str, Any]) -> dict[str, Any] | None:
    if not is_event_post(post):
        return None
    entity = post.get("extracted_entity") if isinstance(post.get("extracted_entity"), dict) else {}
    title = (
        (entity.get("business_name") if entity else None)
        or (entity.get("person_name") if entity else None)
        or (post.get("title") if isinstance(post.get("title"), str) else None)
        or (post.get("merged_text") or post.get("text") or "")[:80].strip()
        or "Событие"
    )
    description = (
        (entity.get("description") if entity else None)
        or post.get("merged_text")
        or post.get("text")
    )
    if isinstance(description, str):
        description = description.strip() or None
    else:
        description = None

    websites = []
    for key in ("website", "websites", "links"):
        val = (entity or {}).get(key) if entity else None
        if isinstance(val, list):
            websites.extend(str(x) for x in val if x)
        elif isinstance(val, str) and val.startswith("http"):
            websites.append(val)
    phones = []
    phone_val = (entity or {}).get("phone") if entity else None
    if isinstance(phone_val, list):
        phones = [str(x) for x in phone_val if x]
    elif isinstance(phone_val, str) and phone_val.strip():
        phones = [phone_val.strip()]

    source = str(post.get("source") or post.get("source_key") or "telegram")
    chat_title = post.get("chat_title")
    city = (
        (entity or {}).get("city")
        or city_for_source(source, chat_title)
    )
    posted = (
        post.get("message_date_start")
        or post.get("message_date")
        or (entity or {}).get("source_date")
    )
    event_at = (entity or {}).get("event_at") or (entity or {}).get("date")
    cluster_key = cluster_key_for(post)
    external_id = cluster_key.replace("tg-event:", "")

    return {
        "cluster_key": cluster_key,
        "kind": "event",
        "display_name": str(title)[:200],
        "phones": phones,
        "instagram": [],
        "websites": websites[:5],
        "mention_count": 1,
        "third_party_mention_count": 0,
        "self_ad_mention_count": 1,
        "comment_texts": [description] if description else [str(title)],
        "request_snippets": [description] if description else [],
        "source_post_urls": [],
        "source_groups": [chat_title] if chat_title else [source],
        "category_guess": "other",
        "category": "other",
        "recommender_names": [],
        "last_posted_at": posted,
        "event_at": str(event_at).strip() if event_at else None,
        "city": city,
        "state_code": None,
        "directory_source": source if source.startswith("telegram") else f"telegram:{source}",
        "target_bucket": "other",
        "source_channel": "telegram",
        "external_source": "telegram",
        "external_id": external_id[:120],
        "source_language": "ru",
        "status": "pending",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def upsert_rows(client: SupabaseRest, rows: list[dict[str, Any]]) -> dict[str, int]:
    stats = {"inserted": 0, "updated": 0, "skipped": 0, "errors": 0}
    for row in rows:
        existing = client._request(
            "GET",
            "/import_comment_recommendations",
            params={
                "select": "id,status",
                "source_channel": "eq.telegram",
                "cluster_key": f"eq.{row['cluster_key']}",
                "limit": "1",
            },
        )
        if existing:
            cur = existing[0]
            if cur.get("status") in {"approved", "rejected", "merged"}:
                stats["skipped"] += 1
                continue
            try:
                client._request(
                    "PATCH",
                    "/import_comment_recommendations",
                    params={"id": f"eq.{cur['id']}"},
                    body={k: v for k, v in row.items() if k != "status"},
                    prefer="return=minimal",
                )
                stats["updated"] += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  update fail {row['cluster_key']}: {exc}", flush=True)
                stats["errors"] += 1
            continue
        try:
            client._request(
                "POST",
                "/import_comment_recommendations",
                body=row,
                prefer="return=minimal",
            )
            stats["inserted"] += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  insert fail {row['cluster_key']}: {exc}", flush=True)
            stats["errors"] += 1
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Reviewer JSON path")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"File not found: {args.input}", file=sys.stderr)
        return 2

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    posts = extract_posts(payload)
    rows = []
    for post in posts:
        row = normalize_post(post)
        if row:
            rows.append(row)

    # Dedup by cluster_key
    by_key = {r["cluster_key"]: r for r in rows}
    rows = list(by_key.values())
    print(f"event_ad candidates: {len(rows)} / posts={len(posts)}")

    if not args.apply:
        for row in rows[:20]:
            print(f"  - {row['cluster_key']}: {row['display_name'][:70]}")
        if len(rows) > 20:
            print(f"  … +{len(rows) - 20} more")
        print("Dry-run only. Pass --apply to enqueue pending.")
        return 0

    load_env()
    client = SupabaseRest.from_env()
    stats = upsert_rows(client, rows)
    print(f"Done: {stats}")
    print("Review in Admin → Inbox → Events — ждут выкладки.")
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
