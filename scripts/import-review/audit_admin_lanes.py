#!/usr/bin/env python3
"""Classify open import_review + recommendations into admin lanes.

Usage:
  PYTHONPATH=scripts/import-review python3 scripts/import-review/audit_admin_lanes.py
  PYTHONPATH=scripts/import-review python3 scripts/import-review/audit_admin_lanes.py --limit 2000
  PYTHONPATH=scripts/import-review python3 scripts/import-review/audit_admin_lanes.py --apply-route
  PYTHONPATH=scripts/import-review python3 scripts/import-review/audit_admin_lanes.py --apply-lanes

--apply-route only fills empty entity_type/target_collection (never quarantine/publish).
--apply-lanes also tags seeking and moves obvious junk to quarantine status.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from common import SupabaseRest, load_env

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "scripts" / "import-review" / "data" / "admin_lanes_audit.json"

SEEKING_RE = re.compile(
    r"(?:^|[\n.!?])\s*(?:ищу|ищем|нужен|нужна|нужно|посоветуйте|looking\s+for)\b",
    re.I,
)
SELF_OFFER_RE = re.compile(
    r"(?:предлагаю|оказываю|записывайтесь|прайс|открыта\s+запись)",
    re.I,
)
TAG_SEEKING = "[seeking]"
TAG_QUARANTINE = "[quarantine]"

OPEN_IR = ("pending", "in_review", "needs_more_info", "ready_to_publish")
OPEN_REC = ("pending", "suspected_duplicate", "quarantine")


def has_contact(row: dict) -> bool:
    for key in ("phone", "email", "website", "instagram", "telegram_username"):
        v = row.get(key)
        if isinstance(v, list) and any(str(x).strip() for x in v):
            return True
        if isinstance(v, str) and v.strip():
            return True
    phones = row.get("phones") or []
    if any(str(x).strip() for x in phones):
        return True
    return False


def blob(row: dict) -> str:
    parts = [
        row.get("title"),
        row.get("business_name"),
        row.get("person_name"),
        row.get("display_name"),
        row.get("description"),
        row.get("source_text"),
    ]
    texts = row.get("comment_texts") or []
    reqs = row.get("request_snippets") or []
    parts.extend(texts)
    parts.extend(reqs)
    return "\n".join(str(p) for p in parts if p)


def append_tag(notes: str | None, tag: str) -> str:
    base = (notes or "").strip()
    if tag in base:
        return base
    return f"{base}\n{tag}".strip() if base else tag


def classify_ir(row: dict) -> str:
    status = (row.get("review_status") or "").lower()
    notes = row.get("review_notes") or ""
    if status == "quarantine" or TAG_QUARANTINE in notes:
        return "quarantine"
    if TAG_SEEKING in notes:
        return "seeking"
    text = blob(row)
    if SEEKING_RE.search(text) and not (
        SELF_OFFER_RE.search(text) and has_contact(row)
    ):
        if not has_contact(row) or not SELF_OFFER_RE.search(text):
            return "seeking"
    if status == "ready_to_publish":
        return "ready"
    if len(text.replace(" ", "").strip()) < 8 and not has_contact(row):
        return "quarantine"
    if row.get("entity_type") and row.get("target_collection"):
        return "route"
    return "review"


def classify_rec(row: dict) -> str:
    status = (row.get("status") or "").lower()
    notes = row.get("notes") or ""
    if status == "quarantine" or TAG_QUARANTINE in notes:
        return "quarantine"
    if status == "suspected_duplicate" or row.get("duplicate_of_entity_id"):
        return "attach"
    third = int(row.get("third_party_mention_count") or 0)
    self_ad = int(row.get("self_ad_mention_count") or 0)
    if third > 0 and self_ad == 0:
        return "attach"
    text = blob(row)
    if SEEKING_RE.search(text) and not has_contact(row):
        return "seeking"
    if not (row.get("display_name") or "").strip() and not has_contact(row):
        return "quarantine"
    return "review"


def fetch_all(client: SupabaseRest, table: str, params: dict, limit: int) -> list[dict]:
    out: list[dict] = []
    page = 1000
    offset = 0
    while len(out) < limit:
        chunk = (
            client._request(
                "GET",
                f"/{table}",
                params={
                    **params,
                    "limit": str(min(page, limit - len(out))),
                    "offset": str(offset),
                },
            )
            or []
        )
        if not chunk:
            break
        out.extend(chunk)
        if len(chunk) < page:
            break
        offset += len(chunk)
    return out


def apply_route_row(client: SupabaseRest, row: dict) -> bool:
    if row.get("entity_type") or row.get("target_collection"):
        return False
    if row.get("review_status") not in (
        "pending",
        "in_review",
        "needs_more_info",
    ):
        return False
    from entity_routing import route_card  # type: ignore

    routed = route_card(
        text=blob(row),
        business_name=row.get("business_name"),
        person_name=row.get("person_name"),
    )
    et = getattr(routed, "entity_type", None) or (
        routed.get("entity_type") if isinstance(routed, dict) else None
    )
    tc = getattr(routed, "target_collection", None) or (
        routed.get("target_collection") if isinstance(routed, dict) else None
    )
    needs_manual = getattr(routed, "needs_manual_type", False) or (
        routed.get("needs_manual_type") if isinstance(routed, dict) else False
    )
    if not et or needs_manual:
        return False
    client._request(
        "PATCH",
        "/import_review_items",
        params={"id": f"eq.{row['id']}"},
        body={
            "entity_type": et,
            "target_collection": tc,
        },
        prefer="return=minimal",
    )
    return True


def apply_lane_ir(client: SupabaseRest, row: dict) -> str | None:
    """Write seeking tag / quarantine status. Returns action name or None."""
    lane = classify_ir(row)
    status = (row.get("review_status") or "").lower()
    if status in ("approved", "rejected", "duplicate", "quarantine"):
        return None

    if lane == "seeking":
        notes = append_tag(row.get("review_notes"), TAG_SEEKING)
        if notes == (row.get("review_notes") or "").strip():
            return None
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{row['id']}"},
            body={"review_notes": notes},
            prefer="return=minimal",
        )
        return "seeking"

    if lane == "quarantine":
        notes = append_tag(row.get("review_notes"), TAG_QUARANTINE)
        client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{row['id']}"},
            body={
                "review_status": "quarantine",
                "review_notes": notes,
                "reject_reason": "quarantine",
            },
            prefer="return=minimal",
        )
        return "quarantine"

    return None


def apply_lane_rec(client: SupabaseRest, row: dict) -> str | None:
    lane = classify_rec(row)
    status = (row.get("status") or "").lower()
    if status in ("approved", "rejected", "merged", "quarantine"):
        return None

    if lane == "quarantine":
        notes = append_tag(row.get("notes"), TAG_QUARANTINE)
        client._request(
            "PATCH",
            "/import_comment_recommendations",
            params={"id": f"eq.{row['id']}"},
            body={"status": "quarantine", "notes": notes},
            prefer="return=minimal",
        )
        return "quarantine_rec"

    if lane == "seeking":
        notes = append_tag(row.get("notes"), TAG_SEEKING)
        if notes == (row.get("notes") or "").strip():
            return None
        client._request(
            "PATCH",
            "/import_comment_recommendations",
            params={"id": f"eq.{row['id']}"},
            body={"notes": notes},
            prefer="return=minimal",
        )
        return "seeking_rec"

    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=9000)
    ap.add_argument(
        "--apply-route",
        action="store_true",
        help="Fill empty entity_type/target_collection when both missing (safe)",
    )
    ap.add_argument(
        "--apply-lanes",
        action="store_true",
        help="Write seeking tags + move obvious junk to quarantine",
    )
    args = ap.parse_args()
    load_env()

    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    ir = fetch_all(
        client,
        "import_review_items",
        {
            "select": "id,review_status,review_notes,entity_type,target_collection,title,business_name,person_name,description,source_text,phone,email,website,instagram,telegram_username",
            "review_status": f"in.({','.join(OPEN_IR)},quarantine)",
            "order": "created_at.desc",
        },
        args.limit,
    )
    recs = fetch_all(
        client,
        "import_comment_recommendations",
        {
            "select": "id,status,notes,display_name,phones,websites,instagram,comment_texts,request_snippets,third_party_mention_count,self_ad_mention_count,duplicate_of_entity_id",
            "status": f"in.({','.join(OPEN_REC)})",
            "order": "created_at.desc",
        },
        args.limit,
    )

    ir_lanes = Counter(classify_ir(r) for r in ir)
    rec_lanes = Counter(classify_rec(r) for r in recs)
    by_collection = Counter(
        (r.get("target_collection") or "unset")
        for r in ir
        if r.get("target_collection")
    )

    applied_route = 0
    applied_lanes: Counter[str] = Counter()

    if args.apply_route or args.apply_lanes:
        for row in ir:
            if apply_route_row(client, row):
                applied_route += 1

    if args.apply_lanes:
        for row in ir:
            action = apply_lane_ir(client, row)
            if action:
                applied_lanes[action] += 1
        for row in recs:
            action = apply_lane_rec(client, row)
            if action:
                applied_lanes[action] += 1

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "import_review_sampled": len(ir),
        "recommendations_sampled": len(recs),
        "import_review_lanes": dict(ir_lanes),
        "recommendation_lanes": dict(rec_lanes),
        "import_review_by_collection": dict(by_collection.most_common(30)),
        "apply_route_patched": applied_route,
        "apply_lanes": dict(applied_lanes),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"Wrote {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
