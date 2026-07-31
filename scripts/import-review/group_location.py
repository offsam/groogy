"""Map Telegram/Facebook group names → city/region when the post has no location.

Group matching: source_location_groups (USA catalog).
Text mentions: Orange County, Irvine, Denver, …
"""

from __future__ import annotations

import re
from typing import Any

from resolve_entity_location import merge_city_with_group as _merge_base
from source_location_groups import location_from_group

_TEXT_PLACE_RULES: list[tuple[re.Pattern[str], str | None, str | None, str | None]] = [
    (
        re.compile(r"\b(orange\s*county|оранж(?:\s*каунти)?|\boc\b)\b", re.I),
        None,
        "Orange County",
        "CA",
    ),
    (
        re.compile(r"\b(sacramento|сакраменто)\b", re.I),
        "Sacramento",
        "Sacramento County",
        "CA",
    ),
    (
        re.compile(r"\b(san\s*diego|сан[-\s]?диего)\b", re.I),
        "San Diego",
        "San Diego County",
        "CA",
    ),
    (
        re.compile(
            r"\b(san\s*francisco|\bsf\b|bay\s*area|сан[-\s]?франциско)\b",
            re.I,
        ),
        "San Francisco",
        "San Francisco County",
        "CA",
    ),
    (
        re.compile(r"\b(los\s*angeles|\bla\b|лос[-\s]?анджелес\w*)\b", re.I),
        "Los Angeles",
        "Los Angeles County",
        "CA",
    ),
    (re.compile(r"\b(denver|денвер)\b", re.I), "Denver", "Denver County", "CO"),
    (re.compile(r"\b(seattle|сиэтл|сиэттл)\b", re.I), "Seattle", "King County", "WA"),
    (
        re.compile(
            r"\b(irvine|айрвин|anaheim|santa\s*ana|tustin|"
            r"costa\s*mesa|newport\s*beach|huntington\s*beach|"
            r"fullerton|buena\s*park|garden\s*grove|orange)\b",
            re.I,
        ),
        None,
        "Orange County",
        "CA",
    ),
]

_OC_CITY_CANON = {
    "irvine": "Irvine",
    "айрвин": "Irvine",
    "anaheim": "Anaheim",
    "santa ana": "Santa Ana",
    "tustin": "Tustin",
    "costa mesa": "Costa Mesa",
    "newport beach": "Newport Beach",
    "huntington beach": "Huntington Beach",
    "fullerton": "Fullerton",
    "buena park": "Buena Park",
    "garden grove": "Garden Grove",
    "orange": "Orange",
}


_STREET_SUFFIX_AFTER_RE = re.compile(
    r"^\s*(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|"
    r"Lane|Ln|Court|Ct|Place|Pl|Highway|Hwy|Parkway|Pkwy|Way)\b",
    re.I,
)

_CITY_STATE_LOCALITY_RE = re.compile(
    r"(?<![A-Za-z])(?P<city>[A-Za-z][A-Za-z .'\-]{1,40}?)\s*,\s*"
    r"(?P<state>CA|California|WA|Washington|NY|New\s*York|FL|Florida|"
    r"OR|Oregon|TX|Texas|CO|Colorado)\b",
    re.I,
)


def location_from_text(text: str | None) -> dict[str, str | None] | None:
    blob = (text or "").strip()
    if not blob:
        return None
    sample = blob[:2500]

    # Prefer explicit «City, ST» (Tustin, CA) over a city token inside a street
    # name (Irvine in «18062 Irvine Blvd»).
    for m in _CITY_STATE_LOCALITY_RE.finditer(sample):
        city = re.sub(r"\s+", " ", m.group("city")).strip(" ,")
        if not city or re.search(r"\bcounty\b", city, re.I):
            continue
        if _STREET_SUFFIX_AFTER_RE.search(sample[m.end(1) : m.end(1) + 12]):
            continue
        state_raw = m.group("state")
        state = "CA" if re.match(r"ca|california", state_raw, re.I) else state_raw.upper()[:2]
        region = None
        low = city.lower()
        if low in _OC_CITY_CANON or low.replace("  ", " ") in {
            k.replace("  ", " ") for k in _OC_CITY_CANON
        }:
            region = "Orange County"
            city = _OC_CITY_CANON.get(low, city)
        return {"city": city, "region": region, "state": state}

    for pattern, city, region, state in _TEXT_PLACE_RULES:
        m = pattern.search(sample)
        if not m:
            continue
        # «Irvine Blvd» is a street, not the city of Irvine.
        after = sample[m.end() : m.end() + 16]
        if _STREET_SUFFIX_AFTER_RE.search(after):
            continue
        raw = re.sub(r"\s+", " ", m.group(0)).strip().lower()
        if region == "Orange County" and city is None:
            canon = _OC_CITY_CANON.get(raw)
            if canon:
                return {"city": canon, "region": region, "state": state}
            return {"city": None, "region": "Orange County", "state": state}
        return {"city": city, "region": region, "state": state}

    try:
        import sys
        from pathlib import Path

        root = Path(__file__).resolve().parents[2]
        fb = str(root / "scripts" / "facebook-collector")
        if fb not in sys.path:
            sys.path.insert(0, fb)
        from geo_price_enrichment import extract_city_from_text  # type: ignore

        hit = extract_city_from_text(sample)
        if hit:
            if hit.lower() == "orange county":
                return {"city": None, "region": "Orange County", "state": "CA"}
            return {"city": hit, "region": None, "state": "CA"}
    except Exception:  # noqa: BLE001
        pass
    return None


def merge_city_with_group(**kwargs: Any) -> dict[str, Any]:
    """Fill city/region/county from text mention, then source group."""
    text = kwargs.get("text")
    base = _merge_base(**kwargs)
    from_text = location_from_text(text) if text else None
    if from_text:
        if not base.get("city") and from_text.get("city"):
            base["city"] = from_text["city"]
        if not base.get("region") and from_text.get("region"):
            base["region"] = from_text["region"]
        if not base.get("state") and from_text.get("state"):
            base["state"] = from_text["state"]
    return base


__all__ = [
    "location_from_group",
    "location_from_text",
    "merge_city_with_group",
]
