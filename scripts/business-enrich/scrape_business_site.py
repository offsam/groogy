#!/usr/bin/env python3
"""Standalone dry-run: visit a business website and extract hours/address/phone.

No Supabase credentials needed, no DB access at all — this is a pure
extraction probe for testing the fixed web scraper (see
scripts/facebook-collector/web_enrichment.py: extract_website_profile_deep,
extract_hours_text, extract_address_text) against a raw URL, independent of
any published business row. Never writes anything anywhere.

Usage:
  python3 scripts/business-enrich/scrape_business_site.py --url https://example.com
  python3 scripts/business-enrich/scrape_business_site.py --url example.com --json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))

from web_enrichment import extract_website_profile_deep  # noqa: E402

# Reuse the existing structured-hours/address normalizers rather than
# duplicating them — they already live in enrich_published_businesses.py.
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))
from enrich_published_businesses import (  # noqa: E402
    clean_street_typos,
    looks_like_street,
    parse_address_parts,
    parse_hours_spec_blob,
    parse_hours_to_weekly,
)


def probe(url: str) -> dict[str, Any]:
    profile = extract_website_profile_deep(url)
    out: dict[str, Any] = {
        "url": url,
        "resolved_url": profile.get("url"),
        "status": profile.get("status"),
        "error": profile.get("error"),
        "pages_tried": profile.get("pages_tried"),
    }
    if profile.get("status") != "ok":
        return out

    out["phone"] = profile.get("phone") or []
    out["email"] = profile.get("email") or []
    out["social_links"] = profile.get("social_links") or []

    raw_address = profile.get("address")
    out["address_raw"] = raw_address
    if raw_address:
        parts = parse_address_parts(raw_address)
        if looks_like_street(raw_address):
            parts["address_line"] = (
                clean_street_typos(parts["address_line"]) if parts.get("address_line") else None
            )
        out["address_parsed"] = parts
    else:
        out["address_parsed"] = None

    raw_hours = profile.get("hours")
    out["hours_raw"] = raw_hours
    weekly = None
    if raw_hours:
        weekly = parse_hours_spec_blob(raw_hours) or parse_hours_to_weekly(raw_hours)
    out["hours_parsed"] = weekly
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Dry-run probe: extract hours/address/phone from a business website")
    parser.add_argument("--url", required=True, help="Business website URL (scheme optional)")
    parser.add_argument("--json", action="store_true", help="Print raw JSON only (no summary line)")
    args = parser.parse_args()

    result = probe(args.url)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    print(json.dumps(result, ensure_ascii=False, indent=2))
    found = []
    if result.get("hours_parsed"):
        found.append("hours")
    if (result.get("address_parsed") or {}).get("address_line"):
        found.append("address")
    if result.get("phone"):
        found.append("phone")
    print(
        f"\nSummary: status={result.get('status')} found={found or 'none'} "
        f"pages_tried={len(result.get('pages_tried') or [])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
