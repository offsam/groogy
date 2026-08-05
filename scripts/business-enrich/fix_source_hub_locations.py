#!/usr/bin/env python3
"""Fix businesses geocoded outside their source-group metro.

Example: street «5800 Madison Ave» without city → Buena Park, but
source is facebook.com/groups/Russian.Sacramento → Sacramento.

Trust ladder (must not fight ZIP repair):
  1. ZIP county / hub wins over source-group hub
  2. Existing city that matches ZIP wins over source hub
  3. Only then re-geocode into the source hub via address_geo

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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))
from address_geo import resolve_address_geo  # noqa: E402
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

# ZIP3 → hub (CA SoCal / Sac). Mixed Bay Area ZIP3s return None.
ZIP3_TO_HUB: dict[str, str] = {
    "900": "los-angeles",
    "901": "los-angeles",
    "902": "los-angeles",
    "903": "los-angeles",
    "904": "los-angeles",
    "905": "los-angeles",
    "907": "los-angeles",
    "908": "los-angeles",
    "910": "los-angeles",
    "911": "los-angeles",
    "912": "los-angeles",
    "913": "los-angeles",
    "914": "los-angeles",
    "915": "los-angeles",
    "916": "los-angeles",
    "917": "los-angeles",
    "918": "los-angeles",
    # 906 is mixed LA/OC — leave unset; city/coord decide
    "926": "orange-county",
    "927": "orange-county",
    "928": "orange-county",
    "919": "san-diego",
    "920": "san-diego",
    "921": "san-diego",
    "942": "sacramento",
    "956": "sacramento",
    "957": "sacramento",
    "958": "sacramento",
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
    "westminster": "orange-county",
    "yorba linda": "orange-county",
    "lake forest": "orange-county",
    "los angeles": "los-angeles",
    "glendale": "los-angeles",
    "encino": "los-angeles",
    "beverly hills": "los-angeles",
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


def hub_from_postal(postal: str | None) -> str | None:
    z = re.sub(r"\D", "", postal or "")[:5]
    if len(z) != 5:
        return None
    return ZIP3_TO_HUB.get(z[:3])


def geocode_in_hub(
    address: str,
    hub_id: str,
    *,
    postal_code: str | None = None,
    prefer_city: str | None = None,
) -> dict[str, Any] | None:
    """Geocode via address_geo; keep only hits that land in hub_id."""
    meta = HUB_META[hub_id]
    bias_city = prefer_city or meta.get("city")
    # OC has no single city — use region name only as query bias text via city slot
    if not bias_city and hub_id == "orange-county":
        bias_city = None

    geo = resolve_address_geo(
        address,
        city=bias_city,
        state_code=meta.get("state_code") or "US-CA",
        postal_code=postal_code,
        throttle=True,
        with_maps_url=True,
    )
    if not geo.ok:
        # Retry with hub primary city when prefer_city failed, or OC with no city
        if prefer_city and prefer_city != meta.get("city"):
            geo = resolve_address_geo(
                address,
                city=meta.get("city"),
                state_code=meta.get("state_code") or "US-CA",
                postal_code=postal_code,
                throttle=True,
                with_maps_url=True,
            )
        elif hub_id == "orange-county" and not prefer_city:
            # Bias with county label as free-text city for Nominatim
            geo = resolve_address_geo(
                address,
                city="Orange County",
                state_code="US-CA",
                postal_code=postal_code,
                throttle=True,
                with_maps_url=True,
            )

    if not geo.ok:
        return None

    lat = geo.patch.get("latitude")
    lng = geo.patch.get("longitude")
    coord_hub = hub_from_coords(
        float(lat) if lat is not None else None,
        float(lng) if lng is not None else None,
    )
    if coord_hub and coord_hub != hub_id:
        return None

    return {
        "latitude": lat,
        "longitude": lng,
        "postal_code": geo.patch.get("postal_code"),
        "location_precision": geo.patch.get("location_precision"),
        "google_maps_url": geo.patch.get("google_maps_url"),
        "query": geo.query,
    }


def fetch_all(client: SupabaseRest, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                path,
                params={**params, "limit": "1000", "offset": str(offset)},
            )
            or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


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

    rows = fetch_all(
        sb,
        "/businesses",
        {
            "select": "id,slug,name,city,region,postal_code,address_line,latitude,longitude,source_url,source_kind,status",
            "status": "in.(approved,pending,deferred)",
            "order": "id.asc",
        },
    )
    print(f"loaded businesses: {len(rows)}")

    report: dict[str, Any] = {
        "mode": "apply" if apply else "dry_run",
        "fixes": [],
        "skipped": [],
    }

    for r in rows:
        src_hub = hub_from_url_direct(r.get("source_url"))
        if not src_hub:
            continue

        postal = (r.get("postal_code") or "").strip() or None
        zip_hub = hub_from_postal(postal)
        coord_hub = hub_from_coords(r.get("latitude"), r.get("longitude"))
        city_hub = hub_from_city(r.get("city"))
        addr = (r.get("address_line") or "").strip()
        city = (r.get("city") or "").strip()

        # ZIP already places the card in another metro → never force source hub.
        if zip_hub and zip_hub != src_hub:
            report["skipped"].append(
                {
                    "slug": r["slug"],
                    "reason": "zip_hub_wins",
                    "src_hub": src_hub,
                    "zip_hub": zip_hub,
                    "postal_code": postal,
                }
            )
            continue

        # City + ZIP agree against source hub → keep (do not stamp group city).
        if city_hub and zip_hub and city_hub == zip_hub and city_hub != src_hub:
            report["skipped"].append(
                {
                    "slug": r["slug"],
                    "reason": "city_zip_agree_over_source",
                    "src_hub": src_hub,
                    "city_hub": city_hub,
                    "zip_hub": zip_hub,
                }
            )
            continue

        # Coords already match ZIP in a different hub than source → keep.
        if (
            coord_hub
            and coord_hub != src_hub
            and zip_hub
            and zip_hub == coord_hub
        ):
            report["skipped"].append(
                {
                    "slug": r["slug"],
                    "reason": "coords_match_zip_over_source",
                    "src_hub": src_hub,
                    "coord_hub": coord_hub,
                    "zip_hub": zip_hub,
                }
            )
            continue

        conflict = False
        if coord_hub and coord_hub != src_hub:
            conflict = True
        if city_hub and city_hub != src_hub:
            conflict = True

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
        prefer = city if city_hub == src_hub else None
        geo = geocode_in_hub(
            addr, src_hub, postal_code=postal, prefer_city=prefer
        )

        patch: dict[str, Any] = {
            "region": meta["region"],
            "state_code": meta["state_code"],
        }

        if geo:
            patch["latitude"] = geo["latitude"]
            patch["longitude"] = geo["longitude"]
            if geo.get("location_precision"):
                patch["location_precision"] = geo["location_precision"]
            if geo.get("google_maps_url"):
                patch["google_maps_url"] = geo["google_maps_url"]
            if geo.get("postal_code") and not postal:
                patch["postal_code"] = geo["postal_code"]
            # City: keep existing if already in hub; else hub primary or leave
            if city_hub == src_hub and city:
                patch["city"] = city
            elif meta.get("city"):
                patch["city"] = meta["city"]
            # OC: do not invent a city when geocode did not fill one
        else:
            # Snap region to source hub; clear coords only when they are outside hub.
            if coord_hub and coord_hub != src_hub:
                patch["latitude"] = None
                patch["longitude"] = None
                patch["location_precision"] = None
                # Keep ZIP — clearing it made ZIP repair harder
            if city_hub == src_hub and city:
                patch["city"] = city
            elif meta.get("city") and not postal:
                # Only stamp hub city when there is no ZIP that already placed us
                patch["city"] = meta["city"]
            elif meta.get("city") and zip_hub == src_hub and not city:
                patch["city"] = meta["city"]

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
                "zip_hub": zip_hub,
            },
            "patch": patch,
            "geo_query": (geo or {}).get("query"),
            "source_url": r.get("source_url"),
        }
        report["fixes"].append(item)
        print(
            f"FIX {r['slug'][:40]:40} {coord_hub or city_hub} → {src_hub} "
            f"city={patch.get('city')} zip={patch.get('postal_code') or postal} "
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
