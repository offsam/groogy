#!/usr/bin/env python3
"""Import scraped Russian Orange Pages cards into admin Yellow Pages bucket.

Usage:
  python3 scripts/business-enrich/import_yellow_pages_cards.py --dry-run
  python3 scripts/business-enrich/import_yellow_pages_cards.py --apply
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

from common import SupabaseRest, load_env  # noqa: E402

CARDS_PATH = (
    Path(__file__).resolve().parent / "data" / "yellow_pages" / "rop_cards_latest.json"
)


def card_to_row(card: dict[str, Any]) -> dict[str, Any]:
    emails = card.get("emails") or []
    address = card.get("address")
    entity = card.get("entity_type_guess") or "business"
    directory_source = (
        card.get("directory_source")
        or ("russian_seattle" if str(card.get("cluster_key") or "").startswith("rasea-") else None)
        or ("orange_pages" if str(card.get("cluster_key") or "").startswith("rop-") else None)
        or ("svoi" if str(card.get("cluster_key") or "").startswith("svoi-") else None)
        or ("boston_pages" if str(card.get("cluster_key") or "").startswith("brp-") else None)
        or ("zerkalo_mn" if str(card.get("cluster_key") or "").startswith("zmn-") else None)
        or ("russian_miami" if str(card.get("cluster_key") or "").startswith("ramia-") else None)
        or ("russian_chicago" if str(card.get("cluster_key") or "").startswith("rachi-") else None)
        or ("ruspagesusa" if str(card.get("cluster_key") or "").startswith("rpu-") else None)
        or ("to4ka" if str(card.get("cluster_key") or "").startswith("t4k-") else None)
        or ("slavic_seattle" if str(card.get("cluster_key") or "").startswith("sls-") else None)
        or ("our_texas" if str(card.get("cluster_key") or "").startswith("otx-") else None)
        or ("echoru" if str(card.get("cluster_key") or "").startswith("ech-") else None)
        or "orange_pages"
    )
    notes_parts = [
        f"entity:{entity}",
        f"region:{card.get('region') or 'USA'}",
        f"directory_source:{directory_source}",
    ]
    if address:
        notes_parts.append(f"address:{address}")
    if emails:
        notes_parts.append("emails:" + ", ".join(emails))

    short = (card.get("short_description") or "").strip()
    full = (card.get("description") or "").strip()
    texts = []
    if short:
        texts.append(short)
    if full and full != short:
        texts.append(full[:1200])

    websites = list(card.get("websites") or [])
    source_url = card.get("source_url")
    source_groups = list(card.get("source_groups") or [])
    if not source_groups:
        if directory_source == "russian_seattle":
            source_groups = ["Russian Seattle Yellow Pages"]
        elif directory_source == "svoi":
            source_groups = ["Svoi.us"]
        elif directory_source == "boston_pages":
            source_groups = ["Boston Russian Pages"]
        elif directory_source == "zerkalo_mn":
            source_groups = ["Zerkalo Minnesota"]
        elif directory_source == "ruspagesusa":
            source_groups = ["RusPagesUSA"]
        elif directory_source == "to4ka":
            source_groups = ["to4ka.us"]
        elif directory_source == "slavic_seattle":
            source_groups = ["Slavic Seattle"]
        elif directory_source == "our_texas":
            source_groups = ["Our Texas"]
        elif directory_source == "echoru":
            source_groups = ["EchoRU"]
        elif directory_source == "russian_miami":
            source_groups = ["Russian Miami"]
        elif directory_source == "russian_chicago":
            source_groups = ["Russian Chicago"]
        else:
            source_groups = ["Russian Orange Pages"]

    return {
        "cluster_key": card["cluster_key"],
        "display_name": card.get("display_name"),
        "phones": card.get("phones") or [],
        "instagram": card.get("instagram") or [],
        "websites": websites,
        "mention_count": 1,
        "third_party_mention_count": 0,
        "self_ad_mention_count": 1,
        "comment_texts": texts or [card.get("display_name") or ""],
        "request_snippets": [short] if short else [],
        "source_post_urls": [source_url] if source_url else [],
        "source_groups": source_groups,
        "category_guess": card.get("category_guess"),
        "recommender_names": [],
        "city": card.get("city"),
        "cover_image_url": card.get("cover_image_url"),
        "target_bucket": "yellow_pages",
        "directory_source": directory_source,
        "source_channel": "other",
        "status": "pending",
        "kind": "profi",
        "notes": "; ".join(notes_parts),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--input", type=Path, default=CARDS_PATH)
    parser.add_argument(
        "--also",
        type=Path,
        action="append",
        default=[],
        help="Extra card JSON files to import (e.g. ra_seattle_latest.json)",
    )
    args = parser.parse_args()
    if not args.apply and not args.dry_run:
        args.dry_run = True

    paths = [args.input, *args.also]
    cards: list[dict[str, Any]] = []
    for p in paths:
        if not p.is_file():
            print(f"skip missing {p}", flush=True)
            continue
        payload = json.loads(p.read_text(encoding="utf-8"))
        batch = payload.get("cards") or []
        print(f"loaded {len(batch)} cards from {p}", flush=True)
        cards.extend(batch)

    # Dedup by cluster_key (last wins)
    by_key: dict[str, dict[str, Any]] = {}
    for c in cards:
        by_key[c["cluster_key"]] = c
    cards = list(by_key.values())
    print(f"unique cards: {len(cards)}", flush=True)

    rows = [card_to_row(c) for c in cards]
    # Quality gate: need a name + (phone or website or address-in-notes)
    filtered: list[dict[str, Any]] = []
    skipped = 0
    for r in rows:
        name = (r.get("display_name") or "").strip()
        if len(name) < 2:
            skipped += 1
            continue
        low = name.lower()
        if any(
            x in low
            for x in (
                "help wanted",
                "требуется",
                "untitled",
                "без названия",
                "test company",
                "seks-shop",
                "sex shop",
                "ясновидящ",
                "гадалка",
                "цыганка",
                "экстрасенс",
            )
        ):
            skipped += 1
            continue
        if len(name) > 100:
            skipped += 1
            continue
        has_contact = bool(r.get("phones") or r.get("websites") or "address:" in (r.get("notes") or ""))
        if not has_contact:
            skipped += 1
            continue
        filtered.append(r)
    rows = filtered
    print(f"quality kept={len(rows)} skipped={skipped}", flush=True)
    if args.dry_run:
        for r in rows[:5]:
            print(
                f"  dry {r['display_name']!r} phones={r['phones']} "
                f"city={r['city']} img={bool(r['cover_image_url'])}",
                flush=True,
            )
        print(json.dumps({"mode": "dry-run", "would_upsert": len(rows)}))
        return 0

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    ok = 0
    errors: list[dict[str, str]] = []
    for row in rows:
        try:
            client._request(
                "POST",
                "/import_comment_recommendations",
                body=row,
                prefer="resolution=merge-duplicates,return=minimal",
                params={"on_conflict": "source_channel,cluster_key"},
            )
            ok += 1
            print(f"ok {row['display_name']!r}", flush=True)
        except Exception as exc:  # noqa: BLE001
            errors.append({"name": row.get("display_name") or "", "error": str(exc)})
            print(f"ERR {row['display_name']!r}: {exc}", flush=True)

    print(json.dumps({"mode": "apply", "upserted": ok, "errors": len(errors)}))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
