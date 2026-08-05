#!/usr/bin/env python3
"""Cheap LLM triage for import_review «Разбор» lane — propose actions, no mass enrich.

Default: dry-run → writes scripts/import-review/data/llm_lane_triage_latest.json

Usage:
  PYTHONPATH=scripts/import-review python3 scripts/import-review/llm_lane_triage.py
  PYTHONPATH=scripts/import-review python3 scripts/import-review/llm_lane_triage.py --limit 50
  PYTHONPATH=scripts/import-review python3 scripts/import-review/llm_lane_triage.py --apply

--apply (confidence >= 0.75): seeking / quarantine / route_entity.
enrich → only [llm_enrich] tag, never runs enrich pipeline.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import ENTITY_TYPES, TARGET_COLLECTIONS, SupabaseRest, load_env

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "scripts" / "import-review" / "data" / "llm_lane_triage_latest.json"
OUT_DIR = OUT.parent

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
TAG_SEEKING = "[seeking]"
TAG_QUARANTINE = "[quarantine]"
TAG_LLM_ENRICH = "[llm_enrich]"

CHEAP_PAID_MODELS = [
    "openai/gpt-4.1-nano",
    "google/gemini-2.5-flash-lite",
    "amazon/nova-micro-v1",
]
# Working free router (paid list may 402 without credits).
FREE_FALLBACK = [
    "openrouter/free",
    "google/gemma-4-31b-it:free",
    "openai/gpt-oss-20b:free",
]
OPENAI_DIRECT_MODELS = ["gpt-4.1-nano", "gpt-4o-mini"]

ACTIONS = {
    "attach",
    "route_entity",
    "seeking",
    "ready",
    "quarantine",
    "enrich",
    "needs_human",
}
ACTION_TO_LANE = {
    "attach": "attach",
    "route_entity": "route",
    "seeking": "seeking",
    "ready": "ready",
    "quarantine": "quarantine",
    "enrich": "route",
    "needs_human": "review",
}

SEEKING_RE = re.compile(
    r"(?:^|[\n.!?])\s*(?:ищу|ищем|нужен|нужна|нужно|посоветуйте|looking\s+for)\b",
    re.I,
)
SELF_OFFER_RE = re.compile(
    r"(?:предлагаю|оказываю|записывайтесь|прайс|открыта\s+запись)",
    re.I,
)
OPEN_IR = ("pending", "in_review", "needs_more_info", "ready_to_publish")
APPLY_MIN_CONF = 0.75


def has_contact(row: dict) -> bool:
    for key in ("phone", "email", "website", "instagram", "telegram_username"):
        v = row.get(key)
        if isinstance(v, list) and any(str(x).strip() for x in v):
            return True
        if isinstance(v, str) and v.strip():
            return True
    return False


def blob(row: dict) -> str:
    parts = [
        row.get("title"),
        row.get("business_name"),
        row.get("person_name"),
        row.get("description"),
        row.get("source_text"),
    ]
    return "\n".join(str(p) for p in parts if p)


def append_tag(notes: str | None, tag: str) -> str:
    base = (notes or "").strip()
    if tag in base:
        return base
    return f"{base}\n{tag}".strip() if base else tag


def classify_det(row: dict) -> str:
    """Mirror audit_admin_lanes.classify_ir — only «review» goes to LLM."""
    status = (row.get("review_status") or "").lower()
    notes = row.get("review_notes") or ""
    if status == "quarantine" or TAG_QUARANTINE in notes:
        return "quarantine"
    if TAG_SEEKING in notes:
        return "seeking"
    text = blob(row)
    if SEEKING_RE.search(text) and not (
        SELF_OFFER_RE.search(text) and has_contact(row)
    ):
        if not has_contact(row) or not SELF_OFFER_RE.search(text):
            return "seeking"
    if status == "ready_to_publish":
        return "ready"
    if len(text.replace(" ", "").strip()) < 8 and not has_contact(row):
        return "quarantine"
    if row.get("entity_type") and row.get("target_collection"):
        return "route"
    return "review"


def model_chain() -> list[str]:
    """Paid first; always append free fallback (triage must work on $0 credits)."""
    env = [
        m.strip()
        for m in (os.environ.get("OPENROUTER_CHEAP_MODELS") or "").split(",")
        if m.strip()
    ]
    paid = env or list(CHEAP_PAID_MODELS)
    # Dedupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for m in paid + FREE_FALLBACK:
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out


def extract_json_object(text: str) -> dict[str, Any] | None:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def build_prompt(title: str, text: str) -> str:
    return (
        "You triage Russian diaspora California directory queue posts.\n"
        "Return ONLY JSON:\n"
        '{"action":"attach|route_entity|seeking|ready|quarantine|enrich|needs_human",'
        '"entityType":"business|private_specialist|marketplace_listing|job|event|'
        'real_estate|lechu_listing|transfer_listing|null",'
        '"targetCollection":"businesses|private_specialists|marketplace|jobs|events|'
        'real_estate|lechu|transfers|null",'
        '"reason":"short","confidence":0.0}\n'
        "Rules:\n"
        "- seeking = demand («ищу…»), not a seller offer\n"
        "- attach = recommendation for an existing business/person, not a new card\n"
        "- quarantine = empty spam / no recoverable catalog value\n"
        "- route_entity = clear section, structured enough to type, enrich not urgent\n"
        "- enrich = recoverable offer but missing category/description/contacts "
        "to extract from text\n"
        "- ready = has name + contact + clear type, publishable soon\n"
        "- needs_human = unclear\n"
        "- Never invent phone/email/address\n"
        f"Title: {title}\n"
        f"Text:\n{text[:2500]}"
    )


def parse_suggestion(
    parsed: dict[str, Any], model: str
) -> dict[str, Any] | None:
    action = str(parsed.get("action") or "needs_human")
    if action not in ACTIONS:
        return None
    et = parsed.get("entityType")
    tc = parsed.get("targetCollection")
    if et is not None and et != "null" and str(et) not in ENTITY_TYPES:
        et = None
    if tc is not None and tc != "null" and str(tc) not in TARGET_COLLECTIONS:
        tc = None
    conf_raw = parsed.get("confidence")
    try:
        conf = float(0.5 if conf_raw is None else conf_raw)
    except (TypeError, ValueError):
        conf = 0.5
    return {
        "action": action,
        "lane": ACTION_TO_LANE[action],
        "entityType": None if et in (None, "null") else str(et),
        "targetCollection": None if tc in (None, "null") else str(tc),
        "reason": str(parsed.get("reason") or model)[:200],
        "confidence": max(0.0, min(1.0, conf)),
        "model": model,
    }


def call_chat(
    url: str,
    api_key: str,
    model: str,
    prompt: str,
    *,
    openrouter: bool,
) -> dict[str, Any] | None:
    payload = {
        "model": model,
        "temperature": 0,
        "max_tokens": 220,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if openrouter:
        headers["HTTP-Referer"] = "https://krugi.app"
        headers["X-Title"] = "KRUGI admin lane triage"
    req = urllib.request.Request(
        url,
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    content = (
        ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
        or ""
    )
    parsed = extract_json_object(content)
    if not parsed:
        return None
    return parse_suggestion(parsed, model)


def llm_suggest(
    openrouter_key: str | None,
    openai_key: str | None,
    title: str,
    text: str,
) -> dict[str, Any] | None:
    """Prefer OpenAI nano when available (OpenRouter often 402/429 on free)."""
    prompt = build_prompt(title, text)
    last_err: Exception | None = None

    if openai_key:
        for model in OPENAI_DIRECT_MODELS:
            try:
                sug = call_chat(
                    OPENAI_URL,
                    openai_key,
                    model,
                    prompt,
                    openrouter=False,
                )
                if sug:
                    return sug
            except urllib.error.HTTPError as exc:
                last_err = exc
                time.sleep(0.25)
                continue
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                time.sleep(0.3)
                continue

    if openrouter_key:
        for model in model_chain():
            try:
                sug = call_chat(
                    OPENROUTER_URL,
                    openrouter_key,
                    model,
                    prompt,
                    openrouter=True,
                )
                if sug:
                    return sug
            except urllib.error.HTTPError as exc:
                last_err = exc
                time.sleep(0.15 if exc.code in (402, 429) else 0.4)
                continue
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                time.sleep(0.35)
                continue

    if last_err:
        err_name = type(last_err).__name__
        code = getattr(last_err, "code", None)
        reason = f"llm_error:{err_name}" + (f":{code}" if code else "")
        return {
            "action": "needs_human",
            "lane": "review",
            "entityType": None,
            "targetCollection": None,
            "reason": reason,
            "confidence": 0.0,
            "model": None,
            "error": True,
        }
    return None


def fetch_all(client: SupabaseRest, limit: int) -> list[dict]:
    out: list[dict] = []
    page = 1000
    offset = 0
    while len(out) < limit:
        chunk = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": (
                        "id,review_status,review_notes,entity_type,target_collection,"
                        "title,business_name,person_name,description,source_text,"
                        "phone,email,website,instagram,telegram_username,category"
                    ),
                    "review_status": f"in.({','.join(OPEN_IR)})",
                    "order": "created_at.desc",
                    "limit": str(min(page, limit - len(out))),
                    "offset": str(offset),
                },
            )
            or []
        )
        if not chunk:
            break
        out.extend(chunk)
        if len(chunk) < page:
            break
        offset += len(chunk)
    return out


def apply_suggestion(
    client: SupabaseRest, row: dict, suggestion: dict[str, Any]
) -> str | None:
    """Apply high-confidence lane writes. Never runs enrich pipeline."""
    action = suggestion.get("action")
    conf = float(suggestion.get("confidence") or 0)
    if conf < APPLY_MIN_CONF:
        return None
    notes = row.get("review_notes")

    if action == "seeking":
        new_notes = append_tag(notes, TAG_SEEKING)
        if new_notes == (notes or "").strip():
            return None
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{row['id']}"},
            body={"review_notes": new_notes},
            prefer="return=minimal",
        )
        return "seeking"

    if action == "quarantine":
        new_notes = append_tag(notes, TAG_QUARANTINE)
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{row['id']}"},
            body={
                "review_status": "quarantine",
                "review_notes": new_notes,
                "reject_reason": "quarantine",
            },
            prefer="return=minimal",
        )
        return "quarantine"

    if action == "route_entity":
        et = suggestion.get("entityType")
        tc = suggestion.get("targetCollection")
        if not et or not tc:
            return None
        body: dict[str, Any] = {}
        if not row.get("entity_type"):
            body["entity_type"] = et
        if not row.get("target_collection"):
            body["target_collection"] = tc
        if not body:
            return None
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{row['id']}"},
            body=body,
            prefer="return=minimal",
        )
        return "route"

    if action == "enrich":
        new_notes = append_tag(notes, TAG_LLM_ENRICH)
        if new_notes == (notes or "").strip():
            return None
        body2: dict[str, Any] = {"review_notes": new_notes}
        et = suggestion.get("entityType")
        tc = suggestion.get("targetCollection")
        if et and not row.get("entity_type"):
            body2["entity_type"] = et
        if tc and not row.get("target_collection"):
            body2["target_collection"] = tc
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{row['id']}"},
            body=body2,
            prefer="return=minimal",
        )
        return "enrich_tag"

    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=2000, help="Max open IR rows to scan")
    ap.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Concurrent OpenRouter calls (default 4)",
    )
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Write seeking/quarantine/route/enrich-tag at confidence>=0.75",
    )
    ap.add_argument(
        "--from-report",
        type=str,
        default="",
        help="Re-apply from an existing triage JSON (skip LLM)",
    )
    args = ap.parse_args()
    load_env()

    openrouter_key = (os.environ.get("OPENROUTER_API_KEY") or "").strip() or None
    openai_key = (os.environ.get("OPENAI_API_KEY") or "").strip() or None
    if not args.from_report and not openrouter_key and not openai_key:
        print("Need OPENROUTER_API_KEY or OPENAI_API_KEY", file=sys.stderr)
        return 1

    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    items: list[dict[str, Any]] = []
    applied: Counter[str] = Counter()

    if args.from_report:
        report_path = Path(args.from_report)
        prev = json.loads(report_path.read_text(encoding="utf-8"))
        items = prev.get("items") or []
        if args.apply:
            # Need fresh notes/status for patches
            ids = [it["id"] for it in items if it.get("id")]
            by_id: dict[str, dict] = {}
            for i in range(0, len(ids), 100):
                chunk_ids = ids[i : i + 100]
                rows = (
                    client._request(
                        "GET",
                        "/import_review_items",
                        params={
                            "select": "id,review_status,review_notes,entity_type,target_collection",
                            "id": f"in.({','.join(chunk_ids)})",
                        },
                    )
                    or []
                )
                for r in rows:
                    by_id[r["id"]] = r
            for it in items:
                row = by_id.get(it["id"])
                if not row:
                    continue
                sug = {
                    "action": it.get("action"),
                    "confidence": it.get("confidence"),
                    "entityType": it.get("entityType"),
                    "targetCollection": it.get("targetCollection"),
                }
                action = apply_suggestion(client, row, sug)
                if action:
                    applied[action] += 1
            summary = {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "mode": "apply_from_report",
                "report": str(report_path),
                "apply_counts": dict(applied),
            }
            print(json.dumps(summary, ensure_ascii=False, indent=2))
            return 0
        print("Use --from-report with --apply", file=sys.stderr)
        return 1

    rows = fetch_all(client, args.limit)
    review_rows = [r for r in rows if classify_det(r) == "review"]
    print(
        f"Scanned {len(rows)} open IR → {len(review_rows)} in «Разбор» for LLM",
        file=sys.stderr,
    )

    def work(row: dict) -> dict[str, Any]:
        title = (
            row.get("title")
            or row.get("business_name")
            or row.get("person_name")
            or ""
        )
        text = blob(row)
        sug = llm_suggest(openrouter_key, openai_key, str(title), text)
        if not sug:
            sug = {
                "action": "needs_human",
                "lane": "review",
                "entityType": None,
                "targetCollection": None,
                "reason": "no_llm_response",
                "confidence": 0.0,
                "model": None,
            }
        return {
            "id": row["id"],
            "title": str(title)[:120],
            "action": sug["action"],
            "lane": sug["lane"],
            "entityType": sug.get("entityType"),
            "targetCollection": sug.get("targetCollection"),
            "reason": sug.get("reason"),
            "confidence": sug.get("confidence"),
            "model": sug.get("model"),
            "error": bool(sug.get("error")),
        }

    results: list[dict[str, Any]] = []
    workers = max(1, min(args.workers, 8))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(work, row): row for row in review_rows}
        done = 0
        for fut in as_completed(futures):
            results.append(fut.result())
            done += 1
            if done % 25 == 0 or done == len(review_rows):
                print(f"LLM {done}/{len(review_rows)}", file=sys.stderr)

    results.sort(key=lambda x: x["id"])
    by_action = Counter(r["action"] for r in results)
    by_lane = Counter(r["lane"] for r in results)
    errors = sum(1 for r in results if r.get("error"))
    enrich_ids = [r["id"] for r in results if r["action"] == "enrich"]

    if args.apply:
        by_id_row = {r["id"]: r for r in review_rows}
        for it in results:
            row = by_id_row.get(it["id"])
            if not row:
                continue
            action = apply_suggestion(client, row, it)
            if action:
                applied[action] += 1

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry_run",
        "scanned_open": len(rows),
        "review_lane_count": len(review_rows),
        "triaged": len(results),
        "llm_errors": errors,
        "by_action": dict(by_action),
        "by_lane": dict(by_lane),
        "enrich_ids": enrich_ids,
        "apply_counts": dict(applied),
        "models": model_chain(),
        "items": results,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stamped = OUT_DIR / f"llm_lane_triage_{stamp}.json"
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    OUT.write_text(payload, encoding="utf-8")
    stamped.write_text(payload, encoding="utf-8")

    summary = {
        "generated_at": report["generated_at"],
        "mode": report["mode"],
        "review_lane_count": report["review_lane_count"],
        "triaged": report["triaged"],
        "llm_errors": errors,
        "by_action": dict(by_action),
        "by_lane": dict(by_lane),
        "enrich_count": len(enrich_ids),
        "apply_counts": dict(applied),
        "report": str(OUT),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Wrote {OUT}", file=sys.stderr)
    print(f"Wrote {stamped}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
