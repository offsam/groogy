#!/usr/bin/env python3
"""
Bulk-load enriched entity cards into businesses (+ optional offers).
Temporary fill — status approved so cards show in the catalog.

Usage:
  python3 scripts/business-seed/import-enriched-entities.py
"""

from __future__ import annotations

import importlib.util
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent / "data" / "enriched_entities_batch_1.json"

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
    "beauty": "beauty",
    "fitness": "medical",
    "automotive": "auto",
    "home services": "services",
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
    value = unicodedata.normalize("NFKD", text)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value[:80] or "entity"


def normalize_phone(raw) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if not raw:
        return None
    text = str(raw).strip()
    if not text or "?" in text:
        return None
    digits = re.sub(r"\D", "", text)
    if len(digits) == 10:
        return f"+1-{digits[0:3]}-{digits[3:6]}-{digits[6:]}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+1-{digits[1:4]}-{digits[4:7]}-{digits[7:]}"
    return text


def offer_slug(title: str) -> str:
    return slugify(title)[:80]


def build_description(entity: dict) -> str:
    parts: list[str] = []
    if entity.get("description"):
        parts.append(str(entity["description"]).strip())
    if entity.get("display_name"):
        parts.append(f"Display name: {entity['display_name']}")
    if entity.get("contact_person"):
        parts.append(f"Contact: {entity['contact_person']}")
    if entity.get("experience_years") is not None:
        parts.append(f"Experience: {entity['experience_years']} years")
    if entity.get("service_area"):
        parts.append("Service area: " + ", ".join(entity["service_area"]))
    if entity.get("services"):
        parts.append("Services:\n- " + "\n- ".join(entity["services"]))
    if entity.get("offers"):
        parts.append("Offers: " + ", ".join(entity["offers"]))
    if entity.get("features"):
        parts.append("Features:\n- " + "\n- ".join(entity["features"]))
    if entity.get("target_audience"):
        parts.append("Audience: " + ", ".join(entity["target_audience"]))
    if entity.get("monthly_price") is not None:
        parts.append(
            f"Monthly: ${entity['monthly_price']} {entity.get('currency') or 'USD'}"
            + (f", deposit ${entity['deposit']}" if entity.get("deposit") is not None else "")
        )
    if entity.get("vehicle_make"):
        parts.append(
            f"Vehicle: {entity.get('vehicle_year')} {entity.get('vehicle_make')} {entity.get('vehicle_model')}"
        )
    parts.append(
        "---ENRICHED_SOURCE---\n"
        + json.dumps(entity, ensure_ascii=False, sort_keys=True)
    )
    return "\n\n".join(parts)


def to_business(entity: dict) -> dict:
    name = (entity.get("display_name") or entity.get("entity_name") or "").strip()
    category_slug = CATEGORY_MAP.get((entity.get("category") or "").strip().lower(), "services")
    state = (entity.get("state") or "").strip().upper() or None
    website = entity.get("website") or entity.get("booking_url")
    short = (entity.get("description") or entity.get("subcategory") or "")[:300] or None
    return {
        "slug": "enriched-" + slugify(entity.get("entity_name") or name),
        "category_id": CATEGORY_IDS[category_slug],
        "name": name[:200],
        "short_description": short,
        "description": build_description(entity),
        "status": "approved",
        "phone": normalize_phone(entity.get("phone")),
        "website": (str(website).strip() if website else None),
        "address_line": (str(entity["address"]).strip() if entity.get("address") else None),
        "city": (str(entity["city"]).strip() if entity.get("city") else None),
        "region": state,
        "state_code": f"US-{state}" if state and len(state) == 2 else None,
        "entity": entity,
    }


def upsert_business(row: dict) -> str:
    sql = f"""
    insert into public.businesses (
      slug, category_id, name, short_description, description, status,
      phone, website, image_url, address_line, city, region,
      state_code, city_geoid, latitude, longitude
    ) values (
      {sql_literal(row['slug'])},
      {sql_literal(row['category_id'])},
      {sql_literal(row['name'])},
      {sql_literal(row['short_description'])},
      {sql_literal(row['description'])},
      {sql_literal(row['status'])},
      {sql_literal(row['phone'])},
      {sql_literal(row['website'])},
      null,
      {sql_literal(row['address_line'])},
      {sql_literal(row['city'])},
      {sql_literal(row['region'])},
      {sql_literal(row['state_code'])},
      null, null, null
    )
    on conflict (slug) do update set
      category_id = excluded.category_id,
      name = excluded.name,
      short_description = excluded.short_description,
      description = excluded.description,
      status = excluded.status,
      phone = excluded.phone,
      website = excluded.website,
      address_line = excluded.address_line,
      city = excluded.city,
      region = excluded.region,
      state_code = excluded.state_code,
      updated_at = now()
    returning id, slug;
    """
    result = sb.sql(sql)
    return result[0]["id"]


