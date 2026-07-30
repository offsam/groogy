#!/usr/bin/env python3
"""Scoped Telegram collector + LLM analyzer with checkpoint/resume.

Default: last 6 months only via required --date-from / --date-to.
--allow-full-history is rejected (hard abort).
Does NOT write to Supabase. Does NOT download media.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.types import MessageService, User

from analyzers import _llm_user_payload, _fill_contacts, _attach_post_fields
from categories import detect_category
from collect_messages import media_type_of, private_message_link, should_skip_raw
from config import SCRIPT_DIR, SESSION_NAME, get_credentials, load_env
from contacts import has_contact_signal
from cost import CostTracker, load_max_cost_usd
from dedupe import apply_deduplication  # per-batch light dedupe before global
from entities import apply_global_deduplication, build_entities
from llm_client import LLMClient
from merge import merge_logical_posts
from names import extract_names
from schema import empty_entity, empty_evidence, validate_analysis_result

# Runtime config — overridden by configure_run()
CHAT_ID = -1001333533747
CHAT_TITLE = "Fun for Mom"
PREFIX = "fun_for_mom"
POST_ID_TAG = "ffm"
ANALYZER_VERSION = "llm_v1"
DATA_DIR = SCRIPT_DIR / "data"
FULL_DIR = DATA_DIR / "full"
BATCH_DIR = FULL_DIR / "batches"
CHECKPOINT_PATH = DATA_DIR / "full_run_checkpoint.json"
ERRORS_PATH = FULL_DIR / "llm_errors.jsonl"

BATCH_LOGICAL_TARGET = 500
DEFAULT_WORKERS = 4
DEFAULT_MONTHS = 6
DEFAULT_CHAT_ID = -1001333533747
DEFAULT_PREFIX = "fun_for_mom"


def post_id_tag_for(prefix: str) -> str:
    parts = [p for p in prefix.replace("-", "_").split("_") if p]
    if len(parts) >= 2:
        return "".join(p[0] for p in parts)[:8]
    return prefix[:6]


def configure_run(
    *,
    chat_id: int,
    prefix: str,
    chat_title: str | None = None,
) -> None:
    """Set per-group paths so Fun for Mom and other groups never share checkpoints."""
    global CHAT_ID, CHAT_TITLE, PREFIX, POST_ID_TAG
    global FULL_DIR, BATCH_DIR, CHECKPOINT_PATH, ERRORS_PATH

    CHAT_ID = int(chat_id)
    PREFIX = prefix.strip()
    if not PREFIX:
        raise SystemExit("prefix must be non-empty")
    CHAT_TITLE = (chat_title or PREFIX).strip()
    POST_ID_TAG = post_id_tag_for(PREFIX)

    if PREFIX == DEFAULT_PREFIX:
        # Keep legacy Fun for Mom layout
        FULL_DIR = DATA_DIR / "full"
        CHECKPOINT_PATH = DATA_DIR / "full_run_checkpoint.json"
    else:
        root = DATA_DIR / PREFIX
        FULL_DIR = root / "full"
        CHECKPOINT_PATH = root / "full_run_checkpoint.json"
    BATCH_DIR = FULL_DIR / "batches"
    ERRORS_PATH = FULL_DIR / "llm_errors.jsonl"


def parse_iso_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def assert_raw_in_window(
    raw: list[dict[str, Any]],
    *,
    date_from: datetime,
    date_to: datetime | None,
) -> None:
    """Hard-stop if any kept message is outside the configured window."""
    for m in raw:
        raw_date = m.get("message_date")
        if not raw_date:
            continue
        msg_dt = parse_iso_dt(str(raw_date))
        if msg_dt is None:
            continue
        if msg_dt < date_from:
            raise RuntimeError(
                f"ABORT: message older than start_date "
                f"(message_id={m.get('message_id')} date={raw_date} "
                f"start_date={date_from.date()})"
            )
        if date_to is not None and msg_dt > date_to:
            raise RuntimeError(
                f"ABORT: message newer than end_date "
                f"(message_id={m.get('message_id')} date={raw_date} "
                f"end_date={date_to.date()})"
            )


def print_run_banner(
    *,
    start_date: datetime,
    end_date: datetime,
    chat_id: int,
    prefix: str,
) -> None:
    print("=== RUN CONFIG (date-scoped) ===", flush=True)
    print(f"start_date={start_date.date().isoformat()}", flush=True)
    print(f"end_date={end_date.date().isoformat()}", flush=True)
    print(f"chat_id={chat_id}", flush=True)
    print(f"prefix={prefix}", flush=True)
    print(f"checkpoint={CHECKPOINT_PATH}", flush=True)
    print(f"output_dir={FULL_DIR}", flush=True)
    print("allow_full_history=False (hard-forbidden)", flush=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_checkpoint() -> dict[str, Any]:
    if CHECKPOINT_PATH.is_file():
        return json.loads(CHECKPOINT_path_read())
    return {
        "chat_id": CHAT_ID,
        "oldest_processed_message_id": None,
        "newest_processed_message_id": None,
        "processed_raw_messages": 0,
        "processed_logical_posts": 0,
        "completed_batches": 0,
        "last_completed_batch": None,
        "last_run_at": None,
        "analyzer_version": ANALYZER_VERSION,
        "model": None,
        "status": "not_started",
        "cost": {},
        "history_count_estimate": None,
        "stop_reason": None,
        "date_newest": None,
        "date_oldest": None,
    }


def CHECKPOINT_path_read() -> str:
    return CHECKPOINT_PATH.read_text(encoding="utf-8")


def save_checkpoint(cp: dict[str, Any]) -> None:
    cp["last_run_at"] = utc_now()
    CHECKPOINT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CHECKPOINT_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(cp, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(CHECKPOINT_PATH)


def append_error(row: dict[str, Any]) -> None:
    ERRORS_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Never include secrets
    safe = {k: v for k, v in row.items() if k not in {"api_key", "authorization", "session"}}
    with ERRORS_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(safe, ensure_ascii=False) + "\n")


def sender_info(message) -> tuple[int | None, str | None]:
    sender = message.sender
    if sender is None:
        return None, None
    if isinstance(sender, User):
        name = " ".join(
            part for part in (sender.first_name, sender.last_name) if part
        ).strip() or None
        return sender.id, name
    return getattr(sender, "id", None), getattr(sender, "title", None)


async def fetch_raw_batch(
    client: TelegramClient,
    entity,
    *,
    offset_id: int | None,
    max_raw: int,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """Fetch up to max_raw non-skipped messages older than offset_id (or newest).

    Returns (rows, reached_date_from). When date_from is set, stops once messages
    older than date_from are reached.
    """
    collected_at = utc_now()
    raw: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {}
    if offset_id:
        kwargs["offset_id"] = offset_id
    reached_date_from = False

    async for message in client.iter_messages(entity, **kwargs):
        msg_date = message.date
        if msg_date is not None and msg_date.tzinfo is None:
            msg_date = msg_date.replace(tzinfo=timezone.utc)

        if date_to is not None and msg_date is not None and msg_date > date_to:
            continue
        if date_from is not None and msg_date is not None and msg_date < date_from:
            reached_date_from = True
            break

        is_service = isinstance(message, MessageService)
        text = message.message or ""
        mtype = media_type_of(message)
        if should_skip_raw(text, bool(message.media), mtype, is_service):
            continue
        if text and len(text.strip()) < 10 and not has_contact_signal(text) and not message.grouped_id:
            continue

        sender_id, sender_name = sender_info(message)
        has_media = message.media is not None and mtype not in {None, "sticker"}
        raw.append(
            {
                "chat_id": CHAT_ID,
                "chat_title": getattr(entity, "title", None) or CHAT_TITLE,
                "message_id": message.id,
                "message_date": message.date.isoformat() if message.date else None,
                "sender_id": sender_id,
                "sender_name": sender_name,
                "text": text,
                "has_media": bool(has_media),
                "media_type": mtype,
                "grouped_id": message.grouped_id,
                "reply_to_message_id": message.reply_to_msg_id,
                "views": message.views,
                "forwards": message.forwards,
                "telegram_message_link": private_message_link(CHAT_ID, message.id),
                "collected_at": collected_at,
            }
        )
        if len(raw) >= max_raw:
            break
    return raw, reached_date_from


def parse_date_arg(value: str | None, *, end_of_day: bool = False) -> datetime | None:
    if not value:
        return None
    dt = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    if end_of_day:
        dt = dt + timedelta(days=1) - timedelta(microseconds=1)
    return dt


def default_six_month_window(today: datetime | None = None) -> tuple[datetime, datetime]:
    today = today or datetime.now(timezone.utc)
    date_to = today.replace(hour=23, minute=59, second=59, microsecond=999999)
    date_from = (today - timedelta(days=182)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return date_from, date_to


def prepare_logical_posts(
    raw_messages: list[dict[str, Any]],
    batch_no: int,
    *,
    assign_ids: bool = True,
) -> list[dict[str, Any]]:
    posts = merge_logical_posts(raw_messages)
    cleaned: list[dict[str, Any]] = []
    for post in posts:
        text = (post.get("merged_text") or "").strip()
        if not text and not post.get("media_count"):
            continue
        if text and len(text) < 10 and not has_contact_signal(text):
            continue
        post["source_chat_id"] = CHAT_ID
        if assign_ids:
            post["internal_post_id"] = (
                f"{POST_ID_TAG}_{batch_no:04d}_{post.get('primary_message_id')}_"
                f"{uuid.uuid4().hex[:8]}"
            )
        cleaned.append(post)
    return cleaned


def ground_and_guard(result: dict[str, Any]) -> dict[str, Any]:
    text = result.get("merged_text") or result.get("text") or ""
    entity = result.get("extracted_entity") or empty_entity(result)
    _fill_contacts(entity, text)
    names = extract_names(text, result.get("sender_name"))
    if names["extracted_name_source"] in {"explicit_text", "business_brand", "instagram"}:
        if not entity.get("person_name"):
            entity["person_name"] = names["person_name"]
        if not entity.get("business_name"):
            entity["business_name"] = names["business_name"]
        entity["extracted_name_source"] = names["extracted_name_source"]
    elif not entity.get("person_name") and not entity.get("business_name"):
        entity["extracted_name_source"] = names["extracted_name_source"]

    if not entity.get("category") or entity.get("category") == "other":
        cat, warns = detect_category(text)
        entity["category"] = cat
        result["warnings"] = list(result.get("warnings") or []) + warns

    result["extracted_entity"] = entity
    # Re-validate decision policy after grounding
    payload = {
        "classification": result.get("classification"),
        "decision": result.get("decision"),
        "confidence": result.get("confidence"),
        "decision_reason": result.get("decision_reason"),
        "advertiser_relationship": result.get("advertiser_relationship"),
        "extracted_entity": entity,
        "evidence": result.get("evidence") or empty_evidence(),
        "missing_fields": result.get("missing_fields") or [],
        "warnings": result.get("warnings") or [],
    }
    validated = validate_analysis_result(payload)
    result.update(validated)

    # Hard guards — goods sales route to marketplace; personal garage sales stay rejected.
    import re
    from pathlib import Path as _P
    import sys as _S

    _S.path.insert(0, str(_P(__file__).resolve().parents[1] / "import-review"))
    from entity_routing import PERSONAL_GOODS_RE, detect_goods_sale  # noqa: E402

    job = re.compile(
        r"\b(вакансия|hiring|ищу\s+работу|looking\s+for\s+(?:a\s+)?(?:job|position)|front\s*desk)\b",
        re.I,
    )
    housing = re.compile(
        r"\b(сда[её]тся\s+(?:квартира|комната|дом)|room\s+for\s+rent|прода[её]тся\s+(?:дом|квартира))\b",
        re.I,
    )
    greet = re.compile(
        r"^(всем\s+привет|добрый\s+день|здравствуйте|девочки)\b",
        re.I,
    )
    for key in ("person_name", "business_name"):
        val = entity.get(key)
        if val and greet.match(str(val).strip()):
            entity[key] = None
            entity["extracted_name_source"] = "unknown"
            if result.get("decision") == "accepted":
                result["decision"] = "needs_review"
                result["warnings"] = list(result.get("warnings") or []) + ["greeting_name_removed"]

    if job.search(text):
        result["classification"] = "job_post"
        result["decision"] = "rejected"
        result["decision_reason"] = "Вакансия / поиск работы."
    elif PERSONAL_GOODS_RE.search(text) and result.get("decision") == "accepted":
        result["classification"] = "marketplace_item"
        result["decision"] = "rejected"
        result["decision_reason"] = "Личная продажа вещи."
    elif detect_goods_sale(text):
        result["classification"] = "marketplace_item"
        entity["entity_type"] = "marketplace_listing"
        entity["target_collection"] = "marketplace"
        if result.get("decision") == "accepted":
            result["decision"] = "needs_review"
        result["decision_reason"] = "Продажа товара → marketplace."
    elif housing.search(text) and result.get("decision") == "accepted":
        result["classification"] = "real_estate_listing"
        result["decision"] = "rejected"
        result["decision_reason"] = "Единичная недвижимость."
    if result.get("classification") == "third_party_recommendation":
        result["decision"] = "needs_review"
        result["advertiser_relationship"] = "third_party_recommendation"

    result["extracted_entity"] = entity
    return result


def analyze_one(client: LLMClient, post: dict[str, Any]) -> dict[str, Any]:
    analyzed_at = utc_now()
    user_payload = _llm_user_payload(post)
    data = None
    schema_failure = False
    try:
        data, _usage = client.complete_json(user_payload, repair=False)
    except Exception as exc:  # noqa: BLE001
        append_error(
            {
                "at": analyzed_at,
                "internal_post_id": post.get("internal_post_id"),
                "primary_message_id": post.get("primary_message_id"),
                "error_type": type(exc).__name__,
                "error": str(exc)[:300],
                "stage": "request",
            }
        )
        data = None

    if data is not None:
        try:
            # normalize list fields
            entity = data.get("extracted_entity") or {}
            for key in (
                "phone", "email", "website", "instagram", "facebook", "telegram",
                "whatsapp", "services", "prices", "service_area", "languages",
            ):
                if key in entity and isinstance(entity[key], str):
                    entity[key] = [entity[key]] if entity[key].strip() else []
            data["extracted_entity"] = entity
            validated = validate_analysis_result(data)
        except Exception as exc:  # noqa: BLE001
            # one repair attempt
            try:
                data, _usage = client.complete_json(user_payload, repair=True)
                entity = data.get("extracted_entity") or {}
                for key in (
                    "phone", "email", "website", "instagram", "facebook", "telegram",
                    "whatsapp", "services", "prices", "service_area", "languages",
                ):
                    if key in entity and isinstance(entity[key], str):
                        entity[key] = [entity[key]] if entity[key].strip() else []
                data["extracted_entity"] = entity
                validated = validate_analysis_result(data)
            except Exception as exc2:  # noqa: BLE001
                schema_failure = True
                append_error(
                    {
                        "at": analyzed_at,
                        "internal_post_id": post.get("internal_post_id"),
                        "primary_message_id": post.get("primary_message_id"),
                        "error_type": type(exc2).__name__,
                        "error": str(exc2)[:300],
                        "stage": "schema_repair",
                    }
                )
                validated = None
    else:
        validated = None

    if validated is None:
        entity = empty_entity(post)
        _fill_contacts(entity, post.get("merged_text") or "")
        validated = validate_analysis_result(
            {
                "classification": "unclear",
                "decision": "needs_review",
                "confidence": 0.4,
                "decision_reason": "LLM schema failure after retry",
                "advertiser_relationship": "unknown",
                "extracted_entity": entity,
                "evidence": empty_evidence(),
                "missing_fields": [],
                "warnings": ["llm_schema_failure"],
            }
        )

    out = _attach_post_fields(post, validated)
    out = ground_and_guard(out)
    out["analyzer_version"] = ANALYZER_VERSION
    out["llm_provider"] = client.provider
    out["llm_model"] = client.model
    out["analyzed_at"] = analyzed_at
    out["duplicate_status"] = out.get("duplicate_status") or "unique"
    out["duplicate_of_internal_post_id"] = None
    out["duplicate_score"] = 0.0
    out["duplicate_reason"] = None
    return out


def analyze_batch(
    posts: list[dict[str, Any]],
    client: LLMClient,
    tracker: CostTracker,
    *,
    workers: int,
    checkpoint: dict[str, Any],
    partial_path: Path,
) -> list[dict[str, Any]]:
    # Resume from partial JSONL if present
    done_by_id: dict[str, dict[str, Any]] = {}
    if partial_path.is_file():
        with partial_path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                pid = row.get("internal_post_id")
                if pid:
                    done_by_id[pid] = row
        print(f"  resumed {len(done_by_id)} posts from partial", flush=True)

    pending = [p for p in posts if p.get("internal_post_id") not in done_by_id]
    results_map = dict(done_by_id)

    def _write_partial(row: dict[str, Any]) -> None:
        with partial_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    if pending:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(analyze_one, client, post): post.get("internal_post_id")
                for post in pending
            }
            done = len(done_by_id)
            total = len(posts)
            for fut in as_completed(futures):
                if tracker.would_exceed():
                    checkpoint["status"] = "stopped_cost_limit"
                    checkpoint["stop_reason"] = (
                        f"Cost limit ${tracker.max_cost_usd} would be exceeded "
                        f"(current ${tracker.cost_usd:.4f})"
                    )
                    checkpoint["cost"] = tracker.as_dict()
                    save_checkpoint(checkpoint)
                    raise RuntimeError(checkpoint["stop_reason"])
                pid = futures[fut]
                row = fut.result()
                results_map[pid] = row
                _write_partial(row)
                done += 1
                if done % 25 == 0 or done == total:
                    print(
                        f"  analyzed {done}/{total} "
                        f"cost=${tracker.cost_usd:.4f} tokens_in={tracker.input_tokens}",
                        flush=True,
                    )
                    checkpoint["cost"] = tracker.as_dict()
                    save_checkpoint(checkpoint)

    # Preserve original order
    ordered = []
    for post in posts:
        pid = post.get("internal_post_id")
        if pid in results_map:
            ordered.append(results_map[pid])
    return ordered


def batch_summary(analyzed: list[dict[str, Any]], raw_count: int, batch_no: int) -> dict[str, Any]:
    from collections import Counter

    return {
        "batch": batch_no,
        "raw_messages": raw_count,
        "logical_posts": len(analyzed),
        "accepted": sum(1 for a in analyzed if a.get("decision") == "accepted"),
        "needs_review": sum(1 for a in analyzed if a.get("decision") == "needs_review"),
        "rejected": sum(1 for a in analyzed if a.get("decision") == "rejected"),
        "classifications": dict(Counter(a.get("classification") for a in analyzed)),
        "multi_message_posts": sum(
            1 for a in analyzed if len(a.get("source_message_ids") or []) > 1
        ),
    }


def finalize(tracker: CostTracker, checkpoint: dict[str, Any]) -> dict[str, Any]:
    """Load all batch analyzed files, global dedupe, write final outputs."""
    from collections import Counter

    all_posts: list[dict[str, Any]] = []
    for path in sorted(BATCH_DIR.glob("batch_*_analyzed.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        all_posts.extend(payload.get("posts") or [])

    apply_global_deduplication(all_posts)
    entities = build_entities(all_posts)

    accepted = [p for p in all_posts if p.get("decision") == "accepted"]
    needs = [p for p in all_posts if p.get("decision") == "needs_review"]
    rejected = [p for p in all_posts if p.get("decision") == "rejected"]
    duplicates = [
        p
        for p in all_posts
        if (p.get("duplicate_status") or "unique") != "unique"
    ]

    dates = [
        p.get("message_date_start")
        for p in all_posts
        if p.get("message_date_start")
    ]
    schema_failures = sum(
        1
        for p in all_posts
        if "llm_schema_failure" in (p.get("warnings") or [])
    )
    llm_error_lines = 0
    if ERRORS_PATH.is_file():
        llm_error_lines = sum(1 for _ in ERRORS_PATH.open(encoding="utf-8"))

    cat_dist = Counter(
        (e.get("category") or "other")
        for e in entities
        if e.get("review_status") in {"ready_for_review", "pending_manual_review"}
    )

    def contact_count(field: str) -> int:
        return sum(1 for e in entities if e.get(field))

    summary = {
        "chat_id": CHAT_ID,
        "chat_title": CHAT_TITLE,
        "prefix": PREFIX,
        "date_from": checkpoint.get("date_from"),
        "date_to": checkpoint.get("date_to"),
        "date_range": {
            "newest": max(dates) if dates else None,
            "oldest": min(dates) if dates else None,
        },
        "raw_messages_read": checkpoint.get("processed_raw_messages"),
        "logical_posts": len(all_posts),
        "multi_message_posts": sum(
            1 for p in all_posts if len(p.get("source_message_ids") or []) > 1
        ),
        "accepted": len(accepted),
        "needs_review": len(needs),
        "rejected": len(rejected),
        "duplicate_status": dict(Counter(p.get("duplicate_status") for p in all_posts)),
        "unique_entities": len(entities),
        "entities_by_review_status": dict(
            Counter(e.get("review_status") for e in entities)
        ),
        "businesses": sum(1 for e in entities if e.get("entity_type") == "business"),
        "private_specialists": sum(
            1 for e in entities if e.get("entity_type") == "private_specialist"
        ),
        "categories": dict(cat_dist),
        "with_phone": contact_count("phone"),
        "with_instagram": contact_count("instagram"),
        "with_telegram": contact_count("telegram"),
        "with_website": contact_count("website"),
        "with_email": contact_count("email"),
        "without_direct_contact": sum(
            1
            for e in entities
            if not any(
                e.get(k)
                for k in ("phone", "email", "website", "instagram", "telegram", "whatsapp")
            )
        ),
        "third_party_recommendation": sum(
            1 for p in all_posts if p.get("classification") == "third_party_recommendation"
        ),
        "schema_failures": schema_failures,
        "llm_errors": llm_error_lines,
        "cost": tracker.as_dict(),
        "completed_batches": checkpoint.get("completed_batches"),
        "analyzer_version": ANALYZER_VERSION,
        "supabase_written": False,
        "status": checkpoint.get("status"),
        "stop_reason": checkpoint.get("stop_reason"),
    }

    FULL_DIR.mkdir(parents=True, exist_ok=True)
    outputs = {
        f"{PREFIX}_all_analyzed.json": {"meta": summary, "posts": all_posts},
        f"{PREFIX}_entities.json": {"meta": summary, "entities": entities},
        f"{PREFIX}_accepted.json": {"meta": summary, "posts": accepted},
        f"{PREFIX}_needs_review.json": {"meta": summary, "posts": needs},
        f"{PREFIX}_rejected.json": {"meta": summary, "posts": rejected},
        f"{PREFIX}_duplicates.json": {"meta": summary, "posts": duplicates},
        f"{PREFIX}_summary.json": summary,
    }
    for name, data in outputs.items():
        path = FULL_DIR / name
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote {path}", flush=True)
    return summary


async def estimate_scope(
    tg: TelegramClient,
    entity,
    *,
    date_from: datetime | None,
    date_to: datetime | None,
) -> dict[str, Any]:
    """Count messages in range and estimate logical posts + cost (no LLM)."""
    total_raw_kept = 0
    total_all_seen = 0
    newest = oldest = None
    sample_raw: list[dict[str, Any]] = []
    offset_id = None
    reached = False

    while not reached:
        page, reached = await fetch_raw_batch(
            tg,
            entity,
            offset_id=offset_id,
            max_raw=500,
            date_from=date_from,
            date_to=date_to,
        )
        if not page and not reached:
            break
        if page:
            total_raw_kept += len(page)
            total_all_seen += len(page)
            offset_id = min(m["message_id"] for m in page)
            dates = [m.get("message_date") for m in page if m.get("message_date")]
            if dates:
                newest = max(newest or dates[0], max(dates))
                oldest = min(oldest or dates[0], min(dates))
            if len(sample_raw) < 800:
                sample_raw.extend(page[: max(0, 800 - len(sample_raw))])
            print(
                f"  estimate scanned kept_raw={total_raw_kept} oldest_id={offset_id}",
                flush=True,
            )
        if not page:
            break

    sample_logical = prepare_logical_posts(sample_raw, 0, assign_ids=False) if sample_raw else []
    ratio = (len(sample_logical) / len(sample_raw)) if sample_raw else 0.66
    est_logical = int(total_raw_kept * ratio)
    return {
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "messages_kept_after_skip": total_raw_kept,
        "sample_raw": len(sample_raw),
        "sample_logical": len(sample_logical),
        "logical_ratio": round(ratio, 4),
        "estimated_logical_posts": est_logical,
        "date_newest_seen": newest,
        "date_oldest_seen": oldest,
    }


async def run(args: argparse.Namespace) -> int:
    global CHAT_TITLE
    load_env()
    if getattr(args, "max_cost_usd", None) is not None and args.max_cost_usd > 0:
        os.environ["TELEGRAM_LLM_MAX_COST_USD"] = str(args.max_cost_usd)
    if getattr(args, "llm_provider", None):
        os.environ["TELEGRAM_LLM_PROVIDER"] = str(args.llm_provider)
    if getattr(args, "llm_model", None):
        os.environ["TELEGRAM_LLM_MODEL"] = str(args.llm_model)
    configure_run(
        chat_id=args.chat_id,
        prefix=args.prefix,
        chat_title=args.chat_title,
    )
    FULL_DIR.mkdir(parents=True, exist_ok=True)
    BATCH_DIR.mkdir(parents=True, exist_ok=True)

    # --- Hard scope guards (never expand / never full history) ---
    if args.allow_full_history:
        print(
            "ABORT: --allow-full-history запрещён. "
            "Собирайте только с явными --date-from / --date-to.",
            file=sys.stderr,
        )
        return 2

    if not args.date_from or not args.date_to:
        print(
            "ABORT: обязательны оба параметра --date-from и --date-to (YYYY-MM-DD).\n"
            "Пример: --date-from 2026-01-25 --date-to 2026-07-25",
            file=sys.stderr,
        )
        return 2

    date_from = parse_date_arg(args.date_from)
    date_to = parse_date_arg(args.date_to, end_of_day=True)
    if date_from is None or date_to is None:
        print("ABORT: неверный формат дат, ожидается YYYY-MM-DD", file=sys.stderr)
        return 2
    if date_from > date_to:
        print("ABORT: start_date позже end_date", file=sys.stderr)
        return 2

    print_run_banner(
        start_date=date_from,
        end_date=date_to,
        chat_id=CHAT_ID,
        prefix=PREFIX,
    )

    max_cost = load_max_cost_usd(20.0)
    if not os.getenv("TELEGRAM_LLM_MAX_COST_USD"):
        os.environ["TELEGRAM_LLM_MAX_COST_USD"] = str(max_cost)
    os.environ["TELEGRAM_ANALYZER_MODE"] = "llm"
    os.environ.setdefault("TELEGRAM_LLM_PROVIDER", "openrouter")
    os.environ.setdefault("TELEGRAM_LLM_MODEL", "openai/gpt-4o-mini")
    print(
        f"LLM provider={os.environ['TELEGRAM_LLM_PROVIDER']} "
        f"model={os.environ['TELEGRAM_LLM_MODEL']} max_cost=${max_cost}",
        flush=True,
    )

    tracker = CostTracker(model=os.environ["TELEGRAM_LLM_MODEL"], max_cost_usd=max_cost)
    checkpoint = load_checkpoint()

    # Never resume another group's checkpoint / different window
    prev_chat = checkpoint.get("chat_id")
    if prev_chat not in (None, CHAT_ID) and int(checkpoint.get("completed_batches") or 0) > 0:
        print(
            f"ABORT: checkpoint chat_id={prev_chat} != current {CHAT_ID}. "
            f"Удалите или смените checkpoint: {CHECKPOINT_PATH}",
            file=sys.stderr,
        )
        return 2
    prev_from = parse_iso_dt(checkpoint.get("date_from"))
    prev_to = parse_iso_dt(checkpoint.get("date_to"))
    if int(checkpoint.get("completed_batches") or 0) > 0:
        if prev_from and prev_from.date() != date_from.date():
            print(
                f"ABORT: checkpoint date_from={prev_from.date()} != {date_from.date()}",
                file=sys.stderr,
            )
            return 2
        if prev_to and prev_to.date() != date_to.date():
            print(
                f"ABORT: checkpoint date_to={prev_to.date()} != {date_to.date()}",
                file=sys.stderr,
            )
            return 2

    checkpoint["chat_id"] = CHAT_ID
    checkpoint["chat_title"] = CHAT_TITLE
    checkpoint["prefix"] = PREFIX
    checkpoint["model"] = os.environ["TELEGRAM_LLM_MODEL"]
    checkpoint["analyzer_version"] = ANALYZER_VERSION
    checkpoint["date_from"] = date_from.isoformat()
    checkpoint["date_to"] = date_to.isoformat()
    checkpoint["allow_full_history"] = False

    tg: TelegramClient | None = None
    entity = None

    async def ensure_telegram():
        nonlocal tg, entity
        global CHAT_TITLE
        if tg is not None and entity is not None:
            return tg, entity
        api_id, api_hash, _ = get_credentials()
        tg = TelegramClient(SESSION_NAME, api_id, api_hash)
        await tg.connect()
        if not await tg.is_user_authorized():
            raise RuntimeError("Session not authorized")
        entity = await tg.get_entity(CHAT_ID)
        resolved_title = getattr(entity, "title", None) or CHAT_TITLE
        checkpoint["chat_title"] = resolved_title
        CHAT_TITLE = resolved_title
        return tg, entity

    # Scope estimate (optional on resume)
    if args.skip_estimate:
        scope = checkpoint.get("scope_estimate") or {}
        if not scope.get("date_from"):
            print(
                "ABORT: --skip-estimate требует prior scope_estimate с date_from",
                file=sys.stderr,
            )
            return 2
        scope_from = parse_iso_dt(str(scope.get("date_from")))
        if scope_from is None or scope_from.date() != date_from.date():
            print(
                "ABORT: scope_estimate date_from не совпадает с --date-from",
                file=sys.stderr,
            )
            return 2
        oldest_seen = scope.get("date_oldest_seen")
        if oldest_seen:
            oldest_dt = parse_iso_dt(str(oldest_seen))
            if oldest_dt is not None and oldest_dt < date_from:
                print(
                    f"ABORT: cached estimate oldest {oldest_seen} < start_date",
                    file=sys.stderr,
                )
                return 2
        print("=== Skipping Telegram estimate (using cached scope) ===", flush=True)
        print(json.dumps(scope, ensure_ascii=False, indent=2), flush=True)
        est_cost = float(scope.get("estimated_cost_usd") or tracker.estimate_for_posts(
            int(scope.get("estimated_logical_posts") or 0)
        ))
        tracker.estimated_upfront_usd = est_cost
    else:
        try:
            await ensure_telegram()
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        assert tg is not None and entity is not None
        print("=== Scope estimate (no LLM) ===", flush=True)
        print(
            f"date_from={date_from.date()} "
            f"date_to={date_to.date()} "
            f"allow_full_history=False",
            flush=True,
        )
        scope = await estimate_scope(tg, entity, date_from=date_from, date_to=date_to)

        # Verify start_date actually bounded the scan
        oldest_seen = scope.get("date_oldest_seen")
        if oldest_seen:
            oldest_dt = parse_iso_dt(str(oldest_seen))
            if oldest_dt is not None and oldest_dt < date_from:
                print(
                    f"ABORT: estimate увидела дату старше start_date: "
                    f"{oldest_seen} < {date_from.isoformat()}",
                    file=sys.stderr,
                )
                await tg.disconnect()
                return 2
        if not scope.get("date_from"):
            print("ABORT: start_date не применился в scope estimate", file=sys.stderr)
            await tg.disconnect()
            return 2

        est_cost = tracker.estimate_for_posts(int(scope["estimated_logical_posts"]))
        tracker.estimated_upfront_usd = est_cost
        scope["estimated_cost_usd"] = round(est_cost, 4)
        scope["max_cost_usd"] = max_cost
        scope["model"] = os.environ["TELEGRAM_LLM_MODEL"]
        scope["chat_id"] = CHAT_ID
        scope["prefix"] = PREFIX
        print(json.dumps(scope, ensure_ascii=False, indent=2), flush=True)
        (FULL_DIR / "scope_estimate.json").write_text(
            json.dumps(scope, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    if not args.confirm_run:
        print(
            "\nОценка завершена. LLM не запускался.\n"
            "Для запуска добавьте --confirm-run "
            "(с теми же --date-from/--date-to/--chat-id/--prefix).",
            flush=True,
        )
        prev_status = checkpoint.get("status")
        if prev_status != "stopped_by_user_scope_change":
            checkpoint["status"] = "estimate_only"
            checkpoint["stop_reason"] = "Awaiting --confirm-run"
        checkpoint["cost"] = {
            **(checkpoint.get("cost") or {}),
            "estimated_upfront_usd": est_cost,
            "max_cost_usd": max_cost,
        }
        checkpoint["scope_estimate"] = scope
        checkpoint["last_run_at"] = utc_now()
        save_checkpoint(checkpoint)
        if tg is not None:
            await tg.disconnect()
        return 0

    # --- Confirmed run ---
    # Restore accumulated cost so resume does not reset budget / totals
    prev_cost = checkpoint.get("cost") or {}
    if prev_cost:
        tracker.input_tokens = int(prev_cost.get("input_tokens") or 0)
        tracker.output_tokens = int(prev_cost.get("output_tokens") or 0)
        tracker.requests = int(prev_cost.get("requests") or 0)
        if prev_cost.get("estimated_upfront_usd") is not None:
            tracker.estimated_upfront_usd = float(prev_cost["estimated_upfront_usd"])
        print(
            f"Restored cost tracker: requests={tracker.requests} "
            f"cost=${tracker.cost_usd:.4f}",
            flush=True,
        )

    # Re-apply CLI overrides after any credential/estimate side-effects.
    # (load_env is now idempotent, but keep this belt-and-suspenders.)
    if getattr(args, "llm_provider", None):
        os.environ["TELEGRAM_LLM_PROVIDER"] = str(args.llm_provider)
    if getattr(args, "llm_model", None):
        os.environ["TELEGRAM_LLM_MODEL"] = str(args.llm_model)

    client_llm = LLMClient(tracker, request_delay_s=0.12, timeout_s=90)
    print(
        f"LLM client ready provider={client_llm.provider} "
        f"model={client_llm.model} base={client_llm.base_url}",
        flush=True,
    )
    checkpoint["status"] = "running"
    checkpoint["stop_reason"] = None
    checkpoint["scope_estimate"] = scope
    save_checkpoint(checkpoint)

    try:
        while True:
            if tracker.would_exceed():
                checkpoint["status"] = "stopped_cost_limit"
                checkpoint["stop_reason"] = f"Reached cost limit ${max_cost}"
                save_checkpoint(checkpoint)
                break

            batch_no = int(checkpoint.get("completed_batches") or 0) + 1
            offset_id = checkpoint.get("oldest_processed_message_id")
            print(
                f"\n=== Batch {batch_no:04d} offset_id={offset_id} ===",
                flush=True,
            )

            raw_path = BATCH_DIR / f"batch_{batch_no:04d}_raw.json"
            partial_path = BATCH_DIR / f"batch_{batch_no:04d}_analyzed.partial.jsonl"
            reached_date_from = False
            raw: list[dict[str, Any]] = []
            logical: list[dict[str, Any]] = []

            # Resume in-progress batch from saved raw so partial LLM IDs still match
            if raw_path.is_file():
                existing = json.loads(raw_path.read_text(encoding="utf-8"))
                raw = list(existing.get("raw_messages") or [])
                logical = list(existing.get("posts") or [])
                reached_date_from = bool(
                    (existing.get("meta") or {}).get("reached_date_from")
                )
                if raw and logical:
                    print(
                        f"  resuming batch raw from disk: raw={len(raw)} "
                        f"logical={len(logical)} (skip Telegram re-fetch)",
                        flush=True,
                    )
                    try:
                        assert_raw_in_window(raw, date_from=date_from, date_to=date_to)
                    except RuntimeError as exc:
                        print(str(exc), file=sys.stderr, flush=True)
                        checkpoint["status"] = "aborted_date_violation"
                        checkpoint["stop_reason"] = str(exc)
                        save_checkpoint(checkpoint)
                        return 2
                else:
                    raw = []
                    logical = []

            if not raw:
                try:
                    await ensure_telegram()
                except RuntimeError as exc:
                    print(str(exc), file=sys.stderr)
                    return 1
                assert tg is not None and entity is not None
                collected_raw: list[dict[str, Any]] = []
                page_offset = offset_id
                reached_date_from = False
                while True:
                    try:
                        page, reached_date_from = await fetch_raw_batch(
                            tg,
                            entity,
                            offset_id=page_offset,
                            max_raw=400,
                            date_from=date_from,
                            date_to=date_to,
                        )
                    except FloodWaitError as exc:
                        print(f"FloodWait {exc.seconds}s", flush=True)
                        await asyncio.sleep(exc.seconds + 1)
                        continue
                    if not page:
                        break
                    try:
                        assert_raw_in_window(page, date_from=date_from, date_to=date_to)
                    except RuntimeError as exc:
                        print(str(exc), file=sys.stderr, flush=True)
                        checkpoint["status"] = "aborted_date_violation"
                        checkpoint["stop_reason"] = str(exc)
                        save_checkpoint(checkpoint)
                        return 2
                    collected_raw.extend(page)
                    page_offset = min(m["message_id"] for m in page)
                    tentative = prepare_logical_posts(collected_raw, batch_no, assign_ids=False)
                    print(
                        f"  fetched_raw={len(collected_raw)} logical≈{len(tentative)} "
                        f"page_oldest={page_offset} reached_date_from={reached_date_from}",
                        flush=True,
                    )
                    if reached_date_from:
                        break
                    if len(tentative) >= BATCH_LOGICAL_TARGET:
                        break
                    if len(collected_raw) >= BATCH_LOGICAL_TARGET * 4:
                        break

                raw = collected_raw
                if not raw:
                    checkpoint["status"] = "completed"
                    checkpoint["stop_reason"] = "reached_start_date_or_empty"
                    save_checkpoint(checkpoint)
                    print("No more messages in scope (start_date reached or empty). Done.", flush=True)
                    break

                try:
                    assert_raw_in_window(raw, date_from=date_from, date_to=date_to)
                except RuntimeError as exc:
                    print(str(exc), file=sys.stderr, flush=True)
                    checkpoint["status"] = "aborted_date_violation"
                    checkpoint["stop_reason"] = str(exc)
                    save_checkpoint(checkpoint)
                    return 2

                logical = prepare_logical_posts(raw, batch_no)
                if len(logical) > BATCH_LOGICAL_TARGET:
                    keep = logical[:BATCH_LOGICAL_TARGET]
                    cutoff = min(
                        mid
                        for p in keep
                        for mid in (p.get("source_message_ids") or [p["primary_message_id"]])
                    )
                    logical = [
                        p
                        for p in logical
                        if max(p.get("source_message_ids") or [p["primary_message_id"]]) >= cutoff
                    ][:BATCH_LOGICAL_TARGET]
                    keep_ids = {
                        mid for p in logical for mid in (p.get("source_message_ids") or [])
                    }
                    raw = [m for m in raw if m["message_id"] in keep_ids]

                raw_path.write_text(
                    json.dumps(
                        {
                            "meta": {
                                "batch": batch_no,
                                "raw_count": len(raw),
                                "chat_id": CHAT_ID,
                                "prefix": PREFIX,
                                "date_from": date_from.isoformat(),
                                "date_to": date_to.isoformat(),
                                "reached_date_from": reached_date_from,
                            },
                            "raw_messages": raw,
                            "posts": logical,
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )

            if not logical:
                oldest = min(m["message_id"] for m in raw)
                newest = max(m["message_id"] for m in raw)
                checkpoint["oldest_processed_message_id"] = oldest
                if checkpoint.get("newest_processed_message_id") is None:
                    checkpoint["newest_processed_message_id"] = newest
                checkpoint["processed_raw_messages"] = int(
                    checkpoint.get("processed_raw_messages") or 0
                ) + len(raw)
                save_checkpoint(checkpoint)
                if reached_date_from:
                    checkpoint["status"] = "completed"
                    checkpoint["stop_reason"] = "reached_start_date"
                    save_checkpoint(checkpoint)
                    print("Reached date_from boundary.", flush=True)
                    break
                continue

            try:
                analyzed = analyze_batch(
                    logical,
                    client_llm,
                    tracker,
                    workers=args.workers,
                    checkpoint=checkpoint,
                    partial_path=partial_path,
                )
            except RuntimeError as exc:
                print(str(exc), flush=True)
                break

            apply_deduplication(analyzed)
            for a in analyzed:
                a["duplicate_of_internal_post_id"] = a.get("duplicate_of_internal_post_id")

            summary = batch_summary(analyzed, len(raw), batch_no)
            summary["cost_so_far"] = tracker.as_dict()

            analyzed_path = BATCH_DIR / f"batch_{batch_no:04d}_analyzed.json"
            summary_path = BATCH_DIR / f"batch_{batch_no:04d}_summary.json"
            analyzed_path.write_text(
                json.dumps({"meta": summary, "posts": analyzed}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            summary_path.write_text(
                json.dumps(summary, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            if partial_path.exists():
                partial_path.unlink()

            oldest = min(m["message_id"] for m in raw)
            newest = max(m["message_id"] for m in raw)
            if checkpoint.get("newest_processed_message_id") is None:
                checkpoint["newest_processed_message_id"] = newest
            checkpoint["oldest_processed_message_id"] = oldest
            checkpoint["processed_raw_messages"] = int(
                checkpoint.get("processed_raw_messages") or 0
            ) + len(raw)
            checkpoint["processed_logical_posts"] = int(
                checkpoint.get("processed_logical_posts") or 0
            ) + len(analyzed)
            checkpoint["completed_batches"] = batch_no
            checkpoint["last_completed_batch"] = f"batch_{batch_no:04d}"
            checkpoint["cost"] = tracker.as_dict()
            dates = [m.get("message_date") for m in raw if m.get("message_date")]
            if dates:
                checkpoint["date_newest"] = max(
                    checkpoint.get("date_newest") or dates[0], max(dates)
                )
                checkpoint["date_oldest"] = min(
                    checkpoint.get("date_oldest") or dates[0], min(dates)
                )
                oldest_kept = parse_iso_dt(str(checkpoint["date_oldest"]))
                if oldest_kept is not None and oldest_kept < date_from:
                    msg = (
                        f"ABORT: checkpoint date_oldest={checkpoint['date_oldest']} "
                        f"< start_date={date_from.date()}"
                    )
                    print(msg, file=sys.stderr, flush=True)
                    checkpoint["status"] = "aborted_date_violation"
                    checkpoint["stop_reason"] = msg
                    save_checkpoint(checkpoint)
                    return 2
            save_checkpoint(checkpoint)
            print(
                f"Batch {batch_no:04d} done: logical={len(analyzed)} "
                f"accepted={summary['accepted']} review={summary['needs_review']} "
                f"rejected={summary['rejected']} cost=${tracker.cost_usd:.4f}",
                flush=True,
            )

            if args.max_batches and batch_no >= args.max_batches:
                checkpoint["status"] = "stopped_max_batches"
                checkpoint["stop_reason"] = f"max_batches={args.max_batches}"
                save_checkpoint(checkpoint)
                break

            if reached_date_from:
                checkpoint["status"] = "completed"
                checkpoint["stop_reason"] = "reached_start_date"
                save_checkpoint(checkpoint)
                print("Reached date_from boundary. Stopping (no deeper history).", flush=True)
                break

    finally:
        if tg is not None:
            await tg.disconnect()

    if int(checkpoint.get("completed_batches") or 0) > 0:
        print("\n=== Finalizing global outputs ===", flush=True)
        summary = finalize(tracker, checkpoint)
        if checkpoint.get("status") == "running":
            checkpoint["status"] = "completed"
            save_checkpoint(checkpoint)
        print(
            json.dumps(
                {
                    k: summary[k]
                    for k in (
                        "logical_posts",
                        "accepted",
                        "needs_review",
                        "rejected",
                        "unique_entities",
                        "cost",
                        "date_range",
                        "date_from",
                        "date_to",
                        "prefix",
                        "status",
                    )
                    if k in summary
                },
                ensure_ascii=False,
                indent=2,
            ),
            flush=True,
        )
    return 0


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Scoped Telegram collector (date window required)")
    p.add_argument("--chat-id", type=int, default=DEFAULT_CHAT_ID)
    p.add_argument("--prefix", type=str, default=DEFAULT_PREFIX)
    p.add_argument("--chat-title", type=str, default=None, help="Optional display title")
    p.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    p.add_argument("--max-batches", type=int, default=None, help="Optional cap for testing")
    p.add_argument("--finalize-only", action="store_true", help="Only rebuild finals from batches")
    p.add_argument("--date-from", type=str, default=None, help="YYYY-MM-DD inclusive (required)")
    p.add_argument("--date-to", type=str, default=None, help="YYYY-MM-DD inclusive (required)")
    p.add_argument(
        "--allow-full-history",
        action="store_true",
        help="FORBIDDEN: present only to hard-reject if passed",
    )
    p.add_argument(
        "--skip-estimate",
        action="store_true",
        help="Resume without re-scanning Telegram history; reuse cached scope_estimate",
    )
    p.add_argument(
        "--confirm-run",
        action="store_true",
        help="Required to start LLM after estimate. Without it, only estimate runs.",
    )
    p.add_argument(
        "--max-cost-usd",
        type=float,
        default=None,
        help="Override TELEGRAM_LLM_MAX_COST_USD after loading .env (per-run budget)",
    )
    p.add_argument(
        "--llm-provider",
        type=str,
        default=None,
        choices=["openrouter", "openai", "anthropic"],
        help="Override TELEGRAM_LLM_PROVIDER after loading .env",
    )
    p.add_argument(
        "--llm-model",
        type=str,
        default=None,
        help="Override TELEGRAM_LLM_MODEL after loading .env",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    load_env()
    if args.max_cost_usd is not None and args.max_cost_usd > 0:
        os.environ["TELEGRAM_LLM_MAX_COST_USD"] = str(args.max_cost_usd)
    if args.llm_provider:
        os.environ["TELEGRAM_LLM_PROVIDER"] = args.llm_provider
    if args.llm_model:
        os.environ["TELEGRAM_LLM_MODEL"] = args.llm_model
    configure_run(
        chat_id=args.chat_id,
        prefix=args.prefix,
        chat_title=args.chat_title,
    )
    if args.finalize_only:
        cp = load_checkpoint()
        tracker = CostTracker(
            model=cp.get("model") or "openai/gpt-4o-mini",
            max_cost_usd=load_max_cost_usd(20.0),
        )
        cost = cp.get("cost") or {}
        tracker.input_tokens = int(cost.get("input_tokens") or 0)
        tracker.output_tokens = int(cost.get("output_tokens") or 0)
        tracker.requests = int(cost.get("requests") or 0)
        finalize(tracker, cp)
        return 0
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
