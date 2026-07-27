#!/usr/bin/env python3
"""Backfill events.source_posted_at / source_body from FB raw dumps; fix starts_at years.

Usage:
  python3 scripts/facebook-collector/backfill_event_source_meta.py
  python3 scripts/facebook-collector/backfill_event_source_meta.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from publish_recommendation_events import (  # noqa: E402
    RAW_GLOBS,
    parse_starts_at,
)


def _post_url(post: dict[str, Any]) -> str | None:
    for key in ("url", "postUrl", "facebookUrl", "topLevelUrl", "link"):
        val = post.get(key)
        if isinstance(val, str) and val.startswith("http"):
            return val.split("?")[0]
    return None


def _post_time(post: dict[str, Any]) -> str | None:
    for key in ("timestamp", "time", "date", "created_time", "createdAt", "postedAt"):
        val = post.get(key)
        if val is None:
            continue
        raw = str(val).strip()
        if not raw:
            continue
        if raw.isdigit() and len(raw) >= 10:
            # unix seconds
            from datetime import datetime, timezone

            try:
                return datetime.fromtimestamp(int(raw[:10]), tz=timezone.utc).isoformat()
            except (ValueError, OSError):
                continue
        if "T" not in raw and " " in raw:
            raw = raw.replace(" ", "T")
        if raw.endswith("Z") or "+" in raw[10:]:
            return raw
        return raw + ("Z" if not raw.endswith("Z") else "")
    return None


def _post_text(post: dict[str, Any]) -> str:
    for key in ("text", "message", "postText", "content"):
        val = post.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def build_post_meta_index() -> dict[str, dict[str, str]]:
    index: dict[str, dict[str, str]] = {}
    files: list[Path] = []
    for pattern in RAW_GLOBS:
        files.extend(sorted(pattern.parent.glob(pattern.name)))
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        posts = data if isinstance(data, list) else (
            data.get("posts") or data.get("items") or data.get("data") or []
        )
        for post in posts:
            if not isinstance(post, dict):
                continue
            url = _post_url(post)
            if not url or url in index:
                continue
            meta: dict[str, str] = {}
            t = _post_time(post)
            body = _post_text(post)
            if t:
                meta["posted_at"] = t
            if body:
                meta["body"] = body[:8000]
            if meta:
                index[url] = meta
    return index


def find_meta(index: dict[str, dict[str, str]], source_url: str | None) -> dict[str, str]:
    if not source_url:
        return {}
    key = source_url.split("?")[0]
    if key in index:
        return index[key]
    for k, meta in index.items():
        if key.rstrip("/") in k or k.rstrip("/") in key:
            return meta
    return {}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1

    print("Indexing FB posts…")
    index = build_post_meta_index()
    print(f"  posts with meta: {len(index)}")

    client = SupabaseRest(url, key)
    events = client._request(
        "GET",
        "/events",
        params={
            "select": "id,title,starts_at,event_at_label,source_url,description",
            "status": "eq.published",
            "limit": "200",
        },
    ) or []
    print(f"events: {len(events)}")

    updated = 0
    for ev in events:
        meta = find_meta(index, ev.get("source_url"))
        if not meta:
            print(f"  miss {(ev.get('title') or '')[:50]}")
            continue
        posted = meta.get("posted_at")
        body = meta.get("body")
        new_starts = None
        if ev.get("event_at_label"):
            new_starts = parse_starts_at(ev.get("event_at_label"), posted)
        # Do not invent starts_at from post time alone — that marks undated promos as "past".
        patch: dict[str, Any] = {}
        if posted:
            patch["source_posted_at"] = posted
        if body:
            patch["source_body"] = body
            desc = (ev.get("description") or "").strip()
            if len(body) > len(desc):
                patch["description"] = body[:4000]
        if new_starts and new_starts != ev.get("starts_at"):
            patch["starts_at"] = new_starts
        print(
            f"  {(ev.get('title') or '')[:45]} | post={posted} | "
            f"starts {ev.get('starts_at')} → {new_starts or ev.get('starts_at')}"
        )
        if args.apply and patch:
            client._request(
                "PATCH",
                "/events",
                params={"id": f"eq.{ev['id']}"},
                body=patch,
                prefer="return=minimal",
            )
            updated += 1

    print(f"updated: {updated}" if args.apply else "dry-run; pass --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
