#!/usr/bin/env python3
"""Facebook Groups → import_review_items PoC collector.

Modes:
  A) --dataset-id   read existing Apify dataset
  B) --actor-id     start Actor for one group URL, then read dataset
  C) --input/--fixture  offline local JSON (no Apify; for plumbing tests)

Default is dry-run (no DB writes). Use --apply to insert pending review rows only.
Never autopublishes to businesses/listings.
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
DEFAULT_CONFIG = HERE / "config.example.json"
DEFAULT_OUT = HERE / "data" / "poc" / "facebook_poc_output.json"

for path in (HERE, TG, IR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from adapters import get_adapter  # noqa: E402
from analyzers import RuleBasedAnalyzer  # noqa: E402
from common import SupabaseRest, load_env  # noqa: E402
from dedupe import apply_deduplication  # noqa: E402
from fetch_apify_dataset import (  # noqa: E402
    ApifyError,
    fetch_dataset_items,
    run_actor_and_fetch_items,
)
from map_review import map_facebook_post  # noqa: E402
from normalize_facebook import published_at_passes_since, to_logical_post  # noqa: E402
from validate import build_stats, example_normalized_redacted  # noqa: E402


def _load_json_rows(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        for key in ("posts", "items", "data", "dataset"):
            if isinstance(data.get(key), list):
                return [r for r in data[key] if isinstance(r, dict)]
    raise SystemExit(f"Unsupported JSON shape in {path}")


def _load_config(path: Path | None) -> dict[str, Any]:
    cfg_path = path or DEFAULT_CONFIG
    if not cfg_path.is_file():
        return {}
    return json.loads(cfg_path.read_text(encoding="utf-8"))


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


def _dedupe_fingerprints(
    posts: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    dupes = 0
    for post in posts:
        fp = post.get("source_fingerprint")
        if not fp:
            continue
        if fp in seen:
            dupes += 1
            continue
        seen.add(fp)
        unique.append(post)
    return unique, dupes


def main() -> int:
    parser = argparse.ArgumentParser(description="Facebook Groups collector PoC")
    parser.add_argument("--dataset-id", default=None, help="Existing Apify dataset id")
    parser.add_argument("--actor-id", default=None, help="Apify Actor id (username~name)")
    parser.add_argument("--group-url", default=None, help="Facebook group URL")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Do not write to DB (default if --apply is omitted)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Insert pending rows into import_review_items",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--since", default=None, help="Keep posts with published_at >= since")
    parser.add_argument(
        "--adapter",
        default=None,
        help="Adapter name (default from config / generic_apify_group)",
    )
    parser.add_argument(
        "--analyzer",
        choices=("rule_based", "llm"),
        default="rule_based",
        help="PoC default rule_based; use llm for quality check",
    )
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument(
        "--fixture",
        action="store_true",
        help="Offline sample Apify-shaped fixture (no Apify token)",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Local dataset JSON (offline / exported Apify items)",
    )
    args = parser.parse_args()

    # Default dry-run unless --apply
    if args.apply and args.dry_run:
        print("Use only one of --dry-run / --apply", file=sys.stderr)
        return 2
    do_apply = bool(args.apply)
    dry_run = not do_apply  # default dry-run

    load_env()
    cfg = _load_config(args.config)

    dataset_id = args.dataset_id or os.environ.get("FACEBOOK_DATASET_ID") or None
    actor_id = args.actor_id or os.environ.get("APIFY_ACTOR_ID") or None
    group_url = args.group_url or os.environ.get("FACEBOOK_GROUP_URL") or None
    adapter_name = (
        args.adapter
        or cfg.get("adapter")
        or ("seed_entities" if args.input and "facebook_entities" in str(args.input) else None)
        or "generic_apify_group"
    )
    if args.fixture:
        adapter_name = "generic_apify_group"

    apify_meta: dict[str, Any] | None = None
    source_label: str

    try:
        if args.fixture:
            raw_rows = _load_json_rows(DEFAULT_FIXTURE)
            source_label = f"fixture:{DEFAULT_FIXTURE}"
        elif args.input:
            raw_rows = _load_json_rows(args.input)
            source_label = f"input:{args.input}"
        elif dataset_id:
            raw_rows = fetch_dataset_items(dataset_id, limit=args.limit)
            source_label = f"dataset:{dataset_id}"
            apify_meta = {"dataset_id": dataset_id, "item_count": len(raw_rows)}
        elif actor_id:
            if not group_url:
                print("--group-url or FACEBOOK_GROUP_URL required with --actor-id", file=sys.stderr)
                return 2
            template = cfg.get("actor_input_template") or {}
            raw_rows, apify_meta = run_actor_and_fetch_items(
                actor_id=actor_id,
                group_url=group_url,
                limit=args.limit,
                template=template,
            )
            source_label = f"actor:{actor_id}"
        else:
            print(
                "Provide --fixture, --input, --dataset-id, or --actor-id "
                "(+ --group-url). See README.md.",
                file=sys.stderr,
            )
            return 2
    except ApifyError as exc:
        print(f"Apify error: {exc}", file=sys.stderr)
        return 1

    adapter = get_adapter(adapter_name)
    normalized = []
    skipped = 0
    empty_count = 0
    for row in raw_rows:
        post = adapter.parse_row(row)
        if post is None:
            skipped += 1
            continue
        if not published_at_passes_since(post.published_at, args.since):
            skipped += 1
            continue
        if post.empty:
            empty_count += 1
        normalized.append(post)

    logical = [to_logical_post(p) for p in normalized]
    before_fp = len(logical)
    logical, fp_dupes = _dedupe_fingerprints(logical)
    if args.limit:
        logical = logical[: args.limit]

    analyzed = _analyze(logical, args.analyzer)
    apply_deduplication(analyzed)
    review_rows = [map_facebook_post(p) for p in analyzed]

    # Persist local artifacts (no secrets)
    out_path: Path = args.output
    out_path.parent.mkdir(parents=True, exist_ok=True)
    artifact = {
        "source": source_label,
        "adapter": adapter_name,
        "analyzer": args.analyzer,
        "apify": apify_meta,
        "normalized": [p.to_dict(include_raw=False) for p in normalized[: args.limit]],
        "analyzed_decisions": [
            {
                "source_fingerprint": p.get("source_fingerprint"),
                "decision": p.get("decision"),
                "classification": p.get("classification"),
                "confidence": p.get("confidence"),
            }
            for p in analyzed
        ],
        "review_preview": [
            {
                "source_fingerprint": r["source_fingerprint"],
                "ai_decision": r.get("ai_decision"),
                "title": r.get("title"),
                "source_url": r.get("source_url"),
            }
            for r in review_rows
        ],
    }
    out_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")

    inserted = 0
    skipped_existing = 0
    if do_apply:
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
        skipped_existing = len(review_rows) - len(to_insert)
        if to_insert:
            client.insert_many("import_review_items", to_insert)
        inserted = len(to_insert)

    stats = build_stats(
        raw_count=len(raw_rows),
        skipped_adapter=skipped,
        normalized=[p.to_dict(include_raw=False) for p in normalized],
        empty_count=empty_count,
        fingerprint_dupes_dropped=fp_dupes + max(0, before_fp - len(logical) - fp_dupes),
        analyzed=analyzed,
        review_rows=review_rows,
        insert_attempted=len(review_rows) if do_apply else 0,
        insert_skipped_existing=skipped_existing,
        inserted=inserted,
    )
    # Fix fingerprint dupe count to the actual dropped count
    stats["fingerprint_duplicates_dropped"] = fp_dupes
    stats["limited_to"] = len(logical)

    report = {
        "mode": "apply" if do_apply else "dry-run",
        "source": source_label,
        "adapter": adapter_name,
        "analyzer": args.analyzer,
        "apify": apify_meta,
        "stats": stats,
        "example_normalized_post": example_normalized_redacted(
            normalized[0].to_dict(include_raw=False) if normalized else None
        ),
        "output": str(out_path),
        "db_migration_needed": False,
        "db_migration_notes": (
            "Existing import_review_items columns suffice: source, source_url, "
            "source_fingerprint (unique), source_text, source_posted_at, source_media, "
            "raw_payload (holds source_post_id, source_group_url, normalized_payload, "
            "classification). No migration required for PoC."
        ),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
