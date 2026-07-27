#!/usr/bin/env python3
"""Enrich professionals from their Svoi.us company pages (fill-empty only).

Reads address / ZIP / city / website / phones / description / cover from the
linked svoi company URL — no invented data.

Usage:
  python3 scripts/business-enrich/enrich_professionals_from_svoi.py --dry-run
  python3 scripts/business-enrich/enrich_professionals_from_svoi.py --apply
  python3 scripts/business-enrich/enrich_professionals_from_svoi.py --apply --category pro_other
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from enrich_svoi_directory import (  # noqa: E402
    enrich_svoi_page,
    streetish,
)

OUT = Path(__file__).resolve().parent / "data" / "professional_svoi_enrich"
OUT.mkdir(parents=True, exist_ok=True)


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def normalize_region_from_state(state_code: str | None) -> str | None:
    if not state_code:
        return None
    sc = state_code.strip().upper()
    if sc == "US-CA" or sc.endswith("-CA"):
        return None  # leave existing region; city is enough
    return None


def build_patch(pro: dict[str, Any], svoi: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}

    addr = svoi.get("address_line")
    if empty(pro.get("private_address_line")) and streetish(addr):
        patch["private_address_line"] = str(addr).strip()[:160]
        patch["location_precision"] = "street"
        patch["public_exact_address"] = False

    if empty(pro.get("postal_code")) and svoi.get("postal_code"):
        z = re.sub(r"\D", "", str(svoi["postal_code"]))[:5]
        if len(z) == 5:
            patch["postal_code"] = z

    if empty(pro.get("city")) and svoi.get("city"):
        city = str(svoi["city"]).strip()
        # skip junk city that is actually a ZIP blob
        if city and not re.fullmatch(r"[A-Z]{2}\s*\d{5}", city) and len(city) <= 80:
            # "NY  91423" style → ignore as city
            if not re.match(r"^[A-Z]{2}\s+\d{5}", city):
                patch["city"] = city

    if empty(pro.get("state_code")) and svoi.get("state_code"):
        patch["state_code"] = str(svoi["state_code"]).strip()
    # Do NOT invent US-CA from ZIP alone — svoi pages span many states.

    # website: svoi returns list
    if empty(pro.get("website")):
        sites = svoi.get("websites") or []
        if sites:
            patch["website"] = str(sites[0]).strip()

    if empty(pro.get("email")):
        emails = svoi.get("emails") or []
        if emails:
            patch["email"] = str(emails[0]).strip().lower()

    if empty(pro.get("phone")):
        phones = svoi.get("phones") or []
        if phones:
            patch["phone"] = str(phones[0]).strip()

    # description only if thin
    desc = (pro.get("description") or "").strip()
    svoi_desc = (svoi.get("description") or "").strip()
    if svoi_desc and (len(desc) < 40 or desc.lower() in {"услуга / специалист", "service"}):
        patch["description"] = svoi_desc[:8000]
        if empty(pro.get("short_description")):
            patch["short_description"] = svoi_desc[:240]

    # cover only if missing / placeholder
    img = (pro.get("image_url") or "").strip()
    cover = (svoi.get("cover_image_url") or "").strip()
    if cover and (not img or "placeholder" in img or "/images/categories/" in img):
        patch["image_url"] = cover

    if patch.get("private_address_line") and empty(pro.get("location_precision")) and "location_precision" not in patch:
        patch["location_precision"] = "street"
    elif patch.get("city") and empty(pro.get("location_precision")) and "location_precision" not in patch:
        patch["location_precision"] = "city"

    return patch


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--category", default="", help="category slug, e.g. pro_other")
    parser.add_argument("--sleep", type=float, default=0.6)
    args = parser.parse_args()
    apply = bool(args.apply) and not args.dry_run

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    cat_id = None
    if args.category.strip():
        cats = client._request(
            "GET",
            "/categories",
            params={"select": "id,slug", "slug": f"eq.{args.category.strip()}"},
        ) or []
        if not cats:
            print(f"category not found: {args.category}", file=sys.stderr)
            return 1
        cat_id = cats[0]["id"]

    pros: list[dict[str, Any]] = []
    last = None
    while True:
        params: dict[str, str] = {
            "select": (
                "id,slug,display_name,source_url,phone,email,website,instagram_url,"
                "image_url,description,short_description,city,region,state_code,"
                "postal_code,private_address_line,location_precision,category_id,status"
            ),
            "status": "eq.approved",
            "source_url": "ilike.*svoi.us/company*",
            "order": "id.asc",
            "limit": "200",
        }
        if cat_id:
            params["category_id"] = f"eq.{cat_id}"
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

    updated = 0
    field_hits: Counter[str] = Counter()
    errors = 0
    samples: list[dict[str, Any]] = []

    for i, pro in enumerate(pros, 1):
        src = (pro.get("source_url") or "").strip()
        if "svoi.us/company" not in src:
            continue
        print(f"[{i}/{len(pros)}] {pro.get('slug')} ← {src}", flush=True)
        svoi = enrich_svoi_page({"source_post_urls": [src], "phones": [], "websites": []})
        if svoi.get("_svoi_error"):
            errors += 1
            print(f"  error: {svoi['_svoi_error']}", flush=True)
            continue
        patch = build_patch(pro, svoi)
        if not patch:
            print("  no gaps to fill", flush=True)
            time.sleep(args.sleep)
            continue

        updated += 1
        for k in patch:
            field_hits[k] += 1
        if len(samples) < 30:
            samples.append(
                {
                    "slug": pro.get("slug"),
                    "name": pro.get("display_name"),
                    "source_url": src,
                    "svoi": {
                        "address_line": svoi.get("address_line"),
                        "city": svoi.get("city"),
                        "postal_code": svoi.get("postal_code"),
                        "websites": (svoi.get("websites") or [])[:2],
                    },
                    "patch": patch,
                }
            )
        print(
            f"  patch {sorted(patch.keys())} addr={svoi.get('address_line') or '-'}",
            flush=True,
        )
        if apply:
            client._request(
                "PATCH",
                f"/professionals?id=eq.{pro['id']}",
                body=patch,
            )
        time.sleep(args.sleep)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if apply else "dry-run",
        "category": args.category or None,
        "scanned": len(pros),
        "updated": updated,
        "errors": errors,
        "field_hits": dict(field_hits),
        "samples": samples,
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({**report, "report": str(path), "samples": samples[:8]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
