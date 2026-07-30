#!/usr/bin/env python3
"""Build the list of contacts that ride on many unrelated cards.

A handle or domain that shows up on dozens of cards with different owners is
the channel's, not an advertiser's. It is only added to the list when it is the
subject of almost none of those cards — a genuinely popular business keeps its
own card, so it stays out.

Usage:
  python3 scripts/import-review/build_channel_noise.py
  python3 scripts/import-review/build_channel_noise.py --min-cards 6
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit_glued_cards import collect, diagnose_card  # noqa: E402
from channel_noise import NOISE_FILE, is_subject, letters  # noqa: E402
from common import SupabaseRest, load_env  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Build channel noise contact list")
    parser.add_argument("--min-cards", type=int, default=8)
    parser.add_argument(
        "--min-owners",
        type=int,
        default=5,
        help="distinct card names the contact must span to count as channel-wide",
    )
    parser.add_argument(
        "--max-subject-share",
        type=float,
        default=0.25,
        help="share of cards where the contact may be the card's own subject",
    )
    args = parser.parse_args()

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    cards = collect(client, "all")
    print(f"Scanned cards: {len(cards)}")

    seen: dict[str, dict[str, set[str]]] = {
        "instagram": defaultdict(set),
        "domains": defaultdict(set),
        "phones": defaultdict(set),
    }
    subject_hits: dict[str, dict[str, int]] = {
        "instagram": defaultdict(int),
        "domains": defaultdict(int),
        "phones": defaultdict(int),
    }
    owners: dict[str, dict[str, set[str]]] = {
        "instagram": defaultdict(set),
        "domains": defaultdict(set),
        "phones": defaultdict(set),
    }

    for card in cards:
        facts = diagnose_card(card, use_noise=False)
        names = (card["title"], card["slug"] or "")
        for kind, values in (
            ("instagram", facts["instagram"]),
            ("domains", facts["domains"]),
            ("phones", facts["phones"]),
        ):
            for value in values:
                seen[kind][value].add(card["id"])
                owner = letters(card["title"])
                if len(owner) >= 4:
                    owners[kind][value].add(owner)
                if is_subject(value, *names):
                    subject_hits[kind][value] += 1

    out: dict[str, list[dict[str, object]]] = {}
    for kind in ("instagram", "domains", "phones"):
        entries = []
        for value, ids in seen[kind].items():
            if len(ids) < args.min_cards:
                continue
            distinct_owners = len(owners[kind].get(value, set()))
            if distinct_owners < args.min_owners:
                continue
            if subject_hits[kind].get(value, 0) / len(ids) > args.max_subject_share:
                continue
            entries.append(
                {"value": value, "cards": len(ids), "owners": distinct_owners}
            )
        entries.sort(key=lambda e: -int(e["cards"]))
        out[kind] = entries
        print(f"{kind}: {len(entries)} noise contacts")

    # Once a contact is cleaned off the cards it stops showing up in the corpus.
    # Keep it listed so the next import does not put it back.
    if NOISE_FILE.exists():
        previous = json.loads(NOISE_FILE.read_text(encoding="utf-8"))
        for kind in ("instagram", "domains", "phones"):
            known = {str(e["value"]) for e in out[kind]}
            for entry in previous.get(kind, []):
                if str(entry.get("value")) not in known:
                    out[kind].append({**entry, "retired": True})

    NOISE_FILE.parent.mkdir(parents=True, exist_ok=True)
    NOISE_FILE.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "min_cards": args.min_cards,
                **out,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {NOISE_FILE}")
    for kind in ("instagram", "domains", "phones"):
        for entry in out[kind][:14]:
            print(
                f"  {kind:9} {entry['cards']:4} карточек / "
                f"{entry['owners']:3} имён  {entry['value']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
