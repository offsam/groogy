#!/usr/bin/env python3
"""Fix businesses where city county ≠ ZIP county (hub stamp conflicts).

Example: city=Los Angeles + postal=92683 (Westminster / Orange County).
Soft mismatches in the same county (West Hollywood vs ZIP place name LA) are skipped.

Usage:
  python3 scripts/business-enrich/repair_zip_city_county_conflicts.py
  python3 scripts/business-enrich/repair_zip_city_county_conflicts.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402

OUT = (
    ROOT
    / "scripts"
    / "business-enrich"
    / "data"
    / "repair_zip_city_county_conflicts.json"
)

# Rough CA ZIP → county geoid for speed (verified against Zippopotam+FCC for conflicts).
# Only used as a hint; Zippopotam place city is the write target.
CA_ZIP3_COUNTY = {
    # Los Angeles County (partial)
    "900": "06037",
    "901": "06037",
    "902": "06037",
    "903": "06037",
    "904": "06037",
    "905": "06037",
    "906": "06037",
    "907": "06037",
    "908": "06037",
    "910": "06037",
    "911": "06037",
    "912": "06037",
    "913": "06037",
    "914": "06037",
    "915": "06037",
    "916": "06037",
    "917": "06037",
    "918": "06037",
    # Orange County
    "926": "06059",
    "927": "06059",
    "928": "06059",
    # San Diego
    "919": "06073",
    "920": "06073",
    "921": "06073",
    # Sacramento area
    "942": "06067",
    "956": "06067",  # mixed — verify via city when needed
    "957": "06067",
    "958": "06067",
    # SF Bay (mixed counties) — rely on city hub labels instead of zip3 alone
}

CITY_HUB = [
    (
        re.compile(
            r"los\s*angeles|glendale|burbank|pasadena|santa\s*monica|west\s*hollywood|"
            r"beverly\s*hills|hollywood|van\s*nuys|northridge|woodland\s*hills|"
            r"chatsworth|tarzana|north\s*hollywood|canoga\s*park|long\s*beach|"
            r"лос[-\s]?анджелес",
            re.I,
        ),
        "la",
        "06037",
        "Los Angeles County",
    ),
    (
        re.compile(
            r"irvine|anaheim|santa\s*ana|costa\s*mesa|huntington\s*beach|newport|"
            r"fullerton|garden\s*grove|westminster|tustin|laguna|mission\s*viejo|"
            r"orange\s*county|^oc$|yorba|lake\s*forest|buena\s*park",
            re.I,
        ),
        "oc",
        "06059",
        "Orange County",
    ),
    (
        re.compile(
            r"sacramento|roseville|elk\s*grove|citrus\s*heights|folsom|сакраменто",
            re.I,
        ),
        "sac",
        "06067",
        "Sacramento County",
    ),
    (
        re.compile(
            r"san\s*francisco|oakland|berkeley|san\s*jose|palo\s*alto|bay\s*area|"
            r"сан[-\s]?франциско",
            re.I,
        ),
        "sf",
        None,
        None,
    ),
    (
        re.compile(r"san\s*diego|chula\s*vista|la\s*jolla|carlsbad|сан[-\s]?диего", re.I),
        "sd",
        "06073",
        "San Diego County",
    ),
]

COUNTY_NAME = {
    "06037": "Los Angeles County",
    "06059": "Orange County",
    "06067": "Sacramento County",
    "06073": "San Diego County",
}


def norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def city_hub(city: str) -> tuple[str | None, str | None, str | None]:
    for pattern, hub, geoid, region in CITY_HUB:
        if pattern.search(city):
            return hub, geoid, region
    return None, None, None


def zip_lookup(z: str, cache: dict[str, Any]) -> dict[str, Any] | None:
    z = re.sub(r"\D", "", z or "")[:5]
    if len(z) != 5:
        return None
    if z in cache:
        return cache[z]
    try:
        with urllib.request.urlopen(
            f"https://api.zippopotam.us/us/{z}", timeout=12
        ) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        place = (data.get("places") or [{}])[0]
        out = {
            "city": place.get("place name"),
            "state": place.get("state abbreviation"),
            "lat": place.get("latitude"),
            "lng": place.get("longitude"),
        }
    except Exception:  # noqa: BLE001
        out = None
    cache[z] = out
    time.sleep(0.04)
    return out


def zip_county_geoid(z: str) -> str | None:
    z3 = re.sub(r"\D", "", z or "")[:3]
    return CA_ZIP3_COUNTY.get(z3)


def is_hard_conflict(city: str, zip_city: str, postal: str) -> bool:
    """True when city metro/county clearly disagrees with ZIP metro/county."""
    if norm(city) == norm(zip_city):
        return False
    ch, c_geoid, _ = city_hub(city)
    zh, z_geoid, _ = city_hub(zip_city)
    if ch and zh and ch != zh:
        return True
    # ZIP3 county vs city hub county
    zc = zip_county_geoid(postal)
    if c_geoid and zc and c_geoid != zc:
        return True
    # city hub vs ZIP place hub already covered; also hub city + foreign ZIP place
    if ch == "la" and zc == "06059":
        return True
    if ch == "oc" and zc == "06037":
        return True
    if ch == "la" and zh == "oc":
        return True
    if ch == "oc" and zh == "la":
        return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/businesses",
                params={
                    "select": "id,slug,name,city,region,postal_code,address_line,county_geoid,status",
                    "status": "eq.approved",
                    "postal_code": "not.is.null",
                    "order": "id",
                    "limit": "500",
                    "offset": str(offset),
                },
            )
            or []
        )
        rows.extend(batch)
        if len(batch) < 500:
            break
        offset += 500
        if args.limit and len(rows) >= args.limit:
            rows = rows[: args.limit]
            break

    print(f"scanned approved with postal: {len(rows)}")
    zip_cache: dict[str, Any] = {}
    fixes: list[dict[str, Any]] = []

    for r in rows:
        city = (r.get("city") or "").strip()
        postal = (r.get("postal_code") or "").strip()
        if not city or not postal:
            continue
        info = zip_lookup(postal, zip_cache)
        if not info or not info.get("city"):
            continue
        zip_city = str(info["city"]).strip()
        if not is_hard_conflict(city, zip_city, postal):
            continue
        zc = zip_county_geoid(postal)
        _, _, zip_region_from_hub = city_hub(zip_city)
        region = zip_region_from_hub or COUNTY_NAME.get(zc or "") or r.get("region")
        fixes.append(
            {
                "id": r["id"],
                "slug": r.get("slug"),
                "name": r.get("name"),
                "before": {
                    "city": city,
                    "region": r.get("region"),
                    "county_geoid": r.get("county_geoid"),
                    "postal_code": postal,
                },
                "after": {
                    "city": zip_city,
                    "region": region,
                    "county_geoid": zc,
                    "postal_code": re.sub(r"\D", "", postal)[:5],
                    "state_code": "US-CA"
                    if (info.get("state") or "").upper() == "CA"
                    else (
                        f"US-{info['state']}"
                        if info.get("state")
                        else r.get("state_code")
                    ),
                },
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scanned": len(rows),
        "hard_conflicts": len(fixes),
        "items": fixes,
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"hard conflicts: {len(fixes)}")
    print(f"wrote {OUT}")
    for item in fixes[:20]:
        b = item["before"]
        a = item["after"]
        print(
            f"  {item['slug']}: {b['city']!r} → {a['city']!r} "
            f"(ZIP {b['postal_code']}, region {a['region']})"
        )

    if not args.apply:
        print("dry-run only; pass --apply to patch DB")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    n = 0
    for item in fixes:
        body = {**item["after"], "updated_at": now}
        # drop nulls
        body = {k: v for k, v in body.items() if v is not None}
        client.patch("businesses", {"id": f"eq.{item['id']}"}, body)
        n += 1
        if n % 25 == 0:
            print(f"  patched {n}/{len(fixes)}")
    print(f"patched {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
