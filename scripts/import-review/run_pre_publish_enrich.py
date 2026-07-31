#!/usr/bin/env python3
"""P5A–P5C pre-publish enrich orchestrator for Admin Review.

Reuses existing queue enrichment only (`run_enrichment_pipeline` steps).
Does NOT invent new enrichers, does NOT touch published entities.
Auto launch stays OFF (no cron). Manual UI trigger is allowed via --ndjson
(streamed from admin Preview «Обогатить»).

Stages:
  P5A  Auto — source_text + website + directories (fill-empty)
  P5B  AI   — record existing ai_* signals; skip generative (entity-only)
  P5C  Quality — completeness score via score_queue_item
  then tag [ready_for_moderator] (even if P5A partial)

Default: dry-run. Use --apply to write patches + tags.
Optional: --promote-in-review sets review_status=in_review after apply.

Usage:
  python3 scripts/import-review/run_pre_publish_enrich.py --ids UUID1,UUID2
  python3 scripts/import-review/run_pre_publish_enrich.py --ids UUID1 --apply
  python3 scripts/import-review/run_pre_publish_enrich.py --ids UUID1 --apply --promote-in-review
  python3 scripts/import-review/run_pre_publish_enrich.py --ids UUID1 --apply --ndjson
  python3 scripts/import-review/run_pre_publish_enrich.py --limit 5 --entity business

Env PRE_PUBLISH_ENRICH_AUTO must stay unset/0 — this script never auto-schedules.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from enrich_resource_queue import run_resource_bfs  # noqa: E402
from review_tags import (  # noqa: E402
    TAG_ENRICH_P5A_DONE,
    TAG_ENRICH_P5A_FAILED,
    TAG_ENRICH_P5A_PARTIAL,
    TAG_ENRICH_P5B_DONE,
    TAG_ENRICH_P5B_SKIPPED,
    TAG_ENRICH_P5C_DONE,
    TAG_EVENT_DATE_CONFIRMED,
    TAG_READY_FOR_MODERATOR,
    merge_enrich_tags,
)
from entity_title_from_text import apply_title_to_queue  # noqa: E402
from telegram_profile_avatar import TelegramQueueAvatarEnricher  # noqa: E402
from structure_event_from_text import (  # noqa: E402
    apply_structured_event_to_queue,
    parse_payment_methods,
    structure_event_from_text,
)
import run_enrichment_pipeline as rep  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "pre_publish_enrich"
OUT.mkdir(parents=True, exist_ok=True)

# Queue statuses eligible for pre-publish enrich (never approved / published).
OPEN_STATUSES = {"pending", "in_review", "needs_more_info", "ready_to_publish"}

ENTITY_REVERSE = {v: k for k, v in rep.ENTITY_MAP.items()}

SELECT = (
    "id,entity_type,review_status,review_notes,title,business_name,person_name,"
    "category,description,source_text,source_url,source,source_group,city,state,price,currency,"
    "address_line,postal_code,"
    "source_chat_id,source_message_ids,source_author_id,source_author_username,"
    "source_author_display_name,"
    "payment_methods,"
    "phone,whatsapp,email,website,instagram,telegram_username,telegram_user_id,"
    "services,preview_image_url,photos_count,ai_decision,ai_confidence,ai_reason,"
    "published_entity_id,published_entity_type,raw_payload"
)


def fetch_by_ids(client: SupabaseRest, ids: list[str]) -> list[dict[str, Any]]:
    if not ids:
        return []
    # PostgREST: id=in.(a,b,c)
    joined = ",".join(ids)
    return (
        client._request(
            "GET",
            "/import_review_items",
            params={"select": SELECT, "id": f"in.({joined})"},
        )
        or []
    )


def fetch_limited(
    client: SupabaseRest, entity_key: str, limit: int
) -> list[dict[str, Any]]:
    entity_type = rep.ENTITY_MAP[entity_key]
    return (
        client._request(
            "GET",
            "/import_review_items",
            params={
                "select": SELECT,
                "entity_type": f"eq.{entity_type}",
                "review_status": f"in.({','.join(sorted(OPEN_STATUSES))})",
                "order": "updated_at.asc",
                "limit": str(limit),
            },
        )
        or []
    )


def p5b_tag(item: dict[str, Any]) -> str:
    """Reuse existing AI signals; do not call OpenRouter / generative summary."""
    if item.get("ai_decision") or item.get("ai_confidence") is not None:
        return TAG_ENRICH_P5B_DONE
    return TAG_ENRICH_P5B_SKIPPED


def emit_ndjson(obj: dict[str, Any]) -> None:
    """One JSON object per line for UI streaming (stdout)."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def run_one(
    item: dict[str, Any],
    *,
    by_phone: dict,
    by_name: dict,
    no_website: bool,
    website_pages: int,
    apply: bool,
    promote: bool,
    client: SupabaseRest,
    avatar_enricher: TelegramQueueAvatarEnricher,
    ndjson: bool = False,
) -> dict[str, Any]:
    item_id = item["id"]
    label = (
        item.get("business_name")
        or item.get("person_name")
        or item.get("title")
        or item_id
    )[:80]
    status = item.get("review_status")
    resource_log: list[dict[str, Any]] = []

    def progress(
        step: str,
        status_s: str,
        *,
        detail: str | None = None,
        found: list[str] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if not ndjson:
            return
        payload: dict[str, Any] = {
            "type": "step",
            "id": item_id,
            "step": step,
            "status": status_s,
        }
        if detail:
            payload["detail"] = detail
        if found is not None:
            payload["found"] = found
        if extra:
            payload.update(extra)
        emit_ndjson(payload)

    def emit_resource(ev: dict[str, Any]) -> None:
        if ev.get("status") in ("done", "error", "skipped"):
            resource_log.append(
                {
                    "url": ev.get("url"),
                    "kind": ev.get("kind") or "website",
                    "status": ev.get("status"),
                    "outcome": ev.get("outcome"),
                    "fields": ev.get("fields") or [],
                    "error": ev.get("error"),
                }
            )
        if ndjson:
            emit_ndjson(ev)

    if ndjson:
        emit_ndjson(
            {
                "type": "started",
                "id": item_id,
                "label": label,
                "mode": "apply" if apply else "dry-run",
            }
        )

    if status not in OPEN_STATUSES:
        result = {
            "id": item_id,
            "label": label,
            "skipped": True,
            "reason": f"status={status} not open for pre-publish enrich",
        }
        if ndjson:
            emit_ndjson({"type": "finished", "result": result})
        return result
    if item.get("published_entity_id"):
        result = {
            "id": item_id,
            "label": label,
            "skipped": True,
            "reason": "already linked to published entity — refuse",
        }
        if ndjson:
            emit_ndjson({"type": "finished", "result": result})
        return result

    entity_type = item.get("entity_type")
    entity_key = ENTITY_REVERSE.get(entity_type or "")
    if not entity_key:
        notes = merge_enrich_tags(
            item.get("review_notes"),
            TAG_ENRICH_P5A_FAILED,
            TAG_ENRICH_P5B_SKIPPED,
            TAG_ENRICH_P5C_DONE,
            TAG_READY_FOR_MODERATOR,
        )
        result = {
            "id": item_id,
            "label": label,
            "p5a": "failed",
            "p5b": "skipped",
            "p5c": "done",
            "reason": f"unsupported entity_type={entity_type}",
            "patch": {},
            "score_before": None,
            "score_after": None,
            "review_notes": notes,
            "steps": {"source_text": [], "website": [], "directories": []},
            "directory_match": None,
            "promoted": False,
        }
        if apply:
            body: dict[str, Any] = {
                "review_notes": notes,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if promote and status == "pending":
                body["review_status"] = "in_review"
                result["promoted"] = True
            client.patch("import_review_items", {"id": f"eq.{item_id}"}, body)
        if ndjson:
            emit_ndjson({"type": "finished", "result": result})
        return result

    patch: dict[str, Any] = {}
    score_before = rep.score_queue_item(entity_key, item, {})

    progress(
        "source_text",
        "running",
        detail="Ищем телефон, email, сайт, Instagram, Telegram в тексте…",
    )
    f1 = rep.step_source_text(item, patch)
    existing_payments = item.get("payment_methods") or []
    payment_blob = "\n".join(
        x
        for x in (item.get("description"), item.get("source_text"))
        if isinstance(x, str) and x.strip()
    )
    text_payments = parse_payment_methods(payment_blob)
    if not existing_payments and text_payments:
        patch["payment_methods"] = text_payments
        if "payment_methods" not in f1:
            f1.append("payment_methods")
    progress(
        "source_text",
        "done",
        detail=(
            f"Найдено: {', '.join(f1)}"
            if f1
            else "В тексте новых контактов не нашлось"
        ),
        found=f1,
    )

    progress(
        "title",
        "running",
        detail="Проверяем название: не метка ли из текста («Контакты», «Форма»)…",
    )
    title_patch, f_title = apply_title_to_queue({**item, **patch}, entity_key)
    for k, v in title_patch.items():
        patch[k] = v
    if f_title:
        label = str(title_patch.get("title") or label)[:80]
    progress(
        "title",
        "done" if f_title else "skipped",
        detail=(
            f"Название из текста: «{title_patch.get('title')}»"
            if f_title
            else "Название на карточке уже нормальное"
        ),
        found=f_title,
    )

    f_event: list[str] = []
    event_date_confirmed = False
    if entity_key == "event":
        progress(
            "event_structure",
            "running",
            detail="Разбираем афишу: дата, адрес, цена, форма, контакты…",
        )
        blob = "\n".join(
            x
            for x in (
                item.get("description"),
                item.get("source_text"),
                item.get("title"),
            )
            if isinstance(x, str) and x.strip()
        )
        structured = structure_event_from_text(blob)
        # Apply fill-empty onto merged view (item + patch so far)
        merged_view = {**item, **patch}
        ev_patch, f_event = apply_structured_event_to_queue(merged_view, structured)
        for k, v in ev_patch.items():
            patch[k] = v
        event_date_confirmed = bool(structured.get("date_from_labeled_field"))
        # Surface parsed when/price in review_notes for moderators (not raw_payload).
        note_bits: list[str] = []
        if structured.get("event_at_label"):
            note_bits.append(f"event_at: {structured['event_at_label']}")
            f_event.append("event_at")
        if structured.get("price_label"):
            note_bits.append(f"price_label: {structured['price_label']}")
            if "price" not in f_event:
                f_event.append("price_label")
        if structured.get("payment_methods"):
            methods = structured["payment_methods"]
            if isinstance(methods, list) and methods:
                note_bits.append(f"payment: {', '.join(str(m) for m in methods)}")
                f_event.append("payment_methods")
        if structured.get("registration_url"):
            note_bits.append(f"registration: {structured['registration_url']}")
            f_event.append("registration")
        occurrences = structured.get("occurrences") or []
        if len(occurrences) > 1:
            # Approve publishes one event per date — tell the moderator upfront.
            days = ", ".join(
                dict.fromkeys(str(o.get("starts_at") or "")[:10] for o in occurrences)
            )
            note_bits.append(f"dates: {days}")
            f_event.append("dates")
        if note_bits:
            # Stash on item so merge_enrich_tags path can append below via patch note.
            patch["_event_note_bits"] = note_bits
        progress(
            "event_structure",
            "done",
            detail=(
                f"Афиша: {', '.join(dict.fromkeys(f_event))}"
                if f_event
                else "Структурированных полей афиши не добавлено"
            ),
            found=list(dict.fromkeys(f_event)),
        )
    else:
        progress(
            "event_structure",
            "skipped",
            detail="Не событие — шаг афиши не нужен",
            found=[],
        )

    progress(
        "group_location",
        "running",
        detail="Ищем город/район в описании, затем в группе-источнике…",
    )
    f1b = rep.step_group_location(item, patch)
    progress(
        "group_location",
        "done",
        detail=(
            f"Локация: {', '.join(f1b)}"
            if f1b
            else "В описании/группе локация не найдена или город уже был"
        ),
        found=f1b,
    )

    website_error = False
    f2: list[str] = []
    skip_website = no_website
    if skip_website:
        progress(
            "website",
            "skipped",
            detail="Шаг сайта отключён",
            found=[],
        )
    elif entity_key == "event":
        progress(
            "website",
            "running",
            detail="Проверяем источник, регистрацию и найденные страницы на способы оплаты…",
        )
        event_urls: list[str] = []
        for raw_urls in (item.get("website"), patch.get("website")):
            values = raw_urls if isinstance(raw_urls, list) else [raw_urls]
            for value in values:
                url = str(value or "").strip()
                if url and url not in event_urls:
                    event_urls.append(url)
        try:
            bfs = run_resource_bfs(
                source_url=item.get("source_url"),
                card_urls=event_urls,
                max_resources=6,
                website_pages=website_pages,
                on_event=emit_resource if ndjson else None,
                sequential=True,
            )
            discovered_methods = [
                str(method).strip()
                for method in (bfs.get("found") or {}).get("payment_methods", [])
                if str(method).strip()
            ]
            if discovered_methods:
                event_note_bits = patch.get("_event_note_bits")
                if not isinstance(event_note_bits, list):
                    event_note_bits = []
                    patch["_event_note_bits"] = event_note_bits
                payment_note = f"payment: {', '.join(discovered_methods)}"
                if not any(str(bit).startswith("payment:") for bit in event_note_bits):
                    event_note_bits.append(payment_note)
                if "payment_methods" not in f_event:
                    f_event.append("payment_methods")
                f2 = ["payment_methods"]
            progress(
                "website",
                "done",
                detail=(
                    f"На ресурсах найдена оплата: {', '.join(discovered_methods)}"
                    if discovered_methods
                    else "На ресурсах способы оплаты не найдены"
                ),
                found=f2,
            )
        except Exception as exc:  # noqa: BLE001 — enrich must continue
            website_error = True
            progress(
                "website",
                "error",
                detail=f"Ошибка обхода ресурсов события: {exc}",
                found=[],
            )
    else:
        site = None
        try:
            site = (item.get("website") or patch.get("website") or [None])[0]
        except (TypeError, IndexError):
            site = None
        progress(
            "website",
            "running",
            detail=(
                f"Открываем сайт {site}…"
                if site
                else "Сайта нет — пропускаем сетевой шаг"
            ),
        )
        try:
            f2 = rep.step_website(
                item,
                patch,
                website_pages,
                on_resource=emit_resource if ndjson else None,
            )
        except Exception as exc:  # noqa: BLE001 — batch must continue
            website_error = True
            if not ndjson:
                print(f"    P5A website error {item_id}: {exc}")
            progress(
                "website",
                "error",
                detail=f"Ошибка загрузки сайта: {exc}",
                found=[],
            )
        else:
            progress(
                "website",
                "done",
                detail=(
                    f"С сайта: {', '.join(f2)}"
                    if f2
                    else "Сайт не дал новых полей"
                ),
                found=f2,
            )

    progress(
        "directories",
        "running",
        detail="Сверяем со справочниками (svoi, rop, boston, echoru)…",
    )
    f3, match_kind = rep.step_directories(item, patch, by_phone, by_name)
    progress(
        "directories",
        "done",
        detail=(
            f"Совпадение по {match_kind}: {', '.join(f3)}"
            if match_kind and f3
            else (
                f"Карточка найдена ({match_kind}), новых полей нет"
                if match_kind
                else "В справочниках совпадений нет"
            )
        ),
        found=f3,
        extra={"directory_match": match_kind},
    )

    progress(
        "telegram_avatar",
        "running",
        detail="Проверяем аватар автора саморекламы в Telegram…",
    )
    avatar_url, avatar_outcome, avatar_error = avatar_enricher.enrich(
        {**item, **patch},
        apply=apply,
    )
    f_avatar: list[str] = []
    if avatar_url:
        patch["preview_image_url"] = avatar_url
        f_avatar = ["preview_image_url"]
        progress(
            "telegram_avatar",
            "done",
            detail="Аватар Telegram добавлен как фото карточки",
            found=f_avatar,
        )
    elif avatar_error:
        progress(
            "telegram_avatar",
            "error",
            detail=f"Аватар Telegram недоступен: {avatar_error}",
            found=[],
        )
    else:
        detail_by_outcome = {
            "not_telegram": "Источник не Telegram — шаг не нужен",
            "image_exists": "На карточке уже есть фото",
            "self_promo_not_confirmed": "Самореклама не подтверждена — аватар автора не используем",
            "no_author_reference": "Нет ссылки на профиль автора Telegram",
        }
        progress(
            "telegram_avatar",
            "skipped",
            detail=detail_by_outcome.get(
                avatar_outcome,
                "Аватар Telegram не найден",
            ),
            found=[],
        )

    progress(
        "ai_signals",
        "running",
        detail="Проверяем уже сохранённые AI-сигналы (без вызова LLM)…",
    )
    p5b = p5b_tag(item)
    progress(
        "ai_signals",
        "done" if p5b == TAG_ENRICH_P5B_DONE else "skipped",
        detail=(
            "AI-поля уже есть на карточке"
            if p5b == TAG_ENRICH_P5B_DONE
            else "Генеративный AI на этом шаге не запускается"
        ),
    )

    score_after = rep.score_queue_item(entity_key, item, patch)
    progress(
        "score",
        "done",
        detail=f"Полнота: {score_before} → {score_after}",
        extra={"score_before": score_before, "score_after": score_after},
    )

    any_step = bool(f1 or f1b or f2 or f3 or f_event or f_title or f_avatar)
    if website_error and not any_step:
        p5a_tag = TAG_ENRICH_P5A_PARTIAL
        p5a_state = "partial"
    elif website_error:
        p5a_tag = TAG_ENRICH_P5A_PARTIAL
        p5a_state = "partial"
    else:
        p5a_tag = TAG_ENRICH_P5A_DONE
        p5a_state = "done"

    note_tags = [
        p5a_tag,
        p5b,
        TAG_ENRICH_P5C_DONE,
        TAG_READY_FOR_MODERATOR,
    ]
    if event_date_confirmed:
        note_tags.append(TAG_EVENT_DATE_CONFIRMED)
    notes = merge_enrich_tags(item.get("review_notes"), *note_tags)
    event_note_bits = patch.pop("_event_note_bits", None)
    if isinstance(event_note_bits, list) and event_note_bits:
        extra = " | ".join(str(x) for x in event_note_bits if x)
        if extra and extra not in (notes or ""):
            notes = f"{(notes or '').rstrip()} {extra}".strip()

    result = {
        "id": item_id,
        "label": label,
        "entity": entity_key,
        "p5a": p5a_state,
        "p5b": "done" if p5b == TAG_ENRICH_P5B_DONE else "skipped",
        "p5c": "done",
        "score_before": score_before,
        "score_after": score_after,
        "patch": {k: v for k, v in patch.items() if not str(k).startswith("_")},
        "steps": {
            "source_text": f1,
            "title": f_title,
            "event_structure": f_event,
            "group_location": f1b,
            "website": f2,
            "directories": f3,
            "telegram_avatar": f_avatar,
        },
        "resources": resource_log,
        "resources_ok": sum(1 for r in resource_log if r.get("outcome") == "ok"),
        "resources_failed": sum(
            1 for r in resource_log if r.get("outcome") in ("empty", "error")
        ),
        "directory_match": match_kind,
        "review_notes": notes,
        "promoted": False,
        "previous_status": status,
        "new_status": status,
    }

    if apply:
        progress(
            "apply",
            "running",
            detail="Сохраняем найденные поля в карточку…",
        )
        body = {
            **{k: v for k, v in patch.items() if not str(k).startswith("_")},
            "review_notes": notes,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if promote and status in {"pending", "needs_more_info"}:
            body["review_status"] = "in_review"
            result["promoted"] = True
            result["new_status"] = "in_review"
        client.patch("import_review_items", {"id": f"eq.{item_id}"}, body)
        progress(
            "apply",
            "done",
            detail=(
                f"Записано полей: {', '.join(patch.keys()) or 'только теги'}"
            ),
            found=list(patch.keys()),
        )
    elif ndjson:
        progress(
            "apply",
            "skipped",
            detail="Dry-run — в БД ничего не писали",
        )

    if ndjson:
        emit_ndjson({"type": "finished", "result": result})
    return result


def main() -> int:
    if os.environ.get("PRE_PUBLISH_ENRICH_AUTO", "").strip() in {"1", "true", "yes"}:
        print(
            "REFUSING: PRE_PUBLISH_ENRICH_AUTO is set. "
            "Unset it — auto launch is intentionally disabled.",
            file=sys.stderr,
        )
        return 2

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--ids",
        default="",
        help="comma-separated import_review_items.id (preferred for dry tests)",
    )
    parser.add_argument(
        "--entity",
        choices=sorted(rep.ENTITY_MAP),
        default="business",
        help="used only with --limit (default business)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="fetch N open queue rows when --ids omitted (cap small for tests)",
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--promote-in-review",
        action="store_true",
        help="after --apply, set pending/needs_more_info → in_review",
    )
    parser.add_argument("--no-website", action="store_true")
    parser.add_argument(
        "--website-pages",
        type=int,
        default=10,
        help="max same-host pages per website BFS",
    )
    parser.add_argument(
        "--ndjson",
        action="store_true",
        help="stream progress + finished result as NDJSON on stdout (for admin UI)",
    )
    args = parser.parse_args()

    ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    if not ids and not args.limit:
        print("Provide --ids UUID,... or --limit N", file=sys.stderr)
        return 1
    if args.limit and args.limit > 20:
        print(
            "REFUSING: --limit > 20. Use a small test set (or pass explicit --ids).",
            file=sys.stderr,
        )
        return 1
    if args.promote_in_review and not args.apply:
        print("--promote-in-review requires --apply", file=sys.stderr)
        return 1
    if args.ndjson and len(ids) != 1:
        print("--ndjson requires exactly one --ids UUID", file=sys.stderr)
        return 1

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)
    avatar_enricher = TelegramQueueAvatarEnricher(url, key)

    items = fetch_by_ids(client, ids) if ids else fetch_limited(client, args.entity, args.limit)
    if ids and len(items) != len(ids):
        found = {r["id"] for r in items}
        missing = [i for i in ids if i not in found]
        print(f"warning: missing ids: {missing}", file=sys.stderr)
        if args.ndjson and missing:
            emit_ndjson(
                {
                    "type": "error",
                    "message": f"Карточка не найдена: {', '.join(missing)}",
                }
            )
            return 1

    by_phone, by_name = rep.load_directory_index()
    if not args.ndjson:
        print(
            f"mode={'APPLY' if args.apply else 'dry-run'}  "
            f"items={len(items)}  promote={args.promote_in_review}"
        )

    results: list[dict[str, Any]] = []
    try:
        for item in items:
            r = run_one(
                item,
                by_phone=by_phone,
                by_name=by_name,
                no_website=args.no_website,
                website_pages=args.website_pages,
                apply=args.apply,
                promote=args.promote_in_review,
                client=client,
                avatar_enricher=avatar_enricher,
                ndjson=args.ndjson,
            )
            results.append(r)
            if args.ndjson:
                continue
            label = r.get("label") or r["id"]
            if r.get("skipped"):
                print(f"  skip  {label}: {r.get('reason')}")
                continue
            patch_keys = ",".join((r.get("patch") or {}).keys()) or "—"
            print(
                f"  {'APPLIED' if args.apply else 'would'}  {label}: "
                f"p5a={r.get('p5a')} p5b={r.get('p5b')} "
                f"score {r.get('score_before')}→{r.get('score_after')} "
                f"fields={patch_keys}"
            )
    finally:
        avatar_enricher.close()

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "promote_in_review": args.promote_in_review,
        "auto_launch": False,
        "processed": len(results),
        "records": results,
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if args.apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if not args.ndjson:
        print("report", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
