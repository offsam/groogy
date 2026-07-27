#!/usr/bin/env python3
"""P2–P4 orchestrator — the ONE entry point for queue maintenance.

Runs the canonical order from CARD_PROCESSING_ARCHITECTURE_V1 §2:

  P2a  hydrate_queue_media.py         (photos + telegram contact backfill)
  P2b  run_enrichment_pipeline.py     (source_text → website → directories,
                                       per entity type: business/professional/listing)
  P3   classify_null_queue.py         (NULL backlog → typed or [needs_manual_type])
  P4   dedupe_open_queue.py           (repost clusters → duplicates marked)

Every step is idempotent (fill-empty / NULL-guarded / fingerprint-keyed), so
re-running this wrapper is always safe. Dry-run is the default; nothing writes
without --apply. A failing step aborts the run (later stages assume earlier ones).

Usage:
  python3 scripts/import-review/process_queue_batch.py             # dry-run, all steps
  python3 scripts/import-review/process_queue_batch.py --apply
  python3 scripts/import-review/process_queue_batch.py --apply --limit 200
  python3 scripts/import-review/process_queue_batch.py --skip media,dedupe
  python3 scripts/import-review/process_queue_batch.py --no-website   # offline extract
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = sys.executable or "python3"
# hydrate_queue_media downloads Telegram photos → needs telethon, which lives
# only in the collector venv (documented in ENRICHMENT_INFRASTRUCTURE_V1 §1).
TELETHON_PY = ROOT / "scripts" / "telegram-collector" / ".venv" / "bin" / "python"
MEDIA_PY = str(TELETHON_PY) if TELETHON_PY.exists() else PY

STEP_ORDER = ("media", "extract", "classify", "dedupe")


def build_steps(args: argparse.Namespace) -> list[tuple[str, list[list[str]]]]:
    mode = ["--apply"] if args.apply else ["--dry-run"]
    limit = ["--limit", str(args.limit)] if args.limit else []

    extract_cmds = []
    for entity in ("business", "professional", "listing"):
        cmd = [PY, "scripts/business-enrich/run_enrichment_pipeline.py", "--entity", entity]
        # run_enrichment_pipeline is dry-run by default; only pass --apply
        if args.apply:
            cmd.append("--apply")
        if args.limit:
            cmd += ["--limit", str(args.limit)]
        if args.no_website:
            cmd.append("--no-website")
        extract_cmds.append(cmd)

    classify_cmds = [[PY, "scripts/import-review/classify_null_queue.py"]]
    if args.apply:
        # per NULL_CLASSIFICATION_ALGORITHM_V1 §4: HIGH auto-applies, the rest is tagged
        classify_cmds = [
            [PY, "scripts/import-review/classify_null_queue.py", "--apply-high", "--tag-rest"]
        ]

    return [
        ("media", [[MEDIA_PY, "scripts/import-review/hydrate_queue_media.py", *mode, *limit]]),
        ("extract", extract_cmds),
        ("classify", classify_cmds),
        ("dedupe", [[PY, "scripts/import-review/dedupe_open_queue.py", *mode]]),  # no --limit flag
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    parser.add_argument("--limit", type=int, default=0, help="cap rows per step (0 = step defaults)")
    parser.add_argument("--skip", default="", help=f"comma-separated steps to skip ({','.join(STEP_ORDER)})")
    parser.add_argument("--no-website", action="store_true", help="offline extract (skip website fetches)")
    args = parser.parse_args()

    skip = {s.strip() for s in args.skip.split(",") if s.strip()}
    unknown = skip - set(STEP_ORDER)
    if unknown:
        parser.error(f"unknown steps in --skip: {sorted(unknown)}")

    print(f"process_queue_batch: mode={'APPLY' if args.apply else 'dry-run'} "
          f"limit={args.limit or 'default'} skip={sorted(skip) or 'none'}")

    for name, cmds in build_steps(args):
        if name in skip:
            print(f"\n=== {name}: SKIPPED")
            continue
        for cmd in cmds:
            print(f"\n=== {name}: {' '.join(cmd[1:])}")
            started = time.time()
            result = subprocess.run(cmd, cwd=ROOT)
            print(f"=== {name}: exit {result.returncode} in {time.time() - started:.0f}s")
            if result.returncode != 0:
                print(f"ABORT: step '{name}' failed — later stages assume earlier ones succeeded")
                return result.returncode
    print("\nprocess_queue_batch: all steps completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
