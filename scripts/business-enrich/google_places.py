"""Google Places lookup for business enrichment.

Uses GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY (Maps/Places key).
Do NOT use GOOGLE_API_KEY here — that is the Gemini key in this project.

Places API (New): Text Search + Place Details.
Enable "Places API (New)" in Google Cloud for the project that owns the key.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

UA = "Mozilla/5.0 (compatible; KrugiPlacesEnrich/1.0; +https://krugi.app)"

SEARCH_FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.rating",
        "places.userRatingCount",
        "places.googleMapsUri",
        "places.businessStatus",
        "places.types",
        "places.nationalPhoneNumber",
        "places.internationalPhoneNumber",
        "places.websiteUri",
    ]
)

DETAILS_FIELD_MASK = ",".join(
    [
        "id",
        "displayName",
        "formattedAddress",
        "location",
        "rating",
        "userRatingCount",
        "googleMapsUri",
        "businessStatus",
        "nationalPhoneNumber",
        "internationalPhoneNumber",
        "websiteUri",
        "regularOpeningHours",
        "addressComponents",
    ]
)


def maps_api_key() -> str | None:
    for name in ("GOOGLE_MAPS_API_KEY", "GOOGLE_PLACES_API_KEY"):
        val = (os.environ.get(name) or "").strip()
        if val:
            return val
    return None


def _post_json(
    url: str,
    body: dict[str, Any],
    *,
    key: str,
    field_mask: str,
    timeout: int = 30,
) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "User-Agent": UA,
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": field_mask,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:500]
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc


def _get_json(
    url: str,
    *,
    key: str,
    field_mask: str,
    timeout: int = 30,
) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": field_mask,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:500]
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc


def phone_digits(value: str | None) -> str:
    d = re.sub(r"\D", "", value or "")
    if len(d) == 11 and d.startswith("1"):
        return d[1:]
    return d


def normalize_name(value: str | None) -> str:
    s = (value or "").lower()
    s = re.sub(r"[^\w\s]", " ", s, flags=re.U)
    s = re.sub(r"\s+", " ", s).strip()
    for noise in (
        " llc",
        " inc",
        " ltd",
        " co",
        " the ",
        " studio",
        " salon",
        " clinic",
    ):
        s = s.replace(noise, " ")
    return re.sub(r"\s+", " ", s).strip()


def name_similarity(a: str, b: str) -> float:
    ta = set(normalize_name(a).split())
    tb = set(normalize_name(b).split())
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    return inter / max(len(ta), len(tb))


def _normalize_place(place: dict[str, Any]) -> dict[str, Any]:
    """Map Places API (New) fields onto the shapes used by scorers / patchers."""
    out = dict(place)
    pid = place.get("id") or place.get("place_id") or ""
    if isinstance(pid, str) and pid.startswith("places/"):
        pid = pid.split("/", 1)[1]
    out["place_id"] = pid or place.get("place_id")
    display = place.get("displayName")
    if isinstance(display, dict):
        out["name"] = display.get("text") or out.get("name")
    elif isinstance(display, str):
        out["name"] = display
    if place.get("formattedAddress") and not out.get("formatted_address"):
        out["formatted_address"] = place["formattedAddress"]
    if place.get("nationalPhoneNumber") and not out.get("formatted_phone_number"):
        out["formatted_phone_number"] = place["nationalPhoneNumber"]
    if place.get("internationalPhoneNumber") and not out.get(
        "international_phone_number"
    ):
        out["international_phone_number"] = place["internationalPhoneNumber"]
    if place.get("websiteUri") and not out.get("website"):
        out["website"] = place["websiteUri"]
    if place.get("googleMapsUri") and not out.get("url"):
        out["url"] = place["googleMapsUri"]
    if place.get("userRatingCount") is not None and out.get("user_ratings_total") is None:
        out["user_ratings_total"] = place["userRatingCount"]
    if place.get("businessStatus") and not out.get("business_status"):
        out["business_status"] = place["businessStatus"]
    loc = place.get("location")
    if isinstance(loc, dict):
        lat = loc.get("latitude")
        lng = loc.get("longitude")
        if lat is not None and lng is not None:
            out["geometry"] = {"location": {"lat": lat, "lng": lng}}
    return out


def places_text_search(
    query: str,
    *,
    key: str,
    location: str | None = None,
) -> list[dict[str, Any]]:
    q = query.strip()
    if location and location.strip().lower() not in q.lower():
        q = f"{q} {location.strip()}"
    body: dict[str, Any] = {
        "textQuery": q,
        "languageCode": "en",
        "regionCode": "US",
        "pageSize": 5,
    }
    data = _post_json(
        "https://places.googleapis.com/v1/places:searchText",
        body,
        key=key,
        field_mask=SEARCH_FIELD_MASK,
    )
    return [_normalize_place(p) for p in (data.get("places") or [])]


def places_details(place_id: str, *, key: str) -> dict[str, Any]:
    pid = place_id.strip()
    if pid.startswith("places/"):
        pid = pid.split("/", 1)[1]
    data = _get_json(
        f"https://places.googleapis.com/v1/places/{urllib.parse.quote(pid, safe='')}",
        key=key,
        field_mask=DETAILS_FIELD_MASK,
    )
    return _normalize_place(data)


def parse_street_from_formatted(address: str | None) -> str | None:
    if not address:
        return None
    # "24000 Alicia Parkway #31, Mission Viejo, CA 92691, USA"
    first = address.split(",")[0].strip()
    if re.search(r"^\d{1,6}\s+\S+", first):
        return first[:160]
    return None


def parse_city_state(address: str | None) -> tuple[str | None, str | None]:
    if not address:
        return None, None
    m = re.search(
        r",\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s*\d{0,5}",
        address,
    )
    if not m:
        return None, None
    city = m.group(1).strip()
    if city.lower() in {"usa", "united states"}:
        return None, None
    return city[:80], f"US-{m.group(2)}"


def score_candidate(
    biz: dict[str, Any],
    place: dict[str, Any],
) -> tuple[float, list[str]]:
    reasons: list[str] = []
    score = 0.0
    pname = place.get("name") or (place.get("displayName") or {}).get("text") or ""
    sim = name_similarity(str(biz.get("name") or ""), str(pname))
    score += sim * 50
    if sim >= 0.8:
        reasons.append(f"name:{sim:.2f}")
    elif sim >= 0.45:
        reasons.append(f"name_partial:{sim:.2f}")

    biz_phone = phone_digits(biz.get("phone"))
    place_phone = phone_digits(
        place.get("formatted_phone_number")
        or place.get("international_phone_number")
        or place.get("nationalPhoneNumber")
    )
    if biz_phone and place_phone and biz_phone == place_phone:
        score += 40
        reasons.append("phone_match")

    biz_host = None
    website = (biz.get("website") or "").strip()
    if website:
        try:
            host = urllib.parse.urlparse(
                website if "://" in website else f"https://{website}"
            ).hostname or ""
            biz_host = host.lower().removeprefix("www.")
        except Exception:
            biz_host = None
    place_web = (place.get("website") or place.get("websiteUri") or "").strip()
    if biz_host and place_web:
        try:
            ph = urllib.parse.urlparse(place_web).hostname or ""
            ph = ph.lower().removeprefix("www.")
            if ph == biz_host or biz_host in ph or ph in biz_host:
                score += 25
                reasons.append("website_match")
        except Exception:
            pass

    status = (place.get("business_status") or place.get("businessStatus") or "").upper()
    if status in {"CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"}:
        score -= 30
        reasons.append(status.lower())

    return score, reasons


def pick_best_place(
    biz: dict[str, Any],
    places: list[dict[str, Any]],
    *,
    min_score: float = 50.0,
) -> dict[str, Any] | None:
    ranked: list[tuple[float, list[str], dict[str, Any]]] = []
    for p in places:
        score, reasons = score_candidate(biz, p)
        ranked.append((score, reasons, p))
    ranked.sort(key=lambda x: -x[0])
    if not ranked:
        return None
    best_score, best_reasons, best = ranked[0]
    # Unique strong name match is enough even without phone/website boost.
    strong_name = any(r.startswith("name:1.") or r.startswith("name:0.8") for r in best_reasons)
    if best_score < min_score and not (len(ranked) == 1 and strong_name and best_score >= 40):
        return {
            "decision": "reject_low_score",
            "score": best_score,
            "reasons": best_reasons,
            "candidates": len(ranked),
            "top_name": best.get("name"),
        }
    # franchise / ambiguous: two strong different addresses
    if len(ranked) >= 2 and ranked[1][0] >= min_score:
        a1 = (best.get("formatted_address") or "").split(",")[0].strip().lower()
        a2 = (ranked[1][2].get("formatted_address") or "").split(",")[0].strip().lower()
        if a1 and a2 and a1 != a2 and "phone_match" not in best_reasons:
            return {
                "decision": "doubtful_multi_location",
                "score": best_score,
                "reasons": best_reasons,
                "candidates": len(ranked),
                "top_name": best.get("name"),
                "addresses": [
                    best.get("formatted_address"),
                    ranked[1][2].get("formatted_address"),
                ],
                "place": best,
            }
    return {
        "decision": "accept",
        "score": best_score,
        "reasons": best_reasons,
        "candidates": len(ranked),
        "place": best,
    }


def lookup_business_places(
    biz: dict[str, Any],
    *,
    key: str,
    sleep_s: float = 0.25,
) -> dict[str, Any]:
    name = (biz.get("name") or "").strip()
    if not name:
        return {"decision": "skip_no_name"}
    city = (biz.get("city") or "").strip()
    location = None
    if city and city.lower() not in {"orange county", "oc", "los angeles county"}:
        location = f"{city}, CA, USA"
    elif city:
        location = "Orange County, CA, USA"
    else:
        location = "California, USA"

    query = name
    phone = (biz.get("phone") or "").strip()
    if phone:
        query = f"{name} {phone}"
    website = (biz.get("website") or "").strip()
    if website:
        try:
            host = urllib.parse.urlparse(
                website if "://" in website else f"https://{website}"
            ).hostname or ""
            host = host.lower().removeprefix("www.")
            if host and host not in query.lower():
                query = f"{query} {host}"
        except Exception:
            pass

    results = places_text_search(query, key=key, location=location)
    time.sleep(sleep_s)
    if not results and phone:
        results = places_text_search(name, key=key, location=location)
        time.sleep(sleep_s)
    if not results and website:
        results = places_text_search(name, key=key, location=location)
        time.sleep(sleep_s)

    picked = pick_best_place(biz, results)
    if not picked:
        return {"decision": "zero_results", "query": query, "location": location}
    if picked.get("decision") != "accept":
        return {**picked, "query": query, "location": location}

    place = picked["place"]
    place_id = place.get("place_id")
    details: dict[str, Any] = {}
    # Details costs a second quota unit — only fetch when hours are missing
    # and Search Text didn't already return them.
    need_hours = not biz.get("opening_hours") and not place.get("regularOpeningHours")
    if place_id and need_hours:
        try:
            details = places_details(str(place_id), key=key)
            time.sleep(sleep_s)
        except Exception as exc:  # noqa: BLE001
            details = {"_details_error": str(exc)[:200]}

    merged = {**place, **{k: v for k, v in details.items() if v}}
    return {
        **picked,
        "query": query,
        "location": location,
        "place": merged,
    }


def _opening_hours_from_place(place: dict[str, Any]) -> dict[str, Any] | None:
    """Convert Places regularOpeningHours into a simple JSON blob for businesses.opening_hours."""
    hours = place.get("regularOpeningHours") or place.get("opening_hours")
    if not isinstance(hours, dict):
        return None
    weekday = hours.get("weekdayDescriptions") or hours.get("weekday_text")
    if weekday:
        return {"weekday_text": list(weekday)[:14]}
    periods = hours.get("periods")
    if periods:
        return {"periods": periods}
    return None


def place_to_fill_empty_patch(
    biz: dict[str, Any],
    place: dict[str, Any],
    *,
    allow_address: bool = True,
) -> dict[str, Any]:
    """Only fill empty business fields from a Places match."""
    patch: dict[str, Any] = {}
    sources: dict[str, str] = {}

    formatted = place.get("formatted_address") or place.get("formattedAddress")
    street = parse_street_from_formatted(formatted)
    city, state_code = parse_city_state(formatted)

    if allow_address and street and not biz.get("address_line"):
        patch["address_line"] = street
        sources["address_line"] = "google_places"
    if city and (
        not biz.get("city")
        or str(biz.get("city")).lower() in {"orange county", "oc", "los angeles"}
    ):
        patch["city"] = city
        sources["city"] = "google_places"
    if state_code and not biz.get("state_code"):
        patch["state_code"] = state_code
        sources["state_code"] = "google_places"

    loc = (place.get("geometry") or {}).get("location") or place.get("location") or {}
    lat = loc.get("lat") if isinstance(loc, dict) else None
    lng = loc.get("lng") if isinstance(loc, dict) else None
    # New Places API shape
    if lat is None and isinstance(loc, dict):
        lat = loc.get("latitude")
        lng = loc.get("longitude")
    if lat is not None and lng is not None and biz.get("latitude") is None:
        patch["latitude"] = float(lat)
        patch["longitude"] = float(lng)
        patch["location_precision"] = "street" if street else "city"
        sources["geo"] = "google_places"

    rating = place.get("rating") or place.get("totalScore")
    reviews = place.get("user_ratings_total") or place.get("userRatingCount") or place.get(
        "reviewsCount"
    )
    if rating is not None and not biz.get("google_rating"):
        patch["google_rating"] = float(rating)
        sources["google_rating"] = "google_places"
    if reviews is not None and not (biz.get("google_reviews_count") or 0):
        patch["google_reviews_count"] = int(reviews)
        sources["google_reviews_count"] = "google_places"

    maps_url = place.get("url") or place.get("googleMapsUri")
    if maps_url and not biz.get("google_maps_url"):
        patch["google_maps_url"] = str(maps_url)[:500]
        sources["google_maps_url"] = "google_places"
    elif street and not biz.get("google_maps_url"):
        q = urllib.parse.quote(f"{street}, {city or ''}, CA")
        patch["google_maps_url"] = f"https://www.google.com/maps/search/?api=1&query={q}"
        sources["google_maps_url"] = "google_places_query"

    phone = (
        place.get("international_phone_number")
        or place.get("formatted_phone_number")
        or place.get("internationalPhoneNumber")
        or place.get("nationalPhoneNumber")
    )
    if phone and not biz.get("phone"):
        digits = phone_digits(phone)
        if len(digits) == 10:
            patch["phone"] = f"+1{digits}"
            sources["phone"] = "google_places"

    website = place.get("website") or place.get("websiteUri")
    if website and not biz.get("website"):
        host = (urllib.parse.urlparse(website).hostname or "").lower()
        if host and "facebook.com" not in host and "instagram.com" not in host:
            patch["website"] = website.split("?")[0][:300]
            sources["website"] = "google_places"

    if not biz.get("opening_hours"):
        hours = _opening_hours_from_place(place)
        if hours:
            patch["opening_hours"] = hours
            sources["opening_hours"] = "google_places"

    return {"patch": patch, "sources": sources}
