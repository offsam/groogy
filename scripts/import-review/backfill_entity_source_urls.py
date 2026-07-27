#!/usr/bin/env python3
"""Backfill source_url / source_kind on published entities from import_review_items.

Usage:
  python3 scripts/import-review/backfill_entity_source_urls.py --dry-run
  python3 scripts/import-review/backfill_entity_source_urls.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402

OUT = (
    ROOT
    / "scripts"
    / "import-review"
    / "data"
    / "backfill_entity_source_urls_report.json"
)


def infer_kind(url: str, source: str | None) -> str | None:
    u = (url or "").lower()
    s = (source or "").lower()
    if "facebook.com" in u or "fb.com" in u or s.startswith("facebook"):
        return "facebook"
    if "t.me/" in u or "telegram.me" in u or s.startswith("telegram"):
        return "telegram"
    if s.startswith("facebook"):
        return "facebook"
    if s.startswith("telegram"):
        return "telegram"
    return None


def normalize_url(raw: str | None) -> str | None:
    if not raw or not str(raw).strip():
        return None
    url = str(raw).strip()
    if url.startswith("//"):
        url = "https:" + url
    if not re.match(r"^https?://", url, re.I):
        if url.startswith("t.me/") or url.startswith("telegram.me/"):
            url = "https://" + url
        elif "facebook.com" in url or "fb.com" in url:
            url = "https://" + url.lstrip("/")
        else:
            return None
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:  # noqa: BLE001
        return None
    if not host:
        return None
    return url


def fetch_all(
    client: SupabaseRest,
    table: str,
    select: str,
    *,
    extra: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    last = "00000000-0000-0000-0000-000000000000"
    while True:
        params = {
            "select": select,
            "id": f"gt.{last}",
            "order": "id.asc",
            "limit": "500",
            **(extra or {}),
        }
        batch = client._request("GET", f"/{table}", params=params) or []
        if not batch:
            break
        rows.extend(batch)
        last = batch[-1]["id"]
        if len(batch) < 500:
            break
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    queue = fetch_all(
        client,
        "import_review_items",
        "id,source_url,source,published_entity_id,published_entity_type,review_status",
        extra={"published_entity_id": "not.is.null", "source_url": "not.is.null"},
    )
    print(f"queue items with published entity + source_url: {len(queue)}")

    # Prefer latest non-empty source per entity
    by_entity: dict[str, dict[str, Any]] = {}
    for row in queue:
        eid = row.get("published_entity_id")
        url = normalize_url(row.get("source_url"))
        if not eid or not url:
            continue
        kind = infer_kind(url, row.get("source"))
        et = (row.get("published_entity_type") or "").lower()
        by_entity[str(eid)] = {
            "source_url": url,
            "source_kind": kind,
            "entity_type": et,
            "queue_id": row["id"],
        }

    businesses = fetch_all(
        client, "businesses", "id,name,slug,source_url,source_kind,status"
    )
    listings = fetch_all(
        client, "listings", "id,title,source_url,source_kind,status"
    )

    biz_updates: list[dict[str, Any]] = []
    for b in businesses:
        if normalize_url(b.get("source_url")):
            continue
        hit = by_entity.get(str(b["id"]))
        if not hit:
            continue
        biz_updates.append(
            {
                "id": b["id"],
                "name": b.get("name"),
                "source_url": hit["source_url"],
                "source_kind": hit["source_kind"],
            }
        )

    listing_updates: list[dict[str, Any]] = []
    for L in listings:
        if normalize_url(L.get("source_url")):
            continue
        hit = by_entity.get(str(L["id"]))
        if not hit:
            continue
        listing_updates.append(
            {
                "id": L["id"],
                "title": L.get("title"),
                "source_url": hit["source_url"],
                "source_kind": hit["source_kind"],
            }
        )

    print(f"businesses missing source → fill: {len(biz_updates)}")
    print(f"listings missing source → fill: {len(listing_updates)}")
    for u in biz_updates[:8]:
        print(f"  biz {u['name'][:40]} → {u['source_kind']} {u['source_url'][:60]}")
    for u in listing_updates[:5]:
        print(f"  listing {(u.get('title') or '')[:40]} → {u['source_kind']}")

    if args.apply:
        for u in biz_updates:
            body = {"source_url": u["source_url"]}
            if u.get("source_kind"):
                body["source_kind"] = u["source_kind"]
            client._request(
                "PATCH",
                "/businesses",
                params={"id": f"eq.{u['id']}"},
                body=body,
                prefer="return=minimal",
            )
        for u in listing_updates:
            body = {"source_url": u["source_url"]}
            if u.get("source_kind"):
                body["source_kind"] = u["source_kind"]
            client._request(
                "PATCH",
                "/listings",
                params={"id": f"eq.{u['id']}"},
                body=body,
                prefer="return=minimal",
            )
        print(f"applied businesses={len(biz_updates)} listings={len(listing_updates)}")

    report = {
        "queue_with_source": len(queue),
        "business_updates": biz_updates,
        "listing_updates": listing_updates,
        "applied": bool(args.apply),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
