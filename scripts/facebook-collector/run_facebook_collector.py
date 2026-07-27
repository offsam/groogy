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
from analyzers import RuleBasedAnalyzer, _llm_user_payload  # noqa: E402
from common import SupabaseRest, load_env  # noqa: E402
from contacts import (  # noqa: E402
    extract_emails,
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
    extract_whatsapp,
)
from dedupe import apply_deduplication  # noqa: E402
from facebook_decision_policy import apply_facebook_decision_policy  # noqa: E402
from facebook_llm import build_facebook_llm_client  # noqa: E402
from fetch_apify_dataset import (  # noqa: E402
    ApifyError,
    fetch_dataset_items,
    run_actor_and_fetch_items,
)
from map_review import map_facebook_post  # noqa: E402
from normalize_facebook import published_at_passes_since, to_logical_post  # noqa: E402
from profile_enrichment import enrich_analyzed_posts  # noqa: E402
from schema import empty_entity, empty_evidence, validate_analysis_result  # noqa: E402
from validate import build_stats, example_normalized_redacted  # noqa: E402
from web_enrichment import enrich_from_website_instagram  # noqa: E402
from geo_price_enrichment import enrich_prices_and_city  # noqa: E402


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


def _ground_contacts(post: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    text = post.get("merged_text") or post.get("text") or ""
    entity = result.get("extracted_entity") or empty_entity(post)
    for key, values in {
        "phone": extract_phones(text),
        "email": extract_emails(text),
        "website": extract_websites(text),
        "instagram": extract_instagram(text),
        "telegram": extract_telegram(text),
        "whatsapp": extract_whatsapp(text),
    }.items():
        entity[key] = values
    result["extracted_entity"] = entity
    return result


def _analyze_llm(posts: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Facebook LLM path. Fail loudly if LLM unavailable (no silent final fallback)."""
    try:
        client = build_facebook_llm_client()
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            f"Facebook LLM analyzer required but unavailable: {exc}. "
            "Set OPENROUTER_API_KEY / OPENAI_API_KEY, or pass --analyzer rule_based for smoke tests."
        ) from exc

    meta = {
        "analyzer": "llm",
        "llm_decisions": 0,
        "analyzer_fallback": 0,
        "fallbacks": [],
    }
    out: list[dict[str, Any]] = []
    for post in posts:
        user_payload = _llm_user_payload(post)
        validated = None
        fallback = False
        try:
            data, _usage = client.complete_json(user_payload, repair=False)
            entity = data.get("extracted_entity") or {}
            for key in (
                "phone",
                "email",
                "website",
                "instagram",
                "facebook",
                "telegram",
                "whatsapp",
                "services",
                "prices",
                "service_area",
                "languages",
            ):
                if key in entity and isinstance(entity[key], str):
                    entity[key] = [entity[key]] if entity[key].strip() else []
            data["extracted_entity"] = entity
            validated = validate_analysis_result(data)
            meta["llm_decisions"] += 1
        except Exception as exc:  # noqa: BLE001
            fallback = True
            meta["analyzer_fallback"] += 1
            meta["fallbacks"].append(
                {
                    "fingerprint": post.get("source_fingerprint"),
                    "error": f"{type(exc).__name__}: {str(exc)[:160]}",
                }
            )
            entity = empty_entity(post)
            validated = validate_analysis_result(
                {
                    "classification": "unclear",
                    "decision": "needs_review",
                    "confidence": 0.4,
                    "decision_reason": f"LLM failure marked analyzer_fallback: {type(exc).__name__}",
                    "advertiser_relationship": "unknown",
                    "extracted_entity": entity,
                    "evidence": empty_evidence(),
                    "missing_fields": [],
                    "warnings": [f"analyzer_fallback:{type(exc).__name__}"],
                }
            )

        merged = dict(post)
        merged.update(validated)
        merged = _ground_contacts(post, merged)
        merged = validate_analysis_result(
            {
                "classification": merged.get("classification"),
                "decision": merged.get("decision"),
                "confidence": merged.get("confidence"),
                "decision_reason": merged.get("decision_reason"),
                "advertiser_relationship": merged.get("advertiser_relationship"),
                "extracted_entity": merged.get("extracted_entity"),
                "evidence": merged.get("evidence") or empty_evidence(),
                "missing_fields": merged.get("missing_fields") or [],
                "warnings": merged.get("warnings") or [],
            }
        )
        row = dict(post)
        row.update(merged)
        row["analyzer"] = "llm_facebook"
        row["analyzer_fallback"] = fallback
        row = apply_facebook_decision_policy(row)
        out.append(row)
    return out, meta


def _analyze_rule_based(posts: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    analyzer = RuleBasedAnalyzer()
    out: list[dict[str, Any]] = []
    for post in posts:
        result = analyzer.analyze(post)
        result["analyzer"] = "rule_based"
        result["analyzer_fallback"] = False
        result = apply_facebook_decision_policy(result)
        out.append(result)
    return out, {"analyzer": "rule_based", "llm_decisions": 0, "analyzer_fallback": 0, "fallbacks": []}


def _analyze(posts: list[dict[str, Any]], mode: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if mode == "rule_based":
        return _analyze_rule_based(posts)
    if mode == "llm":
        return _analyze_llm(posts)
    raise SystemExit(f"Unknown analyzer {mode!r}")


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


def _review_update_body(row: dict[str, Any]) -> dict[str, Any]:
    """Fields safe to PATCH on pending rows (raw_payload is immutable in DB)."""
    skip = {
        "raw_payload",
        "source_fingerprint",
        "source",
        "id",
        "created_at",
        "published_entity_id",
        "published_at",
        "approved_at",
        "approved_by",
    }
    return {k: v for k, v in row.items() if k not in skip and not k.startswith("_")}


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
        default=None,
        help="Default for Facebook is llm. Use rule_based for smoke/offline tests only.",
    )
    parser.add_argument(
        "--update-pending",
        action="store_true",
        help="With --apply: PATCH existing pending rows by fingerprint instead of insert-only",
    )
    parser.add_argument(
        "--enrich-profiles",
        action="store_true",
        default=None,
        help="Enrich from Facebook profile/page (default: on for live runs, off for --fixture)",
    )
    parser.add_argument(
        "--no-enrich-profiles",
        action="store_true",
        help="Disable profile enrichment",
    )
    parser.add_argument(
        "--fetch-profile-pages",
        action="store_true",
        default=False,
        help="Also call Apify pages scraper for profile URLs (costs extra; optional)",
    )
    parser.add_argument(
        "--enrich-web",
        action="store_true",
        default=None,
        help="Enrich from website/Instagram (default: on for live runs, off for --fixture)",
    )
    parser.add_argument(
        "--no-enrich-web",
        action="store_true",
        help="Disable website/Instagram enrichment",
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

    # Facebook default analyzer = llm (unless explicitly set or fixture/smoke)
    if args.analyzer:
        analyzer_mode = args.analyzer
    elif args.fixture:
        analyzer_mode = "rule_based"
    else:
        analyzer_mode = "llm"

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

    analyzed, analyzer_meta = _analyze(logical, analyzer_mode)
    apply_deduplication(analyzed)

    geo_price_stats = enrich_prices_and_city(analyzed, enabled=True)

    if args.no_enrich_profiles:
        enrich_enabled = False
    elif args.enrich_profiles is True:
        enrich_enabled = True
    else:
        # Default: enrich live runs; skip fixture smoke
        enrich_enabled = not bool(args.fixture)

    enrichment_stats = enrich_analyzed_posts(
        analyzed,
        enabled=enrich_enabled,
        fetch_remote=bool(args.fetch_profile_pages),
    )

    if args.no_enrich_web:
        web_enrich_enabled = False
    elif args.enrich_web is True:
        web_enrich_enabled = True
    else:
        web_enrich_enabled = not bool(args.fixture)

    web_enrichment_stats = enrich_from_website_instagram(
        analyzed, enabled=web_enrich_enabled
    )

    review_rows = [map_facebook_post(p) for p in analyzed]

    # Persist local artifacts (no secrets)
    out_path: Path = args.output
    out_path.parent.mkdir(parents=True, exist_ok=True)
    artifact = {
        "source": source_label,
        "adapter": adapter_name,
        "analyzer": analyzer_mode,
        "analyzer_meta": analyzer_meta,
        "apify": apify_meta,
        "normalized": [p.to_dict(include_raw=False) for p in normalized[: args.limit]],
        "analyzed_decisions": [
            {
                "source_fingerprint": p.get("source_fingerprint"),
                "decision": p.get("decision"),
                "classification": p.get("classification"),
                "confidence": p.get("confidence"),
                "entity_type": (p.get("extracted_entity") or {}).get("entity_type"),
                "facebook_policy_lifted": p.get("facebook_policy_lifted"),
                "analyzer_fallback": p.get("analyzer_fallback"),
            }
            for p in analyzed
        ],
        "review_preview": [
            {
                "source_fingerprint": r["source_fingerprint"],
                "ai_decision": r.get("ai_decision"),
                "title": r.get("title"),
                "entity_type": r.get("entity_type"),
                "source_url": r.get("source_url"),
            }
            for r in review_rows
        ],
    }
    out_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")

    inserted = 0
    updated = 0
    skipped_existing = 0
    decision_changes: list[dict[str, Any]] = []
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

        to_insert: list[dict[str, Any]] = []
        for r in review_rows:
            fp = r["source_fingerprint"]
            row = {k: v for k, v in r.items() if not k.startswith("_")}
            prev = existing.get(fp)
            if prev:
                if args.update_pending and prev.get("review_status") in {
                    "pending",
                    "in_review",
                    "needs_more_info",
                }:
                    # Fetch previous ai_decision for report
                    old_decision = None
                    try:
                        prev_full = client._request(
                            "GET",
                            "/import_review_items",
                            params={
                                "select": "id,ai_decision,entity_type,review_status",
                                "id": f"eq.{prev['id']}",
                            },
                        )
                        if prev_full:
                            old_decision = prev_full[0].get("ai_decision")
                    except Exception:  # noqa: BLE001
                        old_decision = None
                    body = _review_update_body(row)
                    client.patch(
                        "import_review_items",
                        {"id": f"eq.{prev['id']}"},
                        body,
                    )
                    updated += 1
                    if old_decision != row.get("ai_decision"):
                        decision_changes.append(
                            {
                                "fingerprint": fp,
                                "old_decision": old_decision,
                                "new_decision": row.get("ai_decision"),
                                "entity_type": row.get("entity_type"),
                            }
                        )
                else:
                    skipped_existing += 1
            else:
                to_insert.append(row)
        if to_insert:
            client.insert_many("import_review_items", to_insert)
        inserted = len(to_insert)

    policy_lifted = sum(1 for p in analyzed if p.get("facebook_policy_lifted"))
    stats = build_stats(
        raw_count=len(raw_rows),
        skipped_adapter=skipped,
        normalized=[p.to_dict(include_raw=False) for p in normalized],
        empty_count=empty_count,
        fingerprint_dupes_dropped=fp_dupes,
        analyzed=analyzed,
        review_rows=review_rows,
        insert_attempted=len(review_rows) if do_apply else 0,
        insert_skipped_existing=skipped_existing,
        inserted=inserted,
    )
    stats["limited_to"] = len(logical)
    stats["updated_pending"] = updated
    stats["policy_lifted_from_rejected"] = policy_lifted
    stats["analyzer_meta"] = analyzer_meta
    stats["decision_changes"] = decision_changes
    stats["profile_enrichment"] = enrichment_stats
    stats["web_enrichment"] = web_enrichment_stats
    stats["geo_price_enrichment"] = geo_price_stats

    entity_counts: dict[str, int] = {}
    for r in review_rows:
        key = str(r.get("entity_type") or "null")
        entity_counts[key] = entity_counts.get(key, 0) + 1
    stats["entity_types"] = entity_counts

    report = {
        "mode": "apply" if do_apply else "dry-run",
        "source": source_label,
        "adapter": adapter_name,
        "analyzer": analyzer_mode,
        "telegram_core_unchanged": True,
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
