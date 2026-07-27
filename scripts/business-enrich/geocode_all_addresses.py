#!/usr/bin/env python3
"""Geocode every approved business/professional that has an address but no lat/lng.

Usage:
  python3 scripts/business-enrich/geocode_all_addresses.py --dry-run
  python3 scripts/business-enrich/geocode_all_addresses.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
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

OUT = Path(__file__).resolve().parent / "data" / "geocode_all_addresses"
OUT.mkdir(parents=True, exist_ok=True)
UA = "KrugiGeocodeAll/1.0 (catalog; contact@krugi.app)"


def geocode(query: str) -> tuple[float, float, str] | None:
    q = urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": "1", "countrycodes": "us"}
    )
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{q}",
        headers={"User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if not data:
            return None
        lat = float(data[0]["lat"])
        lon = float(data[0]["lon"])
        precision = "street" if any(ch.isdigit() for ch in query) else "city"
        return lat, lon, precision
    except Exception:  # noqa: BLE001
        return None


def build_query(address: str, city: str | None, region: str | None) -> str:
    parts = [address.strip()]
    blob = address.lower()
    if city and city.lower() not in blob:
        parts.append(city.strip())
    if region and region.lower() not in blob and "california" not in blob:
        parts.append(region.strip())
    if "ca" not in blob and "california" not in blob:
        parts.append("California, USA")
    else:
        parts.append("USA")
    return ", ".join(parts)


def fetch_need_businesses(client: SupabaseRest) -> list[dict[str, Any]]:
    rows = (
        client._request(
            "GET",
            "/businesses",
            params={
                "select": "id,slug,name,address_line,city,region,latitude,longitude",
                "status": "eq.approved",
                "address_line": "not.is.null",
                "or": "(latitude.is.null,longitude.is.null)",
                "limit": "2000",
            },
        )
        or []
    )
    return [r for r in rows if (r.get("address_line") or "").strip()]


def fetch_need_professionals(client: SupabaseRest) -> list[dict[str, Any]]:
    rows = (
        client._request(
            "GET",
            "/professionals",
            params={
                "select": (
                    "id,slug,display_name,private_address_line,city,region,"
                    "latitude,longitude"
                ),
                "status": "eq.approved",
                "private_address_line": "not.is.null",
                "or": "(latitude.is.null,longitude.is.null)",
                "limit": "2000",
            },
        )
        or []
    )
    return [r for r in rows if (r.get("private_address_line") or "").strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    apply = bool(args.apply)

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    businesses = fetch_need_businesses(client)
    professionals = fetch_need_professionals(client)
    results: list[dict[str, Any]] = []

    print(f"businesses to geocode: {len(businesses)}")
    print(f"professionals to geocode: {len(professionals)}")

    for i, row in enumerate(businesses, 1):
        addr = (row.get("address_line") or "").strip()
        query = build_query(addr, row.get("city"), row.get("region"))
        item: dict[str, Any] = {
            "entity": "business",
            "id": row["id"],
            "slug": row.get("slug"),
            "name": row.get("name"),
            "address": addr,
            "query": query,
        }
        geo = geocode(query)
        time.sleep(1.1)
        if not geo:
            item["status"] = "miss"
            print(f"[biz {i}/{len(businesses)}] miss {row.get('name')}")
        else:
            lat, lon, precision = geo
            item["status"] = "ok"
            item["lat"] = lat
            item["lon"] = lon
            item["precision"] = precision
            if apply:
                client.patch(
                    "businesses",
                    {"id": f"eq.{row['id']}"},
                    {
                        "latitude": lat,
                        "longitude": lon,
                        "location_precision": precision,
                    },
                )
            print(f"[biz {i}/{len(businesses)}] {item['status']} {row.get('name')} → {lat},{lon}")
        results.append(item)

    for i, row in enumerate(professionals, 1):
        addr = (row.get("private_address_line") or "").strip()
        query = build_query(addr, row.get("city"), row.get("region"))
        item = {
            "entity": "professional",
            "id": row["id"],
            "slug": row.get("slug"),
            "name": row.get("display_name"),
            "address": addr,
            "query": query,
        }
        geo = geocode(query)
        time.sleep(1.1)
        if not geo:
            item["status"] = "miss"
            print(f"[pro {i}/{len(professionals)}] miss {row.get('display_name')}")
        else:
            lat, lon, precision = geo
            item["status"] = "ok"
            item["lat"] = lat
            item["lon"] = lon
            item["precision"] = precision
            if apply:
                client.patch(
                    "professionals",
                    {"id": f"eq.{row['id']}"},
                    {
                        "latitude": lat,
                        "longitude": lon,
                        "location_precision": precision if precision in {"street", "city"} else "city",
                    },
                )
            print(
                f"[pro {i}/{len(professionals)}] {item['status']} "
                f"{row.get('display_name')} → {lat},{lon}"
            )
        results.append(item)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report = {
        "mode": "apply" if apply else "dry-run",
        "businesses": len(businesses),
        "professionals": len(professionals),
        "ok": sum(1 for r in results if r.get("status") == "ok"),
        "miss": sum(1 for r in results if r.get("status") == "miss"),
        "results": results,
    }
    path = OUT / f"{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report={path} ok={report['ok']} miss={report['miss']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
