#!/usr/bin/env python3
"""Read-only audit: published cards whose text suggests a different section.

Uses the canonical entity_routing.route_card — no writes.
Writes report to docs/audits/data/section_routing_audit_*.json

Usage:
  python3 scripts/business-enrich/audit_section_routing.py
  python3 scripts/business-enrich/audit_section_routing.py --limit 500
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from entity_routing import route_card  # noqa: E402

# Current published section → expected entity_type from router
SECTION_ENTITY = {
    "professionals": "private_specialist",
    "businesses": "business",
    "marketplace": "marketplace_listing",
    "jobs": "job",
    "events": "event",
    "lechu": "lechu_listing",
    "transfers": "transfer_listing",
}


def fetch_all(client: SupabaseRest, path: str, select: str, filters: dict) -> list[dict]:
    rows: list[dict] = []
    page = 500
    offset = 0
    while True:
        params = {
            "select": select,
            "order": "id.asc",
            "limit": str(page),
            "offset": str(offset),
            **filters,
        }
        batch = client._request("GET", path, params=params) or []
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def mismatch(
    *,
    section: str,
    entity_id: str,
    slug: str | None,
    title: str,
    text: str,
    person_name: str | None = None,
    business_name: str | None = None,
    address_line: str | None = None,
    postal_code: str | None = None,
    location_precision: str | None = None,
) -> dict | None:
    expected = SECTION_ENTITY[section]
    result = route_card(
        text=text,
        person_name=person_name,
        business_name=business_name,
        has_contact=True,
        address_line=address_line,
        postal_code=postal_code,
        location_precision=location_precision,
    )
    if not result.ok or result.entity_type == expected:
        return None
    # Only flag when router is confident enough and points elsewhere.
    if result.confidence == "none":
        return None
    return {
        "section": section,
        "entity_id": entity_id,
        "slug": slug,
        "title": title,
        "current_entity_type": expected,
        "suggested_entity_type": result.entity_type,
        "suggested_collection": result.target_collection,
        "confidence": result.confidence,
        "reason": result.reason,
        "path": _path(section, slug or entity_id),
    }


def _path(section: str, slug: str) -> str:
    prefixes = {
        "professionals": "/professional",
        "businesses": "/business",
        "marketplace": "/marketplace",
        "jobs": "/jobs",
        "events": "/events",
        "lechu": "/lechu",
        "transfers": "/transfers",
    }
    return f"{prefixes[section]}/{slug}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Cap rows per table (0=all)")
    args = parser.parse_args()
    load_env()
    client = SupabaseRest.from_env()

    findings: list[dict] = []

    # Professionals
    pros = fetch_all(
        client,
        "/professionals",
        "id,slug,display_name,description,short_description,headline,status",
        {"status": "eq.approved"},
    )
    if args.limit:
        pros = pros[: args.limit]
    for row in pros:
        text = " ".join(
            filter(
                None,
                [
                    row.get("display_name"),
                    row.get("headline"),
                    row.get("short_description"),
                    row.get("description"),
                ],
            )
        )
        hit = mismatch(
            section="professionals",
            entity_id=row["id"],
            slug=row.get("slug"),
            title=row.get("display_name") or "",
            text=text,
            person_name=row.get("display_name"),
        )
        if hit:
            findings.append(hit)

    # Businesses
    biz = fetch_all(
        client,
        "/businesses",
        "id,slug,name,description,short_description,status,address_line,postal_code,location_precision",
        {"status": "eq.approved"},
    )
    if args.limit:
        biz = biz[: args.limit]
    for row in biz:
        text = " ".join(
            filter(
                None,
                [
                    row.get("name"),
                    row.get("short_description"),
                    row.get("description"),
                ],
            )
        )
        hit = mismatch(
            section="businesses",
            entity_id=row["id"],
            slug=row.get("slug"),
            title=row.get("name") or "",
            text=text,
            business_name=row.get("name"),
            address_line=row.get("address_line"),
            postal_code=row.get("postal_code"),
            location_precision=row.get("location_precision"),
        )
        if hit:
            findings.append(hit)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = ROOT / "docs" / "audits" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": stamp,
        "count": len(findings),
        "by_suggestion": {},
        "findings": findings,
    }
    for f in findings:
        key = f"{f['section']}→{f['suggested_collection']}"
        payload["by_suggestion"][key] = payload["by_suggestion"].get(key, 0) + 1

    stamped = out_dir / f"section_routing_audit_{stamp}.json"
    latest = out_dir / "section_routing_audit_latest.json"
    stamped.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    latest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"mismatches: {len(findings)}")
    for k, v in sorted(payload["by_suggestion"].items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}")
    print(f"wrote {stamped.relative_to(ROOT)}")
    print(f"wrote {latest.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
