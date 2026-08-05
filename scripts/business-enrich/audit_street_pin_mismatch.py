#!/usr/bin/env python3
"""Find street pins that land far from the card's city / contradict ZIP.

Root cause example: «4590 McArthur Blvd, Newport Beach» geocoded to
San Bernardino (Inland Empire) because Nominatim matched a different McArthur
Blvd and the geo step only checked state.

Usage:
  python3 scripts/business-enrich/audit_street_pin_mismatch.py --dry-run
  python3 scripts/business-enrich/audit_street_pin_mismatch.py --apply
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from address_geo import (  # noqa: E402
    normalize_street_spelling,
    resolve_address_geo,
)
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "audit_street_pin_mismatch"
OUT.mkdir(parents=True, exist_ok=True)

# Beyond metro diameter for a claimed city — treat as wrong pin.
MAX_KM_FROM_CITY = 45.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def fetch_all(
    client: SupabaseRest, table: str, select: str
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                f"/{table}",
                params={
                    "select": select,
                    "status": "eq.approved",
                    "location_precision": "eq.street",
                    "latitude": "not.is.null",
                    "longitude": "not.is.null",
                    "limit": "1000",
                    "offset": str(offset),
                    "order": "id.asc",
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def load_city_centers(
    url: str, anon_key: str
) -> dict[tuple[str, str], tuple[float, float]]:
    """(name_normalized, state_code) → (lat, lng).

    platform_cities is granted to anon, not service_role (see city-center.ts).
    """
    anon = SupabaseRest(url, anon_key)
    out: dict[tuple[str, str], tuple[float, float, int]] = {}
    offset = 0
    while True:
        batch = (
            anon._request(
                "GET",
                "/platform_cities",
                params={
                    "select": "name,name_normalized,state_code,latitude,longitude",
                    "is_active": "eq.true",
                    "limit": "1000",
                    "offset": str(offset),
                },
            )
            or []
        )
        if not batch:
            break
        for r in batch:
            key = (
                str(r.get("name_normalized") or "").strip().lower(),
                str(r.get("state_code") or "").strip().upper(),
            )
            try:
                lat = float(r["latitude"])
                lng = float(r["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            if not (key[0] and key[1]):
                continue
            # Prefer «Burbank city» over «Burbank CDP» (same name_normalized).
            name = str(r.get("name") or "").lower()
            rank = 0
            if name.endswith(" city") or " city" in name:
                rank = 3
            elif "town" in name or "village" in name:
                rank = 2
            elif "cdp" in name:
                rank = 0
            else:
                rank = 1
            prev = out.get(key)
            if prev is None or rank > prev[2]:
                out[key] = (lat, lng, rank)
        if len(batch) < 1000:
            break
        offset += 1000
    return {k: (v[0], v[1]) for k, v in out.items()}


def norm_city(value: Any) -> str:
    v = str(value or "").lower()
    v = re.sub(r"[^a-z0-9\s-]+", "", v)
    return re.sub(r"\s+", " ", v).strip()


def far_from_city(
    row: dict[str, Any],
    centers: dict[tuple[str, str], tuple[float, float]],
) -> float | None:
    city = norm_city(row.get("city"))
    state = str(row.get("state_code") or "").strip().upper()
    if not city or not state:
        return None
    center = centers.get((city, state))
    if not center:
        return None
    try:
        lat = float(row["latitude"])
        lng = float(row["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    return haversine_km(lat, lng, center[0], center[1])


def process(
    client: SupabaseRest,
    rows: list[dict[str, Any]],
    centers: dict[tuple[str, str], tuple[float, float]],
    *,
    table: str,
    address_col: str,
    name_col: str,
    apply: bool,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for i, row in enumerate(rows, 1):
        street = (row.get(address_col) or "").strip()
        if not street:
            continue
        dist = far_from_city(row, centers)
        spelling = normalize_street_spelling(street)
        spelling_changed = spelling != street
        # Always re-check McArthur-style typos; also anything >45km from city.
        suspect = spelling_changed or (dist is not None and dist > MAX_KM_FROM_CITY)
        if not suspect:
            continue

        geo = resolve_address_geo(
            spelling,
            row.get("city"),
            row.get("state_code"),
            row.get("postal_code"),
            with_maps_url=(table == "businesses"),
        )
        patch: dict[str, Any] = {}
        if spelling_changed:
            patch[address_col] = spelling[:160]
        if not geo.ok:
            # Do not wipe pins on a geocode miss — keep the old pin for a
            # human pass. Only rewrite when Nominatim returns a better hit.
            if not spelling_changed:
                continue
            # Spelling-only fix without a new pin.
            pass
        else:
            for k, v in geo.patch.items():
                if table == "professionals" and k == "google_maps_url":
                    continue
                patch[k] = v

        if not patch:
            continue

        # Skip no-op if coords unchanged and street unchanged.
        try:
            old_lat = float(row["latitude"])
            old_lng = float(row["longitude"])
        except (KeyError, TypeError, ValueError):
            old_lat = old_lng = None
        new_lat = patch.get("latitude", old_lat)
        new_lng = patch.get("longitude", old_lng)
        coords_same = (
            old_lat is not None
            and new_lat is not None
            and abs(float(new_lat) - old_lat) < 1e-5
            and abs(float(new_lng) - old_lng) < 1e-5
        )
        if coords_same and not spelling_changed:
            continue
        # When distance flagged a pin but the new geocode is still far from
        # the (possibly wrong) city field, only keep the rewrite if it moved
        # meaningfully (>500m) or fixed street spelling.
        if (
            geo.ok
            and not spelling_changed
            and old_lat is not None
            and new_lat is not None
        ):
            moved_km = haversine_km(
                old_lat, old_lng, float(new_lat), float(new_lng)
            )
            if moved_km < 0.5:
                continue

        item = {
            "table": table,
            "id": row["id"],
            "slug": row.get("slug"),
            "name": row.get(name_col),
            "city": row.get("city"),
            "postal_code": row.get("postal_code"),
            "km_from_city": round(dist, 1) if dist is not None else None,
            "before": {
                "street": street,
                "lat": row.get("latitude"),
                "lng": row.get("longitude"),
            },
            "geo_status": "ok" if geo.ok else geo.reason,
            "patch": patch,
        }
        if apply and patch:
            try:
                client.patch(table, {"id": f"eq.{row['id']}"}, patch)
            except Exception as exc:  # noqa: BLE001
                item["error"] = str(exc)[:240]
        print(
            f"[{table} {i}/{len(rows)}] {row.get('slug')} "
            f"city={row.get('city')} km={item['km_from_city']} "
            f"{item['geo_status']} → {patch.get('latitude')},{patch.get('longitude')}",
            flush=True,
        )
        results.append(item)
    return results


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--only",
        choices=("all", "businesses", "professionals"),
        default="all",
    )
    args = ap.parse_args()
    apply = bool(args.apply)

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    anon = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get(
        "SUPABASE_ANON_KEY"
    )
    if not anon:
        print("Missing anon key for platform_cities", file=sys.stderr)
        return 1
    print("Loading city centers…", flush=True)
    centers = load_city_centers(url, anon)
    print(f"city centers: {len(centers)}", flush=True)

    results: list[dict[str, Any]] = []
    if args.only in ("all", "professionals"):
        pros = fetch_all(
            client,
            "professionals",
            "id,slug,display_name,private_address_line,city,state_code,"
            "postal_code,latitude,longitude,location_precision",
        )
        print(f"professionals street pins: {len(pros)}", flush=True)
        results += process(
            client,
            pros,
            centers,
            table="professionals",
            address_col="private_address_line",
            name_col="display_name",
            apply=apply,
        )
    if args.only in ("all", "businesses"):
        biz = fetch_all(
            client,
            "businesses",
            "id,slug,name,address_line,city,state_code,"
            "postal_code,latitude,longitude,location_precision",
        )
        print(f"businesses street pins: {len(biz)}", flush=True)
        results += process(
            client,
            biz,
            centers,
            table="businesses",
            address_col="address_line",
            name_col="name",
            apply=apply,
        )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report = {
        "mode": "apply" if apply else "dry-run",
        "max_km": MAX_KM_FROM_CITY,
        "fixed": len(results),
        "errors": sum(1 for r in results if r.get("error")),
        "results": results,
    }
    path = OUT / f"{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report={path} fixed={report['fixed']} errors={report['errors']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
