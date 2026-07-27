#!/usr/bin/env python3
"""find_duplicates(entity) — cross-layer duplicate search. Read-only.

Searches three layers for likely duplicates of a given entity:
  Layer 1: import_review_items (the queue)
  Layer 2: businesses (published)
  Layer 3: professionals (published)

Four signal types per layer:
  - normalized phone (last 10 digits, exact match)
  - Instagram handle (exact, case-insensitive)
  - website domain (exact host match, junk hosts excluded)
  - fuzzy name + city (difflib ratio >= threshold, default 0.85)

This function does NOT merge or write anything — it returns a list of
candidate matches (layer, id, match_type, confidence, matched_value) for a
human, or a future separate merge script, to act on.

Reuses proven normalization logic rather than reinventing it:
  - norm_phone / website_host / instagram_handle: same approach as
    scripts/business-enrich/find_business_duplicates.py (read in full before
    writing this file — that script's matching is exact-key only, no fuzzy).
  - norm_name: same approach as
    scripts/business-enrich/merge_professional_duplicates.py (also exact-key
    only after normalization).
No fuzzy matching existed anywhere in scripts/business-enrich/ before this
file (confirmed by reading both scripts above in full) — the name+city fuzzy
layer here is new, built with stdlib difflib (no new dependency, consistent
with every other script in this directory being stdlib-only).

Usage (dry-run probe against real data, prints matches, writes nothing):
  python3 scripts/business-enrich/find_duplicates.py --phone "+1 949 555 1212" --name "Ocean Nails" --city "Irvine"
  python3 scripts/business-enrich/find_duplicates.py --business-id <uuid>
  python3 scripts/business-enrich/find_duplicates.py --professional-id <uuid>
  python3 scripts/business-enrich/find_duplicates.py --import-review-id <uuid>
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402

FUZZY_THRESHOLD_DEFAULT = 0.85

SKIP_HOSTS = {
    "instagram.com",
    "facebook.com",
    "fb.com",
    "t.me",
    "telegram.me",
    "linktr.ee",
    "maps.apple.com",
    "maps.app.goo.gl",
    "youtu.be",
    "youtube.com",
    "eventbrite.com",
    "bit.ly",
}


# ---------------------------------------------------------------------------
# Normalization (mirrors find_business_duplicates.py / merge_professional_duplicates.py)
# ---------------------------------------------------------------------------

def norm_phone(raw: str | None) -> str | None:
    """Last 10 digits if len>=10 (matches find_business_duplicates.py);
    else the raw digit string if 7<=len<10 (looser, matches
    merge_professional_duplicates.py — useful cross-checking a queue item
    whose phone may be missing an area code)."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) >= 10:
        return digits[-10:]
    if 7 <= len(digits) < 10:
        return digits
    return None


