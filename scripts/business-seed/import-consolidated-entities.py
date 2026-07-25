#!/usr/bin/env python3
"""
Import consolidated Facebook entities (18) as approved catalog cards + offers.
Fills every available field into description / offers. Idempotent by slug.

Usage:
  python3 scripts/business-seed/import-consolidated-entities.py
"""

from __future__ import annotations

import importlib.util
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent / "data" / "facebook_entities_consolidated_18.json"

spec = importlib.util.spec_from_file_location("sb_sql", ROOT / "scripts" / "sb_sql.py")
sb = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(sb)

CATEGORY_IDS = {
    "restaurants": "a1000001-0000-4000-8000-000000000001",
    "groceries": "a1000001-0000-4000-8000-000000000002",
    "beauty": "a1000001-0000-4000-8000-000000000003",
    "auto": "a1000001-0000-4000-8000-000000000004",
    "medical": "a1000001-0000-4000-8000-000000000005",
    "legal": "a1000001-0000-4000-8000-000000000006",
    "education": "a1000001-0000-4000-8000-000000000007",
    "services": "a1000001-0000-4000-8000-000000000008",
}

CATEGORY_MAP = {
    "real estate": "services",
    "commercial real estate": "services",
    "fitness & wellness": "medical",
    "food & catering": "restaurants",
    "beauty services": "beauty",
    "entertainment": "services",
    "legal services": "legal",
    "home services": "services",
    "accounting & tax": "legal",
    "automotive": "auto",
    "recreation": "services",
    "document & consular services": "services",
    "healthcare": "medical",
    "education": "education",
}


