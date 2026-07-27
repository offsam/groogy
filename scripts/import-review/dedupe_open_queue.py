#!/usr/bin/env python3
"""Orchestrate open-queue dedupe against published businesses + within-queue clusters.

Typical flow (safe → aggressive):
  1) Merge queue cards that match an already-published business
     (phone / IG / website / strong name) → enrich + approve.
  2) Collapse recurring ads inside the open queue into one primary
     (same phone/IG/TG/web/name) → mark secondaries as duplicate.

Usage:
  python3 scripts/import-review/dedupe_open_queue.py --dry-run
  python3 scripts/import-review/dedupe_open_queue.py --apply
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def run(script: str, *extra: str) -> int:
    cmd = [sys.executable, str(ROOT / script), *extra]
    print("\n==>", " ".join(cmd), flush=True)
    return subprocess.call(cmd)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    mode = "--dry-run" if args.dry_run else "--apply"

    rc = run("merge_queue_into_existing.py", mode)
    if rc != 0:
        return rc
    rc = run("merge_pending_clusters.py", mode)
    if rc != 0:
        return rc
    print("\nDone. Review:")
    print("  scripts/import-review/data/merge_queue_into_existing_dry_run.json")
    print("  scripts/import-review/data/merge_pending_clusters_report.json")
    print("  scripts/import-review/data/merge_pending_manual_review.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
