#!/usr/bin/env python3
"""Move акции that are still buried in card copy into entity_promotions.

Published cards created before the promotions model (and every card published
through the recommendation path, which had no promo step at all) keep their
offers inside `description`. This walks approved businesses and professionals,
pulls the offers out with the shared detector and writes them as promotion
cards. With --clean-description the promo paragraph is also removed from the
narrative so it does not live in two places.

Usage:
  python3 scripts/business-enrich/backfill_entity_promotions.py --dry-run
  python3 scripts/business-enrich/backfill_entity_promotions.py --slug SLUG --apply
  python3 scripts/business-enrich/backfill_entity_promotions.py --slug SLUG \
      --text-file archived.txt --apply
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from promotions_from_text import (  # noqa: E402
    add_missing_entity_promotions,
    is_promotion_active,
    promotions_from_ad_text,
    strip_promotion_blocks,
)

OUT = ROOT / "docs" / "audits" / "data"
OUT.mkdir(parents=True, exist_ok=True)

OWNERS: dict[str, dict[str, str]] = {
    "business": {"table": "/businesses", "name": "name"},
    "professional": {"table": "/professionals", "name": "display_name"},
}


def fetch_cards(
    client: SupabaseRest, owner_type: str, slug: str | None, limit: int
) -> list[dict[str, Any]]:
    spec = OWNERS[owner_type]
    params = {
        "select": f"id,slug,{spec['name']},description,category_id",
        "status": "eq.approved",
        "order": "created_at.desc",
        "limit": str(limit),
    }
    if slug:
        params["slug"] = f"eq.{slug}"
    return client._request("GET", spec["table"], params=params) or []


def source_texts(client: SupabaseRest, owner_type: str, card: dict[str, Any]) -> list[str]:
    """Original ad copy, where the offer often survives after cleanup."""
    rows = (
        client._request(
            "GET",
            "/import_review_items",
            params={
                "select": "source_text,description",
                "published_entity_id": f"eq.{card['id']}",
                "limit": "5",
            },
        )
        or []
    )
    out: list[str] = []
    for row in rows:
        for key in ("source_text", "description"):
            value = (row.get(key) or "").strip()
            if value:
                out.append(value)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--slug")
    parser.add_argument(
        "--owner", choices=["business", "professional", "all"], default="all"
    )
    parser.add_argument(
        "--text-file",
        help="Archived ad copy to scan in addition to the live card text.",
    )
    parser.add_argument("--clean-description", action="store_true")
    parser.add_argument(
        "--deep",
        action="store_true",
        help="Also scan the original queue copy (one request per card).",
    )
    parser.add_argument("--limit", type=int, default=2000)
    args = parser.parse_args()
    if not args.apply:
        args.dry_run = True
    dry_run = not args.apply

    load_env()
    import os

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    extra = ""
    if args.text_file:
        extra = Path(args.text_file).read_text(encoding="utf-8")

    owner_types = (
        ["business", "professional"] if args.owner == "all" else [args.owner]
    )
    report: list[dict[str, Any]] = []
    added_total = 0
    expired_total = 0

    for owner_type in owner_types:
        cards = fetch_cards(client, owner_type, args.slug, args.limit)
        for card in cards:
            parts = [card.get("description") or "", extra]
            if args.deep or args.slug:
                parts.extend(source_texts(client, owner_type, card))
            blob = "\n\n".join(t for t in parts if t.strip())
            promos = promotions_from_ad_text(blob)
            if not promos:
                continue
            fresh = [p for p in promos if is_promotion_active({**p, "status": "active"})]
            expired_total += len(promos) - len(fresh)
            entry = {
                "owner_type": owner_type,
                "id": card["id"],
                "slug": card.get("slug"),
                "name": card.get(OWNERS[owner_type]["name"]),
                "promotions": promos,
                "expired": len(promos) - len(fresh),
            }
            if not dry_run:
                inserted = add_missing_entity_promotions(
                    client,
                    owner_type=owner_type,
                    owner_id=card["id"],
                    promotions=promos,
                    category_id=card.get("category_id"),
                )
                entry["inserted"] = len(inserted)
                added_total += len(inserted)
                if args.clean_description and inserted:
                    cleaned = strip_promotion_blocks(card.get("description"), promos)
                    if cleaned and cleaned != (card.get("description") or "").strip():
                        client._request(
                            "PATCH",
                            OWNERS[owner_type]["table"],
                            params={"id": f"eq.{card['id']}"},
                            body={"description": cleaned},
                            prefer="return=minimal",
                        )
                        entry["description_cleaned"] = True
            else:
                added_total += len(fresh)
            report.append(entry)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if not dry_run else "dry"
    payload = {
        "mode": mode,
        "cards_with_promotions": len(report),
        "promotions_added": added_total,
        "promotions_expired_skipped": expired_total,
        "items": report,
    }
    for name in (f"promotions_backfill_{mode}_{stamp}.json", f"promotions_backfill_{mode}_latest.json"):
        (OUT / name).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(
        f"{mode}: cards={len(report)} promotions={added_total} "
        f"expired_skipped={expired_total}"
    )
    for entry in report[:15]:
        titles = ", ".join(p["title"][:60] for p in entry["promotions"])
        print(f"  {entry['owner_type']} {entry['slug']}: {titles}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
