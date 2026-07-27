"""Map Telegram/Facebook group names → city/region when the post has no location."""

from __future__ import annotations

import re
from typing import Any

# (pattern, city, region) — city OR region filled; never invent street addresses.
_GROUP_RULES: list[tuple[re.Pattern[str], str | None, str | None]] = [
    (
        re.compile(
            r"la[_\s-]?orange\s*county|orange\s*county|orangecounty|\boc\b|fun\s*for\s*mom",
            re.I,
        ),
        None,
        "Orange County",
    ),
    (
        re.compile(r"los\s*angeles|\bla\b|russian\.?la|full_group|glendale", re.I),
        "Los Angeles",
        "Los Angeles County",
    ),
    (
        re.compile(r"sacramento|russian\.?sacramento|сакраменто", re.I),
        "Sacramento",
        "Sacramento County",
    ),
    (
        re.compile(r"san\s*diego|sandiego", re.I),
        "San Diego",
        "San Diego County",
    ),
    (
        re.compile(r"san\s*francisco|\bsf\b|bay\s*area|russiansf|сан[\s-]?франциско", re.I),
        "San Francisco",
        "San Francisco County",
    ),
]

_COUNTY_AS_CITY = re.compile(
    r"^(orange\s+county|oc|оранж\s*каунти|los\s+angeles\s+county|san\s+diego\s+county)$",
    re.I,
)


def location_from_group(*parts: str | None) -> dict[str, str | None] | None:
    blob = " ".join(p for p in parts if p).strip()
    if not blob:
        return None
    for pattern, city, region in _GROUP_RULES:
        if pattern.search(blob):
            return {"city": city, "region": region, "state": "CA"}
    return None


def merge_city_with_group(
    *,
    city: str | None,
    state: str | None = None,
    source_group: str | None = None,
    source: str | None = None,
    chat_title: str | None = None,
    address_line: str | None = None,
) -> dict[str, Any]:
    """Fill missing city/region from the source group.

    When the post has a street but no city, the group metro wins
    (Russian.Sacramento → Sacramento) so geocoders don't pick Buena Park.
    Never invents a street address.
    """
    city_out = (city or "").strip() or None
    state_out = (state or "").strip() or None
    region_out: str | None = None

    # County typed as city → region
    if city_out and _COUNTY_AS_CITY.match(city_out):
        region_out = (
            "Orange County"
            if re.match(r"^(oc|orange|оранж)", city_out, re.I)
            else city_out
        )
        city_out = None

    from_group = location_from_group(source_group, source, chat_title)

    street_only = bool((address_line or "").strip()) and not city_out
    if (not city_out and not region_out) or street_only:
        if from_group:
            if not city_out:
                city_out = from_group.get("city")
            if not region_out:
                region_out = from_group.get("region")
            if not state_out:
                state_out = from_group.get("state")
    elif not region_out and from_group and from_group.get("region"):
        region_out = from_group.get("region")
        if not state_out:
            state_out = from_group.get("state")

    if region_out and not state_out:
        state_out = region_out

    return {
        "city": city_out,
        "state": region_out or state_out,
        "region": region_out,
    }