def upsert_offers(business_id: str, entity: dict) -> int:
    created = 0
    prices = entity.get("prices") or []
    price_by_service = {
        p.get("service"): p for p in prices if isinstance(p, dict) and p.get("service")
    }

    # Named priced services
    for item in prices:
        title = item.get("service")
        if not title:
            continue
        slug = offer_slug(title)
        amount = item.get("price")
        sql = f"""
        insert into public.business_offers (
          business_id, offer_type, title, slug, short_description, description,
          status, visibility, price_mode, price_amount, currency, price_unit,
          sort_order, is_available, attributes, published_at
        ) values (
          {sql_literal(business_id)},
          'service',
          {sql_literal(title)},
          {sql_literal(slug)},
          {sql_literal(title)},
          null,
          'active', 'public', 'fixed',
          {sql_literal(amount)},
          {sql_literal(item.get('currency') or 'USD')},
          'service',
          {created},
          true,
          '{{}}'::jsonb,
          now()
        )
        on conflict (business_id, slug) do update set
          title = excluded.title,
          price_mode = excluded.price_mode,
          price_amount = excluded.price_amount,
          currency = excluded.currency,
          status = 'active',
          published_at = coalesce(business_offers.published_at, now()),
          updated_at = now();
        """
        sb.sql(sql)
        created += 1

    # Car rental as rental offer
    if entity.get("entity_type") == "car_rental" and entity.get("monthly_price") is not None:
        title = entity.get("entity_name") or "Vehicle Rental"
        attrs = {
            "rental_period": "month",
            "deposit_amount": entity.get("deposit"),
            "availability_note": ", ".join(entity.get("features") or [])[:500] or None,
        }
        attrs = {k: v for k, v in attrs.items() if v is not None}
        sql = f"""
        insert into public.business_offers (
          business_id, offer_type, title, slug, short_description,
          status, visibility, price_mode, price_amount, currency, price_unit,
          sort_order, is_available, attributes, published_at
        ) values (
          {sql_literal(business_id)},
          'rental',
          {sql_literal(title)},
          {sql_literal(offer_slug(title))},
          {sql_literal(f"{entity.get('vehicle_year')} {entity.get('vehicle_make')} {entity.get('vehicle_model')}")},
          'active', 'public', 'fixed',
          {sql_literal(entity.get('monthly_price'))},
          {sql_literal(entity.get('currency') or 'USD')},
          'month',
          0, true,
          {sql_literal(attrs)},
          now()
        )
        on conflict (business_id, slug) do update set
          price_amount = excluded.price_amount,
          attributes = excluded.attributes,
          status = 'active',
          published_at = coalesce(business_offers.published_at, now()),
          updated_at = now();
        """
        sb.sql(sql)
        created += 1

    # Unpriced service list (skip ones already covered by prices)
    for idx, service in enumerate(entity.get("services") or []):
        if service in price_by_service:
            continue
        # Skip huge handyman lists as individual offers — too noisy; only first 8
        if entity.get("entity_type") == "handyman" and idx >= 8:
            break
        slug = offer_slug(service)
        sql = f"""
        insert into public.business_offers (
          business_id, offer_type, title, slug, short_description,
          status, visibility, price_mode, currency, price_unit,
          sort_order, is_available, attributes, published_at
        ) values (
          {sql_literal(business_id)},
          'service',
          {sql_literal(service)},
          {sql_literal(slug)},
          {sql_literal(service)},
          'active', 'public', 'contact', 'USD', 'service',
          {100 + idx}, true, '{{}}'::jsonb, now()
        )
        on conflict (business_id, slug) do update set
          status = 'active',
          published_at = coalesce(business_offers.published_at, now()),
          updated_at = now();
        """
        sb.sql(sql)
        created += 1

    return created


def main() -> int:
    entities = json.loads(DATA.read_text(encoding="utf-8"))
    print(f"loading {len(entities)} entities from {DATA.name}")
    for entity in entities:
        row = to_business(entity)
        biz_id = upsert_business(row)
        offers_n = upsert_offers(biz_id, entity)
        print(f"OK {row['slug']} id={biz_id} offers={offers_n} phone={row['phone']}")

    totals = sb.sql(
        """
        select
          count(*) filter (where slug like 'enriched-%')::int as enriched,
          count(*) filter (where slug like 'enriched-%' and status='approved')::int as approved
        from public.businesses
        """
    )[0]
    print("totals", totals)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
