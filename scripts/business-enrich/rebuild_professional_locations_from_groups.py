#!/usr/bin/env python3
"""Rebuild professional city/region the correct way:

  1) Location written in the post (import city / text)
  2) Else fallback from source group / source key (Telegram/FB group)

Never invents streets. County labels never stay in `city`.

Usage:
  python3 scripts/business-enrich/rebuild_professional_locations_from_groups.py --dry-run
  python3 scripts/business-enrich/rebuild_professional_locations_from_groups.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402
from group_location import (  # noqa: E402
    location_from_group,
    merge_city_with_group,
)

OUT = Path(__file__).resolve().parent / "data" / "professional_locations"
OUT.mkdir(parents=True, exist_ok=True)

KNOWN_CITIES = {
    "irvine": "Irvine",
    "tustin": "Tustin",
    "anaheim": "Anaheim",
    "santa ana": "Santa Ana",
    "costa mesa": "Costa Mesa",
    "newport beach": "Newport Beach",
    "huntington beach": "Huntington Beach",
    "mission viejo": "Mission Viejo",
    "lake forest": "Lake Forest",
    "aliso viejo": "Aliso Viejo",
    "laguna hills": "Laguna Hills",
    "laguna niguel": "Laguna Niguel",
    "laguna beach": "Laguna Beach",
    "fullerton": "Fullerton",
    "garden grove": "Garden Grove",
    "yorba linda": "Yorba Linda",
    "brea": "Brea",
    "buena park": "Buena Park",
    "cypress": "Cypress",
    "fountain valley": "Fountain Valley",
    "westminster": "Westminster",
    "placentia": "Placentia",
    "seal beach": "Seal Beach",
    "los alamitos": "Los Alamitos",
    "dana point": "Dana Point",
    "san clemente": "San Clemente",
    "san juan capistrano": "San Juan Capistrano",
    "orange": "Orange",
    "los angeles": "Los Angeles",
    "лос-анджелес": "Los Angeles",
    "hollywood": "Hollywood",
    "glendale": "Glendale",
    "burbank": "Burbank",
    "pasadena": "Pasadena",
    "long beach": "Long Beach",
    "santa monica": "Santa Monica",
    "sherman oaks": "Sherman Oaks",
    "encino": "Encino",
    "van nuys": "Van Nuys",
    "north hollywood": "North Hollywood",
    "west hollywood": "West Hollywood",
    "beverly hills": "Beverly Hills",
    "culver city": "Culver City",
    "torrance": "Torrance",
    "sacramento": "Sacramento",
    "сакраменто": "Sacramento",
    "antelope": "Antelope",
    "roseville": "Roseville",
    "folsom": "Folsom",
    "elk grove": "Elk Grove",
    "san francisco": "San Francisco",
    "сан-франциско": "San Francisco",
    "oakland": "Oakland",
    "berkeley": "Berkeley",
    "walnut creek": "Walnut Creek",
    "concord": "Concord",
    "palo alto": "Palo Alto",
    "sunnyvale": "Sunnyvale",
    "san jose": "San Jose",
    "san mateo": "San Mateo",
    "redwood city": "Redwood City",
    "fremont": "Fremont",
    "san diego": "San Diego",
    "la jolla": "La Jolla",
    "carlsbad": "Carlsbad",
}

CITY_ALIASES = {
    "сакраменто": "Sacramento",
    "сан-франциско": "San Francisco",
    "сан франциско": "San Francisco",
    "лос-анджелес": "Los Angeles",
    "лос анджелес": "Los Angeles",
    "сан-диего": "San Diego",
    "сан диего": "San Diego",
}


def normalize_city(city: str | None) -> str | None:
    if not city:
        return None
    key = re.sub(r"\s+", " ", city.strip().lower().replace("ё", "е"))
    if key in CITY_ALIASES:
        return CITY_ALIASES[key]
    if key in KNOWN_CITIES:
        return KNOWN_CITIES[key]
    return city.strip()


REGION_ALIASES = {
    "sacramento": "Sacramento County",
    "los angeles": "Los Angeles County",
    "san francisco": "San Francisco County",
    "san francisco bay area": "San Francisco County",
    "bay area": "San Francisco County",
    "san diego": "San Diego County",
    "ca": None,  # drop bare state-as-region
    "california": None,
    "southern california": "Southern California",
    "socal": "Southern California",
}


def normalize_region(region: str | None) -> str | None:
    if not region:
        return None
    key = re.sub(r"\s+", " ", region.strip().lower())
    if key in REGION_ALIASES:
        return REGION_ALIASES[key]
    return region.strip()


CITY_STATE_ZIP_RE = re.compile(
    r"\b([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .'-]{1,40}),\s*(?:CA|California)\s+\d{5}\b",
    re.I,
)
COUNTY_AS_CITY_RE = re.compile(
    r"^(orange\s+county(?:\s*/\s*la)?|oc|southern\s+california|so\s*cal|bay\s+area|"
    r"los\s+angeles\s+county|sacramento\s+county|san\s+diego\s+county|"
    r"san\s+francisco\s+county)$",
    re.I,
)


def extract_city_from_post(text: str) -> str | None:
    if not text.strip():
        return None
    m = CITY_STATE_ZIP_RE.search(text)
    if m:
        cand = re.sub(r"\s+", " ", m.group(1)).strip(" ,.-")
        if cand and not COUNTY_AS_CITY_RE.match(cand):
            return cand
    low = text.lower()
    low = re.sub(
        r"\borange\s+county\b|\bsouthern\s+california\b|\bbay\s+area\b",
        " ",
        low,
    )
    for key in sorted(KNOWN_CITIES.keys(), key=len, reverse=True):
        if key == "orange" and re.search(r"\borange\s+county\b", text, re.I):
            continue
        if re.search(rf"\b{re.escape(key)}\b", low):
            return KNOWN_CITIES[key]
    return None


def extract_zip(text: str) -> str | None:
    m = re.search(
        r"\b(?:CA|California)\s+(\d{5})(?:-\d{4})?\b",
        text,
        re.I,
    )
    if m:
        return m.group(1)
    m2 = re.search(r",\s*(\d{5})(?:-\d{4})?\b(?!\s*[A-Za-z])", text)
    return m2.group(1) if m2 else None


def state_code_from_region(region: str | None, state: str | None) -> str | None:
    blob = f"{region or ''} {state or ''}".upper()
    if "CA" in blob or "CALIFORNIA" in blob or "COUNTY" in blob:
        return "US-CA"
    if state and re.fullmatch(r"US-[A-Z]{2}", state.strip().upper()):
        return state.strip().upper()
    return "US-CA" if (region or state) else None


def precision_for(city: str | None, region: str | None, has_street: bool) -> str | None:
    if has_street:
        return "street"
    if city:
        return "city"
    if region:
        return "county"
    return None


def resolve_for_pro(
    pro: dict[str, Any],
    item: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return city/region/state_code/location_precision/postal_code patch values."""
    post_text = ""
    source_group = None
    source_key = None
    item_city = None
    item_state = None

    if item:
        post_text = "\n".join(
            str(x)
            for x in (
                item.get("source_text"),
                item.get("description"),
                item.get("title"),
                item.get("person_name"),
            )
            if x
        )
        source_group = item.get("source_group")
        source_key = item.get("source")
        item_city = (item.get("city") or "").strip() or None
        item_state = (item.get("state") or "").strip() or None
        if item_city and COUNTY_AS_CITY_RE.match(item_city):
            # county dumped into import city
            if not item_state or COUNTY_AS_CITY_RE.match(item_state):
                item_state = item_city
            item_city = None

    # Also scan professional description (may be richer after enrich)
    pro_text = "\n".join(
        str(x)
        for x in (
            pro.get("headline"),
            pro.get("short_description"),
            pro.get("description"),
        )
        if x
    )
    blob = f"{post_text}\n{pro_text}".strip()

    # Linked to import: rebuild from post → group (authoritative).
    # Unlinked: keep existing real city; only demote county labels + fill ZIP.
    if item:
        city_from_post = item_city or extract_city_from_post(blob)
        merged = merge_city_with_group(
            city=city_from_post,
            state=item_state,
            source_group=source_group,
            source=source_key,
            chat_title=source_group,
            address_line=pro.get("private_address_line"),
        )
        city = merged.get("city")
        region = merged.get("region")
        state_raw = merged.get("state")
        # merge may leave county label in `state` when region is empty
        if not region and state_raw and COUNTY_AS_CITY_RE.match(state_raw):
            region = (
                "Orange County"
                if re.match(r"^(oc|orange)", state_raw, re.I)
                else state_raw
            )
            state_raw = "CA"
        if region and state_raw and state_raw == region:
            state_code = "US-CA"
        else:
            state_code = state_code_from_region(region, state_raw)

        if not city and not region:
            g = location_from_group(source_group, source_key)
            if g:
                city = g.get("city")
                region = g.get("region")
                state_code = "US-CA"
    else:
        city = (pro.get("city") or "").strip() or None
        region = (pro.get("region") or "").strip() or None
        state_code = (pro.get("state_code") or "").strip() or None
        if city and COUNTY_AS_CITY_RE.match(city):
            if not region:
                region = (
                    "Orange County"
                    if re.match(r"^(oc|orange)", city, re.I)
                    else city
                )
            city = None
        city_from_text = extract_city_from_post(blob)
        if city_from_text:
            city = city_from_text
        if not state_code:
            state_code = state_code_from_region(region, None)

    zip_code = extract_zip(blob)
    has_street = bool((pro.get("private_address_line") or "").strip())
    city = normalize_city(city)
    region = normalize_region(region)

    out: dict[str, Any] = {
        "city": city,
        "region": region,
        "state_code": state_code,
        "location_precision": precision_for(city, region, has_street),
    }
    # Area-only: no map pin without street
    if not has_street:
        out["latitude"] = None
        out["longitude"] = None
        out["public_exact_address"] = False

    if zip_code and not (pro.get("postal_code") or "").strip():
        out["postal_code"] = zip_code

    return out


