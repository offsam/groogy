#!/usr/bin/env python3
"""Collect + LLM-analyze the last N Telegram posts for one chat (no date window).

Writes reviewer_v1 under data/<prefix>/full/ then exits — call extract separately.
Does NOT publish. Uses OpenAI/OpenRouter via existing LLMClient.

Usage:
  python run_last_n.py --chat-id -1001955320601 --prefix la_orange_county \\
    --chat-title "LA Orange County" --limit 50 --confirm-run \\
    --llm-provider openai --llm-model gpt-4o-mini
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from telethon import TelegramClient
from telethon.tl.types import MessageService

from collect_messages import media_type_of, private_message_link, should_skip_raw
from config import SESSION_NAME, get_credentials, load_env
from cost import CostTracker, load_max_cost_usd
from llm_client import LLMClient
import run_full as rf
from run_full import (
    analyze_batch,
    batch_summary,
    configure_run,
    prepare_logical_posts,
    utc_now,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--chat-id", type=int, required=True)
    p.add_argument("--prefix", type=str, required=True)
    p.add_argument("--chat-title", type=str, default=None)
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--confirm-run", action="store_true")
    p.add_argument("--max-cost-usd", type=float, default=15.0)
    p.add_argument(
        "--llm-provider",
        type=str,
        default="openai",
        choices=["openrouter", "openai", "anthropic"],
    )
    p.add_argument("--llm-model", type=str, default="gpt-4o-mini")
    return p.parse_args()


async def fetch_last_n(chat_id: int, limit: int) -> list[dict[str, Any]]:
    api_id, api_hash, _ = get_credentials()
    client = TelegramClient(SESSION_NAME, api_id, api_hash)
    collected_at = utc_now()
    raw: list[dict[str, Any]] = []
    skipped = 0
    await client.connect()
    if not await client.is_user_authorized():
        raise SystemExit("Telegram session not authorized — run auth.py")
    entity = await client.get_entity(chat_id)
    async for message in client.iter_messages(entity, limit=limit * 3):
        if len(raw) >= limit:
            break
        if isinstance(message, MessageService):
            skipped += 1
            continue
        text = message.message or ""
        mtype = media_type_of(message)
        is_service = isinstance(message, MessageService)
        if should_skip_raw(text, bool(message.media), mtype, is_service):
            skipped += 1
            continue
        sender = message.sender
        sender_id = getattr(sender, "id", None) if sender else None
        sender_name = None
        if sender is not None:
            sender_name = (
                " ".join(
                    p
                    for p in (
                        getattr(sender, "first_name", None),
                        getattr(sender, "last_name", None),
                    )
                    if p
                ).strip()
                or getattr(sender, "title", None)
            )
        mid = int(message.id)
        raw.append(
            {
                "message_id": mid,
                "chat_id": chat_id,
                "sender_id": sender_id,
                "sender_name": sender_name,
                "message_date": message.date.astimezone(timezone.utc).isoformat()
                if message.date
                else None,
                "text": text,
                "media_type": mtype,
                "has_media": bool(message.media) and mtype not in {None, "sticker"},
                "reply_to_message_id": message.reply_to_msg_id,
                "telegram_message_link": private_message_link(chat_id, mid),
                "collected_at": collected_at,
            }
        )
    await client.disconnect()
    print(f"fetched_raw={len(raw)} skipped={skipped} limit={limit}", flush=True)
    return raw


async def main_async(args: argparse.Namespace) -> int:
    load_env()
    os.environ["TELEGRAM_LLM_PROVIDER"] = args.llm_provider
    os.environ["TELEGRAM_LLM_MODEL"] = args.llm_model
    os.environ["TELEGRAM_LLM_MAX_COST_USD"] = str(args.max_cost_usd)
    os.environ["TELEGRAM_ANALYZER_MODE"] = "llm"

    configure_run(
        chat_id=args.chat_id,
        prefix=args.prefix,
        chat_title=args.chat_title,
    )
    full_dir = rf.FULL_DIR
    batch_dir = rf.BATCH_DIR
    chat_id = rf.CHAT_ID
    prefix = rf.PREFIX
    full_dir.mkdir(parents=True, exist_ok=True)
    batch_dir.mkdir(parents=True, exist_ok=True)

    if not args.confirm_run:
        print("Pass --confirm-run to analyze with LLM.", flush=True)
        return 2

    print(
        f"=== LAST N RUN prefix={prefix} chat={chat_id} limit={args.limit} "
        f"provider={args.llm_provider} model={args.llm_model} ===",
        flush=True,
    )

    raw = await fetch_last_n(chat_id, args.limit)
    raw_path = batch_dir / "batch_0001_raw.json"
    logical = prepare_logical_posts(raw, 1)
    # Keep newest N logical posts
    logical = logical[: args.limit]
    keep_ids = {
        mid for p in logical for mid in (p.get("source_message_ids") or [p.get("primary_message_id")])
    }
    raw = [m for m in raw if m.get("message_id") in keep_ids]
    raw_path.write_text(
        json.dumps(
            {
                "meta": {
                    "batch": 1,
                    "raw_count": len(raw),
                    "chat_id": chat_id,
                    "prefix": prefix,
                    "limit": args.limit,
                    "mode": "last_n",
                },
                "raw_messages": raw,
                "posts": logical,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"logical_posts={len(logical)}", flush=True)

    max_cost = load_max_cost_usd(args.max_cost_usd)
    tracker = CostTracker(model=args.llm_model, max_cost_usd=max_cost)
    client = LLMClient(tracker, request_delay_s=0.12, timeout_s=90)
    print(
        f"LLM client ready provider={client.provider} model={client.model} "
        f"base={client.base_url}",
        flush=True,
    )

    checkpoint: dict[str, Any] = {
        "status": "running",
        "chat_id": chat_id,
        "prefix": prefix,
        "completed_batches": 0,
        "cost": {},
    }
    partial = batch_dir / "batch_0001_analyzed.partial.jsonl"
    if partial.exists():
        partial.unlink()
    analyzed = analyze_batch(
        logical,
        client,
        tracker,
        workers=args.workers,
        checkpoint=checkpoint,
        partial_path=partial,
    )
    summary = batch_summary(analyzed, len(raw), 1)
    summary["cost_so_far"] = tracker.as_dict()
    (batch_dir / "batch_0001_analyzed.json").write_text(
        json.dumps({"meta": summary, "posts": analyzed}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if partial.exists():
        partial.unlink()

    accepted = [p for p in analyzed if p.get("decision") == "accepted"]
    needs = [p for p in analyzed if p.get("decision") == "needs_review"]
    rejected = [p for p in analyzed if p.get("decision") == "rejected"]

    def write(name: str, posts: list[dict[str, Any]]) -> None:
        path = full_dir / f"{prefix}_{name}.json"
        path.write_text(
            json.dumps(
                {
                    "meta": {
                        "prefix": prefix,
                        "chat_id": chat_id,
                        "mode": "last_n",
                        "limit": args.limit,
                        "posts": len(posts),
                        "generated_at": utc_now(),
                    },
                    "posts": posts,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    write("accepted", accepted)
    write("needs_review", needs)
    write("rejected", rejected)
    (full_dir / f"{prefix}_summary.json").write_text(
        json.dumps(
            {
                "status": "completed",
                "mode": "last_n",
                "limit": args.limit,
                "logical_posts": len(analyzed),
                "accepted": len(accepted),
                "needs_review": len(needs),
                "rejected": len(rejected),
                "cost": tracker.as_dict(),
                "finished_at": utc_now(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    reviewer_posts = accepted + needs
    reviewer_path = full_dir / f"{prefix}_reviewer_v1.json"
    reviewer_path.write_text(
        json.dumps(
            {
                "meta": {
                    "reviewer": "passthrough_last_n",
                    "posts": len(reviewer_posts),
                    "limit": args.limit,
                },
                "posts": reviewer_posts,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    from collections import Counter

    by_class = Counter(p.get("classification") for p in analyzed)
    by_decision = Counter(p.get("decision") for p in analyzed)
    print(
        f"DONE accepted={len(accepted)} review={len(needs)} rejected={len(rejected)} "
        f"cost=${tracker.cost_usd:.4f}",
        flush=True,
    )
    print(f"by_classification={dict(by_class)}", flush=True)
    print(f"by_decision={dict(by_decision)}", flush=True)
    print(f"reviewer={reviewer_path}", flush=True)
    return 0


def main() -> int:
    args = parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
