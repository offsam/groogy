#!/usr/bin/env python3
"""Backfill businesses.postal_code (+ city cleanup) for listing cards.

Sources: address/short/description text, same-street siblings, Nominatim reverse.

Usage:
  python3 scripts/business-enrich/backfill_city_zip.py --dry-run
  python3 scripts/business-enrich/backfill_city_zip.py --apply
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
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "dupe_audit"
OUT.mkdir(parents=True, exist_ok=True)

ZIP_STATE = re.compile(
    r"\b(?:CA|California|FL|NY|TX|AZ|OR|WA|NV)\s+(\d{5})(?:-\d{4})?\b",
    re.I,
)
CITY_STATE_ZIP = re.compile(
    r"\b([A-Za-z][A-Za-z .'-]{1,40}),\s*(?:CA|California|FL|NY|TX|AZ|OR|WA|NV)\s+(\d{5})\b",
    re.I,
)
ANY_ZIP = re.compile(r"(?<!\d)(\d{5})(?:-\d{4})?(?!\d)")
COUNTY_CITY = re.compile(
    r"^(orange county|los angeles|southern california|oc|orange county\s*/\s*la)\s*$",
    re.I,
)


def extract_zip(blob: str, address_line: str | None = None) -> str | None:
    """Only state-qualified ZIPs — never bare house numbers."""
    if not blob:
        return None
    m = ZIP_STATE.search(blob)
    if m:
        z = m.group(1)
        if address_line and re.match(rf"^{z}\b", address_line.strip()):
            return None
        return z
    m = CITY_STATE_ZIP.search(blob)
    if m:
        return m.group(2)
    return None


def extract_city_from_text(blob: str) -> str | None:
    m = CITY_STATE_ZIP.search(blob)
    if m:
        return m.group(1).strip()
    return None


def street_key(addr: str | None) -> str | None:
    if not addr:
        return None
    s = addr.lower()
    s = re.sub(r"#\s*\w+|ste\.?\s*\w+|suite\s*\w+|unit\s*\w+", "", s)
    s = re.sub(
        r"\b(street|st|drive|dr|avenue|ave|road|rd|blvd|boulevard|lane|ln|way|court|ct)\b",
        "",
        s,
    )
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s if len(s) >= 6 else None


def nominatim_zip(lat: float, lng: float) -> tuple[str | None, str | None]:
    qs = urllib.parse.urlencode(
        {
            "format": "jsonv2",
            "lat": f"{lat:.6f}",
            "lon": f"{lng:.6f}",
            "addressdetails": 1,
        }
    )
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/reverse?{qs}",
        headers={
            "User-Agent": "KrugiBusinessDirectory/1.0 (zip backfill; local)",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None, None
    addr = data.get("address") or {}
    postcode = str(addr.get("postcode") or "").strip()
    zip5 = re.match(r"^(\d{5})", postcode)
    city = (
        addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or addr.get("hamlet")
        or addr.get("suburb")
    )
    return (zip5.group(1) if zip5 else None), (str(city).strip() if city else None)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--geocode", action="store_true", help="Nominatim for remaining gaps")
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
                "select": "id,slug,name,city,postal_code,address_line,region,short_description,description,latitude,longitude,status",
                "status": "eq.approved",
                "limit": "2000",
            },
        )
        or []
    )

    by_street: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        sk = street_key(r.get("address_line"))
        if sk:
            by_street[sk].append(r)

    report: dict[str, Any] = {"mode": "apply" if apply else "dry_run", "updates": []}

    for r in rows:
        patch: dict[str, Any] = {}
        city = (r.get("city") or "").strip() or None
        postal = (r.get("postal_code") or "").strip() or None
        if postal:
            postal = re.sub(r"\D", "", postal)[:5] or None

        blob = "\n".join(
            filter(
                None,
                [
                    r.get("address_line"),
                    r.get("short_description"),
                    r.get("description"),
                    r.get("city"),
                    r.get("region"),
                ],
            )
        )

        if not postal:
            postal = extract_zip(blob, r.get("address_line"))

        if not postal:
            sk = street_key(r.get("address_line"))
            if sk:
                for sib in by_street.get(sk, []):
                    z = (sib.get("postal_code") or "").strip()
                    z = re.sub(r"\D", "", z)[:5] if z else ""
                    if re.fullmatch(r"\d{5}", z):
                        postal = z
                        break

        if (not city or COUNTY_CITY.match(city)) and blob:
            c2 = extract_city_from_text(blob)
            if c2:
                city = c2
            else:
                # tail city on street: "..., Laguna Hills"
                addr = r.get("address_line") or ""
                m = re.search(r",\s*([A-Za-z][A-Za-z .'-]{1,40})\s*$", addr)
                if m and not re.search(r"\b(ste|suite|apt|unit|#)\b", m.group(1), re.I):
                    city = m.group(1).strip()

        # Reverse geocode only when still missing ZIP and coords exist
        if (
            args.geocode
            and not postal
            and isinstance(r.get("latitude"), (int, float))
            and isinstance(r.get("longitude"), (int, float))
        ):
            z, c = nominatim_zip(float(r["latitude"]), float(r["longitude"]))
            time.sleep(1.05)
            if z:
                postal = z
            if c and (not city or COUNTY_CITY.match(city)):
                city = c

        if postal and postal != (r.get("postal_code") or "").strip():
            patch["postal_code"] = postal
        if city and city != (r.get("city") or "").strip():
            patch["city"] = city

        if not patch:
            continue

        item = {
            "slug": r["slug"],
            "before": {"city": r.get("city"), "postal_code": r.get("postal_code")},
            "patch": patch,
        }
        report["updates"].append(item)
        print(f"{r['slug'][:42]:42} {item['before']} → {patch}")
        if apply:
            sb.patch("businesses", {"id": f"eq.{r['id']}"}, patch)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if apply else "dry_run"
    path = OUT / f"city_zip_backfill_{mode}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"updated={len(report['updates'])} → {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
