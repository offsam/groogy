#!/usr/bin/env python3
"""Classify the entity_type IS NULL backlog in import_review_items.

Thin wrapper around the EXISTING classifiers — no new keyword lists:
  - scripts/telegram-collector/reviewer.py  (LECHU_RE / TRANSFER_RE via detect_lechu_or_transfer)
  - scripts/facebook-collector/facebook_decision_policy.py
    (REAL_ESTATE_OFFER_RE, JOB_HIRE_RE, MARKETPLACE_RE, EVENT_RE,
     BUSINESS_SIGNAL_RE, SPECIALIST_SIGNAL_RE)

Decision tree follows docs/audits/NULL_CLASSIFICATION_ALGORITHM_V1.md §3 exactly.

Default is dry-run: prints a tally and writes a full per-row report to
scripts/import-review/data/null_queue_dry_run.json — no writes of any kind.

--apply-high  : write entity_type/target_collection/classification_confidence/
                classification_reason for HIGH-confidence rows only
                (guarded by entity_type=is.null on every PATCH).
--tag-rest    : tag still-NULL rows with review_notes '[needs_manual_type]'
                (MEDIUM proposals keep their proposal in the tag for admins).
Never writes a default 'business' for unclassified rows.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from reviewer import detect_lechu_or_transfer  # noqa: E402
from facebook_decision_policy import (  # noqa: E402
    BUSINESS_SIGNAL_RE,
    JOB_HIRE_RE,
    MARKETPLACE_RE,
    REAL_ESTATE_OFFER_RE,
    SPECIALIST_SIGNAL_RE,
)

REAL_ESTATE_CATEGORIES = {
    "real_estate_services",
    "realtor",
    "mortgage",
    "property_management",
}

TARGET_BY_TYPE = {
    "event": "events",
    "real_estate": "real_estate",
    "lechu_listing": "lechu",
    "transfer_listing": "transfers",
    "job": "jobs",
    "marketplace_listing": "marketplace",
    "business": "businesses",
    "private_specialist": "private_specialists",
}


def classify(row: dict) -> tuple[str | None, str, str]:
    """Return (entity_type|None, confidence, reason)."""
    category = (row.get("category") or "").strip()
    text = row.get("source_text") or ""
    business_name = (row.get("business_name") or "").strip()
    person_name = (row.get("person_name") or "").strip()
    has_contact = bool(
        (row.get("phone") or []) or (row.get("website") or []) or (row.get("instagram") or [])
    )

    # Gate 0 — hard route by explicit keyword category
    if category == "events":
        return "event", "high", "gate0:category=events"
    if category in REAL_ESTATE_CATEGORIES:
        return "real_estate", "high", f"gate0:category={category}"
    if REAL_ESTATE_OFFER_RE.search(text):
        return "real_estate", "high", "gate0:real_estate_offer_re"

    # Gate 1 — route-shaped listings
    travel = detect_lechu_or_transfer(text)
    if travel == "lechu_listing":
        return "lechu_listing", "high", "gate1:lechu_re"
    if travel == "transfer_listing":
        return "transfer_listing", "high", "gate1:transfer_re"
    if JOB_HIRE_RE.search(text):
        return "job", "medium", "gate1:job_hire_re"
    if MARKETPLACE_RE.search(text) and not business_name:
        return "marketplace_listing", "medium", "gate1:marketplace_re"

    # Gate 2 — business vs private_specialist
    signal = None
    reason = ""
    if business_name and not person_name:
        signal, reason = "business", "gate2:business_name_slot"
    elif person_name and not business_name:
        signal, reason = "private_specialist", "gate2:person_name_slot"
    elif BUSINESS_SIGNAL_RE.search(text) and not SPECIALIST_SIGNAL_RE.search(text):
        signal, reason = "business", "gate2:business_signal_re"
    elif SPECIALIST_SIGNAL_RE.search(text) and not BUSINESS_SIGNAL_RE.search(text):
        signal, reason = "private_specialist", "gate2:specialist_signal_re"

    if signal is not None:
        confidence = "high" if has_contact else "medium"
        return signal, confidence, reason + (":with_contact" if has_contact else ":no_contact")

    # Gate 3 — nothing fired
    return None, "none", "gate3:no_signal"


def fetch_null_rows(client: SupabaseRest) -> list[dict]:
    rows: list[dict] = []
    page = 1000
    offset = 0
    select = (
        "id,source,category,business_name,person_name,source_text,"
        "phone,website,instagram,telegram_username,email,review_status,review_notes"
    )
    while True:
        batch = client._request(
            "GET",
            "/import_review_items",
            params={
                "select": select,
                "entity_type": "is.null",
                "order": "id.asc",
                "limit": str(page),
                "offset": str(offset),
            },
        )
        rows.extend(batch or [])
        if not batch or len(batch) < page:
            break
        offset += page
    return rows


def patch_bucket(client: SupabaseRest, ids: list[str], payload: dict) -> int:
    """PATCH a bucket of rows, guarded so only still-NULL rows are touched."""
    done = 0
    chunk = 100
    for i in range(0, len(ids), chunk):
        part = ids[i : i + chunk]
        values = ",".join(f'"{v}"' for v in part)
        res = client._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"in.({values})", "entity_type": "is.null"},
            body=payload,
            prefer="return=representation",
        )
        done += len(res or [])
    return done


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply-high", action="store_true")
    ap.add_argument("--tag-rest", action="store_true")
    args = ap.parse_args()

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    rows = fetch_null_rows(client)
    print(f"fetched {len(rows)} rows with entity_type IS NULL")

    results = []
    for row in rows:
        etype, confidence, reason = classify(row)
        results.append(
            {
                "id": row["id"],
                "source": row.get("source"),
                "category": row.get("category"),
                "review_status": row.get("review_status"),
                "proposed_type": etype,
                "confidence": confidence,
                "reason": reason,
            }
        )

    tally = Counter((r["proposed_type"], r["confidence"], r["reason"]) for r in results)
    print("\n=== tally (proposed_type, confidence, reason) ===")
    for (etype, confidence, reason), count in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"{count:6d}  {etype or '-':22s} {confidence:7s} {reason}")

    out_path = SCRIPT_DIR / "data" / "null_queue_dry_run.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print(f"\nreport written: {out_path}")

    if args.apply_high:
        buckets: dict[tuple[str, str], list[str]] = {}
        for r in results:
            if r["confidence"] == "high" and r["proposed_type"]:
                buckets.setdefault((r["proposed_type"], r["reason"]), []).append(r["id"])
        total = 0
        for (etype, reason), ids in sorted(buckets.items()):
            payload = {
                "entity_type": etype,
                "target_collection": TARGET_BY_TYPE[etype],
                "classification_confidence": "high",
                "classification_reason": reason,
            }
            n = patch_bucket(client, ids, payload)
            total += n
            print(f"applied {n:5d}/{len(ids):5d}  {etype:22s} {reason}")
        print(f"total applied HIGH: {total}")

    if args.tag_rest:
        # Rows still NULL after apply-high: MEDIUM proposals + gate3.
        # review_notes is APPENDED to, never overwritten; already-tagged rows skipped.
        notes_by_id = {row["id"]: (row.get("review_notes") or "").strip() for row in rows}
        targets: list[tuple[str, str, str, str]] = []  # id, tag, confidence, reason
        for r in results:
            if r["confidence"] == "medium" and r["proposed_type"]:
                tag = f"[needs_manual_type][proposed:{r['proposed_type']}:medium]"
            elif r["confidence"] == "none":
                tag = "[needs_manual_type]"
            else:
                continue
            if "[needs_manual_type]" in notes_by_id.get(r["id"], ""):
                continue
            targets.append((r["id"], tag, r["confidence"], r["reason"]))

        # Bulk-patch rows sharing identical resulting notes; per-row for the rest.
        buckets2: dict[tuple[str, str, str], list[str]] = {}
        for rid, tag, confidence, reason in targets:
            existing = notes_by_id.get(rid, "")
            new_notes = (existing + " " + tag).strip() if existing else tag
            buckets2.setdefault((new_notes, confidence, reason), []).append(rid)
        total = 0
        for (new_notes, confidence, reason), ids in sorted(buckets2.items()):
            payload = {
                "classification_confidence": confidence,
                "classification_reason": reason,
                "review_notes": new_notes,
            }
            n = patch_bucket(client, ids, payload)
            total += n
        print(f"total tagged: {total} (of {len(targets)} targets)")


if __name__ == "__main__":
    main()
