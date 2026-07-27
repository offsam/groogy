#!/usr/bin/env python3
"""First domain-events consumer — establishes the outbox worker pattern (B2).

Reads unprocessed rows from public.domain_events (oldest first), dispatches
each to a handler by event_type, and stamps processed_at. Today's only
handler logs the event — the point is the LOOP, not the handler: future
notifications / search-indexing / AI workers plug into HANDLERS below
instead of inventing their own polling.

Contract (CARD_PROCESSING / STABILIZATION):
  * consumers never mutate anything except domain_events.processed_at
    and their own side effects;
  * a failing handler leaves the event unprocessed (retried next run);
  * safe to re-run any time (idempotent by processed_at).

Usage:
  python3 scripts/runtime/consume_domain_events.py            # dry-run: list unprocessed
  python3 scripts/runtime/consume_domain_events.py --apply    # handle + stamp
  python3 scripts/runtime/consume_domain_events.py --apply --limit 100
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

from common import SupabaseRest, load_env  # noqa: E402

LOG_PATH = ROOT / "scripts" / "runtime" / "data" / "consumed_events.jsonl"


def handle_log(event: dict[str, Any]) -> None:
    """Default handler: append to the local ledger. Replace/extend, don't fork."""
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")


# event_type prefix → handler. First matching prefix wins; '' matches all.
HANDLERS: list[tuple[str, Callable[[dict[str, Any]], None]]] = [
    ("", handle_log),
]


def dispatch(event: dict[str, Any]) -> None:
    etype = event.get("event_type") or ""
    for prefix, handler in HANDLERS:
        if etype.startswith(prefix):
            handler(event)
            return


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="handle events and stamp processed_at")
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    events = client._request(
        "GET",
        "/domain_events",
        params={
            "select": "id,event_type,entity_type,entity_id,actor_id,payload,created_at",
            "processed_at": "is.null",
            "order": "id.asc",
            "limit": str(args.limit),
        },
    ) or []
    print(f"unprocessed events: {len(events)} (mode={'APPLY' if args.apply else 'dry-run'})")

    handled = 0
    for event in events:
        label = f"#{event['id']} {event['event_type']} {event.get('entity_type') or ''} {event.get('entity_id') or ''}"
        if not args.apply:
            print(f"  would handle {label}")
            continue
        try:
            dispatch(event)
        except Exception as exc:  # leave unprocessed for retry
            print(f"  handler FAILED for {label}: {exc}")
            continue
        client.patch(
            "domain_events",
            {"id": f"eq.{event['id']}"},
            {"processed_at": datetime.now(timezone.utc).isoformat()},
        )
        handled += 1
        print(f"  handled {label}")

    if args.apply:
        print(f"done: {handled}/{len(events)} handled")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
