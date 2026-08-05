#!/usr/bin/env python3
"""Additive catalog backfill enrich — does NOT replace queue pre-publish enrich.

Wraps existing published-card enrich scripts:
  - businesses  → enrich_published_businesses.py
  - professionals → enrich_professionals_card_first.py

Queue path (`run_pre_publish_enrich.py` / admin Enrich drawer) stays untouched.

Instagram-only / closed profiles: these scripts cannot invent data — they skip
or fill-empty from public website/source_url only. Do not expect magic.

Usage:
  python3 scripts/business-enrich/run_catalog_backfill_enrich.py --dry-run --limit 5
  python3 scripts/business-enrich/run_catalog_backfill_enrich.py --apply --kind businesses --limit 10
  python3 scripts/business-enrich/run_catalog_backfill_enrich.py --apply --kind professionals --slug mathwithasya
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BIZ = ROOT / "scripts" / "business-enrich" / "enrich_published_businesses.py"
PRO = ROOT / "scripts" / "business-enrich" / "enrich_professionals_card_first.py"


def _run(script: Path, extra: list[str]) -> int:
    if not script.is_file():
        print(f"missing script: {script}", file=sys.stderr)
        return 2
    cmd = [sys.executable, str(script), *extra]
    print("+", " ".join(cmd), flush=True)
    return subprocess.call(cmd, cwd=str(ROOT))


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Catalog backfill enrich (additive; queue enrich unchanged)",
    )
    ap.add_argument(
        "--kind",
        choices=("all", "businesses", "professionals"),
        default="all",
        help="Which catalog tables to enrich",
    )
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--slug", type=str, default=None)
    args = ap.parse_args()

    flags: list[str] = ["--dry-run" if args.dry_run else "--apply"]
    if args.limit:
        flags += ["--limit", str(args.limit)]
    if args.slug:
        flags += ["--slug", args.slug]

    codes: list[int] = []
    if args.kind in ("all", "businesses"):
        codes.append(_run(BIZ, flags))
    if args.kind in ("all", "professionals"):
        codes.append(_run(PRO, flags))

    return max(codes) if codes else 0


if __name__ == "__main__":
    raise SystemExit(main())