def sql_literal(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def slugify(text: str) -> str:
    value = unicodedata.normalize("NFKD", str(text))
    value = value.encode("ascii", "ignore").decode("ascii").lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return (value or "item")[:80]


def first_phone(entity: dict) -> str | None:
    phones = entity.get("phones") or []
    if isinstance(phones, str):
        phones = [phones]
    for raw in phones:
        if not raw:
            continue
        text = str(raw).strip()
        if text and "?" not in text:
            return text
    return None


def first_address(entity: dict) -> tuple[str | None, str | None, str | None]:
    city = entity.get("city")
    state = entity.get("state")
    address_line = None
    addresses = entity.get("addresses") or []
    if addresses and isinstance(addresses, list):
        a0 = addresses[0]
        if isinstance(a0, str):
            address_line = a0
        elif isinstance(a0, dict):
            address_line = a0.get("line") or a0.get("address") or a0.get("street")
            city = a0.get("city") or city
            state = a0.get("state") or state
    return address_line, city, state


def as_text_list(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        return [value]
    out: list[str] = []
    for item in value:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            out.append(
                item.get("name")
                or item.get("title")
                or item.get("text")
                or json.dumps(item, ensure_ascii=False)
            )
        else:
            out.append(str(item))
    return out


def build_description(entity: dict) -> str:
    parts: list[str] = []
    if entity.get("description"):
        parts.append(str(entity["description"]).strip())
    if entity.get("business_name"):
        parts.append(f"Business: {entity['business_name']}")
    if entity.get("organization"):
        org = entity["organization"]
        parts.append(
            f"Organization: {org if isinstance(org, str) else json.dumps(org, ensure_ascii=False)}"
        )
    if entity.get("contact_person"):
        parts.append(f"Contact person: {entity['contact_person']}")
    if entity.get("entity_type"):
        parts.append(f"Type: {entity['entity_type']}")
    if entity.get("subcategory"):
        parts.append(f"Subcategory: {entity['subcategory']}")
    if entity.get("experience_years") is not None:
        parts.append(f"Experience: {entity['experience_years']} years")
    emails = as_text_list(entity.get("emails"))
    if emails:
        parts.append("Email: " + ", ".join(emails))
    if entity.get("instagram"):
        parts.append(f"Instagram: {entity['instagram']}")
    messengers = entity.get("messengers") or {}
    if messengers:
        parts.append(
            "Messengers: "
            + ", ".join(f"{k}={v}" for k, v in messengers.items() if v)
        )
    if entity.get("licenses"):
        parts.append("Licenses: " + json.dumps(entity["licenses"], ensure_ascii=False))
    memberships = as_text_list(entity.get("professional_memberships"))
    if memberships:
        parts.append("Memberships: " + ", ".join(memberships))
    specialties = as_text_list(entity.get("specialties"))
    if specialties:
        parts.append("Specialties: " + ", ".join(specialties))
    if entity.get("insurance"):
        parts.append("Insurance: " + json.dumps(entity["insurance"], ensure_ascii=False))
    if entity.get("accepting_new_patients") is not None:
        parts.append(f"Accepting new patients: {entity['accepting_new_patients']}")
    payment_methods = as_text_list(entity.get("payment_methods"))
    if payment_methods:
        parts.append("Payment methods: " + ", ".join(payment_methods))
    payment_options = as_text_list(entity.get("payment_options"))
    if payment_options:
        parts.append("Payment options: " + ", ".join(payment_options))
    features = as_text_list(entity.get("features"))
    if features:
        parts.append("Features:\n- " + "\n- ".join(features))
    audience = as_text_list(entity.get("target_audience"))
    if audience:
        parts.append("Audience: " + ", ".join(audience))
    promotions = as_text_list(entity.get("promotions"))
    if promotions:
        parts.append("Promotions: " + ", ".join(promotions))
    services = as_text_list(entity.get("services"))
    if services:
        parts.append("Services:\n- " + "\n- ".join(services))
    if entity.get("products"):
        parts.append("Products:\n" + json.dumps(entity["products"], ensure_ascii=False, indent=2))
    if entity.get("pricing"):
        parts.append("Pricing:\n" + json.dumps(entity["pricing"], ensure_ascii=False, indent=2))
    if entity.get("real_estate_listings"):
        parts.append(
            "Listings:\n"
            + json.dumps(entity["real_estate_listings"], ensure_ascii=False, indent=2)
        )
    if entity.get("rentals"):
        parts.append("Rentals:\n" + json.dumps(entity["rentals"], ensure_ascii=False, indent=2))
    if entity.get("events"):
        parts.append("Events:\n" + json.dumps(entity["events"], ensure_ascii=False, indent=2))
    if entity.get("jobs"):
        parts.append("Jobs:\n" + json.dumps(entity["jobs"], ensure_ascii=False, indent=2))
    authors = as_text_list(entity.get("source_authors"))
    if authors:
        parts.append("Source authors: " + ", ".join(authors))
    parts.append(
        "---CONSOLIDATED_SOURCE---\n"
        + json.dumps(entity, ensure_ascii=False, sort_keys=True)
    )
    return "\n\n".join(parts)


def upsert_business(entity: dict) -> str:
    eid = entity["id"]
    name = (entity.get("entity_name") or eid).strip()
    category_slug = CATEGORY_MAP.get(
        (entity.get("category") or "").strip().lower(), "services"
    )
    address_line, city, state = first_address(entity)
    state = (state or "").strip().upper() or None
    phone = first_phone(entity)
    website = entity.get("website")
    short = (entity.get("description") or entity.get("subcategory") or "")[:300] or None
    slug = f"consolidated-{eid}"[:80]

    sql = f"""
    insert into public.businesses (
      slug, category_id, name, short_description, description, status,
      phone, website, image_url, address_line, city, region,
      state_code, city_geoid, latitude, longitude
    ) values (
      {sql_literal(slug)},
      {sql_literal(CATEGORY_IDS[category_slug])},
      {sql_literal(name[:200])},
      {sql_literal(short)},
      {sql_literal(build_description(entity))},
      'approved',
      {sql_literal(phone)},
      {sql_literal(website)},
      null,
      {sql_literal(address_line)},
      {sql_literal(city)},
      {sql_literal(state)},
      {sql_literal(f'US-{state}' if state and len(state)==2 else None)},
      null, null, null
    )
    on conflict (slug) do update set
      category_id = excluded.category_id,
      name = excluded.name,
      short_description = excluded.short_description,
      description = excluded.description,
      status = 'approved',
      phone = excluded.phone,
      website = excluded.website,
      address_line = excluded.address_line,
      city = excluded.city,
      region = excluded.region,
      state_code = excluded.state_code,
      updated_at = now()
    returning id;
    """
    return sb.sql(sql)[0]["id"]


def upsert_offer(
    business_id: str,
    *,
    offer_type: str,
    title: str,
    slug: str,
    short: str | None,
    price_mode: str,
    price_amount=None,
    price_min=None,
    price_max=None,
    price_unit: str | None = "service",
    currency: str = "USD",
    sort_order: int = 0,
    attributes: dict | None = None,
) -> None:
    attrs = attributes or {}
    sql = f"""
    insert into public.business_offers (
      business_id, offer_type, title, slug, short_description, description,
      status, visibility, price_mode, price_amount, price_min, price_max,
      currency, price_unit, sort_order, is_available, attributes, published_at
    ) values (
      {sql_literal(business_id)},
      {sql_literal(offer_type)},
      {sql_literal(title[:160])},
      {sql_literal(slug[:80])},
      {sql_literal((short or title)[:300])},
      null,
      'active', 'public',
      {sql_literal(price_mode)},
      {sql_literal(price_amount)},
      {sql_literal(price_min)},
      {sql_literal(price_max)},
      {sql_literal(currency)},
      {sql_literal(price_unit)},
      {sort_order},
      true,
      {sql_literal(attrs)},
      now()
    )
    on conflict (business_id, slug) do update set
      offer_type = excluded.offer_type,
      title = excluded.title,
      short_description = excluded.short_description,
      price_mode = excluded.price_mode,
      price_amount = excluded.price_amount,
      price_min = excluded.price_min,
      price_max = excluded.price_max,
      currency = excluded.currency,
      price_unit = excluded.price_unit,
      attributes = excluded.attributes,
      status = 'active',
      published_at = coalesce(business_offers.published_at, now()),
      updated_at = now();
    """
    sb.sql(sql)


def create_offers(business_id: str, entity: dict) -> int:
    n = 0
    priced_names: set[str] = set()

    for i, item in enumerate(entity.get("pricing") or []):
        if not isinstance(item, dict):
            continue
        title = item.get("name") or item.get("service") or f"Price {i+1}"
        priced_names.add(title)
        amount = item.get("price")
        price_from = item.get("price_from")
        price_to = item.get("price_to")
        currency = item.get("currency") or "USD"
        if amount is not None:
            mode, pa, pmin, pmax = "fixed", amount, None, None
        elif price_from is not None and price_to is not None:
            mode, pa, pmin, pmax = "range", None, price_from, price_to
        elif price_from is not None:
            mode, pa, pmin, pmax = "from", price_from, price_from, None
        else:
            mode, pa, pmin, pmax = "contact", None, None, None
        upsert_offer(
            business_id,
            offer_type="service",
            title=title,
            slug=slugify(title),
            short=title,
            price_mode=mode,
            price_amount=pa,
            price_min=pmin,
            price_max=pmax,
            currency=currency,
            sort_order=n,
        )
        n += 1

    for i, service in enumerate(as_text_list(entity.get("services"))):
        if service in priced_names:
            continue
        upsert_offer(
            business_id,
            offer_type="service",
            title=service,
            slug=slugify(service),
            short=service,
            price_mode="contact",
            sort_order=100 + i,
        )
        n += 1

    for i, product in enumerate(entity.get("products") or []):
        if isinstance(product, str):
            title, amount, currency = product, None, "USD"
            mode = "contact"
        else:
            title = product.get("name") or product.get("title") or f"Product {i+1}"
            amount = product.get("price")
            currency = product.get("currency") or "USD"
            mode = "fixed" if amount is not None else "contact"
        upsert_offer(
            business_id,
            offer_type="product",
            title=title,
            slug=slugify(title),
            short=title,
            price_mode=mode,
            price_amount=amount,
            currency=currency,
            price_unit="item",
            sort_order=200 + i,
            attributes={
                k: product.get(k)
                for k in ("sku", "brand", "model", "condition")
                if isinstance(product, dict) and product.get(k) is not None
            },
        )
        n += 1

    for i, listing in enumerate(entity.get("real_estate_listings") or []):
        if not isinstance(listing, dict):
            continue
        title_bits = [
            listing.get("property_type") or "Property",
            listing.get("city") or "",
        ]
        title = " — ".join(b for b in title_bits if b).strip(" —")
        if listing.get("bedrooms"):
            title = f"{title} ({listing['bedrooms']} bed)"
        attrs = {
            k: listing.get(k)
            for k in (
                "listing_type",
                "property_type",
                "address",
                "city",
                "state",
                "zip",
                "bedrooms",
                "bathrooms",
                "sqft",
                "lot_size",
                "year_built",
                "mls_number",
            )
            if listing.get(k) is not None
        }
        if listing.get("square_feet") is not None:
            attrs["sqft"] = listing["square_feet"]
        if "listing_type" not in attrs:
            attrs["listing_type"] = "sale"
        price = listing.get("price")
        upsert_offer(
            business_id,
            offer_type="property",
            title=title[:160],
            slug=slugify(f"listing-{i}-{title}"),
            short=title,
            price_mode="fixed" if price is not None else "contact",
            price_amount=price,
            price_unit="item",
            sort_order=300 + i,
            attributes=attrs,
        )
        n += 1

    for i, rental in enumerate(entity.get("rentals") or []):
        if isinstance(rental, str):
            title = rental
            amount = None
            attrs = {}
        else:
            title = rental.get("name") or rental.get("title") or f"Rental {i+1}"
            amount = rental.get("price") or rental.get("monthly_price")
            attrs = {
                k: rental.get(k)
                for k in (
                    "rental_period",
                    "deposit_amount",
                    "minimum_duration",
                    "availability_note",
                    "capacity",
                )
                if rental.get(k) is not None
            }
            if rental.get("deposit") is not None:
                attrs["deposit_amount"] = rental["deposit"]
        upsert_offer(
            business_id,
            offer_type="rental",
            title=title,
            slug=slugify(f"rental-{title}"),
            short=title,
            price_mode="fixed" if amount is not None else "contact",
            price_amount=amount,
            price_unit="month",
            sort_order=400 + i,
            attributes=attrs,
        )
        n += 1

    for i, event in enumerate(entity.get("events") or []):
        if isinstance(event, str):
            title = event
            amount = None
        else:
            title = event.get("name") or event.get("title") or f"Event {i+1}"
            amount = event.get("price")
        upsert_offer(
            business_id,
            offer_type="other",
            title=title,
            slug=slugify(f"event-{title}"),
            short=title,
            price_mode="fixed" if amount is not None else "contact",
            price_amount=amount,
            price_unit="person",
            sort_order=500 + i,
        )
        n += 1

    return n


def main() -> int:
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    entities = payload.get("entities") or []
    print(f"loading {len(entities)} consolidated entities")
    for entity in entities:
        biz_id = upsert_business(entity)
        offers_n = create_offers(biz_id, entity)
        print(
            f"OK consolidated-{entity['id']} "
            f"name={entity.get('entity_name')!r} "
            f"phone={first_phone(entity)!r} offers={offers_n}"
        )

    totals = sb.sql(
        """
        select
          count(*) filter (where slug like 'consolidated-%')::int as businesses,
          count(*) filter (where slug like 'consolidated-%' and status='approved')::int as approved
        from public.businesses
        """
    )[0]
    offers = sb.sql(
        """
        select count(*)::int as offers
        from public.business_offers o
        join public.businesses b on b.id = o.business_id
        where b.slug like 'consolidated-%'
        """
    )[0]
    print("totals", totals, offers)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
