#!/usr/bin/env python3
"""Delete linked duplicate rows from import_review_items.

Primaries already hold unioned contacts/services/descriptions from merge.
Linked secondaries (review_status=duplicate + duplicate_of_item_id set)
are safe to remove — audit rows cascade.

Usage:
  python3 scripts/import-review/purge_linked_duplicates.py          # dry-run
  python3 scripts/import-review/purge_linked_duplicates.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402


def fetch_linked_duplicates(client: SupabaseRest) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": "id,duplicate_of_item_id,review_notes,title,source",
                    "review_status": "eq.duplicate",
                    "duplicate_of_item_id": "not.is.null",
                    "order": "id",
                    "offset": str(offset),
                    "limit": "1000",
                },
            )
            or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def delete_ids(client: SupabaseRest, ids: list[str]) -> int:
    deleted = 0
    # PostgREST: delete in chunks via in.(...)
    chunk = 100
    for i in range(0, len(ids), chunk):
        part = ids[i : i + chunk]
        client._request(
            "DELETE",
            "/import_review_items",
            params={"id": f"in.({','.join(part)})"},
            prefer="return=minimal",
        )
        deleted += len(part)
        print(f"  deleted {deleted}/{len(ids)}")
    return deleted


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    client = SupabaseRest(url, key)
    rows = fetch_linked_duplicates(client)
    auto = sum(1 for r in rows if "[auto-merge" in (r.get("review_notes") or ""))
    print(f"linked duplicates: {len(rows)} (auto-merge notes: {auto})")

    out = ROOT / "scripts" / "import-review" / "data" / "purge_linked_duplicates_report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "count": len(rows),
                "auto_merge_notes": auto,
                "sample_ids": [r["id"] for r in rows[:20]],
                "applied": bool(args.apply),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"report: {out}")

    if not args.apply:
        print("dry-run only; pass --apply to delete")
        return 0

    deleted = delete_ids(client, [r["id"] for r in rows])
    print(f"done: deleted {deleted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
