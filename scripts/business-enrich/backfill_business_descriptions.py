#!/usr/bin/env python3
"""Backfill missing `description` on already-published businesses from their
original Svoi.us source page.

Unlike enrich_svoi_directory.py (which works on *pending* import_comment_
recommendations queue rows and optionally publishes new cards), this targets
businesses that are ALREADY approved/published, have source_kind='directory'
(bulk Svoi.us import), and have an empty description — i.e. the description
was never captured at import time even though the source page has real body
copy.

Reuses the existing, tested extraction logic:
  - svoi_parse.extract_svoi_body_description  (real <h1>-adjacent body text,
    never the generic og:description SEO blurb)
  - svoi_parse.is_svoi_seo_blurb               (extra safety net)

Never invents text — if no real body description can be recovered from the
source page, the row is left untouched (reported as "no_description_found").

Usage:
  python3 scripts/business-enrich/backfill_business_descriptions.py --dry-run --limit 20
  python3 scripts/business-enrich/backfill_business_descriptions.py --apply --limit 50
  python3 scripts/business-enrich/backfill_business_descriptions.py --apply   # all remaining
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from svoi_parse import extract_svoi_body_description, is_svoi_seo_blurb  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "description_backfill"
OUT.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def fetch_html(url: str, *, timeout: int = 45) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def fetch_targets(client: SupabaseRest, *, limit: int) -> list[dict[str, Any]]:
    rows = (
        client._request(
            "GET",
            "/businesses",
            params={
                "select": "id,name,slug,source_url,description,short_description",
                "source_kind": "eq.directory",
                "source_url": "not.is.null",
                "or": "(description.is.null,description.eq.)",
                "order": "id.asc",
                "limit": str(limit),
            },
        )
        or []
    )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=350)
    parser.add_argument("--sleep", type=float, default=0.4)
    args = parser.parse_args()
    if not args.apply and not args.dry_run:
        args.dry_run = True
    dry_run = not args.apply

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    skey = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not skey:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local", file=sys.stderr)
        return 1
    client = SupabaseRest(url, skey)

    targets = fetch_targets(client, limit=args.limit)
    print(f"targets={len(targets)} dry_run={dry_run}")

    report: list[dict[str, Any]] = []
    found = 0
    not_found = 0
    errors = 0

    for i, biz in enumerate(targets, 1):
        name = biz.get("name") or ""
        src = biz.get("source_url") or ""
        print(f"[{i}/{len(targets)}] {name} <- {src}", flush=True)
        entry: dict[str, Any] = {"id": biz["id"], "name": name, "source_url": src}
        try:
            html = fetch_html(src)
        except Exception as exc:  # noqa: BLE001
            entry["error"] = str(exc)[:200]
            print(f"  fetch error: {entry['error']}", flush=True)
            errors += 1
            report.append(entry)
            time.sleep(args.sleep)
            continue

        body = extract_svoi_body_description(html)
        if not body or is_svoi_seo_blurb(body):
            entry["result"] = "no_description_found"
            not_found += 1
            print("  no real description found on source page", flush=True)
            report.append(entry)
            time.sleep(args.sleep)
            continue

        entry["result"] = "recovered"
        entry["description"] = body
        found += 1
        print(f"  recovered ({len(body)} chars): {body[:120]}...", flush=True)

        if not dry_run:
            patch: dict[str, Any] = {
                "description": body,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if not biz.get("short_description"):
                patch["short_description"] = body[:240]
            client._request(
                "PATCH",
                "/businesses",
                params={"id": f"eq.{biz['id']}"},
                body=patch,
                prefer="return=minimal",
            )
            print("  applied", flush=True)

        report.append(entry)
        time.sleep(args.sleep)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = OUT / f"batch_{stamp}.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "latest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"\nDone. total={len(targets)} recovered={found} "
        f"no_description_found={not_found} errors={errors} report={out_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
