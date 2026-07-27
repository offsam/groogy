#!/usr/bin/env python3
"""Restore archived businesses that indicate a real place of service.

Rule: place (street / suite / named venue) → business.
Person without place → professional.

Finds archived businesses with a place-like address (or coords + street),
sets status=approved, geocodes if needed, and archives linked professionals.

Usage:
  python3 scripts/business-enrich/restore_place_businesses.py --dry-run
  python3 scripts/business-enrich/restore_place_businesses.py --apply
  python3 scripts/business-enrich/restore_place_businesses.py --apply --geocode
"""

from __future__ import annotations

import argparse
import json
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

OUT = Path(__file__).resolve().parent / "data" / "restore_place_businesses"
OUT.mkdir(parents=True, exist_ok=True)

BATCH_ID = "restore_place_businesses_v1"
UA = "KrugiRestorePlace/1.0 (catalog; contact@krugi.app)"

# Street number + road, suite/unit, or named venue (not city-only).
PLACE_RE = re.compile(
    r"(?:"
    r"\d{1,6}\s+.+"  # 17621 Irvine Blvd
    r"|(?:suite|ste\.?|unit|#)\s*\d"  # suite 103
    r"|(?:recreation\s+center|sports\s+park|irvine\s+spectrum|"
    r"los\s+olivos|fashion\s+lane|newport\s+center)"
    r")",
    re.I,
)

# Pure city / area labels — keep as professional (or leave archived).
CITY_ONLY_RE = re.compile(
    r"^(?:"
    r"california|ca\b|los\s+angeles|la\b|orange\s+county|oc\b|"
    r"irvine|newport(?:\s+beach)?|laguna\s+hills|sherman\s+oaks|"
    r"encino|woodland\s+hills|studio\s+city|north\s+hollywood|"
    r"glendale|pasadena|san\s+diego|sacramento|bay\s+area|sf\b"
    r")(?:\s*,\s*(?:ca|california|orange\s+county|oc))?$",
    re.I,
)

# Shared columns that can be copied pro → business when business is empty.
CONTACT_FIELDS = (
    "phone",
    "email",
    "website",
    "instagram_url",
    "short_description",
    "description",
    "image_url",
    "opening_hours",
)


def is_place_address(address: str | None) -> bool:
    a = (address or "").strip()
    if len(a) < 5:
        return False
    if CITY_ONLY_RE.match(a):
        return False
    # City + county without street still not a place
    if re.match(
        r"^[A-Za-zА-Яа-яёЁ .'-]+,\s*(Orange County|CA|California)\s*$",
        a,
        re.I,
    ) and not PLACE_RE.search(a):
        return False
    return bool(PLACE_RE.search(a))


def geocode(query: str) -> tuple[float, float, str] | None:
    q = urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 1, "countrycodes": "us"}
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
        return lat, lon, "street"
    except Exception:  # noqa: BLE001
        return None


