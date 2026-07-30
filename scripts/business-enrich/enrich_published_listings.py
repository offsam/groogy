#!/usr/bin/env python3
"""Enrich published listings (service / job / transfer) via BFS resource queue.

Usage:
  python3 scripts/business-enrich/enrich_published_listings.py --kind service --dry-run --limit 5
  python3 scripts/business-enrich/enrich_published_listings.py --kind job --apply --slug …
  python3 scripts/business-enrich/enrich_published_listings.py --kind transfer --dry-run --slug …
  python3 scripts/business-enrich/enrich_published_listings.py --kind service --apply --id … --ndjson
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
from web_enrichment import extract_payment_methods  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "listing_enrich"
OUT.mkdir(parents=True, exist_ok=True)

KIND_TABLE = {
    "service": "listings",
    "job": "jobs",
    "transfer": "listings",
    "marketplace": "listings",
    "lechu": "listings",
}

KIND_LISTING_TYPE = {
    "service": "service",
    "transfer": "transfer",
    "marketplace": "marketplace_item",
    "lechu": "transport_carry",
}

KIND_LABEL = {
    "service": "услуги",
    "job": "вакансии",
    "transfer": "перевода",
    "marketplace": "объявления",
    "lechu": "поездки",
}


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def build_patch_listing(row: dict[str, Any], found: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    payment_blob = "\n".join(
        str(x)
        for x in (row.get("description"), found.get("description"))
        if x
    )
    discovered_payments: list[str] = []
    for method in list(found.get("payment_methods") or []) + extract_payment_methods(
        payment_blob
    ):
        label = str(method).strip()
        if label and label not in discovered_payments:
            discovered_payments.append(label)
    if not (row.get("payment_methods") or []) and discovered_payments:
        patch["payment_methods"] = discovered_payments
    if is_junk_title(row.get("title")):
        blob = "\n".join(
            x
            for x in (found.get("description"), row.get("description"))
            if isinstance(x, str) and x.strip()
        )
        derived = derive_title_from_text(blob)
        if derived:
            patch["title"] = derived[:200]
    if found.get("description") and (
        empty(row.get("description")) or len(str(row.get("description") or "")) < 80
    ):
        patch["description"] = str(found["description"]).strip()[:4000]
    if found.get("city") and empty(row.get("city")):
        patch["city"] = str(found["city"]).strip()[:80]
    return patch


def enrich_one(
    row: dict[str, Any],
    *,
    on_event: Callable[[dict[str, Any]], None] | None = None,
    client: Any = None,
) -> dict[str, Any]:
    bfs = run_resource_bfs(
        source_url=row.get("source_url"),
        card_urls=[
            row.get("website"),
            row.get("registration_url"),
            *source_record_urls(client, row.get("id")),
        ],
        max_resources=6,
        website_pages=4,
        on_event=on_event,
        sequential=True,
    )
    found = dict(bfs.get("found") or {})
    return {
        "id": row["id"],
        "slug": row.get("slug"),
        "title": row.get("title") or row.get("name"),
        "bfs_steps": bfs.get("steps") or [],
        "found": {k: v for k, v in found.items() if not str(k).startswith("_")},
        "patch": build_patch_listing(row, found),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--kind",
        choices=["service", "job", "transfer", "marketplace", "lechu"],
        required=True,
    )
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--slug", default=None)
    ap.add_argument("--id", default=None)
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
    table = KIND_TABLE[args.kind]

    if args.kind == "job":
        select = "id,title,slug,description,city,source_url,payment_methods,status"
        status_filter = "eq.published"
    else:
        # listings table has no slug/website columns
        select = "id,title,description,city,source_url,payment_methods,status,listing_type"
        status_filter = "eq.active"

    single = bool(args.slug or args.id)
    params: dict[str, str] = {
        "select": select,
        "limit": "1" if single else str(args.limit),
    }
    if args.kind != "job":
        params["listing_type"] = f"eq.{KIND_LISTING_TYPE[args.kind]}"
    if args.id:
        params["id"] = f"eq.{args.id}"
    elif args.slug:
        if args.kind != "job":
            print("--slug only works for --kind job (listings have no slug)", flush=True)
            return 2
        params["slug"] = f"eq.{args.slug}"
    else:
        params["status"] = status_filter
        params["order"] = "updated_at.desc"

    try:
        rows = client._request("GET", f"/{table}", params=params) or []
    except Exception as exc:
        msg = f"Fetch failed ({table}): {exc}"
        if args.ndjson:
            emit({"type": "error", "message": msg})
        else:
            print(msg, flush=True)
        return 1

    if single and not rows:
        msg = f"{args.kind} not found id={args.id!r} slug={args.slug!r}"
        if args.ndjson:
            emit({"type": "error", "message": msg})
        else:
            print(msg, flush=True)
        return 1

    report: list[dict[str, Any]] = []
    updated = 0
    for i, row in enumerate(rows, 1):
        label = (
            f"Обогащение {KIND_LABEL[args.kind]} "
            f"«{row.get('slug') or row.get('id')}»"
        )
        if args.ndjson:
            emit(
                {
                    "type": "started",
                    "id": row.get("id"),
                    "label": label,
                    "mode": "apply" if args.apply else "dry-run",
                }
            )
        else:
            print(
                f"\n[{i}/{len(rows)}] {args.kind.upper()} {row.get('slug')} — "
                f"{(row.get('title') or row.get('name') or '')[:50]}",
                flush=True,
            )

        def on_event(payload: dict[str, Any]) -> None:
            if args.ndjson:
                emit(payload)

        entry = enrich_one(row, on_event=on_event, client=client)
        entry["kind"] = args.kind
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
                try:
                    client._request(
                        "PATCH",
                        f"/{table}",
                        params={"id": f"eq.{row['id']}"},
                        body=entry["patch"],
                    )
                    updated += 1
                except Exception as exc:
                    if args.ndjson:
                        emit({"type": "error", "message": f"apply failed: {exc}"})
                    else:
                        print(f"  ! apply failed: {exc}", flush=True)

        if args.ndjson:
            emit(
                {
                    "type": "finished",
                    "result": {
                        "id": row.get("id"),
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
    path = OUT / f"{args.kind}_{'apply' if args.apply else 'dry'}_{stamp}.json"
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