def website_host(url: str | None) -> str | None:
    if not url:
        return None
    u = url.strip()
    if not u:
        return None
    if "://" not in u:
        u = "https://" + u
    try:
        host = (urllib.parse.urlparse(u).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return None
    if not host or "." not in host:
        return None
    if host in SKIP_HOSTS or any(host.endswith("." + s) for s in SKIP_HOSTS) or host.startswith("maps."):
        return None
    return host


def instagram_handle(raw: str | None) -> str | None:
    if not raw:
        return None
    value = str(raw).strip().lstrip("@")
    m = re.search(r"instagram\.com/([A-Za-z0-9._]+)", value, re.I)
    if m:
        value = m.group(1)
    value = value.split("?")[0].strip("/")
    if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", value or ""):
        return None
    return value.lower()


def norm_name(s: str | None) -> str:
    """Lowercase, ё→е, strip everything except [a-zа-я0-9], collapse whitespace."""
    if not s:
        return ""
    t = s.lower().replace("ё", "е")
    t = re.sub(r"[^a-zа-я0-9]+", " ", t, flags=re.I | re.U)
    return re.sub(r"\s+", " ", t).strip()


def norm_city(s: str | None) -> str:
    return norm_name(s)


def fuzzy_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


# ---------------------------------------------------------------------------
# Entity adapters — build the flat {phone, instagram, website, name, city}
# shape find_duplicates() expects, from each of the three row shapes.
# ---------------------------------------------------------------------------

def entity_from_business(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "phone": row.get("phone"),
        "instagram": row.get("instagram_url"),
        "website": row.get("website"),
        "name": row.get("name"),
        "city": row.get("city"),
    }


def entity_from_professional(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "phone": row.get("phone"),
        "instagram": row.get("instagram_url"),
        "website": row.get("website"),
        "name": row.get("display_name"),
        "city": row.get("city"),
    }


def entity_from_import_review_item(row: dict[str, Any]) -> dict[str, Any]:
    phones = row.get("phone") or []
    instagrams = row.get("instagram") or []
    websites = row.get("website") or []
    return {
        "phone": phones[0] if isinstance(phones, list) and phones else phones,
        "instagram": instagrams[0] if isinstance(instagrams, list) and instagrams else instagrams,
        "website": websites[0] if isinstance(websites, list) and websites else websites,
        "name": row.get("title") or row.get("business_name") or row.get("person_name"),
        "city": row.get("city"),
    }


# ---------------------------------------------------------------------------
# Candidate fetch — pull the whole (small) table client-side, same pattern
# already used by find_business_duplicates.py / merge_professional_duplicates.py.
# ---------------------------------------------------------------------------

def _paged_fetch(client: SupabaseRest, path: str, select: str, extra_params: dict[str, str] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        params = {"select": select, "offset": str(offset), "limit": "1000"}
        if extra_params:
            params.update(extra_params)
        batch = client._request("GET", path, params=params) or []
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < 1000:
            break
    return rows


def fetch_business_candidates(client: SupabaseRest) -> list[dict[str, Any]]:
    return _paged_fetch(
        client,
        "/businesses",
        "id,slug,name,city,phone,website,instagram_url,status",
        {"status": "in.(approved,pending,deferred)"},
    )


def fetch_professional_candidates(client: SupabaseRest) -> list[dict[str, Any]]:
    return _paged_fetch(
        client,
        "/professionals",
        "id,slug,display_name,city,phone,website,instagram_url,status",
        {"status": "in.(approved,pending)"},
    )


def fetch_import_review_candidates(client: SupabaseRest) -> list[dict[str, Any]]:
    return _paged_fetch(
        client,
        "/import_review_items",
        "id,title,business_name,person_name,city,phone,instagram,website,entity_type,review_status",
        {"review_status": "neq.rejected"},
    )


# ---------------------------------------------------------------------------
# Core matcher
# ---------------------------------------------------------------------------

def _match_against_layer(
    entity: dict[str, Any],
    candidates: list[dict[str, Any]],
    *,
    layer: str,
    get_entity: Any,
    exclude_id: str | None,
    fuzzy_threshold: float,
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []

    e_phone = norm_phone(entity.get("phone"))
    e_ig = instagram_handle(entity.get("instagram"))
    e_host = website_host(entity.get("website"))
    e_name = norm_name(entity.get("name"))
    e_city = norm_city(entity.get("city"))

    for cand in candidates:
        cid = str(cand.get("id"))
        if exclude_id and cid == str(exclude_id):
            continue
        c = get_entity(cand)

        c_phone = norm_phone(c.get("phone"))
        if e_phone and c_phone and e_phone == c_phone:
            matches.append(
                {
                    "layer": layer,
                    "id": cid,
                    "match_type": "phone",
                    "confidence": 0.95 if len(e_phone) == 10 else 0.7,
                    "matched_value": c_phone,
                    "candidate_name": c.get("name"),
                }
            )
            continue  # phone match is decisive enough — don't also fuzzy-match this row

        c_ig = instagram_handle(c.get("instagram"))
        if e_ig and c_ig and e_ig == c_ig:
            matches.append(
                {
                    "layer": layer,
                    "id": cid,
                    "match_type": "instagram",
                    "confidence": 0.95,
                    "matched_value": c_ig,
                    "candidate_name": c.get("name"),
                }
            )
            continue

        c_host = website_host(c.get("website"))
        if e_host and c_host and e_host == c_host:
            matches.append(
                {
                    "layer": layer,
                    "id": cid,
                    "match_type": "website_domain",
                    "confidence": 0.9,
                    "matched_value": c_host,
                    "candidate_name": c.get("name"),
                }
            )
            continue

        c_name = norm_name(c.get("name"))
        c_city = norm_city(c.get("city"))
        if e_name and c_name and e_city and c_city and e_city == c_city:
            ratio = fuzzy_ratio(e_name, c_name)
            if ratio >= fuzzy_threshold:
                matches.append(
                    {
                        "layer": layer,
                        "id": cid,
                        "match_type": "name_city_fuzzy",
                        "confidence": round(ratio, 3),
                        "matched_value": f"{c_name} @ {c_city}",
                        "candidate_name": c.get("name"),
                    }
                )

    return matches


def find_duplicates(
    entity: dict[str, Any],
    *,
    client: SupabaseRest,
    exclude_id: str | None = None,
    fuzzy_threshold: float = FUZZY_THRESHOLD_DEFAULT,
) -> list[dict[str, Any]]:
    """Search all three layers for likely duplicates of `entity`.

    `entity` shape: {"phone": str|None, "instagram": str|None, "website":
    str|None, "name": str|None, "city": str|None} — use the entity_from_*()
    adapters above to build this from a real row.

    Returns a flat list of match dicts, most-confident first. Does not
    merge, does not write anything.
    """
    results: list[dict[str, Any]] = []

    results += _match_against_layer(
        entity,
        fetch_import_review_candidates(client),
        layer="import_review_items",
        get_entity=entity_from_import_review_item,
        exclude_id=exclude_id,
        fuzzy_threshold=fuzzy_threshold,
    )
    results += _match_against_layer(
        entity,
        fetch_business_candidates(client),
        layer="businesses",
        get_entity=entity_from_business,
        exclude_id=exclude_id,
        fuzzy_threshold=fuzzy_threshold,
    )
    results += _match_against_layer(
        entity,
        fetch_professional_candidates(client),
        layer="professionals",
        get_entity=entity_from_professional,
        exclude_id=exclude_id,
        fuzzy_threshold=fuzzy_threshold,
    )

    results.sort(key=lambda m: -m["confidence"])
    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only cross-layer duplicate search")
    parser.add_argument("--phone", type=str, default=None)
    parser.add_argument("--instagram", type=str, default=None)
    parser.add_argument("--website", type=str, default=None)
    parser.add_argument("--name", type=str, default=None)
    parser.add_argument("--city", type=str, default=None)
    parser.add_argument("--business-id", type=str, default=None, help="Look up a businesses row by id and search for its duplicates")
    parser.add_argument("--professional-id", type=str, default=None)
    parser.add_argument("--import-review-id", type=str, default=None)
    parser.add_argument("--threshold", type=float, default=FUZZY_THRESHOLD_DEFAULT)
    args = parser.parse_args()

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    exclude_id = None
    if args.business_id:
        rows = client._request("GET", "/businesses", params={"select": "id,name,city,phone,website,instagram_url", "id": f"eq.{args.business_id}"}) or []
        if not rows:
            print(json.dumps({"error": "business not found"}))
            return 1
        entity = entity_from_business(rows[0])
        exclude_id = args.business_id
    elif args.professional_id:
        rows = client._request("GET", "/professionals", params={"select": "id,display_name,city,phone,website,instagram_url", "id": f"eq.{args.professional_id}"}) or []
        if not rows:
            print(json.dumps({"error": "professional not found"}))
            return 1
        entity = entity_from_professional(rows[0])
        exclude_id = args.professional_id
    elif args.import_review_id:
        rows = client._request("GET", "/import_review_items", params={"select": "id,title,business_name,person_name,city,phone,instagram,website", "id": f"eq.{args.import_review_id}"}) or []
        if not rows:
            print(json.dumps({"error": "import_review_item not found"}))
            return 1
        entity = entity_from_import_review_item(rows[0])
    else:
        entity = {
            "phone": args.phone,
            "instagram": args.instagram,
            "website": args.website,
            "name": args.name,
            "city": args.city,
        }

    matches = find_duplicates(entity, client=client, exclude_id=exclude_id, fuzzy_threshold=args.threshold)
    print(json.dumps({"entity": entity, "match_count": len(matches), "matches": matches}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
