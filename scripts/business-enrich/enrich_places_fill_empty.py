#!/usr/bin/env python3
"""Fill-empty Google Places enrichment for approved businesses.

Requires GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY (Maps Places key).
GOOGLE_API_KEY in this repo is Gemini — it will NOT work here.

Usage:
  python3 scripts/business-enrich/enrich_places_fill_empty.py --dry-run --limit 20
  python3 scripts/business-enrich/enrich_places_fill_empty.py --apply
  python3 scripts/business-enrich/enrich_places_fill_empty.py --apply --slug batch2-5-star-appliance-repair
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from google_places import (  # noqa: E402
    lookup_business_places,
    maps_api_key,
    place_to_fill_empty_patch,
)

OUT = ROOT / "scripts" / "business-enrich" / "data" / "enrich_places_report.json"


def gap_score(b: dict[str, Any]) -> int:
    g = 0
    if not b.get("address_line"):
        g += 3
    if b.get("latitude") is None:
        g += 2
    if not b.get("google_maps_url"):
        g += 2
    if not b.get("google_rating"):
        g += 2
    if not b.get("website"):
        g += 1
    if not b.get("phone"):
        g += 1
    city = (b.get("city") or "").lower()
    if city in {"orange county", "oc", "los angeles"}:
        g += 1
    return g


def is_matchable(b: dict[str, Any]) -> bool:
    """Skip IG-only / telegram-handle cards that Places cannot resolve safely."""
    if b.get("phone") or b.get("address_line"):
        return True
    website = (b.get("website") or "").lower()
    if website and not any(
        x in website
        for x in (
            "instagram.com",
            "facebook.com",
            "t.me/",
            "wa.me",
            "linktr.ee",
            "etsy.com",
            "turo.com",
        )
    ):
        return True
    name = (b.get("name") or "").strip()
    if " " in name and len(name) >= 8 and not name.startswith("@"):
        # Avoid pure first-name cards like "Александра" / "Alena"
        parts = [p for p in name.replace("—", " ").replace("-", " ").split() if p]
        if len(parts) >= 2 and sum(len(p) for p in parts) >= 10:
            return True
    return False


def fetch_targets(
    client: SupabaseRest, *, limit: int | None, slug: str | None
) -> list[dict[str, Any]]:
    select = (
        "id,name,slug,website,instagram_url,phone,email,city,region,state_code,"
        "address_line,description,short_description,google_maps_url,google_rating,"
        "google_reviews_count,yelp_url,latitude,longitude,opening_hours,status"
    )
    if slug:
        return (
            client._request(
                "GET",
                "/businesses",
                params={"select": select, "slug": f"eq.{slug}", "limit": "1"},
            )
            or []
        )

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/businesses",
                params={
                    "select": select,
                    "status": "eq.approved",
                    "order": "updated_at.asc",
                    "offset": str(offset),
                    "limit": "100",
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < 100:
            break

    # Prefer businesses with real gaps that Places can actually match
    rows = [b for b in rows if gap_score(b) > 0 and is_matchable(b)]
    rows.sort(key=lambda b: (-int(is_matchable(b)), -gap_score(b)))
    if limit is not None:
        rows = rows[:limit]
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--slug", type=str, default=None)
    parser.add_argument("--sleep", type=float, default=0.3)
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    key = maps_api_key()
    if not key:
        print(
            json.dumps(
                {
                    "error": "missing_maps_api_key",
                    "hint": (
                        "Set GOOGLE_MAPS_API_KEY (or GOOGLE_PLACES_API_KEY) in .env.local. "
                        "Enable Places API (New) on that Google Cloud project. "
                        "Do not reuse GOOGLE_API_KEY — that is Gemini in this project."
                    ),
                    "gemini_key_present": bool(os.environ.get("GOOGLE_API_KEY")),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 3

    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    targets = fetch_targets(client, limit=args.limit, slug=args.slug)
    print(
        json.dumps(
            {
                "mode": "apply" if args.apply else "dry-run",
                "targets": len(targets),
                "key_source": (
                    "GOOGLE_MAPS_API_KEY"
                    if os.environ.get("GOOGLE_MAPS_API_KEY")
                    else "GOOGLE_PLACES_API_KEY"
                ),
            },
            ensure_ascii=False,
        )
    )

    reports: list[dict[str, Any]] = []
    doubtful: list[dict[str, Any]] = []
    applied = 0
    for i, biz in enumerate(targets, 1):
        print(f"[{i}/{len(targets)}] {biz.get('name')}", flush=True)
        try:
            looked = lookup_business_places(biz, key=key, sleep_s=args.sleep)
        except Exception as exc:  # noqa: BLE001
            looked = {"decision": "error", "error": str(exc)[:300]}

        decision = looked.get("decision")
        err_text = str(looked.get("error") or "")
        if decision == "error" and (
            "429" in err_text or "Quota exceeded" in err_text or "RESOURCE_EXHAUSTED" in err_text
        ):
            print(
                json.dumps(
                    {
                        "stopped": "places_quota_exceeded",
                        "at": i,
                        "of": len(targets),
                        "hint": "Raise Places API (New) SearchText daily quota or retry tomorrow.",
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            reports.append(
                {
                    "id": biz["id"],
                    "slug": biz.get("slug"),
                    "name": biz.get("name"),
                    "decision": "error",
                    "error": err_text[:300],
                    "patch": {},
                    "sources": {},
                }
            )
            break
        rep: dict[str, Any] = {
            "id": biz["id"],
            "slug": biz.get("slug"),
            "name": biz.get("name"),
            "decision": decision,
            "score": looked.get("score"),
            "reasons": looked.get("reasons"),
            "query": looked.get("query"),
            "error": looked.get("error"),
            "patch": {},
            "sources": {},
        }

        if decision == "accept":
            allow_address = True
            filled = place_to_fill_empty_patch(
                biz, looked["place"], allow_address=allow_address
            )
            rep["patch"] = filled["patch"]
            rep["sources"] = filled["sources"]
            rep["place_name"] = (looked.get("place") or {}).get("name")
            rep["place_address"] = (looked.get("place") or {}).get("formatted_address")
        elif decision == "doubtful_multi_location":
            # Still fill rating/maps if empty, but NOT street address.
            place = looked.get("place") or {}
            filled = place_to_fill_empty_patch(biz, place, allow_address=False)
            # Drop geo if we refused street (hub coords may already exist)
            for k in ("latitude", "longitude", "location_precision", "address_line"):
                filled["patch"].pop(k, None)
                filled["sources"].pop(k, None)
                filled["sources"].pop("geo", None)
            rep["patch"] = filled["patch"]
            rep["sources"] = filled["sources"]
            rep["addresses"] = looked.get("addresses")
            doubtful.append(
                {
                    "slug": biz.get("slug"),
                    "name": biz.get("name"),
                    "reason": "multi_location",
                    "addresses": looked.get("addresses"),
                    "score": looked.get("score"),
                }
            )
        elif decision in {"reject_low_score", "zero_results", "error"}:
            doubtful.append(
                {
                    "slug": biz.get("slug"),
                    "name": biz.get("name"),
                    "reason": decision,
                    "score": looked.get("score"),
                    "error": looked.get("error"),
                    "top_name": looked.get("top_name"),
                }
            )

        if args.apply and rep.get("patch"):
            try:
                client._request(
                    "PATCH",
                    "/businesses",
                    params={"id": f"eq.{biz['id']}"},
                    body=rep["patch"],
                    prefer="return=minimal",
                )
                rep["applied"] = True
                applied += 1
            except Exception as exc:  # noqa: BLE001
                rep["applied"] = False
                rep["apply_error"] = str(exc)[:300]

        reports.append(rep)
        time.sleep(0.05)

    summary = {
        "mode": "apply" if args.apply else "dry-run",
        "targets": len(targets),
        "accepted": sum(1 for r in reports if r.get("decision") == "accept"),
        "doubtful_multi": sum(
            1 for r in reports if r.get("decision") == "doubtful_multi_location"
        ),
        "with_patch": sum(1 for r in reports if r.get("patch")),
        "applied": applied,
        "doubtful": doubtful[:80],
        "reports": reports,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {k: summary[k] for k in (
                "mode", "targets", "accepted", "doubtful_multi", "with_patch", "applied"
            )},
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"Wrote {OUT}")
    if doubtful:
        print("Doubtful sample:")
        for d in doubtful[:15]:
            print("-", d.get("slug"), d.get("reason"), d.get("score"), d.get("addresses") or d.get("top_name") or "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
