#!/usr/bin/env python3
"""Attach open queue events/promos onto existing businesses as business_offers.

Match (same strong keys as merge_queue_into_existing):
  - shared phone / WhatsApp
  - shared Instagram
  - shared website host
  - unique strong business-name mention in event title/description

Creates offer_type=other («Предложения») via service_attach_queue_item_as_business_offer.

Usage:
  python3 scripts/import-review/attach_queue_events_to_businesses.py --dry-run
  python3 scripts/import-review/attach_queue_events_to_businesses.py --apply
  python3 scripts/import-review/attach_queue_events_to_businesses.py --apply --limit 50
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402
from description_merge import similarity  # noqa: E402
from eligibility import normalize_instagram, normalize_phone  # noqa: E402
from merge_queue_into_existing import (  # noqa: E402
    build_business_indexes,
    fetch_businesses,
    item_title,
    titles_compatible,
    website_host,
)

OPEN = ("pending", "in_review", "needs_more_info", "ready_to_publish")
# Events + loose promo-ish collections that should land on business offers
ATTACH_COLLECTIONS = ("events",)
# Also allow marketplace/services cards that look like promotions when they match a business
PROMO_HINT = re.compile(
    r"\b(акци[яию]|скидк|промо|спецпредлож|event|событи|афиша|концерт|мастер[- ]?класс)\b",
    re.IGNORECASE | re.UNICODE,
)


def fetch_open_attach_candidates(
    client: SupabaseRest, *, limit: int | None
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": (
                        "id,title,business_name,person_name,description,source_text,"
                        "phone,whatsapp,instagram,website,email,city,"
                        "entity_type,target_collection,telegram_username,"
                        "preview_image_url,occurrence_count,source"
                    ),
                    "review_status": f"in.({','.join(OPEN)})",
                    "published_entity_id": "is.null",
                    "order": "occurrence_count.desc.nullslast",
                    "offset": str(offset),
                    "limit": "200",
                },
            )
            or []
        )
        if not batch:
            break
        for row in batch:
            coll = (row.get("target_collection") or "").strip()
            if coll in ATTACH_COLLECTIONS:
                rows.append(row)
                continue
            blob = " ".join(
                str(row.get(f) or "")
                for f in ("title", "business_name", "description", "source_text")
            )
            if PROMO_HINT.search(blob) and (
                row.get("phone") or row.get("instagram") or row.get("website")
            ):
                rows.append(row)
        offset += len(batch)
        if limit is not None and len(rows) >= limit * 6:
            break
        if len(batch) < 200:
            break
    return rows


def build_name_index(
    businesses: list[dict[str, Any]],
) -> list[tuple[str, dict[str, Any]]]:
    """Distinctive names (≥8 chars after clean) for substring match."""
    out: list[tuple[str, dict[str, Any]]] = []
    for b in businesses:
        name = (b.get("name") or "").strip()
        if len(name) < 8:
            continue
        low = name.lower()
        # skip very generic
        if low in {"russian restaurant", "beauty salon", "auto service"}:
            continue
        out.append((low, b))
    # longer names first → prefer specific matches
    out.sort(key=lambda x: len(x[0]), reverse=True)
    return out


def _fold(s: str) -> str:
    """Light normalize for name mentions (café≈cafe, ё≈е)."""
    t = (s or "").lower().replace("ё", "е").replace("é", "e").replace("á", "a")
    t = re.sub(r"[^\w\s]+", " ", t, flags=re.UNICODE)
    return re.sub(r"\s+", " ", t).strip()


def _soft_name_in(name_f: str, hay: str) -> bool:
    """True if name is in hay, or all significant tokens match (stem-tolerant)."""
    if not name_f or not hay:
        return False
    if name_f in hay:
        return True
    toks = [t for t in name_f.split() if len(t) >= 4]
    if len(toks) < 2:
        return False
    hay_words = hay.split()
    matched = 0
    for t in toks:
        if t in hay:
            matched += 1
            continue
        stem = t[:5]
        if any(
            w.startswith(stem) or stem.startswith(w[: min(5, len(w))])
            for w in hay_words
            if len(w) >= 4
        ):
            matched += 1
    return matched == len(toks)


def match_business_for_attach(
    item: dict[str, Any],
    by_phone: dict[str, list[dict[str, Any]]],
    by_ig: dict[str, list[dict[str, Any]]],
    by_host: dict[str, list[dict[str, Any]]],
    name_index: list[tuple[str, dict[str, Any]]],
) -> tuple[dict[str, Any] | None, str | None]:
    qtitle = item_title(item)
    desc = f"{item.get('description') or ''}\n{item.get('source_text') or ''}"
    title_fold = _fold(qtitle)
    # Prefer subject line over long signatures at the end of Telegram posts
    head_fold = _fold(f"{qtitle}\n{desc[:320]}")

    # Prefer unique business-name mention first (events often cite the venue/brand)
    mentions: list[tuple[str, dict[str, Any], float]] = []
    for name_low, biz in name_index:
        if len(name_low) < 12:
            continue
        name_f = _fold(name_low)
        if len(name_f) < 10:
            continue
        in_title = _soft_name_in(name_f, title_fold)
        in_head = _soft_name_in(name_f, head_fold)
        if not in_title and not in_head:
            continue
        # Long event titles: require the brand in the title itself (avoid poster signatures)
        if len(title_fold) >= 24 and not in_title:
            continue
        score = similarity(title_fold, name_f)
        if in_title:
            score += 0.35
        mentions.append((name_low, biz, score))
        if len(mentions) > 8:
            break
    if len(mentions) == 1:
        return mentions[0][1], f"name_mention:{mentions[0][1].get('name')}"
    if len(mentions) > 1:
        mentions.sort(key=lambda x: x[2], reverse=True)
        top, second = mentions[0], mentions[1]
        if top[2] >= 0.35 and top[2] - second[2] >= 0.12:
            return top[1], f"name_mention:{top[1].get('name')}"
        # Exact/soft title containment wins
        titled = [m for m in mentions if _soft_name_in(_fold(m[0]), title_fold)]
        if len(titled) == 1:
            return titled[0][1], f"name_mention:{titled[0][1].get('name')}"

    def pick(
        hits: list[dict[str, Any]], reason: str
    ) -> tuple[dict[str, Any] | None, str | None]:
        compatible = [
            h
            for h in hits
            if titles_compatible(qtitle, str(h.get("name") or ""), desc=desc)
        ]
        if len(compatible) == 1:
            return compatible[0], reason
        if len(compatible) > 1:
            compatible.sort(
                key=lambda h: similarity(
                    qtitle.lower().replace("_", " "),
                    str(h.get("name") or "").lower(),
                ),
                reverse=True,
            )
            top, second = compatible[0], compatible[1]
            s1 = similarity(qtitle.lower(), str(top.get("name") or "").lower())
            s2 = similarity(qtitle.lower(), str(second.get("name") or "").lower())
            if s1 >= 0.45 and s1 - s2 >= 0.1:
                return top, reason
            return None, None
        return None, None

    phones: list[str] = []
    for raw in list(item.get("phone") or []) + list(item.get("whatsapp") or []):
        n = normalize_phone(str(raw))
        if n and n not in phones:
            phones.append(n)
    for phone in phones:
        hits = by_phone.get(phone) or []
        if hits:
            found = pick(hits, f"phone:{phone}")
            if found[0]:
                return found

    igs: list[str] = []
    for raw in item.get("instagram") or []:
        n = normalize_instagram(str(raw))
        if n and n.lower() not in igs:
            igs.append(n.lower())
    for ig in igs:
        hits = by_ig.get(ig) or []
        if hits:
            found = pick(hits, f"instagram:@{ig}")
            if found[0]:
                return found

    host = website_host(
        (item.get("website") or [None])[0]
        if isinstance(item.get("website"), list)
        else item.get("website")
    )
    if not host:
        for raw in item.get("website") or [] if isinstance(item.get("website"), list) else []:
            host = website_host(str(raw))
            if host:
                break
    if host:
        hits = by_host.get(host) or []
        if hits:
            found = pick(hits, f"website:{host}")
            if found[0]:
                return found

    return None, None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Attach queue events/promos as business offers"
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    if args.dry_run and args.apply:
        print("Use only one of --dry-run / --apply", file=sys.stderr)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    candidates = fetch_open_attach_candidates(client, limit=args.limit)
    businesses = fetch_businesses(client)
    by_phone, by_ig, by_host = build_business_indexes(businesses)
    name_index = build_name_index(businesses)

    matches: list[dict[str, Any]] = []
    seen_items: set[str] = set()
    for item in candidates:
        item_id = str(item.get("id") or "")
        if not item_id or item_id in seen_items:
            continue
        biz, reason = match_business_for_attach(
            item, by_phone, by_ig, by_host, name_index
        )
        if not biz or not reason:
            continue
        seen_items.add(item_id)
        matches.append(
            {
                "item_id": item["id"],
                "item_title": item.get("title")
                or item.get("business_name")
                or item.get("person_name"),
                "target_collection": item.get("target_collection"),
                "business_id": biz["id"],
                "business_name": biz.get("name"),
                "business_slug": biz.get("slug"),
                "match": reason,
            }
        )
        if args.limit is not None and len(matches) >= args.limit:
            break

    print(
        json.dumps(
            {
                "candidates_scanned": len(candidates),
                "businesses_indexed": len(businesses),
                "matches": len(matches),
                "mode": "dry_run" if args.dry_run else "apply",
                "sample": matches[:20],
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    out = (
        ROOT
        / "scripts"
        / "import-review"
        / "data"
        / "attach_queue_events_dry_run.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"matches": matches}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {out}")

    if args.dry_run:
        return 0

    ok = 0
    fail = 0
    results: list[dict[str, Any]] = []
    for m in matches:
        try:
            res = client.rpc_call(
                "service_attach_queue_item_as_business_offer",
                {
                    "p_item_id": m["item_id"],
                    "p_business_id": m["business_id"],
                    "p_offer_type": "other",
                    "p_note": f"Событие/предложение → бизнес по {m['match']}",
                },
            )
            ok += 1
            results.append({"match": m, "result": res})
        except Exception as exc:
            fail += 1
            results.append({"match": m, "error": str(exc)[:400]})

    print(
        json.dumps(
            {"ok": ok, "fail": fail, "results": results[:25]},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
