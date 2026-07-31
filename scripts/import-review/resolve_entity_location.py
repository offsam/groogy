"""USA Location Canon — resolve county for import rows (Python twin of resolve-entity-location.ts)."""

from __future__ import annotations

import re
from typing import Any

from source_location_groups import location_from_group

_COUNTY_AS_CITY = re.compile(
    r"^(orange\s+county|oc|оранж\s*каунти|los\s+angeles\s+county|"
    r"san\s+diego\s+county|sacramento\s+county|bay\s+area|"
    r".+\s+county)$",
    re.I,
)

_ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")


def _is_county_label(value: str | None) -> bool:
    if not value or not value.strip():
        return False
    v = value.strip().lower().replace("  ", " ")
    return bool(_COUNTY_AS_CITY.match(v)) or v in {
        "oc",
        "orange county",
        "оранж каунти",
        "bay area",
    }


def merge_city_with_group(
    *,
    city: str | None,
    state: str | None = None,
    source_group: str | None = None,
    source: str | None = None,
    chat_title: str | None = None,
    chat_id: str | None = None,
    address_line: str | None = None,
    text: str | None = None,
    postal_code: str | None = None,
) -> dict[str, Any]:
    """Fill missing city/region/county from post text, then source group.

    Priority: explicit city → group metro. Never invents a street address.
    ZIP/city DB resolution happens on the TS approve path; Python fills group fallback.
    """
    city_out = (city or "").strip() or None
    state_out = (state or "").strip() or None
    region_out: str | None = None
    county_geoid: str | None = None
    location_source: str | None = None
    postal = (postal_code or "").strip() or None
    if not postal and text:
        # Prefer ZIP after a state abbr; never the leading house number.
        m = re.search(r"\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b", text)
        if not m:
            m = re.search(
                r",\s*[A-Za-z .'\-]{2,40}\s*,\s*[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b",
                text,
            )
        if m:
            postal = m.group(1)

    if city_out and _is_county_label(city_out):
        region_out = (
            "Orange County"
            if re.match(r"^(oc|orange|оранж)", city_out, re.I)
            else city_out
        )
        city_out = None

    from_group = location_from_group(chat_id, source_group, source, chat_title)

    street_only = bool((address_line or "").strip()) and not city_out
    if (not city_out and not region_out) or street_only:
        if from_group:
            if not city_out:
                city_out = from_group.get("city")
            if not region_out:
                region_out = from_group.get("region")
            county_geoid = from_group.get("county_geoid")
            location_source = "source_group"
            if not state_out:
                state_out = from_group.get("state") or from_group.get("state_code")
    else:
        if not region_out and from_group:
            region_out = from_group.get("region")
            if not county_geoid:
                county_geoid = from_group.get("county_geoid")
                location_source = "source_group"
        if not state_out and from_group:
            state_out = from_group.get("state") or from_group.get("state_code")

    if region_out and not state_out:
        state_out = region_out

    return {
        "city": city_out,
        "state": region_out or state_out,
        "region": region_out,
        "county_geoid": county_geoid,
        "location_source": location_source,
        "postal_code": postal,
    }
