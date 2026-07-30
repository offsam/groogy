#!/usr/bin/env python3
"""Repair one import-review event card from its own source text.

Rebuilds the affiche fields the merge/dedupe passes got wrong:
- description: clean narrative from source_text (no repeated ad header)
- title / business_name: real name instead of a meta label («Контакты»)
- wrong duplicate link: a shared telegram author is not a duplicate

Usage:
  python3 scripts/import-review/repair_event_card.py --id <uuid> --dry-run
  python3 scripts/import-review/repair_event_card.py --id <uuid> --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402
from description_merge import merge_descriptions  # noqa: E402
from entity_title_from_text import apply_title_to_queue  # noqa: E402
from structure_event_from_text import (  # noqa: E402
    event_day_keys,
    same_event_dates,
    structure_event_from_text,
)

SELECT = (
    "id,title,business_name,person_name,description,source_text,entity_type,"
    "review_status,duplicate_status,duplicate_of_item_id,review_notes,"
    "occurrence_count,source_message_ids"
)
OPEN_STATUS = "pending"


def load(client: SupabaseRest, item_id: str) -> dict[str, Any] | None:
    rows = (
        client._request(
            "GET", "/import_review_items", params={"select": SELECT, "id": f"eq.{item_id}"}
        )
        or []
    )
    return rows[0] if rows else None


def build_patch(client: SupabaseRest, item: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}

    children = (
        client._request(
            "GET",
            "/import_review_items",
            params={
                "select": "id,description,source_text",
                "duplicate_of_item_id": f"eq.{item['id']}",
                "limit": "50",
            },
        )
        or []
    )
    # Clean each text first, then merge narratives: the stored description may
    # carry sentences the latest post dropped, and source_text carries the rest.
    narratives = [
        {"description": structure_event_from_text(text).get("description")}
        for row in (item, *children)
        for text in (row.get("source_text"), row.get("description"))
        if (text or "").strip()
    ]
    merged = merge_descriptions(
        [n for n in narratives if n["description"]], title=item.get("title")
    )
    if merged and merged != (item.get("description") or ""):
        patch["description"] = merged

    title_patch, _ = apply_title_to_queue(
        {**item, **patch}, item.get("entity_type") or "event"
    )
    patch.update(title_patch)

    # A shared Telegram author is not a duplicate: only overlapping dates are.
    parent_id = item.get("duplicate_of_item_id")
    if item.get("review_status") == "duplicate" and parent_id:
        parent = load(client, parent_id)
        wrong_link = parent is None or (
            parent.get("entity_type") != item.get("entity_type")
            or not same_event_dates(
                item.get("source_text") or item.get("description"),
                parent.get("source_text") or parent.get("description"),
            )
        )
        if wrong_link:
            patch["review_status"] = OPEN_STATUS
            patch["duplicate_of_item_id"] = None
            patch["duplicate_status"] = "recurring_ad"
            patch["review_notes"] = "\n".join(
                line
                for line in (item.get("review_notes") or "").split("\n")
                if "Дубликат import item" not in line
            ).strip() or None
            patch["reviewed_at"] = datetime.now(timezone.utc).isoformat()
    return patch


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    item = load(client, args.id)
    if not item:
        print(json.dumps({"error": "not_found", "id": args.id}))
        return 1

    patch = build_patch(client, item)
    print(
        json.dumps(
            {
                "id": args.id,
                "dates": event_day_keys(item.get("source_text") or item.get("description")),
                "before": {k: item.get(k) for k in patch},
                "patch": patch,
                "mode": "apply" if args.apply else "dry_run",
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if not patch:
        return 0
    if args.apply:
        client._request(
            "PATCH", "/import_review_items", params={"id": f"eq.{args.id}"}, body=patch
        )
        print("applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
