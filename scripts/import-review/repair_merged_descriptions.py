#!/usr/bin/env python3
"""Rebuild merged descriptions for already auto-merged primary cards.

Pulls unique texts from the primary + its duplicate_of children and writes
one coherent description via description_merge.merge_descriptions.

Usage:
  python3 scripts/import-review/repair_merged_descriptions.py --dry-run --limit 20
  python3 scripts/import-review/repair_merged_descriptions.py --apply --limit 100
  python3 scripts/import-review/repair_merged_descriptions.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402
from description_merge import merge_descriptions  # noqa: E402

OPEN = ("pending", "in_review", "needs_more_info", "ready_to_publish")


def fetch_primaries(client: SupabaseRest, *, limit: int | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": "id,title,business_name,description,source_text,occurrence_count,review_notes",
                    "review_status": f"in.({','.join(OPEN)})",
                    "review_notes": "ilike.*auto-merge*",
                    "order": "occurrence_count.desc",
                    "offset": str(offset),
                    "limit": "100",
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if limit is not None and len(rows) >= limit:
            return rows[:limit]
        if len(batch) < 100:
            break
    return rows


def fetch_duplicates(client: SupabaseRest, primary_id: str) -> list[dict[str, Any]]:
    return (
        client._request(
            "GET",
            "/import_review_items",
            params={
                "select": "id,title,description,source_text",
                "duplicate_of_item_id": f"eq.{primary_id}",
                "limit": "80",
            },
        )
        or []
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Repair merged descriptions")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    primaries = fetch_primaries(client, limit=args.limit)
    print(json.dumps({"primaries": len(primaries), "mode": "dry_run" if args.dry_run else "apply"}))

    changed = 0
    skipped = 0
    samples: list[dict[str, Any]] = []

    for primary in primaries:
        dups = fetch_duplicates(client, primary["id"])
        rows = [primary, *dups]
        title = primary.get("business_name") or primary.get("title")
        merged = merge_descriptions(rows, title=title if isinstance(title, str) else None)
        old = (primary.get("description") or "").strip()
        if not merged or merged == old:
            skipped += 1
            continue
        changed += 1
        if len(samples) < 8:
            samples.append(
                {
                    "id": primary["id"],
                    "title": title,
                    "dups": len(dups),
                    "old_len": len(old),
                    "new_len": len(merged),
                    "old_preview": old[:160].replace("\n", " | "),
                    "new_preview": merged[:220].replace("\n", " | "),
                }
            )
        if args.apply:
            client.patch(
                "import_review_items",
                {"id": f"eq.{primary['id']}"},
                {"description": merged},
            )

    print(json.dumps({"changed": changed, "skipped": skipped, "samples": samples}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
