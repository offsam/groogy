#!/usr/bin/env python3
"""Reclassify open queue items into lechu / transfers by text heuristics.

Usage:
  python3 scripts/import-review/reclassify_lechu_transfers.py --dry-run
  python3 scripts/import-review/reclassify_lechu_transfers.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from reviewer import LECHU_RE, TRANSFER_RE, TRANSLATOR_NOISE_RE  # noqa: E402

OPEN = ("pending", "in_review", "needs_more_info", "ready_to_publish")


def blob_of(row: dict[str, Any]) -> str:
    return "\n".join(
        [
            str(row.get("title") or ""),
            str(row.get("business_name") or ""),
            str(row.get("description") or ""),
            str(row.get("source_text") or ""),
        ]
    )


def classify(row: dict[str, Any]) -> tuple[str, str] | None:
    """Return (entity_type, target_collection) or None."""
    text = blob_of(row)
    if LECHU_RE.search(text):
        if re.search(
            r"лечу|летим|летит|#лечу|возьму|заберу\s+и\s+привезу|передам\s+|посыл|документ|чемодан|packages?",
            text,
            re.I,
        ):
            return "lechu_listing", "lechu"
    if TRANSFER_RE.search(text) and not TRANSLATOR_NOISE_RE.search(text):
        return "transfer_listing", "transfers"
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
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

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": (
                        "id,title,business_name,description,source_text,"
                        "entity_type,target_collection,review_status"
                    ),
                    "review_status": f"in.({','.join(OPEN)})",
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

    changes: list[dict[str, Any]] = []
    for row in rows:
        hit = classify(row)
        if not hit:
            continue
        entity_type, target = hit
        if row.get("entity_type") == entity_type and row.get("target_collection") == target:
            continue
        changes.append(
            {
                "id": row["id"],
                "title": row.get("title") or row.get("business_name"),
                "from": {
                    "entity_type": row.get("entity_type"),
                    "target_collection": row.get("target_collection"),
                },
                "to": {"entity_type": entity_type, "target_collection": target},
            }
        )
        if args.limit is not None and len(changes) >= args.limit:
            break

    print(
        json.dumps(
            {
                "scanned": len(rows),
                "to_update": len(changes),
                "lechu": sum(1 for c in changes if c["to"]["target_collection"] == "lechu"),
                "transfers": sum(
                    1 for c in changes if c["to"]["target_collection"] == "transfers"
                ),
                "mode": "dry_run" if args.dry_run else "apply",
                "sample": changes[:20],
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    if args.dry_run:
        out = (
            ROOT
            / "scripts"
            / "import-review"
            / "data"
            / "reclassify_lechu_transfers_dry_run.json"
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(changes, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote {out}")
        return 0

    ok = 0
    for c in changes:
        client.patch(
            "import_review_items",
            {"id": f"eq.{c['id']}"},
            {
                "entity_type": c["to"]["entity_type"],
                "target_collection": c["to"]["target_collection"],
                "review_notes": (
                    f"[reclassify] {c['from']['target_collection']} → {c['to']['target_collection']}"
                ),
            },
        )
        ok += 1
    print(json.dumps({"updated": ok}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
