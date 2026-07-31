#!/usr/bin/env python3
"""Address → geo step. Single contract for every enrichment pipeline.

Rule (see docs/architecture/runtime/USA_LOCATION_CANON_V1.md):
`location_precision = 'street'` may only be written together with real
coordinates. A street-like address string alone is NOT a street pin — it is an
address waiting to be geocoded. Callers must use `resolve_address_geo` instead
of setting precision by hand.

Usage:
    from address_geo import resolve_address_geo

    geo = resolve_address_geo(
        address_line="1325 Bluff City Blvd",
        city="Elgin",
        state_code="US-IL",
    )
    patch.update(geo.patch)   # coords + precision + maps url, or precision reset
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

UA = "KrugiGeoStep/1.0 (catalog; contact@krugi.app)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
#: Nominatim asks for <= 1 request per second.
THROTTLE_SECONDS = 1.1

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana",
    "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
_NAME_TO_ABBR = {name.lower(): abbr for abbr, name in STATE_NAMES.items()}


def state_abbr(raw: Any) -> str | None:
    """`US-IL` / `IL` / `Illinois` → `IL`. Never guesses a missing state."""
    value = str(raw or "").strip()
    if not value:
        return None
    upper = value.upper().replace("US-", "")
    if upper in STATE_NAMES:
        return upper
    return _NAME_TO_ABBR.get(value.lower())


def is_county_label(value: Any) -> bool:
    """County/metro labels break a street-level geocode query."""
    v = str(value or "").strip().lower()
    return v == "oc" or v.endswith(" county")


def looks_like_street(value: Any) -> bool:
    """House number + street name — the only shape that earns a street pin."""
    v = str(value or "").strip()
    if not v or is_county_label(v):
        return False
    if not re.match(r"^\d{1,6}\s+[A-Za-zА-Яа-я]", v):
        return False
    # «1325 2nd» is fine, «123 456» is not an address.
    return not re.match(r"^\d{1,6}\s+\d+\s*$", v)


#: «Ste 200», «Apt B», «Fl 8» — keyword plus a short identifier with a digit or
#: a single letter, so real street names («Avenue of the Stars») stay intact.
_UNIT_RE = re.compile(
    r",?\s*\b(?:ste|suite|unit|apt|apartment|bldg|building|fl|floor|room|rm|office)\b\.?"
    r"\s*#?\s*(?:(?=[\w-]*\d)[\w-]{1,8}|[A-Za-z]{1,2})\b",
    re.I,
)


def strip_unit(value: Any) -> str:
    """Drop «Ste 200» / «#5» / «Apt B» — unit numbers confuse the geocoder."""
    v = re.sub(r"\s+", " ", str(value or "").strip())
    v = _UNIT_RE.sub("", v)
    v = re.sub(r"#\s*[\w-]+", "", v)
    return re.sub(r"\s+", " ", v).strip(" ,-")


def build_query(
    address: Any,
    city: Any = None,
    state_code: Any = None,
    postal_code: Any = None,
) -> str:
    """Street, city, state, ZIP, USA — county labels dropped."""
    street = re.sub(r"\s+", " ", str(address or "").strip())
    blob = street.lower()
    parts = [street]
    if city and not is_county_label(city) and str(city).lower() not in blob:
        parts.append(str(city).strip())
    abbr = state_abbr(state_code)
    if abbr:
        parts.append(STATE_NAMES[abbr])
    if postal_code and str(postal_code).strip() not in blob:
        parts.append(str(postal_code).strip())
    parts.append("USA")
    return ", ".join(p for p in parts if p)


def maps_url(address: Any, city: Any = None, state_code: Any = None) -> str:
    query = ", ".join(
        str(p).strip()
        for p in (address, city, state_abbr(state_code))
        if p and not is_county_label(p)
    )
    return (
        "https://www.google.com/maps/search/?api=1&query="
        + urllib.parse.quote(query)
    )