def fetch_all(
    client: SupabaseRest, table: str, params: dict[str, str], page: int = 1000
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        p = {**params, "limit": str(page), "offset": str(offset)}
        rows = client._request("GET", f"/{table}", params=p) or []
        if not rows:
            break
        out.extend(rows)
        if len(rows) < page:
            break
        offset += page
    return out


def merge_contacts(
    biz: dict[str, Any], pros: list[dict[str, Any]]
) -> dict[str, Any]:
    """Fill empty business contact fields from linked professionals."""
    patch: dict[str, Any] = {}
    for field in CONTACT_FIELDS:
        if biz.get(field):
            continue
        for pro in pros:
            val = pro.get(field)
            if field == "image_url" and val and "placeholder" in str(val):
                continue
            if val:
                patch[field] = val
                break
    # Prefer professional private address if business address empty
    if not biz.get("address_line"):
        for pro in pros:
            addr = (pro.get("private_address_line") or "").strip()
            if addr and is_place_address(addr):
                patch["address_line"] = addr
                break
    return patch


def build_plan(client: SupabaseRest) -> list[dict[str, Any]]:
    archived = fetch_all(
        client,
        "businesses",
        {
            "select": (
                "id,slug,name,status,address_line,city,region,"
                "latitude,longitude,location_precision,"
                "phone,email,website,instagram_url,"
                "short_description,description,image_url,opening_hours,"
                "category_id"
            ),
            "status": "eq.archived",
            "order": "updated_at.desc",
        },
    )
    plans: list[dict[str, Any]] = []
    for biz in archived:
        addr = biz.get("address_line")
        if not is_place_address(addr):
            continue
        pros = (
            client._request(
                "GET",
                "/professionals",
                params={
                    "select": (
                        "id,slug,display_name,status,private_address_line,"
                        "phone,email,website,instagram_url,"
                        "short_description,description,image_url,"
                        "opening_hours,category_id"
                    ),
                    "source_record_id": f"eq.{biz['id']}",
                    "status": "eq.approved",
                },
            )
            or []
        )
        contact_patch = merge_contacts(biz, pros)
        needs_geo = biz.get("latitude") is None or biz.get("longitude") is None
        plans.append(
            {
                "business_id": biz["id"],
                "business_slug": biz["slug"],
                "name": biz.get("name"),
                "address_line": addr,
                "has_coords": not needs_geo,
                "needs_geocode": needs_geo,
                "contact_patch_keys": sorted(contact_patch.keys()),
                "contact_patch": contact_patch,
                "professionals": [
                    {"id": p["id"], "slug": p.get("slug"), "name": p.get("display_name")}
                    for p in pros
                ],
            }
        )
    return plans


def apply_plan(
    client: SupabaseRest,
    plan: dict[str, Any],
    *,
    do_geocode: bool,
) -> dict[str, Any]:
    result = {
        "business_id": plan["business_id"],
        "business_slug": plan["business_slug"],
        "archived_pros": [],
        "status": "ok",
    }
    patch: dict[str, Any] = {
        "status": "approved",
        **plan.get("contact_patch", {}),
    }
    addr = plan.get("address_line") or ""
    if plan.get("needs_geocode") and do_geocode and addr:
        geo_q = f"{addr}, California, USA"
        geo = geocode(geo_q)
        time.sleep(1.1)  # Nominatim courtesy
        if geo:
            lat, lon, precision = geo
            patch["latitude"] = lat
            patch["longitude"] = lon
            patch["location_precision"] = precision
            result["geocoded"] = {"lat": lat, "lon": lon}
        else:
            result["geocode"] = "miss"

    try:
        client.patch("businesses", {"id": f"eq.{plan['business_id']}"}, patch)
    except Exception as exc:  # noqa: BLE001
        result["status"] = "error"
        result["error"] = str(exc)[:300]
        return result

    for pro in plan.get("professionals") or []:
        try:
            client.patch(
                "professionals",
                {"id": f"eq.{pro['id']}"},
                {
                    "status": "archived",
                    "import_batch_id": BATCH_ID,
                },
            )
            result["archived_pros"].append(pro["id"])
        except Exception as exc:  # noqa: BLE001
            result["status"] = "partial"
            result.setdefault("pro_errors", []).append(
                {"id": pro["id"], "error": str(exc)[:200]}
            )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--geocode",
        action="store_true",
        help="Nominatim fill lat/lng when missing",
    )
    args = parser.parse_args()
    apply = bool(args.apply)
    if apply:
        args.dry_run = False

    load_env()
    import os

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)
    plans = build_plan(client)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report: dict[str, Any] = {
        "mode": "apply" if apply else "dry-run",
        "batch_id": BATCH_ID,
        "geocode": bool(args.geocode),
        "count": len(plans),
        "plans": [
            {
                k: v
                for k, v in p.items()
                if k != "contact_patch" or apply
            }
            for p in plans
        ],
    }

    apply_results: list[dict[str, Any]] = []
    if apply:
        for i, plan in enumerate(plans, 1):
            print(
                f"[{i}/{len(plans)}] restore {plan['business_slug']} "
                f"({plan['address_line']}) "
                f"pros={len(plan['professionals'])}"
            )
            apply_results.append(
                apply_plan(client, plan, do_geocode=bool(args.geocode))
            )
        report["apply_results"] = apply_results
    else:
        for p in plans:
            print(
                f"dry-run {p['business_slug']} | {p['address_line']} | "
                f"coords={'yes' if p['has_coords'] else 'NEED'} | "
                f"pros={len(p['professionals'])}"
            )

    path = OUT / f"{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / ("apply_latest.json" if apply else "dry_run_latest.json")).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"count={len(plans)} report={path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
