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


def state_abbr_from_region(region: Any) -> str | None:
    """`FL 33138` / `US-FL` / `Florida` → `FL`."""
    text = str(region or "").strip()
    if not text:
        return None
    direct = state_abbr(text)
    if direct:
        return direct
    m = re.search(
        r"\b(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEHINOST]|"
        r"N[CDEHJMVY]|O[HKR]|P[AWR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\b",
        text,
        re.I,
    )
    return state_abbr(m.group(1)) if m else None


def state_abbr_from_zip(postal_code: Any, *, network: bool = True) -> str | None:
    """ZIP → state via Zippopotam (same source as TS `resolveUsZipLocation`).

    Offline fallback: coarse ZIP3 ranges so a hub-default CA cannot block a
    Florida street geocode when the network is down.
    """
    digits = re.sub(r"\D", "", str(postal_code or ""))
    if len(digits) < 5:
        return None
    zip5 = digits[:5]
    if network:
        try:
            req = urllib.request.Request(
                f"https://api.zippopotam.us/us/{zip5}",
                headers={"User-Agent": UA, "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            place = (data.get("places") or [None])[0] or {}
            abbr = place.get("state abbreviation")
            if abbr:
                return state_abbr(abbr)
        except Exception:  # noqa: BLE001 -- offline / rate-limit → ZIP3 fallback
            pass
    return _state_from_zip3(zip5[:3])


#: Coarse USPS ZIP3 → state (enough to reject CA vs FL/NY/… hub defaults).
_ZIP3_STATE: dict[str, str] = {}


def _init_zip3_state() -> None:
    if _ZIP3_STATE:
        return
    ranges: list[tuple[int, int, str]] = [
        (5, 5, "NY"),
        (6, 9, "PR"),
        (10, 27, "NY"),
        (28, 29, "RI"),
        (30, 38, "NH"),
        (39, 49, "ME"),
        (50, 59, "VT"),
        (60, 69, "CT"),
        (70, 89, "NJ"),
        (90, 99, "AE"),  # military — skip
        (100, 149, "NY"),
        (150, 196, "PA"),
        (197, 199, "DE"),
        (200, 205, "DC"),
        (206, 219, "MD"),
        (220, 246, "VA"),
        (247, 268, "WV"),
        (270, 289, "NC"),
        (290, 299, "SC"),
        (300, 319, "GA"),
        (320, 349, "FL"),
        (350, 369, "AL"),
        (370, 385, "TN"),
        (386, 397, "MS"),
        (398, 399, "GA"),
        (400, 427, "KY"),
        (430, 458, "OH"),
        (460, 479, "IN"),
        (480, 499, "MI"),
        (500, 528, "IA"),
        (530, 549, "WI"),
        (550, 567, "MN"),
        (570, 577, "SD"),
        (580, 588, "ND"),
        (590, 599, "MT"),
        (600, 629, "IL"),
        (630, 658, "MO"),
        (660, 679, "KS"),
        (680, 693, "NE"),
        (700, 714, "LA"),
        (716, 729, "AR"),
        (730, 749, "OK"),
        (750, 799, "TX"),
        (800, 816, "CO"),
        (820, 831, "WY"),
        (832, 838, "ID"),
        (840, 847, "UT"),
        (850, 865, "AZ"),
        (870, 884, "NM"),
        (889, 898, "NV"),
        (900, 961, "CA"),
        (970, 979, "OR"),
        (980, 994, "WA"),
        (995, 999, "AK"),
        (967, 968, "HI"),
    ]
    for lo, hi, st in ranges:
        if st == "AE":
            continue
        for z in range(lo, hi + 1):
            _ZIP3_STATE[f"{z:03d}"] = st


def _state_from_zip3(zip3: str) -> str | None:
    _init_zip3_state()
    return _ZIP3_STATE.get(str(zip3 or "").zfill(3)[:3])


def reconcile_state_code(
    state_code: Any = None,
    postal_code: Any = None,
    region: Any = None,
    *,
    network: bool = True,
) -> str | None:
    """Prefer ZIP / region state over a conflicting hub default (often US-CA).

    Returns `US-XX` when known, else normalized existing state, else None.
    """
    existing = state_abbr(state_code)
    from_region = state_abbr_from_region(region)
    from_zip = state_abbr_from_zip(postal_code, network=network)
    chosen = from_zip or from_region or existing
    if from_zip and existing and from_zip != existing:
        chosen = from_zip
    elif from_region and existing and from_region != existing and not from_zip:
        chosen = from_region
    return f"US-{chosen}" if chosen else None


def is_county_label(value: Any) -> bool:
    """County/metro labels break a street-level geocode query."""
    v = str(value or "").strip().lower()
    return v == "oc" or v.endswith(" county")


def looks_like_street(value: Any) -> bool:
    """House number + street name — the only shape that earns a street pin."""
    v = str(value or "").strip()
    if not v or is_county_label(v):
        return False
    # «123 Main St» or «18635 8th Ave S» (ordinal street names start with a digit).
    if not re.match(
        r"^\d{1,6}\s+(?:\d{1,3}(?:st|nd|rd|th)\b|[A-Za-zА-Яа-я])",
        v,
        re.I,
    ):
        return False
    # «1325 2nd» is fine, «123 456» is not an address.
    return not re.match(r"^\d{1,6}\s+\d+\s*$", v)


#: Directory glue: «6108 seattleubc.com 1829 S 308th St» / «4 ufgpc.com 5904…»
_DOMAIN_GLUE_RE = re.compile(
    r"(?:\b\d{1,6}\s+)?[\w.-]+\.(?:com|org|net|ru|info|us)\s+",
    re.I,
)


def scrub_directory_glue(value: Any) -> str:
    """Strip website crumbs pasted in front of the real street line."""
    v = re.sub(r"\s+", " ", str(value or "").strip())
    if not v:
        return ""
    cleaned = _DOMAIN_GLUE_RE.sub("", v).strip(" ,;-")
    return cleaned or v


def street_identity(value: Any) -> str:
    """Normalize a street line for equality (suite / Ave vs Avenue ignored)."""
    v = strip_unit(value).lower()
    v = re.sub(r"[^\w\s]", " ", v)
    v = re.sub(
        r"\b(avenue|ave|street|st|boulevard|blvd|drive|dr|road|rd|lane|ln|"
        r"court|ct|way|parkway|pkwy|place|pl|circle|cir|terrace|ter)\b",
        "",
        v,
    )
    return re.sub(r"\s+", " ", v).strip()


def address_richness(value: Any) -> int:
    """Rough completeness score — city/state/ZIP beat a bare house+street stub."""
    v = str(value or "").strip()
    if not v:
        return 0
    score = 1
    if "," in v:
        score += 2
    if re.search(r"\b[A-Z]{2}\b", v) or re.search(r"\bUS-[A-Z]{2}\b", v):
        score += 2
    if re.search(r"\b\d{5}(?:-\d{4})?\b", v):
        score += 2
    # Long enough to include a city token beyond the street.
    if len(v) >= 28:
        score += 1
    return score


def is_address_stub(value: Any) -> bool:
    """Bare «7213 truck drive» without city/state — not enough to overwrite."""
    v = str(value or "").strip()
    if not v:
        return True
    if "," in v:
        return False
    if re.search(r"\b\d{5}(?:-\d{4})?\b", v):
        return False
    if re.search(r",\s*[A-Za-z].*\b[A-Z]{2}\b", v):
        return False
    return True


def prefer_own_website_street(
    existing: Any,
    website: Any,
) -> bool:
    """True when the card's own website street should replace what is stored.

    Fill-empty keeps telegram / party glue forever; the shop's site is the
    stronger source when the house number + street name disagree — but never
    replace a fuller line with a stub like «7213 truck drive».
    """
    web = str(website or "").strip()
    if not web or not looks_like_street(web):
        return False
    cur = str(existing or "").strip()
    if not cur or not looks_like_street(cur):
        return True
    # Stub website line must not wipe a real city/state address.
    if is_address_stub(web) and not is_address_stub(cur):
        return False
    if street_identity(cur) == street_identity(web):
        return False
    # Different streets: trust the website even when the card's line looks
    # «richer» because it glued City, ST, USA onto the wrong house number
    # (to4ka / telegram) while the site only has street + unit.
    return True


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


#: Common directory typos that send Nominatim to the wrong city
#: (McArthur Blvd → San Bernardino instead of MacArthur / Newport Beach).
_STREET_SPELLING_FIXES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bMcArthur\b", re.I), "MacArthur"),
    (re.compile(r"\bMcarthur\b", re.I), "MacArthur"),
)


def normalize_street_spelling(value: Any) -> str:
    v = re.sub(r"\s+", " ", str(value or "").strip())
    for pat, repl in _STREET_SPELLING_FIXES:
        v = pat.sub(repl, v)
    return v


def _norm_place(value: Any) -> str:
    v = str(value or "").lower()
    v = re.sub(r"[^a-z0-9\s]", " ", v)
    return re.sub(r"\s+", " ", v).strip()


def hit_matches_expected(
    hit: dict[str, Any],
    *,
    city: Any = None,
    postal_code: Any = None,
) -> bool:
    """Reject Inland-Empire misses when the card says Newport Beach / 92660."""
    expect_zip = re.sub(r"\D", "", str(postal_code or ""))[:5]
    hit_zip = re.sub(r"\D", "", str(hit.get("postal_code") or ""))[:5]
    if expect_zip and len(expect_zip) == 5:
        if hit_zip and hit_zip != expect_zip:
            return False
        # ZIP on the card is authoritative — city label may be a neighborhood.
        if hit_zip == expect_zip:
            return True

    expect_city = _norm_place(city)
    if not expect_city or is_county_label(city):
        return True

    hit_places = [
        hit.get("city"),
        hit.get("town"),
        hit.get("village"),
        hit.get("municipality"),
        hit.get("suburb"),
        hit.get("hamlet"),
        hit.get("county"),
    ]
    norms = [_norm_place(p) for p in hit_places if p]
    if not norms:
        # No place labels — keep only when we could not check ZIP either.
        return not expect_zip

    for n in norms:
        if not n:
            continue
        if n == expect_city or expect_city in n or n in expect_city:
            return True
    return False


#: Full dump pasted into street: "123 Main St, Suite 2, Irvine, CA 92618"
_CITY_STATE_ZIP_TAIL_RE = re.compile(
    r",\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .'-]{1,40})\s*,\s*"
    r"(CA|California|калифорния|[A-Z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$",
    re.I,
)
_CITY_ZIP_TAIL_RE = re.compile(
    r",\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .'-]{1,40})\s+(\d{5}(?:-\d{4})?)\s*$",
    re.I,
)


def peel_street_city_state_zip(
    address_line: Any,
    city: Any = None,
    state_code: Any = None,
    postal_code: Any = None,
) -> dict[str, str | None]:
    """Street-only line + city/state/ZIP. Full dump in street wins over fields.

    Mirrors `normalizeStructuredAddress` when addressLine has City, ST ZIP.
    """
    street = re.sub(r"\s+", " ", str(address_line or "").strip()) or None
    out_city = str(city or "").strip() or None
    out_state = state_abbr(state_code)
    out_zip = re.sub(r"\D", "", str(postal_code or ""))[:5] or None
    if out_zip and len(out_zip) != 5:
        out_zip = None

    if not street:
        return {
            "address_line": None,
            "city": out_city,
            "state_code": f"US-{out_state}" if out_state else None,
            "postal_code": out_zip,
        }

    m = _CITY_STATE_ZIP_TAIL_RE.search(street)
    if m:
        street_city = re.sub(r"\s+", " ", m.group(1)).strip(" ,.")
        street_state = state_abbr(m.group(2))
        raw_zip = m.group(3) or ""
        street_zip = re.sub(r"\D", "", raw_zip)[:5] or None
        if street_city:
            out_city = street_city
        if street_state:
            out_state = street_state
        if street_zip:
            out_zip = street_zip
        street = street[: m.start()].strip(" ,.") or None
    else:
        m2 = _CITY_ZIP_TAIL_RE.search(street)
        if m2:
            street_city = re.sub(r"\s+", " ", m2.group(1)).strip(" ,.")
            street_zip = re.sub(r"\D", "", m2.group(2))[:5] or None
            if street_city and not re.search(
                r"(?i)\b(ste|suite|apt|unit|bldg|floor|fl|#)\b", street_city
            ):
                out_city = street_city
            if street_zip:
                out_zip = street_zip
            street = street[: m2.start()].strip(" ,.") or None

    return {
        "address_line": street,
        "city": out_city,
        "state_code": f"US-{out_state}" if out_state else None,
        "postal_code": out_zip,
    }


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


def geocode(
    query: str,
    expect_state: str | None = None,
    *,
    expect_city: Any = None,
    expect_postal: Any = None,
) -> dict[str, Any] | None:
    """Nominatim lookup; wrong state / ZIP / city hits are rejected."""
    qs = urllib.parse.urlencode(
        {
            "q": query,
            "format": "json",
            "limit": "5",
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
        candidate = {
            "latitude": lat,
            "longitude": lng,
            "postal_code": address.get("postcode"),
            "city": address.get("city") or address.get("town") or address.get("village"),
            "town": address.get("town"),
            "village": address.get("village"),
            "municipality": address.get("municipality"),
            "suburb": address.get("suburb"),
            "hamlet": address.get("hamlet"),
            "county": address.get("county"),
        }
        if not hit_matches_expected(
            candidate, city=expect_city, postal_code=expect_postal
        ):
            continue
        return candidate
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
    region: Any = None,
    throttle: bool = True,
    with_maps_url: bool = True,
) -> AddressGeo:
    """Geocode a street address and build the location patch.

    Street pin (`location_precision = 'street'`) is returned only when the
    address looks street-level AND the geocoder answers in the expected state.
    Otherwise precision is left alone (empty patch) so a hub-default CA miss
    does not wipe fields — callers fall back to a city map.

    When ZIP/region imply a different state than ``state_code`` (classic:
    Miami FL ZIP + leftover US-CA), ZIP/region win before Nominatim runs.
    """
    street = scrub_directory_glue(address_line)
    street = normalize_street_spelling(street)
    if not street:
        return AddressGeo(ok=False, reason="no_address")
    if not looks_like_street(street):
        return AddressGeo(
            ok=False, patch={"location_precision": None}, reason="not_street"
        )

    original_state = state_abbr(state_code)
    reconciled = reconcile_state_code(
        state_code, postal_code, region, network=True
    )
    state_code = reconciled or state_code

    # Attempt ladder: full line → spelling-fixed → without unit → without city
    # (typo cities). Never accept a hit whose ZIP/city contradicts the card.
    bare = strip_unit(street)
    raw = scrub_directory_glue(address_line)
    raw = re.sub(r"\s+", " ", raw)
    attempts = [build_query(street, city, state_code, postal_code)]
    if raw and raw != street:
        attempts.insert(0, build_query(raw, city, state_code, postal_code))
    if bare and bare != street:
        attempts.append(build_query(bare, city, state_code, postal_code))
    # Drop city only while keeping ZIP — ZIP is what stops McArthur→Inland Empire.
    if str(postal_code or "").strip():
        attempts.append(build_query(bare or street, None, state_code, postal_code))
    elif str(city or "").strip():
        # No ZIP: last resort without city (still validated against city name).
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
    expect = state_abbr(state_code)
    for attempt in attempts:
        query = attempt
        hit = geocode(
            attempt,
            expect,
            expect_city=city,
            expect_postal=postal_code,
        )
        if throttle:
            time.sleep(THROTTLE_SECONDS)
        if hit:
            break

    # Hub-default CA (etc.) still wrong after reconcile → retry without state
    # constraint but keep ZIP/city validation.
    if not hit and expect and str(postal_code or "").strip():
        for attempt in attempts:
            # Rebuild query without state name so Nominatim is not biased to CA.
            loose = re.sub(
                rf",\s*{re.escape(STATE_NAMES.get(expect, expect))}\b",
                "",
                attempt,
                flags=re.I,
            )
            query = loose
            hit = geocode(
                loose,
                None,
                expect_city=city,
                expect_postal=postal_code,
            )
            if throttle:
                time.sleep(THROTTLE_SECONDS)
            if hit:
                break

    if not hit:
        # Do NOT write location_precision=None on a miss — that pollutes the
        # enrich patch («+location_precision») and can clear a good city map.
        return AddressGeo(
            ok=False,
            patch={},
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
    # Surface reconciled state so callers fix leftover hub defaults (US-CA).
    reconciled_abbr = state_abbr(state_code)
    if reconciled_abbr and reconciled_abbr != original_state:
        patch["state_code"] = f"US-{reconciled_abbr}"
    zip_hit = str(hit.get("postal_code") or "").strip()
    if not str(postal_code or "").strip() and re.fullmatch(r"\d{5}", zip_hit):
        patch["postal_code"] = zip_hit
    return AddressGeo(ok=True, patch=patch, reason="street_hit", query=query)
