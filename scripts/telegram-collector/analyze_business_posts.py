#!/usr/bin/env python3
"""Analyze collected Telegram posts for business / specialist ads.

Modes (TELEGRAM_ANALYZER_MODE):
  llm         — OpenRouter / OpenAI / Anthropic (requires API key)
  rule_based  — heuristic fallback (not a substitute for LLM semantics)

Does not write to Supabase. Does not publish anything.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from analyzers import get_analyzer, llm_key_status
from config import SCRIPT_DIR, load_env
from dedupe import apply_deduplication
from merge import merge_logical_posts

DATA_DIR = SCRIPT_DIR / "data"
DEFAULT_INPUT = DATA_DIR / "fun_for_mom_raw.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze collected Telegram posts")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--outdir", type=Path, default=DATA_DIR)
    parser.add_argument("--prefix", default="fun_for_mom")
    parser.add_argument(
        "--version-tag",
        default="",
        help="Optional tag inserted before .json, e.g. v2 -> fun_for_mom_analyzed_v2.json",
    )
    parser.add_argument(
        "--mode",
        default=None,
        help="Override TELEGRAM_ANALYZER_MODE (llm|rule_based)",
    )
    parser.add_argument(
        "--remerge",
        action="store_true",
        help="Rebuild logical posts from raw message rows before analysis",
    )
    return parser.parse_args()


def build_summary(analyzed: list[dict[str, Any]], raw_meta: dict[str, Any], analyzer) -> dict[str, Any]:
    decisions = Counter(a.get("decision") for a in analyzed)
    classifications = Counter(a.get("classification") for a in analyzed)
    dup_status = Counter(a.get("duplicate_status") for a in analyzed)
    entity_types = Counter(
        (a.get("extracted_entity") or {}).get("entity_type")
        for a in analyzed
        if a.get("decision") in {"accepted", "needs_review"}
    )
    categories = Counter(
        (a.get("extracted_entity") or {}).get("category") or "other"
        for a in analyzed
        if a.get("decision") == "accepted"
    )
    name_sources = Counter(
        (a.get("extracted_entity") or {}).get("extracted_name_source") or "unknown"
        for a in analyzed
        if a.get("decision") == "accepted"
    )

    def accepted_with(field: str) -> int:
        return sum(
            1
            for a in analyzed
            if a.get("decision") == "accepted"
            and (a.get("extracted_entity") or {}).get(field)
        )

    accepted = [a for a in analyzed if a.get("decision") == "accepted"]
    no_contact = 0
    for a in accepted:
        e = a.get("extracted_entity") or {}
        if not any(e.get(k) for k in ("phone", "email", "website", "instagram", "telegram", "whatsapp")):
            no_contact += 1

    return {
        "analyzer": getattr(analyzer, "name", None),
        "llm_provider": getattr(analyzer, "provider", None),
        "llm_model": getattr(analyzer, "model", None),
        "raw_messages_received": raw_meta.get("raw_message_rows"),
        "logical_posts_after_merge": len(analyzed),
        "accepted": decisions.get("accepted", 0),
        "needs_review": decisions.get("needs_review", 0),
        "rejected": decisions.get("rejected", 0),
        "classifications": dict(classifications),
        "duplicate_status": dict(dup_status),
        "third_party_recommendations": classifications.get("third_party_recommendation", 0),
        "businesses": entity_types.get("business", 0),
        "private_specialists": entity_types.get("private_specialist", 0),
        "categories": dict(categories),
        "accepted_name_sources": dict(name_sources),
        "with_phone": accepted_with("phone"),
        "with_instagram": accepted_with("instagram"),
        "with_website": accepted_with("website"),
        "with_telegram": accepted_with("telegram"),
        "accepted_without_direct_contact": no_contact,
        "supabase_written": False,
    }


def load_posts(payload: dict[str, Any], remerge: bool) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    meta = dict(payload.get("meta") or {})
    if remerge and payload.get("raw_messages"):
        posts = merge_logical_posts(payload["raw_messages"])
        meta["logical_posts"] = len(posts)
        meta["merge_version"] = "v2_advanced"
        return posts, meta
    posts = payload.get("posts") or []
    # If posts look like v1 without merge fields, still ok.
    for p in posts:
        p.setdefault("merged_text", p.get("text"))
        p.setdefault("primary_message_id", p.get("message_id"))
        p.setdefault("source_message_ids", p.get("message_ids") or [p.get("message_id")])
        p.setdefault("merge_reason", p.get("merge_reason") or "imported_v1")
        p.setdefault("message_date_start", p.get("message_date"))
        p.setdefault("message_date_end", p.get("message_date"))
    return posts, meta


def main() -> int:
    load_env()
    args = parse_args()

    input_path: Path = args.input
    if not input_path.is_absolute():
        input_path = (Path.cwd() / input_path).resolve()
    if not input_path.is_file():
        print(f"Ошибка: нет файла {input_path}", file=sys.stderr)
        return 1

    outdir: Path = args.outdir
    if not outdir.is_absolute():
        outdir = (Path.cwd() / outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    mode = args.mode or os.getenv("TELEGRAM_ANALYZER_MODE") or "llm"
    if mode == "llm":
        status = llm_key_status()
        if not status["configured"]:
            print(
                "LLM не настроена. Нужен один из ключей в .env.local:\n"
                "  OPENROUTER_API_KEY=\n"
                "  OPENAI_API_KEY=\n"
                "  ANTHROPIC_API_KEY=\n"
                "Опционально:\n"
                "  TELEGRAM_ANALYZER_MODE=llm\n"
                "  TELEGRAM_LLM_PROVIDER=openrouter|openai|anthropic\n"
                "  TELEGRAM_LLM_MODEL=...\n"
                "Фиктивный анализ не выполнялся. v2 accepted/rejected не создавались.",
                file=sys.stderr,
            )
            return 2

    analyzer = get_analyzer(mode)
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    posts, raw_meta = load_posts(payload, remerge=args.remerge or bool(payload.get("raw_messages")))

    analyzed: list[dict[str, Any]] = []
    total = len(posts)
    for i, post in enumerate(posts, 1):
        if i == 1 or i % 10 == 0 or i == total:
            print(f"Analyzing {i}/{total}…", flush=True)
        result = analyzer.analyze(post)
        result["analyzer"] = analyzer.name
        if getattr(analyzer, "provider", None):
            result["llm_provider"] = analyzer.provider
            result["llm_model"] = analyzer.model
        analyzed.append(result)

    apply_deduplication(analyzed)

    accepted = [a for a in analyzed if a.get("decision") == "accepted"]
    needs_review = [a for a in analyzed if a.get("decision") == "needs_review"]
    rejected = [a for a in analyzed if a.get("decision") == "rejected"]
    summary = build_summary(analyzed, raw_meta, analyzer)

    prefix = args.prefix
    tag = f"_{args.version_tag}" if args.version_tag else ""
    outputs = {
        f"{prefix}_analyzed{tag}.json": {
            "meta": {**raw_meta, "analyzer": analyzer.name, "mode": mode},
            "posts": analyzed,
        },
        f"{prefix}_accepted{tag}.json": {"meta": summary, "posts": accepted},
        f"{prefix}_needs_review{tag}.json": {"meta": summary, "posts": needs_review},
        f"{prefix}_rejected{tag}.json": {"meta": summary, "posts": rejected},
        f"{prefix}_summary{tag}.json": summary,
    }
    for name, data in outputs.items():
        path = outdir / name
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Сохранено: {path}")

    print(
        f"mode={mode} analyzer={analyzer.name} provider={getattr(analyzer,'provider',None)} "
        f"model={getattr(analyzer,'model',None)} "
        f"logical={len(analyzed)} accepted={len(accepted)} "
        f"needs_review={len(needs_review)} rejected={len(rejected)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
