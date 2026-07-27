#!/usr/bin/env python3
"""Enrich professionals.city / postal_code / private_address_line from text + import queue.

Fill-empty only. Never invents addresses.

Usage:
  python3 scripts/business-enrich/enrich_professional_locations.py --dry-run
  python3 scripts/business-enrich/enrich_professional_locations.py --apply
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "professional_locations"
OUT.mkdir(parents=True, exist_ok=True)

# Common SoCal / CA city tokens (title-cased for storage)
KNOWN_CITIES = {
    "irvine": "Irvine",
    "tustin": "Tustin",
    "anaheim": "Anaheim",
    "orange": "Orange",
    "santa ana": "Santa Ana",
    "costa mesa": "Costa Mesa",
    "newport beach": "Newport Beach",
    "huntington beach": "Huntington Beach",
    "laguna hills": "Laguna Hills",
    "laguna niguel": "Laguna Niguel",
    "laguna beach": "Laguna Beach",
    "aliso viejo": "Aliso Viejo",
    "mission viejo": "Mission Viejo",
    "lake forest": "Lake Forest",
    "fountain valley": "Fountain Valley",
    "garden grove": "Garden Grove",
    "fullerton": "Fullerton",
    "yorba linda": "Yorba Linda",
    "brea": "Brea",
    "buena park": "Buena Park",
    "cypress": "Cypress",
    "los alamitos": "Los Alamitos",
    "seal beach": "Seal Beach",
    "westminster": "Westminster",
    "placentia": "Placentia",
    "san clemente": "San Clemente",
    "san juan capistrano": "San Juan Capistrano",
    "dana point": "Dana Point",
    "los angeles": "Los Angeles",
    "hollywood": "Hollywood",
    "glendale": "Glendale",
    "burbank": "Burbank",
    "pasadena": "Pasadena",
    "long beach": "Long Beach",
    "torrance": "Torrance",
    "santa monica": "Santa Monica",
    "culver city": "Culver City",
    "sherman oaks": "Sherman Oaks",
    "encino": "Encino",
    "van nuys": "Van Nuys",
    "north hollywood": "North Hollywood",
    "west hollywood": "West Hollywood",
    "sacramento": "Sacramento",
    "san francisco": "San Francisco",
    "san jose": "San Jose",
    "oakland": "Oakland",
    "palo alto": "Palo Alto",
    "mountain view": "Mountain View",
    "sunnyvale": "Sunnyvale",
    "fremont": "Fremont",
    "berkeley": "Berkeley",
    "walnut creek": "Walnut Creek",
    "concord": "Concord",
    "san diego": "San Diego",
    "la jolla": "La Jolla",
    "carlsbad": "Carlsbad",
    "redwood city": "Redwood City",
    "westlake village": "Westlake Village",
    "thousand oaks": "Thousand Oaks",
    "calabasas": "Calabasas",
    "woodland hills": "Woodland Hills",
    "studio city": "Studio City",
    "beverly hills": "Beverly Hills",
    "manhattan beach": "Manhattan Beach",
    "redondo beach": "Redondo Beach",
    "antelope": "Antelope",
    "roseville": "Roseville",
    "folsom": "Folsom",
    "elk grove": "Elk Grove",
}

CITY_STATE_ZIP_RE = re.compile(
    r"\b([A-Za-z][A-Za-z .'-]{1,40}),\s*(?:CA|California)\s+(\d{5})(?:-\d{4})?\b",
    re.I,
)
STATE_ZIP_RE = re.compile(
    r"\b(?:CA|California)\s+(\d{5})(?:-\d{4})?\b",
    re.I,
)
STREET_RE = re.compile(
    r"\b\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9 .'-]{2,60}"
    r"(?:Ave|Avenue|St|Street|Blvd|Boulevard|Dr|Drive|Rd|Road|Way|Ln|Lane|Ct|Court|"
    r"Pl|Place|Cir|Circle|Pkwy|Parkway|Hwy|Highway)\b\.?",
    re.I,
)


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def extract_zip(text: str) -> str | None:
    m = CITY_STATE_ZIP_RE.search(text) or STATE_ZIP_RE.search(text)
    if m:
        return m.group(m.lastindex or 1)
    # ", 92618" not followed by street words
    m2 = re.search(r",\s*(\d{5})(?:-\d{4})?\b(?!\s*[A-Za-z])", text)
    if m2:
        return m2.group(1)
    return None


def extract_city(text: str) -> str | None:
    m = CITY_STATE_ZIP_RE.search(text)
    if m:
        cand = re.sub(r"\s+", " ", m.group(1)).strip(" ,.-")
        if cand and "county" not in cand.lower():
            return cand.title() if cand.islower() or cand.isupper() else cand

    low = text.lower()
    # Don't treat «Orange County» as city Orange
    low_for_city = re.sub(r"\borange\s+county\b", " ", low)
    # Longer names first
    for key in sorted(KNOWN_CITIES.keys(), key=len, reverse=True):
        if key == "orange" and re.search(r"\borange\s+county\b", low):
            continue
        if re.search(rf"\b{re.escape(key)}\b", low_for_city):
            return KNOWN_CITIES[key]
    return None


def extract_street(text: str) -> str | None:
    m = STREET_RE.search(text)
    if not m:
        return None
    street = re.sub(r"\s+", " ", m.group(0)).strip(" ,.")
    # Don't keep if it looks like a phone-ish number dump
    if len(street) < 8 or len(street) > 90:
        return None
    return street


def blob_for(pro: dict[str, Any]) -> str:
    return "\n".join(
        str(x)
        for x in (
            pro.get("headline"),
            pro.get("short_description"),
            pro.get("description"),
            pro.get("service_area_text"),
            pro.get("region"),
            pro.get("display_name"),
        )
        if x
    )


def patch_from_text(pro: dict[str, Any]) -> dict[str, Any]:
    text = blob_for(pro)
    if not text.strip():
        return {}
    patch: dict[str, Any] = {}
    if empty(pro.get("postal_code")):
        z = extract_zip(text)
        if z:
            patch["postal_code"] = z
    if empty(pro.get("city")):
        city = extract_city(text)
        if city:
            patch["city"] = city
    if empty(pro.get("private_address_line")):
        street = extract_street(text)
        if street:
            patch["private_address_line"] = street
            if empty(pro.get("location_precision")):
                patch["location_precision"] = "street"
    if "city" in patch and empty(pro.get("location_precision")) and "location_precision" not in patch:
        patch["location_precision"] = "city"
    if "postal_code" in patch and empty(pro.get("state_code")):
        patch["state_code"] = "US-CA"
    return patch


def patch_from_item(pro: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if empty(pro.get("city")) and item.get("city"):
        city = str(item["city"]).strip()
        if 2 <= len(city) <= 80:
            patch["city"] = city
    text = "\n".join(
        str(x)
        for x in (item.get("source_text"), item.get("description"), item.get("title"))
        if x
    )
    if empty(pro.get("postal_code")):
        z = extract_zip(text)
        if z:
            patch["postal_code"] = z
    if empty(pro.get("city")) and "city" not in patch:
        city = extract_city(text)
        if city:
            patch["city"] = city
    if empty(pro.get("private_address_line")):
        street = extract_street(text)
        if street:
            patch["private_address_line"] = street
    if patch.get("postal_code") and empty(pro.get("state_code")):
        patch["state_code"] = "US-CA"
    if patch.get("city") and empty(pro.get("location_precision")):
        patch["location_precision"] = (
            "street" if patch.get("private_address_line") else "city"
        )
    return patch


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    apply = bool(args.apply) and not args.dry_run

    load_env()
    import os

    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    pros: list[dict[str, Any]] = []
    last = None
    while True:
        params: dict[str, str] = {
            "select": (
                "id,slug,display_name,headline,short_description,description,"
                "city,region,state_code,postal_code,private_address_line,"
                "location_precision,service_area_text,source_url,status"
            ),
            "status": "eq.approved",
            "order": "id.asc",
            "limit": "200",
        }
        if last:
            params["id"] = f"gt.{last}"
        batch = client._request("GET", "/professionals", params=params) or []
        if not batch:
            break
        pros.extend(batch)
        last = batch[-1]["id"]
        if args.limit and len(pros) >= args.limit:
            pros = pros[: args.limit]
            break
        if len(batch) < 200:
            break

    # Index import items by source_url
    by_url: dict[str, dict[str, Any]] = {}
    last = None
    while True:
        params = {
            "select": "id,source_url,city,source_text,description,title",
            "order": "id.asc",
            "limit": "500",
        }
        if last:
            params["id"] = f"gt.{last}"
        batch = client._request("GET", "/import_review_items", params=params) or []
        if not batch:
            break
        for it in batch:
            url = (it.get("source_url") or "").strip().lower().rstrip("/")
            if url and url not in by_url:
                by_url[url] = it
        last = batch[-1]["id"]
        if len(batch) < 500:
            break

    updated = 0
    field_hits: Counter[str] = Counter()
    samples: list[dict[str, Any]] = []

    for pro in pros:
        patch: dict[str, Any] = {}
        url = (pro.get("source_url") or "").strip().lower().rstrip("/")
        if url and url in by_url:
            patch.update(patch_from_item(pro, by_url[url]))
        # Re-read gaps after item patch for text fill
        merged = {**pro, **patch}
        for k, v in patch_from_text(merged).items():
            if k not in patch:
                patch[k] = v

        if not patch:
            continue
        updated += 1
        for k in patch:
            field_hits[k] += 1
        if len(samples) < 40:
            samples.append(
                {
                    "slug": pro.get("slug"),
                    "name": pro.get("display_name"),
                    "patch": patch,
                }
            )
        if apply:
            client._request("PATCH", f"/professionals?id=eq.{pro['id']}", body=patch)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if apply else "dry-run",
        "scanned": len(pros),
        "updated": updated,
        "fields": dict(field_hits),
        "samples": samples,
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({**report, "report": str(path), "samples": samples[:8]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
