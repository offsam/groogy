#!/usr/bin/env python3
"""Facebook Groups ingest PoC.

Pipeline (Actor-swappable):
  dataset JSON
  → adapter (generic_apify | seed_entities | …)
  → canonical post
  → logical post
  → analyzer (rule_based | llm)
  → entity dedupe
  → import_review_items rows (manual review only)

Usage:
  # Offline fixture PoC (no Apify, no LLM):
  python3 scripts/facebook-collector/run_poc.py --fixture \\
    --analyzer rule_based --dry-run

  # Historical seed texts (same group as business-seed):
  python3 scripts/facebook-collector/run_poc.py \\
    --input scripts/business-seed/data/facebook_entities_posts_1_41.json \\
    --adapter seed_entities --limit 50 --analyzer rule_based --dry-run

  # After a real Apify dataset export:
  python3 scripts/facebook-collector/run_poc.py \\
    --input /path/to/dataset.json --adapter generic_apify_group \\
    --analyzer llm --dry-run

  # Write pending rows to Supabase review queue (no autopublish):
  python3 scripts/facebook-collector/run_poc.py --fixture --analyzer rule_based --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TG = ROOT / "scripts" / "telegram-collector"
IR = ROOT / "scripts" / "import-review"
DEFAULT_FIXTURE = HERE / "fixtures" / "sample_apify_dataset.json"
DEFAULT_OUT = HERE / "data" / "poc"

for path in (HERE, TG, IR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from adapters import get_adapter  # noqa: E402
from analyzers import RuleBasedAnalyzer  # noqa: E402
from common import SupabaseRest, load_env  # noqa: E402
from dedupe import apply_deduplication  # noqa: E402
from map_review import map_facebook_post  # noqa: E402
from normalize import to_logical_post  # noqa: E402


def _load_rows(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        for key in ("posts", "items", "data", "dataset"):
            if isinstance(data.get(key), list):
                return [r for r in data[key] if isinstance(r, dict)]
    raise SystemExit(f"Unsupported JSON shape in {path}")


def _analyze(posts: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    if mode == "rule_based":
        analyzer = RuleBasedAnalyzer()
        return [analyzer.analyze(p) for p in posts]

    if mode != "llm":
        raise SystemExit(f"Unknown analyzer {mode!r}")

    from llm_client import LLMClient
    from run_full import analyze_one, ground_and_guard

    client = LLMClient.from_env()
    out: list[dict[str, Any]] = []
    for post in posts:
        result = analyze_one(client, post)
        result = ground_and_guard(result)
        out.append(result)
    return out


def _dedupe_by_fingerprint(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for post in posts:
        fp = post.get("source_fingerprint")
        if not fp or fp in seen:
            continue
        seen.add(fp)
        unique.append(post)
    return unique


def main() -> int:
    parser = argparse.ArgumentParser(description="Facebook Groups ingest PoC")
    parser.add_argument("--fixture", action="store_true", help="Use sample_apify_dataset.json")
    parser.add_argument("--input", type=Path, help="Apify dataset or seed JSON")
    parser.add_argument(
        "--adapter",
        default="generic_apify_group",
        help="Adapter name (generic_apify_group | seed_entities)",
    )
    parser.add_argument("--limit", type=int, default=100, help="Max posts after normalize")
    parser.add_argument(
        "--analyzer",
        choices=("rule_based", "llm"),
        default="rule_based",
        help="PoC default is rule_based (no LLM spend)",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Insert pending rows into import_review_items",
    )
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    if args.dry_run and args.apply:
        print("Use only one of --dry-run / --apply", file=sys.stderr)
        return 2

    input_path = DEFAULT_FIXTURE if args.fixture else args.input
    if input_path is None:
        print("Provide --fixture or --input PATH", file=sys.stderr)
        return 2
    if args.fixture:
        args.adapter = "generic_apify_group"

    adapter = get_adapter(args.adapter)
    raw_rows = _load_rows(input_path)
    canonical = []
    skipped = 0
    for row in raw_rows:
        post = adapter.parse_row(row)
        if post is None:
            skipped += 1
            continue
        canonical.append(post)

    logical = [to_logical_post(p) for p in canonical]
    logical = _dedupe_by_fingerprint(logical)
    if args.limit:
        logical = logical[: args.limit]

    load_env()
    analyzed = _analyze(logical, args.analyzer)
    apply_deduplication(analyzed)

    review_rows = [map_facebook_post(p) for p in analyzed]
    args.out_dir.mkdir(parents=True, exist_ok=True)
    logical_path = args.out_dir / "poc_logical_posts.json"
    analyzed_path = args.out_dir / "poc_analyzed.json"
    review_path = args.out_dir / "poc_import_review_rows.json"
    logical_path.write_text(
        json.dumps(logical, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    analyzed_path.write_text(
        json.dumps(analyzed, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    review_path.write_text(
        json.dumps(review_rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    decisions: dict[str, int] = {}
    for row in review_rows:
        key = str(row.get("ai_decision") or "none")
        decisions[key] = decisions.get(key, 0) + 1

    summary = {
        "input": str(input_path),
        "adapter": args.adapter,
        "analyzer": args.analyzer,
        "raw_rows": len(raw_rows),
        "skipped_rows": skipped,
        "canonical_posts": len(canonical),
        "logical_after_fingerprint_dedupe": len(logical),
        "review_rows": len(review_rows),
        "decisions": decisions,
        "outputs": {
            "logical": str(logical_path),
            "analyzed": str(analyzed_path),
            "review_rows": str(review_path),
        },
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if args.dry_run:
        print("dry-run: not writing to Supabase")
        return 0

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        return 1

    client = SupabaseRest(url, key)
    fingerprints = [r["source_fingerprint"] for r in review_rows]
    existing = client.fetch_existing(fingerprints)
    to_insert = [
        {k: v for k, v in r.items() if not k.startswith("_")}
        for r in review_rows
        if r["source_fingerprint"] not in existing
    ]
    if to_insert:
        client.insert_many("import_review_items", to_insert)
    print(
        json.dumps(
            {
                "inserted": len(to_insert),
                "skipped_existing": len(review_rows) - len(to_insert),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
