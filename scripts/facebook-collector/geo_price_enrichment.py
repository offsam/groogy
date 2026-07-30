"""Safe prices[] + city fill for Facebook pipeline (post-text only).

Fills EMPTY fields after classification. Does not touch media, website/IG
enrichment, LLM prompts, or Telegram analyzers. No free-form NLP / addresses /
service_area inference.
"""

from __future__ import annotations

import re
from typing import Any

SOURCE = "post_text_rules"

# Canonical display names for the platform launch market (CA).
# Matched case-insensitively with word boundaries; longest names first.
SOCAL_CITIES: tuple[str, ...] = (
    # Los Angeles County
    "Los Angeles",
    "Hollywood",
    "West Hollywood",
    "North Hollywood",
    "Studio City",
    "Sherman Oaks",
    "Encino",
    "Tarzana",
    "Woodland Hills",
    "Canoga Park",
    "Chatsworth",
    "Northridge",
    "Reseda",
    "Van Nuys",
    "Burbank",
    "Glendale",
    "Pasadena",
    "Santa Monica",
    "Beverly Hills",
    "Culver City",
    "Inglewood",
    "Torrance",
    "Long Beach",
    "Manhattan Beach",
    "Redondo Beach",
    "Hermosa Beach",
    "El Segundo",
    # Orange County
    "Anaheim",
    "Orange",
    "Santa Ana",
    "Irvine",
    "Tustin",
    "Costa Mesa",
    "Newport Beach",
    "Huntington Beach",
    "Fountain Valley",
    "Westminster",
    "Garden Grove",
    "Cypress",
    "Buena Park",
    "Fullerton",
    "Placentia",
    "Yorba Linda",
    "Brea",
    "Mission Viejo",
    "Lake Forest",
    "Laguna Hills",
    "Laguna Niguel",
    "Laguna Beach",
    "Aliso Viejo",
    "Rancho Santa Margarita",
    "San Clemente",
    "Dana Point",
    "Orange County",
    # San Diego County
    "San Diego",
    "La Jolla",
    "Chula Vista",
    "National City",
    "El Cajon",
    "La Mesa",
    "Santee",
    "Poway",
    "Escondido",
    "San Marcos",
    "Vista",
    "Oceanside",
    "Carlsbad",
    "Encinitas",
    "Solana Beach",
    "Del Mar",
    # Inland Empire
    "Riverside",
    "Corona",
    "Norco",
    "Eastvale",
    "Moreno Valley",
    "Perris",
    "Jurupa Valley",
    "Ontario",
    "Rancho Cucamonga",
    "Fontana",
    "Upland",
    "Chino Hills",
    "Chino",
    "Redlands",
    "Highland",
    "San Bernardino",
    "Beaumont",
    "Banning",
    "Temecula",
    "Murrieta",
    "Menifee",
)

# Raw price snippets only — no normalization of amount/currency.
# Covers: $20, 20$, от $90, от 90$, $20/hour, $20/час, $20 per hour, 20$ в час
PRICE_RE = re.compile(
    r"""
    (?:от\s+)?\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?
      (?:\s*(?:/\s*(?:час|hour|hr)|per\s+hour|в\s+час))?
    |
    (?:от\s+)?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*\$
      (?:\s*(?:/\s*(?:час|hour|hr)|per\s+hour|в\s+час))?
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _city_patterns() -> list[tuple[str, re.Pattern[str]]]:
    """Longest canonical name first so 'West Hollywood' wins over 'Hollywood'."""
    ordered = sorted(SOCAL_CITIES, key=lambda c: len(c), reverse=True)
    out: list[tuple[str, re.Pattern[str]]] = []
    for name in ordered:
        parts = [re.escape(p) for p in name.split()]
        body = r"\s+".join(parts)
        out.append((name, re.compile(rf"(?<![A-Za-z]){body}(?![A-Za-z])", re.I)))
    return out


_CITY_PATTERNS = _city_patterns()


def extract_prices_from_text(text: str) -> list[str]:
    """Return unique raw price matches in appearance order."""
    found: list[str] = []
    seen: set[str] = set()
    for match in PRICE_RE.finditer(text or ""):
        raw = match.group(0).strip()
        if not raw:
            continue
        key = re.sub(r"\s+", " ", raw.lower())
        if key in seen:
            continue
        seen.add(key)
        found.append(raw)
    return found


def extract_city_from_text(text: str) -> str | None:
    """Best dictionary hit: longest name wins; ties → later span (e.g. neighborhood)."""
    hits: list[tuple[int, int, str]] = []
    for canonical, pattern in _CITY_PATTERNS:
        match = pattern.search(text or "")
        if match:
            hits.append((len(canonical), match.start(), canonical))
    if not hits:
        return None
    hits.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return hits[0][2]


def _prices_empty(entity: dict[str, Any]) -> bool:
    prices = entity.get("prices")
    if prices is None:
        return True
    if isinstance(prices, list):
        return not any(str(p).strip() for p in prices)
    if isinstance(prices, str):
        return not prices.strip()
    return True


def _city_empty(entity: dict[str, Any]) -> bool:
    city = entity.get("city")
    return city is None or (isinstance(city, str) and not city.strip())


def enrich_prices_and_city(
    posts: list[dict[str, Any]],
    *,
    enabled: bool = True,
) -> dict[str, Any]:
    """Fill empty prices[] / city from post text. Never raises."""
    stats: dict[str, Any] = {
        "enabled": enabled,
        "posts": len(posts),
        "prices_filled": 0,
        "city_filled": 0,
        "price_values": {},
        "city_values": {},
        "errors": 0,
    }
    if not enabled:
        return stats

    for post in posts:
        try:
            entity = post.get("extracted_entity")
            if not isinstance(entity, dict):
                entity = {}
            text = post.get("merged_text") or post.get("text") or ""
            sources = dict(entity.get("field_sources") or {})
            applied: list[str] = []

            if _prices_empty(entity):
                prices = extract_prices_from_text(text)
                if prices:
                    entity["prices"] = prices
                    sources["prices"] = SOURCE
                    applied.append("prices")
                    stats["prices_filled"] += 1
                    for p in prices:
                        stats["price_values"][p] = stats["price_values"].get(p, 0) + 1

            if _city_empty(entity):
                city = extract_city_from_text(text)
                if city:
                    entity["city"] = city
                    sources["city"] = SOURCE
                    applied.append("city")
                    stats["city_filled"] += 1
                    stats["city_values"][city] = stats["city_values"].get(city, 0) + 1

            if sources:
                entity["field_sources"] = sources
            post["extracted_entity"] = entity
            if applied:
                post.setdefault("enrichments", []).append(
                    {
                        "source": SOURCE,
                        "status": "ok",
                        "fields_applied": applied,
                        "prices": entity.get("prices") if "prices" in applied else None,
                        "city": entity.get("city") if "city" in applied else None,
                    }
                )
        except Exception:
            stats["errors"] += 1
            post.setdefault("enrichments", []).append(
                {"source": SOURCE, "status": "error"}
            )

    return stats
