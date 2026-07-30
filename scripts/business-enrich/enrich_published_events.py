#!/usr/bin/env python3
"""Enrich published events via shared BFS resource queue.

source_url → registration_url / website / social → fill-empty event fields.

Usage:
  python3 scripts/business-enrich/enrich_published_events.py --dry-run --limit 5
  python3 scripts/business-enrich/enrich_published_events.py --apply --slug …
  python3 scripts/business-enrich/enrich_published_events.py --apply --id … --ndjson
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from entity_title_from_text import (  # noqa: E402
    derive_title_from_text,
    is_junk_title,
)
from enrich_resource_queue import run_resource_bfs  # noqa: E402
from source_record_urls import source_record_urls  # noqa: E402
from structure_event_from_text import structure_event_from_text  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "event_enrich"
OUT.mkdir(parents=True, exist_ok=True)


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def build_patch(ev: dict[str, Any], found: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    blob = "\n".join(
        x
        for x in (
            found.get("description"),
            ev.get("description"),
            ev.get("source_body"),
        )
        if isinstance(x, str) and x.strip()
    )
    structured = structure_event_from_text(blob) if blob.strip() else {}

    if is_junk_title(ev.get("title")):
        derived = derive_title_from_text(blob)
        if derived:
            patch["title"] = derived[:200]
    existing_payments = ev.get("payment_methods") or []
    discovered_payments: list[str] = []
    for method in list(found.get("payment_methods") or []) + list(
        structured.get("payment_methods") or []
    ):
        label = str(method).strip()
        if label and label not in discovered_payments:
            discovered_payments.append(label)
    if (
        (not isinstance(existing_payments, list) or len(existing_payments) == 0)
        and discovered_payments
    ):
        patch["payment_methods"] = discovered_payments
    if (
        empty(ev.get("price_label"))
        and structured.get("price_label")
    ):
        patch["price_label"] = str(structured["price_label"]).strip()[:120]
    if empty(ev.get("phone")) and structured.get("phone"):
        patch["phone"] = str(structured["phone"]).strip()[:40]
    if empty(ev.get("address_line")) and structured.get("address_line"):
        patch["address_line"] = str(structured["address_line"]).strip()[:200]
    if found.get("description") and (
        empty(ev.get("description")) or len(str(ev.get("description") or "")) < 80
    ):
        # Prefer cleaned narrative from structure when available
        clean = structured.get("description") or found.get("description")
        if clean:
            patch["description"] = str(clean).strip()[:4000]
    if found.get("image_url") and empty(ev.get("cover_image_url")):
        img = str(found["image_url"]).strip()
        if img.startswith("http"):
            patch["cover_image_url"] = img[:500]
    if found.get("website") and empty(ev.get("registration_url")):
        # Prefer registration_url slot for event signup / site
        patch["registration_url"] = str(found["website"]).split("?")[0][:500]
    if empty(ev.get("registration_url")) and structured.get("registration_url"):
        patch["registration_url"] = str(structured["registration_url"]).strip()[:500]
    city = found.get("city") or structured.get("city")
    if not city and found.get("address"):
        # crude "City, CA"
        import re

        m = re.search(
            r"\b([A-Z][a-zA-Z .'-]+),\s*CA\b",
            str(found.get("address") or ""),
        )
        if m:
            city = m.group(1).strip()
    if city and empty(ev.get("city")):
        patch["city"] = str(city).strip()[:80]
    return patch


def enrich_one(
    ev: dict[str, Any],
    *,
    on_event: Callable[[dict[str, Any]], None] | None = None,
    client: Any = None,
) -> dict[str, Any]:
    bfs = run_resource_bfs(
        source_url=ev.get("source_url"),
        card_urls=[ev.get("registration_url"), *source_record_urls(client, ev.get("id"))],
        max_resources=6,
        website_pages=4,
        on_event=on_event,
        sequential=True,
    )
    found = dict(bfs.get("found") or {})
    patch = build_patch(ev, found)
    return {
        "id": ev["id"],
        "slug": ev.get("slug"),
        "title": ev.get("title"),
        "bfs_steps": bfs.get("steps") or [],
        "found": {
            k: v for k, v in found.items() if not str(k).startswith("_")
        },
        "patch": patch,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--slug", default=None)
    ap.add_argument("--id", default=None, help="Single event id (preferred)")
    ap.add_argument(
        "--ndjson",
        action="store_true",
        help="Stream started/resource/finished NDJSON for admin UI",
    )
    args = ap.parse_args()
    if not args.dry_run and not args.apply:
        print("Pass --dry-run or --apply", flush=True)
        return 2
    if args.ndjson and not (args.id or args.slug):
        print("--ndjson requires --id or --slug", file=sys.stderr)
        return 2

    def emit(obj: dict[str, Any]) -> None:
        if args.ndjson:
            print(json.dumps(obj, ensure_ascii=False), flush=True)

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    select = (
        "id,title,slug,description,status,starts_at,event_at_label,city,"
        "cover_image_url,registration_url,source_url,source_body,"
        "price_label,phone,address_line,payment_methods"
    )
    if args.id or args.slug:
        params: dict[str, str] = {"select": select, "limit": "1"}
        if args.id:
            params["id"] = f"eq.{args.id}"
        else:
            params["slug"] = f"eq.{args.slug}"
        rows = client._request("GET", "/events", params=params) or []
        if not rows:
            msg = f"Event not found id={args.id!r} slug={args.slug!r}"
            if args.ndjson:
                emit({"type": "error", "message": msg})
            else:
                print(msg, flush=True)
            return 1
    else:
        rows = (
            client._request(
                "GET",
                "/events",
                params={
                    "select": select,
                    "status": "eq.published",
                    "order": "updated_at.desc",
                    "limit": str(args.limit),
                },
            )
            or []
        )

    report: list[dict[str, Any]] = []
    updated = 0
    for i, ev in enumerate(rows, 1):
        label = f"Обогащение события «{ev.get('slug') or ev.get('id')}»"
        if args.ndjson:
            emit(
                {
                    "type": "started",
                    "id": ev.get("id"),
                    "label": label,
                    "mode": "apply" if args.apply else "dry-run",
                }
            )
        else:
            print(
                f"\n[{i}/{len(rows)}] EVENT {ev.get('slug')} — "
                f"{(ev.get('title') or '')[:50]}",
                flush=True,
            )

        def on_event(payload: dict[str, Any]) -> None:
            if args.ndjson:
                emit(payload)

        entry = enrich_one(ev, on_event=on_event, client=client)
        report.append(entry)
        steps = entry.get("bfs_steps") or []
        ok_n = sum(1 for s in steps if s.get("outcome") == "ok")
        fail_n = sum(1 for s in steps if s.get("outcome") in ("empty", "error"))

        if not args.ndjson:
            for st in steps:
                print(
                    f"  · {st.get('kind')}: {st.get('url')} → {st.get('fields')}",
                    flush=True,
                )

        if not entry.get("patch"):
            if not args.ndjson:
                print("  → no patch", flush=True)
        else:
            if not args.ndjson:
                print(
                    f"  → {'APPLY' if args.apply else 'dry'} {entry['patch']}",
                    flush=True,
                )
            if args.apply:
                client._request(
                    "PATCH",
                    "/events",
                    params={"id": f"eq.{ev['id']}"},
                    body=entry["patch"],
                )
                updated += 1

        if args.ndjson:
            emit(
                {
                    "type": "finished",
                    "result": {
                        "id": ev.get("id"),
                        "label": label,
                        "skipped": False,
                        "reason": (
                            None
                            if entry.get("patch")
                            else "Готово — новых полей не нашлось (fill-empty)."
                        ),
                        "patch": entry.get("patch") or {},
                        "resources": steps,
                        "resources_ok": ok_n,
                        "resources_failed": fail_n,
                    },
                }
            )

    if args.ndjson:
        return 0

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if args.apply else 'dry'}_{stamp}.json"
    path.write_text(
        json.dumps(
            {"updated": updated, "total": len(rows), "report": report},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nWrote {path} updated={updated}/{len(rows)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