def same_loc(a: Any, b: Any) -> bool:
    return (str(a or "").strip().lower()) == (str(b or "").strip().lower())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    apply = bool(args.apply) and not args.dry_run

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # Load import items indexed by published_entity_id + source_url
    by_entity: dict[str, dict[str, Any]] = {}
    by_url: dict[str, dict[str, Any]] = {}
    by_record: dict[str, dict[str, Any]] = {}
    last = None
    while True:
        params: dict[str, str] = {
            "select": (
                "id,source,source_group,source_url,source_text,description,title,"
                "person_name,city,state,published_entity_id,published_entity_type,"
                "target_collection,entity_type"
            ),
            "order": "id.asc",
            "limit": "500",
        }
        if last:
            params["id"] = f"gt.{last}"
        batch = client._request("GET", "/import_review_items", params=params) or []
        if not batch:
            break
        for it in batch:
            eid = it.get("published_entity_id")
            et = (it.get("published_entity_type") or it.get("entity_type") or "").lower()
            tc = (it.get("target_collection") or "").lower()
            pro_like = et in {
                "professional",
                "private_specialist",
            } or tc in {"private_specialists", "professionals", "services"}
            if eid and (pro_like or not et):
                # Prefer pro-like rows; first win for bare ids
                if eid not in by_entity or pro_like:
                    by_entity[eid] = it
            by_record[it["id"]] = it
            url = (it.get("source_url") or "").strip().lower().rstrip("/")
            if url and (url not in by_url or pro_like):
                by_url[url] = it
        last = batch[-1]["id"]
        if len(batch) < 500:
            break

    pros: list[dict[str, Any]] = []
    last = None
    while True:
        params = {
            "select": (
                "id,slug,display_name,headline,short_description,description,"
                "city,region,state_code,postal_code,private_address_line,"
                "location_precision,latitude,longitude,source_url,source_record_id,status"
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

    updated = 0
    linked = 0
    unlinked = 0
    region_counts: Counter[str] = Counter()
    samples: list[dict[str, Any]] = []

    for pro in pros:
        item = None
        if pro.get("source_record_id") and pro["source_record_id"] in by_record:
            item = by_record[pro["source_record_id"]]
        elif pro["id"] in by_entity:
            item = by_entity[pro["id"]]
        else:
            url = (pro.get("source_url") or "").strip().lower().rstrip("/")
            if url and url in by_url:
                item = by_url[url]

        if item:
            linked += 1
        else:
            unlinked += 1

        resolved = resolve_for_pro(pro, item)
        region_counts[resolved.get("region") or "(null)"] += 1

        # Diff against current
        patch: dict[str, Any] = {}
        for key in (
            "city",
            "region",
            "state_code",
            "location_precision",
            "postal_code",
            "latitude",
            "longitude",
            "public_exact_address",
        ):
            if key not in resolved:
                continue
            new_v = resolved[key]
            old_v = pro.get(key)
            if key in {"latitude", "longitude"}:
                if new_v is None and old_v is not None:
                    patch[key] = None
                continue
            if key == "public_exact_address":
                if old_v is not False and new_v is False:
                    patch[key] = False
                continue
            if not same_loc(old_v, new_v):
                patch[key] = new_v

        if not patch:
            continue

        updated += 1
        if len(samples) < 40:
            samples.append(
                {
                    "slug": pro.get("slug"),
                    "name": pro.get("display_name"),
                    "before": {
                        "city": pro.get("city"),
                        "region": pro.get("region"),
                    },
                    "after": {
                        "city": resolved.get("city"),
                        "region": resolved.get("region"),
                    },
                    "source_group": (item or {}).get("source_group"),
                    "source": (item or {}).get("source"),
                    "linked": bool(item),
                    "patch_keys": sorted(patch.keys()),
                }
            )

        if apply:
            client._request(
                "PATCH",
                f"/professionals?id=eq.{pro['id']}",
                body=patch,
            )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if apply else "dry-run",
        "scanned": len(pros),
        "linked_to_import": linked,
        "unlinked": unlinked,
        "updated": updated,
        "regions_after_resolve": dict(region_counts.most_common()),
        "samples": samples,
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"rebuild_from_groups_{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({**report, "report": str(path), "samples": samples[:12]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
