#!/usr/bin/env python3
"""DEPRECATED — prefer rebuild_professional_locations_from_groups.py

Fill professionals.city ONLY where it is NULL, from:

  1) the matched import_review_items row's extracted city (post text), else
  2) the source Telegram/FB group metro via group_location.location_from_group()
     (sacramento → Sacramento CA, etc.)

Strictly fill-empty: never touches a non-null city/region/state_code,
never writes lat/lng or street addresses.

Kept as a safe fill-empty subset; new work should use the rebuild script
(post text → group fallback, county labels out of `city`).

  python3 scripts/business-enrich/rebuild_professional_locations_from_groups.py --dry-run
  python3 scripts/business-enrich/fill_professional_city_from_groups.py --dry-run
  python3 scripts/business-enrich/fill_professional_city_from_groups.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402
from group_location import location_from_group  # noqa: E402

import re

# t.me/c/<internal chat id>/<msg> → group label. Sources: run_full.py
# (-1001333533747 = "Fun for Mom") and import_review_items.source for
# -1001955320601 (telegram:la_orange_county). Both resolve via group_location.
CHAT_ID_GROUPS = {
    "1333533747": "fun for mom",
    "1955320601": "la orange county",
}
TME_C_RE = re.compile(r"t\.me/c/(\d+)/")


def fetch_all(client: SupabaseRest, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = client._request(
            "GET", path, params={**params, "limit": "1000", "offset": str(offset)}
        ) or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print(
        "DEPRECATED: prefer rebuild_professional_locations_from_groups.py "
        "(this script is fill-empty only).",
        file=sys.stderr,
    )

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    pros = fetch_all(
        client,
        "/professionals",
        {
            "select": "id,slug,display_name,city,region,state_code,source_record_id,source_url",
            "status": "eq.approved",
            "city": "is.null",
            "order": "id.asc",
        },
    )
    print(f"professionals with city IS NULL: {len(pros)}")

    # Load the linked queue rows for extracted city + group name.
    rec_ids = [p["source_record_id"] for p in pros if p.get("source_record_id")]
    items: dict[str, dict[str, Any]] = {}
    for i in range(0, len(rec_ids), 80):
        chunk = rec_ids[i : i + 80]
        values = ",".join(f'"{v}"' for v in chunk)
        for row in client._request(
            "GET",
            "/import_review_items",
            params={
                "select": "id,city,state,source,source_group,source_chat_id",
                "id": f"in.({values})",
            },
        ) or []:
            items[row["id"]] = row

    planned: list[dict[str, Any]] = []
    reasons: Counter[str] = Counter()
    for p in pros:
        item = items.get(p.get("source_record_id") or "")
        patch: dict[str, Any] = {}
        reason = None
        loc = None
        if item and (item.get("city") or "").strip():
            patch["city"] = item["city"].strip()
            reason = "import_item_city"
        else:
            group_blob_parts = []
            if item:
                group_blob_parts += [item.get("source_group"), item.get("source")]
            chat_match = TME_C_RE.search(p.get("source_url") or "")
            if chat_match:
                group_blob_parts.append(CHAT_ID_GROUPS.get(chat_match.group(1)))
            loc = location_from_group(*group_blob_parts)
            if loc and loc.get("city"):
                patch["city"] = loc["city"]
                reason = "group_fallback"
                if loc.get("region") and not p.get("region"):
                    patch["region"] = loc["region"]
            elif loc and loc.get("region") and not p.get("region"):
                # county-only signal: fill region, leave city empty
                patch["region"] = loc["region"]
                reason = "group_fallback_region_only"
        if not patch:
            reasons["no_signal"] += 1
            continue
        if not p.get("state_code"):
            # Prefer group catalog state; never invent California.
            group_state = (loc or {}).get("state_code") or (loc or {}).get("stateCode")
            if group_state:
                patch["state_code"] = group_state
        reasons[reason] += 1
        planned.append({"id": p["id"], "slug": p["slug"], "patch": patch, "reason": reason})

    print(json.dumps({"planned": len(planned), "reasons": dict(reasons)}, ensure_ascii=False))
    for row in planned[:15]:
        print(f"- {row['slug']}: {row['patch']} ({row['reason']})")

    out = Path(__file__).resolve().parent / "data" / "professional_city_from_groups.json"
    out.write_text(json.dumps(planned, ensure_ascii=False, indent=1))
    print(f"report: {out}")

    if args.apply:
        done = 0
        for row in planned:
            # Guard: only when city still NULL at write time.
            res = client._request(
                "PATCH",
                "/professionals",
                params={"id": f"eq.{row['id']}", "city": "is.null"},
                body=row["patch"],
                prefer="return=representation",
            )
            done += len(res or [])
        print(f"applied: {done}/{len(planned)}")


if __name__ == "__main__":
    main()