def geocode(query: str, expect_state: str | None = None) -> dict[str, Any] | None:
    """Nominatim lookup; hits landing in another state are rejected."""
    qs = urllib.parse.urlencode(
        {
            "q": query,
            "format": "json",
            "limit": "3",
            "countrycodes": "us",
            "addressdetails": "1",
        }
    )
    req = urllib.request.Request(f"{NOMINATIM}?{qs}", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 -- network/geocoder failure is a miss
        return None
    if not data:
        return None

    for hit in data:
        address = hit.get("address") or {}
        if expect_state:
            found = (address.get("state") or "").strip()
            if found and found != STATE_NAMES.get(expect_state):
                continue
        try:
            lat = float(hit["lat"])
            lng = float(hit["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        return {
            "latitude": lat,
            "longitude": lng,
            "postal_code": address.get("postcode"),
            "city": address.get("city") or address.get("town") or address.get("village"),
            "county": address.get("county"),
        }
    return None


@dataclass
class AddressGeo:
    """Outcome of the address → geo step."""

    ok: bool
    #: Fields to merge into the entity patch.
    patch: dict[str, Any] = field(default_factory=dict)
    #: `street_hit` | `not_street` | `geocode_miss` | `no_address`
    reason: str = ""
    query: str | None = None


def resolve_address_geo(
    address_line: Any,
    city: Any = None,
    state_code: Any = None,
    postal_code: Any = None,
    *,
    throttle: bool = True,
    with_maps_url: bool = True,
) -> AddressGeo:
    """Geocode a street address and build the location patch.

    Street pin (`location_precision = 'street'`) is returned only when the
    address looks street-level AND the geocoder answers in the expected state.
    Otherwise precision is reset to None so the card falls back to a city map
    instead of claiming a pin it does not have.
    """
    street = re.sub(r"\s+", " ", str(address_line or "").strip())
    if not street:
        return AddressGeo(ok=False, reason="no_address")
    if not looks_like_street(street):
        return AddressGeo(
            ok=False, patch={"location_precision": None}, reason="not_street"
        )

    # Attempt ladder: full line → without unit → without city (imports often
    # poison the query with a typo / neighbourhood) → street + state only.
    bare = strip_unit(street)
    attempts = [build_query(street, city, state_code, postal_code)]
    if bare and bare != street:
        attempts.append(build_query(bare, city, state_code, postal_code))
    if str(postal_code or "").strip():
        attempts.append(build_query(bare or street, None, state_code, postal_code))
    # Typo cities ("Metachen", "EL KAHON") break Nominatim — always try without city.
    if str(city or "").strip():
        attempts.append(build_query(bare or street, None, state_code, postal_code))
        attempts.append(build_query(bare or street, None, state_code, None))

    # De-dupe while preserving order.
    seen: set[str] = set()
    unique_attempts: list[str] = []
    for attempt in attempts:
        if attempt and attempt not in seen:
            seen.add(attempt)
            unique_attempts.append(attempt)
    attempts = unique_attempts

    hit = None
    query = attempts[0] if attempts else ""
    for attempt in attempts:
        query = attempt
        hit = geocode(attempt, state_abbr(state_code))
        if throttle:
            time.sleep(THROTTLE_SECONDS)
        if hit:
            break

    if not hit:
        return AddressGeo(
            ok=False,
            patch={"location_precision": None},
            reason="geocode_miss",
            query=query,
        )

    patch: dict[str, Any] = {
        "latitude": hit["latitude"],
        "longitude": hit["longitude"],
        "location_precision": "street",
    }
    if with_maps_url:
        patch["google_maps_url"] = maps_url(street, city, state_code)
    zip_hit = str(hit.get("postal_code") or "").strip()
    if not str(postal_code or "").strip() and re.fullmatch(r"\d{5}", zip_hit):
        patch["postal_code"] = zip_hit
    return AddressGeo(ok=True, patch=patch, reason="street_hit", query=query)
