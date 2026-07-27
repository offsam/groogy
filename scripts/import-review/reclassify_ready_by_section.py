#!/usr/bin/env python3
"""Reclassify ready_to_publish items into correct section buckets.

Fixes the "everything looks like business" mess:
  - entity_type ↔ target_collection sync
  - car rentals out of real_estate → marketplace
  - food / goods → marketplace
  - housing / hostel → real_estate
  - true one-off events (mis-tagged as business/specialist) → events

Usage:
  python3 scripts/import-review/reclassify_ready_by_section.py
  python3 scripts/import-review/reclassify_ready_by_section.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402

OUT = (
    ROOT
    / "scripts"
    / "import-review"
    / "data"
    / "reclassify_ready_by_section_report.json"
)

CAR_RENTAL_RE = re.compile(
    r"("
    r"сдам\s+в\s+аренду.{0,60}(toyota|honda|lexus|prius|приус|camry|камри|bmw|mercedes|авто|машин)|"
    r"сда[её]тся\s*:?\s*(honda|toyota|lexus|prius|приус|camry|камри|bmw|mercedes)|"
    r"сдам\s+(toyota|honda|lexus|prius|приус|camry|камри|bmw|mercedes)|"
    r"в\s+аренду\s+(toyota|honda|lexus|prius|приус|camry|камри|bmw|mercedes|авто)|"
    r"аренда\s+авто|"
    r"(toyota|honda|lexus|prius|приус|camry|камри).{0,40}(аренда|\$\s*\d+)|"
    r"rent\s+(a\s+)?car|car\s+rental|"
    r"(неделя|месяц).{0,20}(страховк)|"
    r"со\s+своей\s+страховкой|"
    r"ваша\s+страховка"
    r")",
    re.I,
)

HOUSING_RE = re.compile(
    r"("
    r"хостел|hostel|"
    r"аренда\s+жиль|"
    r"сдам\s+(квартир|комнат|студи|дом)|"
    r"сда[её]тся\s+(квартир|комнат|студи|дом)|"
    r"(квартир|комнат).{0,40}(аренда|сда|\$\s*\d)|"
    r"bedroom|bath\b|sq\s*ft|"
    r"for\s+rent|"
    r"lease\s+(apartment|room|house|studio)"
    r")",
    re.I,
)

FOOD_GOODS_RE = re.compile(
    r"("
    r"борщ|салат\s+оливье|меренгов|"
    r"стики|heets|iqos|terea|"
    r"продам\s+|прода[её]тся|"
    r"в\s+наличии\s*:|"
    r"на\s+заказ\s+\d"
    r")",
    re.I,
)

TICKET_RE = re.compile(
    r"билет|ticket|концерт|спектакл|sphere",
    re.I,
)

TRUE_EVENT_RE = re.compile(
    r"("
    r"приглаша(ем|ю)\s+(вас\s+)?(на|в)|"
    r"мастер[\s-]?класс|workshop|лекци[яю]|"
    r"женский\s+круг|девичник|квиз|"
    r"мюзикл|маслениц|"
    r"when:|когда:|дата:|"
    r"opening\s+night|"
    r"регистраци[яю]|"
    r"gathering|offline[\s-]?встреч|офлайн[\s-]?встреч|"
    r"онлайн[\s-]?лекци|"
    r"играем\s+в\s+трансформацион|"
    r"сыграть\s+в\s+трансформацион|"
    r"серию\s+трансформационных\s+игр|"
    r"relay\s+for\s+life|благотворит|волонтер"
    r")",
    re.I,
)

COLLECTION_FOR_ENTITY = {
    "business": "businesses",
    "private_specialist": "private_specialists",
    "marketplace_listing": "marketplace",
    "real_estate": "real_estate",
    "event": "events",
    "lechu_listing": "lechu",
    "transfer_listing": "transfers",
    "organization": "organizations",
    "job": "jobs",
}


def blob(item: dict[str, Any]) -> str:
    return "\n".join(
        str(item.get(k) or "")
        for k in ("title", "business_name", "description", "source_text", "category")
    )


def decide(item: dict[str, Any]) -> dict[str, Any] | None:
    """Return patch fields or None if already correct."""
    text = blob(item)
    et = item.get("entity_type")
    tc = item.get("target_collection")
    cat = (item.get("category") or "").strip() or None
    notes = item.get("review_notes") or ""
    was_event_reclass = "Event →" in notes

    new_et, new_tc, new_cat = et, tc, cat
    reason = None

    # 1) True events wrongly sitting as business/specialist
    if (
        was_event_reclass or cat == "events"
    ) and et in {"business", "private_specialist"}:
        if TRUE_EVENT_RE.search(text) and not re.search(
            r"продам.{0,40}билет", text, re.I
        ):
            new_et, new_tc = "event", "events"
            new_cat = "events"
            reason = "revert_true_event"

    # 2) Ticket resale ads → marketplace
    if reason is None and TICKET_RE.search(text) and re.search(
        r"продам|прода[её]|обмен", text, re.I
    ):
        new_et, new_tc = "marketplace_listing", "marketplace"
        new_cat = "events" if cat in {None, "events", "other"} else cat
        if (et, tc) != (new_et, new_tc):
            reason = "ticket_resale→marketplace"

    # 3) Housing / hostel → real_estate (before car_rental — студии often mis-tagged)
    if reason is None and HOUSING_RE.search(text) and not CAR_RENTAL_RE.search(text):
        new_et, new_tc = "real_estate", "real_estate"
        if cat in {None, "other", "car_rental", "real_estate_services", "events"}:
            new_cat = "real_estate"
        if (et, tc) != (new_et, new_tc) or cat != new_cat:
            reason = "housing→real_estate"

    # 4) Car rentals out of real_estate / wrong buckets
    if reason is None and (
        (cat == "car_rental" and CAR_RENTAL_RE.search(text))
        or (cat != "car_rental" and CAR_RENTAL_RE.search(text))
        or (cat == "car_rental" and re.search(r"toyota|honda|lexus|prius|camry|bmw|mercedes|страховк", text, re.I))
    ):
        new_et, new_tc, new_cat = "marketplace_listing", "marketplace", "car_rental"
        if (et, tc, cat) != (new_et, new_tc, new_cat):
            reason = "car_rental→marketplace"

    # 5) Food / goods for sale → marketplace
    if reason is None and FOOD_GOODS_RE.search(text) and et in {
        "business",
        "private_specialist",
    }:
        if re.search(r"(продам|в\s+наличии|на\s+заказ|стики|борщ|салат)", text, re.I):
            new_et, new_tc = "marketplace_listing", "marketplace"
            if cat in {None, "other", "events"}:
                new_cat = "food"
            reason = "goods→marketplace"

    # 6) Sync entity ↔ collection when collection is authoritative and content fits
    if reason is None:
        if tc == "marketplace" and et != "marketplace_listing":
            new_et = "marketplace_listing"
            reason = "sync_entity_to_marketplace"
        elif tc == "real_estate" and et != "real_estate":
            new_et = "real_estate"
            reason = "sync_entity_to_real_estate"
        elif tc == "businesses" and et != "business":
            new_et = "business"
            reason = "sync_entity_to_business"
        elif tc == "private_specialists" and et != "private_specialist":
            new_et = "private_specialist"
            reason = "sync_entity_to_specialist"
        elif tc == "events" and et != "event":
            new_et = "event"
            reason = "sync_entity_to_event"
        elif tc == "services" and et == "business":
            new_et, new_tc = "business", "businesses"
            reason = "services_org→businesses"

    if reason is None:
        return None
    if new_et == et and new_tc == tc and new_cat == cat:
        return None
    # Category-only cleanup on already-correct RE — keep only when category was wrong
    if (
        new_et == et
        and new_tc == tc
        and reason == "housing→real_estate"
        and et == "real_estate"
        and tc == "real_estate"
        and cat not in {"car_rental", "events", "food", "auto_services"}
    ):
        return None

    return {
        "id": item["id"],
        "title": item.get("title"),
        "from": {"entity_type": et, "target_collection": tc, "category": cat},
        "to": {
            "entity_type": new_et,
            "target_collection": new_tc,
            "category": new_cat,
        },
        "reason": reason,
    }


def fetch_ready(client: SupabaseRest) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": (
                        "id,title,business_name,description,source_text,category,"
                        "entity_type,target_collection,review_notes,review_status"
                    ),
                    "review_status": "eq.ready_to_publish",
                    "order": "updated_at.desc",
                    "offset": str(offset),
                    "limit": "200",
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < 200:
            break
    return rows


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

    client = SupabaseRest(url, key)
    items = fetch_ready(client)
    print(f"ready: {len(items)}")

    decisions = [d for d in (decide(i) for i in items) if d]
    print("changes:", len(decisions), dict(Counter(d["reason"] for d in decisions)))
    for d in decisions:
        fr, to = d["from"], d["to"]
        print(
            f"  [{d['reason']}] {(d.get('title') or '')[:40]:40} "
            f"{fr['entity_type']}/{fr['target_collection']} → "
            f"{to['entity_type']}/{to['target_collection']} cat={to.get('category')}"
        )

    applied: list[dict[str, Any]] = []
    if args.apply:
        for d in decisions:
            to = d["to"]
            note_suffix = f"reclassify:{d['reason']}"
            # Keep previous notes, append
            item = next(i for i in items if i["id"] == d["id"])
            prev = (item.get("review_notes") or "").strip()
            notes = (prev + "\n" + note_suffix).strip() if prev else note_suffix
            body = {
                "entity_type": to["entity_type"],
                "target_collection": to["target_collection"],
                "review_notes": notes[:500],
            }
            if to.get("category") is not None:
                body["category"] = to["category"]
            client._request(
                "PATCH",
                "/import_review_items",
                params={"id": f"eq.{d['id']}"},
                body=body,
                prefer="return=minimal",
            )
            applied.append({"id": d["id"], "ok": True, "reason": d["reason"]})
            print(f"  applied {d['id'][:8]}… {d['reason']}")

    # Summary after
    after_counts: dict[str, Any] = {}
    if args.apply:
        after = fetch_ready(client)
        after_counts = {
            "entity_type": dict(Counter(i.get("entity_type") for i in after)),
            "target_collection": dict(
                Counter(i.get("target_collection") for i in after)
            ),
            "total": len(after),
        }
        print("after:", after_counts)

    report = {
        "total_ready": len(items),
        "changes": len(decisions),
        "by_reason": dict(Counter(d["reason"] for d in decisions)),
        "before": {
            "entity_type": dict(Counter(i.get("entity_type") for i in items)),
            "target_collection": dict(
                Counter(i.get("target_collection") for i in items)
            ),
        },
        "after": after_counts,
        "decisions": decisions,
        "applied": applied,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
