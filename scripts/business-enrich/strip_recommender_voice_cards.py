#!/usr/bin/env python3
"""Take somebody else's comment out of «О специалисте» / «О нас».

A community recommendation describes the card owner from the outside («я
обращалась», «рекомендую обратиться к…»). The platform already shows those as
«Рекомендации сообщества» — a counter with source links — so the same text must
not also pose as the owner's own description.

This keeps the factual sentences about the subject and drops the opinion ones.
Cards whose copy is nothing but an opinion end up without a description, which
is correct: the recommendation counter carries that information.

Usage:
  python3 scripts/business-enrich/strip_recommender_voice_cards.py --dry-run
  python3 scripts/business-enrich/strip_recommender_voice_cards.py --slug SLUG --apply
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

from common import SupabaseRest, load_env  # noqa: E402
from recommendation_subject import (  # noqa: E402
    clean_public_description,
    is_recommender_voice,
    short_teaser,
    strip_recommender_voice,
)

OUT = ROOT / "docs" / "audits" / "data"
OUT.mkdir(parents=True, exist_ok=True)

OWNERS: dict[str, dict[str, Any]] = {
    "professional": {
        "table": "/professionals",
        "name": "display_name",
        "extra": ["card_summary", "headline", "employer_role"],
    },
    "business": {
        "table": "/businesses",
        "name": "name",
        "extra": [],
    },
}


def fetch(client: SupabaseRest, owner: str, slug: str | None, limit: int) -> list[dict]:
    spec = OWNERS[owner]
    cols = [
        "id",
        "slug",
        spec["name"],
        "description",
        "short_description",
        "third_party_mention_count",
        "self_ad_mention_count",
        *spec["extra"],
    ]
    params = {
        "select": ",".join(cols),
        "status": "eq.approved",
        "order": "created_at.desc",
        "limit": str(limit),
    }
    if slug:
        params["slug"] = f"eq.{slug}"
    else:
        # Only cards whose copy came from somebody else's comment.
        params["third_party_mention_count"] = "gt.0"
    return client._request("GET", spec["table"], params=params) or []


def plan(owner: str, card: dict[str, Any]) -> dict[str, Any] | None:
    description = card.get("description") or ""
    short = card.get("short_description") or ""
    if not is_recommender_voice(description) and not is_recommender_voice(short):
        return None

    new_description = clean_public_description(strip_recommender_voice(description))
    patch: dict[str, Any] = {"description": new_description}

    # Keep the teaser identical to the description when it fits, so the profile
    # does not print the same paragraph twice.
    teaser = short_teaser(new_description)
    if new_description and teaser and not teaser.endswith("…"):
        teaser = new_description
    patch["short_description"] = teaser

    if owner == "professional":
        if "card_summary" in card:
            patch["card_summary"] = teaser
        if "headline" in card:
            role = (card.get("employer_role") or "").strip()
            patch["headline"] = role[:160] or None
    return patch


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--slug")
    parser.add_argument("--owner", choices=["professional", "business", "all"], default="all")
    parser.add_argument("--limit", type=int, default=3000)
    args = parser.parse_args()
    if not args.apply:
        args.dry_run = True
    dry_run = not args.apply

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    owners = ["professional", "business"] if args.owner == "all" else [args.owner]
    report: list[dict[str, Any]] = []
    emptied = 0

    for owner in owners:
        for card in fetch(client, owner, args.slug, args.limit):
            patch = plan(owner, card)
            if not patch:
                continue
            if not patch.get("description"):
                emptied += 1
            entry = {
                "owner_type": owner,
                "slug": card.get("slug"),
                "name": card.get(OWNERS[owner]["name"]),
                "before": (card.get("description") or "")[:300],
                "after": (patch.get("description") or "")[:300],
            }
            if not dry_run:
                client._request(
                    "PATCH",
                    OWNERS[owner]["table"],
                    params={"id": f"eq.{card['id']}"},
                    body=patch,
                    prefer="return=minimal",
                )
                entry["applied"] = True
            report.append(entry)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if not dry_run else "dry"
    payload = {
        "mode": mode,
        "cards": len(report),
        "description_emptied": emptied,
        "items": report,
    }
    for name in (
        f"recommender_voice_{mode}_{stamp}.json",
        f"recommender_voice_{mode}_latest.json",
    ):
        (OUT / name).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(f"{mode}: cards={len(report)} emptied={emptied}")
    for entry in report[:20]:
        print(f"  {entry['owner_type']} {entry['slug']}")
        print(f"    before: {entry['before'][:120]}")
        print(f"    after : {entry['after'][:120] or '—'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
