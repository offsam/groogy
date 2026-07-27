#!/usr/bin/env python3
"""Media Pipeline v1 for published Fun for Mom + LA Orange County cards.

Usage:
  python3 scripts/media-pipeline/run_media_pipeline.py --dry-run
  python3 scripts/media-pipeline/run_media_pipeline.py --apply --limit 10
  python3 scripts/media-pipeline/run_media_pipeline.py --apply
  python3 scripts/media-pipeline/run_media_pipeline.py --apply --ids id1,id2
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import load_env  # noqa: E402
from pipeline import (  # noqa: E402
    apply_plan,
    fetch_published_items,
    load_existing_images,
    load_listing_owners,
    pick_control_ten,
    plan_to_dict,
    resolve_candidate,
    summarize,
)
from storage_client import MediaSupabase  # noqa: E402
from telegram_photos import TelegramPhotoClient  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Media Pipeline v1")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--ids",
        type=str,
        default=None,
        help="Comma-separated published entity UUIDs to process",
    )
    parser.add_argument(
        "--control-ten",
        action="store_true",
        help="Apply only the curated diverse control set of 10",
    )
    parser.add_argument(
        "--no-telegram",
        action="store_true",
        help="Skip Telegram downloads",
    )
    parser.add_argument(
        "--fast-dry",
        action="store_true",
        help="Dry-run without probing Instagram/website HTTP",
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
        print("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    client = MediaSupabase(url, key)
    items = fetch_published_items(client)
    print(f"Published items loaded: {len(items)}")

    existing = load_existing_images(client, items)
    listing_ids = [
        i["published_entity_id"]
        for i in items
        if i.get("published_entity_type") == "listing"
    ]
    listing_owners = load_listing_owners(client, listing_ids)

    tg: TelegramPhotoClient | None = None
    if not args.no_telegram:
        tg = TelegramPhotoClient()
        try:
            tg.connect()
            print("Telegram session connected")
        except Exception as exc:
            print(f"Telegram unavailable ({type(exc).__name__}); continuing without it")
            tg = None

    # Dry-run: confirm Telegram photo presence (no download) + optional HTTP probe.
    # Apply: download Telegram bytes + HTTP probe.
    probe_remote = args.apply or not args.fast_dry
    download_telegram = bool(args.apply)
    plans = []
    try:
        for item in items:
            eid = item["published_entity_id"]
            plan = resolve_candidate(
                item,
                already_has_image=bool(existing.get(eid)),
                tg=tg,
                probe_remote=probe_remote,
                download_telegram=download_telegram,
            )
            plans.append(plan)
    finally:
        if tg:
            tg.close()

    if args.ids:
        wanted = {x.strip() for x in args.ids.split(",") if x.strip()}
        plans = [p for p in plans if p.entity_id in wanted]
    elif args.control_ten:
        plans = pick_control_ten(plans)
        print(f"Control-ten selected: {len(plans)}")
    elif args.limit:
        # Prefer actionable first
        actionable = [p for p in plans if not p.skip_reason]
        rest = [p for p in plans if p.skip_reason]
        plans = (actionable + rest)[: args.limit]

    report_dir = ROOT / "scripts" / "media-pipeline" / "data"
    report_dir.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        stats = summarize(plans)
        print("\n=== Media Pipeline dry-run ===")
        print(json.dumps(stats, ensure_ascii=False, indent=2))
        print("\nBy source:")
        for k, v in sorted(stats["by_source"].items(), key=lambda x: -x[1]):
            print(f"  {k}: {v}")
        out = {
            "stats": stats,
            "candidates": [plan_to_dict(p) for p in plans],
        }
        path = report_dir / "media_pipeline_dry_run.json"
        path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nWrote {path}")
        print("DRY-RUN complete. No Storage/DB writes.")
        return 0

    # APPLY — reconnect telegram if needed for bytes
    tg2: TelegramPhotoClient | None = None
    if not args.no_telegram:
        tg2 = TelegramPhotoClient()
        try:
            tg2.connect()
        except Exception:
            tg2 = None

    applied = []
    try:
        # Re-resolve with probe for selected plans to get bytes
        id_set = {p.entity_id for p in plans}
        item_by_id = {i["published_entity_id"]: i for i in items}
        fresh_plans = []
        for eid in [p.entity_id for p in plans]:
            item = item_by_id[eid]
            plan = resolve_candidate(
                item,
                already_has_image=bool(existing.get(eid)),
                tg=tg2,
                probe_remote=True,
                download_telegram=True,
            )
            fresh_plans.append(plan)

        for plan in fresh_plans:
            try:
                apply_plan(client, plan, listing_owners=listing_owners)
            except Exception as exc:
                plan.apply_status = f"error:{type(exc).__name__}"
                plan.notes.append(str(exc)[:200])
            applied.append(plan)
            print(
                f"[{plan.apply_status}] {plan.entity_type} {plan.title!r} "
                f"via {plan.chosen_source} → {plan.public_url or '-'}"
            )
    finally:
        if tg2:
            tg2.close()

    stats = summarize(applied)
    print("\n=== Media Pipeline apply summary ===")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    path = report_dir / (
        "media_pipeline_control_apply.json"
        if args.control_ten or (args.limit and args.limit <= 10)
        else "media_pipeline_full_apply.json"
    )
    path.write_text(
        json.dumps(
            {"stats": stats, "results": [plan_to_dict(p) for p in applied]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
