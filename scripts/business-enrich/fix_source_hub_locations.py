#!/usr/bin/env python3
"""Fix businesses geocoded outside their source-group metro.

Example: street «5800 Madison Ave» without city → Buena Park, but
source is facebook.com/groups/Russian.Sacramento → Sacramento.

Usage:
  python3 scripts/business-enrich/fix_source_hub_locations.py --dry-run
  python3 scripts/business-enrich/fix_source_hub_locations.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402
from group_location import location_from_group  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "dupe_audit"
OUT.mkdir(parents=True, exist_ok=True)

HUB_BOUNDS: dict[str, tuple[float, float, float, float]] = {
    # south, north, west, east
    "sacramento": (38.2, 39.05, -122.0, -120.8),
    "orange-county": (33.38, 33.95, -118.14, -117.4),
    "los-angeles": (33.7, 34.4, -118.7, -117.85),
    "san-diego": (32.5, 33.3, -117.4, -116.8),
    "san-francisco": (37.35, 37.95, -122.6, -121.9),
}

HUB_META: dict[str, dict[str, str | None]] = {
    "sacramento": {
        "city": "Sacramento",
        "region": "Sacramento County",
        "state_code": "US-CA",
    },
    "orange-county": {
        "city": None,
        "region": "Orange County",
        "state_code": "US-CA",
    },
    "los-angeles": {
        "city": "Los Angeles",
        "region": "Los Angeles County",
        "state_code": "US-CA",
    },
    "san-diego": {
        "city": "San Diego",
        "region": "San Diego County",
        "state_code": "US-CA",
    },
    "san-francisco": {
        "city": "San Francisco",
        "region": "San Francisco County",
        "state_code": "US-CA",
    },
}

CITY_TO_HUB = {
    "sacramento": "sacramento",
    "roseville": "sacramento",
    "antelope": "sacramento",
    "citrus heights": "sacramento",
    "elk grove": "sacramento",
    "rancho cordova": "sacramento",
    "folsom": "sacramento",
    "buena park": "orange-county",
    "irvine": "orange-county",
    "anaheim": "orange-county",
    "costa mesa": "orange-county",
    "tustin": "orange-county",
    "huntington beach": "orange-county",
    "newport beach": "orange-county",
    "mission viejo": "orange-county",
    "laguna hills": "orange-county",
    "orange": "orange-county",
    "fullerton": "orange-county",
    "santa ana": "orange-county",
    "garden grove": "orange-county",
    "los angeles": "los-angeles",
    "glendale": "los-angeles",
    "encino": "los-angeles",
    "hollywood hills": "los-angeles",
    "west hollywood": "los-angeles",
    "long beach": "los-angeles",
    "san diego": "san-diego",
    "chula vista": "san-diego",
    "san francisco": "san-francisco",
    "oakland": "san-francisco",
    "walnut creek": "san-francisco",
}


def hub_from_source(url: str | None) -> str | None:
    if not url:
        return None
    loc = location_from_group(url)
    if not loc:
        # location_from_group returns city/region; map to hub id
        return None
    city = (loc.get("city") or "").lower()
    region = (loc.get("region") or "").lower()
    blob = f"{city} {region} {url}".lower()
    if "sacramento" in blob:
        return "sacramento"
    if "orange" in blob:
        return "orange-county"
    if "diego" in blob:
        return "san-diego"
    if "francisco" in blob or "bay" in blob:
        return "san-francisco"
    if "los angeles" in blob or re.search(r"\bla\b", blob):
        return "los-angeles"
    return None


def hub_from_url_direct(url: str | None) -> str | None:
    if not url:
        return None
    u = url.lower()
    if "sacramento" in u:
        return "sacramento"
    if "orangecounty" in u or "orange-county" in u or "orange%20county" in u:
        return "orange-county"
    if "sandiego" in u or "san-diego" in u:
        return "san-diego"
    if "russiansf" in u or "sanfrancisco" in u or "bayarea" in u:
        return "san-francisco"
    if "russian.la" in u or "russianla" in u or "losangeles" in u:
        return "los-angeles"
    m = re.search(r"facebook\.com/groups/([^/?#]+)", u)
    if m:
        return hub_from_source(m.group(1).replace("%20", " ").replace("+", " "))
    return hub_from_source(url)


def hub_from_coords(lat: float | None, lng: float | None) -> str | None:
    if lat is None or lng is None:
        return None
    for hid, (s, n, w, e) in HUB_BOUNDS.items():
        if s <= lat <= n and w <= lng <= e:
            return hid
    return None


def hub_from_city(city: str | None) -> str | None:
    if not city:
        return None
    return CITY_TO_HUB.get(city.strip().lower())


def nominatim_search(query: str) -> dict[str, Any] | None:
    qs = urllib.parse.urlencode(
        {
            "q": query,
            "format": "jsonv2",
            "limit": 1,
            "addressdetails": 1,
            "countrycodes": "us",
        }
    )
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{qs}",
        headers={
            "User-Agent": "KrugiBusinessDirectory/1.0 (source-hub fix)",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    return data[0] if data else None


def normalize_street_for_geocode(address: str) -> list[str]:
    """Return address variants Nominatim is more likely to resolve."""
    raw = address.strip()
    variants = [raw]
    # third Ave → 3rd Ave (common FB post style)
    ordinals = {
        "first": "1st",
        "second": "2nd",
        "third": "3rd",
        "fourth": "4th",
        "fifth": "5th",
        "sixth": "6th",
        "seventh": "7th",
        "eighth": "8th",
        "ninth": "9th",
        "tenth": "10th",
    }
    lowered = raw
    for word, num in ordinals.items():
        pat = re.compile(rf"\b{word}\b", re.I)
        if pat.search(lowered):
            variants.append(pat.sub(num, raw))
            break
    # Ave → Avenue
    if re.search(r"\bAve\.?\b", raw, re.I) and "Avenue" not in raw:
        variants.append(re.sub(r"\bAve\.?\b", "Avenue", raw, flags=re.I))
    # dedupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for v in variants:
        key = v.lower()
        if key not in seen:
            seen.add(key)
            out.append(v)
    return out


def geocode_in_hub(address: str, hub_id: str) -> dict[str, Any] | None:
    meta = HUB_META[hub_id]
    city = meta.get("city")
    region = meta.get("region")
    # Prefer city bias; for OC use region name
    bias = city or region or "California"
    house = re.match(r"^(\d+)", address.strip())
    house_num = house.group(1) if house else None
    fallback: dict[str, Any] | None = None

    for addr_variant in normalize_street_for_geocode(address):
        queries = [
            f"{addr_variant}, {bias}, CA, USA",
            f"{addr_variant}, {bias}, California",
        ]
        for q in queries:
            hit = nominatim_search(q)
            time.sleep(1.1)
            if not hit:
                continue
            lat = float(hit["lat"])
            lng = float(hit["lon"])
            addr = hit.get("address") or {}
            place_city = (
                addr.get("city")
                or addr.get("town")
                or addr.get("village")
                or addr.get("hamlet")
            )
            coord_ok = hub_from_coords(lat, lng) == hub_id
            city_ok = hub_from_city(place_city) == hub_id
            if not coord_ok and not city_ok:
                continue
            if not coord_ok and hub_from_coords(lat, lng) and hub_from_coords(lat, lng) != hub_id:
                continue

            postcode = str(addr.get("postcode") or "")
            zm = re.match(r"^(\d{5})", postcode)
            result = {
                "latitude": lat,
                "longitude": lng,
                "postal_code": zm.group(1) if zm else None,
                "city": place_city or city,
                "display": hit.get("display_name"),
                "has_house": bool(
                    house_num
                    and (
                        str(addr.get("house_number") or "") == house_num
                        or house_num in str(hit.get("display_name") or "")
                    )
                ),
            }
            if result["has_house"]:
                return result
            if fallback is None:
                fallback = result
    return fallback
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    apply = bool(args.apply)
    if not apply and not args.dry_run:
        args.dry_run = True

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    sb = SupabaseRest(url, key)

    rows = (
        sb._request(
            "GET",
            "/businesses",
            params={
                "select": "id,slug,name,city,region,postal_code,address_line,latitude,longitude,source_url,source_kind,status",
                "status": "in.(approved,pending,deferred)",
                "limit": "3000",
            },
        )
        or []
    )

    report: dict[str, Any] = {
        "mode": "apply" if apply else "dry_run",
        "fixes": [],
        "skipped": [],
    }

    for r in rows:
        src_hub = hub_from_url_direct(r.get("source_url"))
        if not src_hub:
            continue
        coord_hub = hub_from_coords(r.get("latitude"), r.get("longitude"))
        city_hub = hub_from_city(r.get("city"))
        conflict = False
        if coord_hub and coord_hub != src_hub:
            conflict = True
        if city_hub and city_hub != src_hub:
            conflict = True
        # Street present, city missing, source has city hub → still fill
        addr = (r.get("address_line") or "").strip()
        city = (r.get("city") or "").strip()
        needs_fill = bool(addr) and not city and src_hub in (
            "sacramento",
            "los-angeles",
            "san-diego",
            "san-francisco",
        )
        if not conflict and not needs_fill:
            continue
        if not addr:
            report["skipped"].append(
                {"slug": r["slug"], "reason": "no address", "src_hub": src_hub}
            )
            continue

        meta = HUB_META[src_hub]
        geo = geocode_in_hub(addr, src_hub)
        patch: dict[str, Any] = {
            "region": meta["region"],
            "state_code": meta["state_code"],
        }
        if meta.get("city"):
            patch["city"] = meta["city"]
        elif geo and geo.get("city"):
            patch["city"] = geo["city"]

        if geo:
            patch["latitude"] = geo["latitude"]
            patch["longitude"] = geo["longitude"]
            # Exact house → street; street centroid only → county (coords still useful)
            patch["location_precision"] = (
                "street" if geo.get("has_house") else "county"
            )
            if geo.get("postal_code"):
                patch["postal_code"] = geo["postal_code"]
            # Prefer geocoder city when hub is OC (no single city)
            if src_hub == "orange-county" and geo.get("city"):
                patch["city"] = geo["city"]
            elif geo.get("city") and src_hub != "orange-county":
                # Keep hub primary city for Sacramento etc., unless geocoder
                # found a suburb in the same hub (Roseville, etc.)
                ghub = hub_from_city(geo["city"])
                if ghub == src_hub:
                    patch["city"] = geo["city"]
        else:
            # At least snap city/region to source; clear wrong coords outside hub.
            # businesses.location_precision only allows street|county|null.
            if coord_hub and coord_hub != src_hub:
                patch["latitude"] = None
                patch["longitude"] = None
                patch["postal_code"] = None
                patch["location_precision"] = "county"

        item = {
            "slug": r["slug"],
            "name": r.get("name"),
            "src_hub": src_hub,
            "was": {
                "city": r.get("city"),
                "region": r.get("region"),
                "postal_code": r.get("postal_code"),
                "latitude": r.get("latitude"),
                "longitude": r.get("longitude"),
                "coord_hub": coord_hub,
            },
            "patch": patch,
            "geo_display": (geo or {}).get("display"),
            "source_url": r.get("source_url"),
        }
        report["fixes"].append(item)
        print(
            f"FIX {r['slug'][:40]:40} {coord_hub or city_hub} → {src_hub} "
            f"city={patch.get('city')} zip={patch.get('postal_code')} "
            f"lat={patch.get('latitude')}"
        )
        if apply:
            sb.patch("businesses", {"id": f"eq.{r['id']}"}, patch)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if apply else "dry_run"
    path = OUT / f"source_hub_fix_{mode}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"fixes={len(report['fixes'])} skipped={len(report['skipped'])} → {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
