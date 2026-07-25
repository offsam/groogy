#!/usr/bin/env python3
"""
Import Facebook entity dataset into public.businesses.

Replaces demo catalog rows. Uses existing schema only.
Upsert key: slug (fb-post-{source_post_number})
Status: pending (Pending Review)

Usage:
  python3 scripts/business-seed/import-facebook-entities.py
  python3 scripts/business-seed/import-facebook-entities.py --dry-run
  python3 scripts/business-seed/import-facebook-entities.py --keep-existing
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FILE = (
    Path(__file__).resolve().parent / "data" / "facebook_entities_posts_1_41.json"
)

spec = importlib.util.spec_from_file_location("sb_sql", ROOT / "scripts" / "sb_sql.py")
sb = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(sb)

# Existing platform category IDs (PACK 2.5A / MVP seed).
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
    "food & specialty products": "groceries",
    "food & catering": "restaurants",
    "beauty services": "beauty",
    "beauty & personal care": "beauty",
    "automotive": "auto",
    "transportation": "auto",
    "health & wellness": "medical",
    "fitness & wellness": "medical",
    "wellness & fitness": "medical",
    "legal services": "legal",
    "legal & tax services": "legal",
    "legal & licensing": "legal",
    "education": "education",
    "insurance": "services",
    "real estate": "services",
    "commercial real estate": "services",
    "home services": "services",
    "construction": "services",
    "business services": "services",
    "professional services": "services",
    "digital marketing": "services",
    "logistics & delivery": "services",
    "moving & logistics": "services",
    "employment": "services",
    "entertainment": "services",
}


def sql_literal(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def slugify(text: str, fallback: str) -> str:
    value = unicodedata.normalize("NFKD", text)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return (value or fallback)[:80]


def clean_phone(phone_field) -> str | None:
    if phone_field is None:
        return None
    values = phone_field if isinstance(phone_field, list) else [phone_field]
    for raw in values:
        if raw is None:
            continue
        text = str(raw).strip()
        if not text or "?" in text:
            continue
        return text
    return None


def map_category(category: str | None) -> str:
    if not category:
        return "services"
    return CATEGORY_MAP.get(category.strip().lower(), "services")


def build_description(entity: dict) -> str:
    parts: list[str] = []
    if entity.get("description"):
        parts.append(str(entity["description"]).strip())
    if entity.get("original_text"):
        parts.append("Original post:\n" + str(entity["original_text"]).strip())
    # Preserve full Facebook source record without schema changes.
    parts.append(
        "---FACEBOOK_SOURCE---\n"
        + json.dumps(entity, ensure_ascii=False, sort_keys=True)
    )
    return "\n\n".join(parts)


def short_description(entity: dict) -> str | None:
    text = (entity.get("description") or entity.get("subcategory") or "").strip()
    if not text:
        return None
    return text[:300]


def validate_entity(entity: object, index: int) -> tuple[dict | None, str | None]:
    if not isinstance(entity, dict):
        return None, f"[{index}] not an object"
    name = (entity.get("entity_name") or "").strip()
    if not name:
        return None, f"[{index}] missing entity_name"
    post_number = entity.get("source_post_number")
    if post_number is None:
        return None, f"[{index}] missing source_post_number ({name})"
    try:
        post_number = int(post_number)
    except (TypeError, ValueError):
        return None, f"[{index}] invalid source_post_number ({name})"
    if post_number < 1:
        return None, f"[{index}] source_post_number < 1 ({name})"
    return entity, None


def to_business_row(entity: dict, disambiguator: int = 0) -> dict:
    post_number = int(entity["source_post_number"])
    name = str(entity["entity_name"]).strip()
    category_slug = map_category(entity.get("category"))
    state = (entity.get("state") or "").strip().upper() or None
    region = state
    state_code = f"US-{state}" if state and len(state) == 2 else None
    website = (entity.get("website") or entity.get("facebook_page") or None)
    if website:
        website = str(website).strip() or None

    name_slug = slugify(name, f"entity-{post_number}")
    if disambiguator > 0:
        slug = f"fb-post-{post_number}-{name_slug}"[:80]
    else:
        slug = f"fb-post-{post_number}-{name_slug}"[:80]

    return {
        "slug": slug,
        "category_id": CATEGORY_IDS[category_slug],
        "name": name[:200],
        "short_description": short_description(entity),
        "description": build_description(entity),
        "status": "pending",
        "phone": clean_phone(entity.get("phone")),
        "website": website,
        "image_url": None,
        "address_line": (str(entity["address"]).strip() if entity.get("address") else None),
        "city": (str(entity["city"]).strip() if entity.get("city") else None),
        "region": region,
        "state_code": state_code,
        "city_geoid": None,
        "latitude": None,
        "longitude": None,
        "source_post_number": post_number,
    }


def row_values(row: dict) -> str:
    return (
        "("
        + ", ".join(
            [
                sql_literal(row["slug"]),
                sql_literal(row.get("category_id")),
                sql_literal(row["name"]),
                sql_literal(row.get("short_description")),
                sql_literal(row.get("description")),
                sql_literal(row.get("status") or "pending"),
                sql_literal(row.get("phone")),
                sql_literal(row.get("website")),
                sql_literal(row.get("image_url")),
                sql_literal(row.get("address_line")),
                sql_literal(row.get("city")),
                sql_literal(row.get("region")),
                sql_literal(row.get("state_code")),
                sql_literal(row.get("city_geoid")),
                sql_literal(row.get("latitude")),
                sql_literal(row.get("longitude")),
            ]
        )
        + ")"
    )


UPSERT_SQL = """
insert into public.businesses (
  slug, category_id, name, short_description, description, status,
  phone, website, image_url, address_line, city, region,
  state_code, city_geoid, latitude, longitude
) values
{values}
on conflict (slug) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  short_description = excluded.short_description,
  description = excluded.description,
  status = excluded.status,
  phone = excluded.phone,
  website = excluded.website,
  image_url = excluded.image_url,
  address_line = excluded.address_line,
  city = excluded.city,
  region = excluded.region,
  state_code = excluded.state_code,
  city_geoid = excluded.city_geoid,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  updated_at = now()
returning slug, (xmax = 0) as inserted;
"""


def load_and_validate(path: Path) -> tuple[list[dict], list[str]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON: {exc}") from exc

    if not isinstance(payload, list):
        raise SystemExit("expected top-level JSON array")

    rows: list[dict] = []
    errors: list[str] = []
    seen_slugs: set[str] = set()
    post_counts: dict[int, int] = {}

    for index, entity in enumerate(payload):
        valid, err = validate_entity(entity, index)
        if err:
            errors.append(err)
            continue
        assert valid is not None
        post_number = int(valid["source_post_number"])
        disambiguator = post_counts.get(post_number, 0)
        post_counts[post_number] = disambiguator + 1
        row = to_business_row(valid, disambiguator=disambiguator)
        if row["slug"] in seen_slugs:
            errors.append(f"[{index}] duplicate slug {row['slug']}")
            continue
        seen_slugs.add(row["slug"])
        rows.append(row)

    return rows, errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE)
    parser.add_argument("--batch-size", type=int, default=40)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--keep-existing",
        action="store_true",
        help="Do not delete non-Facebook (demo) businesses before import",
    )
    args = parser.parse_args()

    rows, errors = load_and_validate(args.file)
    print(f"file={args.file}")
    print(f"valid={len(rows)} skipped={len(errors)}")
    for err in errors:
        print(f"VALIDATION: {err}")

    if args.dry_run:
        print("dry-run sample:", rows[0]["slug"] if rows else None)
        return 0

    deleted = 0
    if not args.keep_existing:
        # Remove demo / previous catalog rows that are not Facebook imports.
        result = sb.sql(
            """
            with doomed as (
              delete from public.businesses
              where slug not like 'fb-post-%'
              returning id
            )
            select count(*)::int as deleted from doomed
            """
        )
        deleted = result[0]["deleted"] if result else 0
        print(f"deleted_non_facebook={deleted}")

    imported = 0
    inserted = 0
    updated = 0
    failed = 0

    for i in range(0, len(rows), args.batch_size):
        batch = rows[i : i + args.batch_size]
        values = ",\n".join(row_values(b) for b in batch)
        try:
            result = sb.sql(UPSERT_SQL.format(values=values))
            imported += len(batch)
            if isinstance(result, list):
                for item in result:
                    if item.get("inserted"):
                        inserted += 1
                    else:
                        updated += 1
            print(f"upserted {imported}/{len(rows)}")
        except Exception as exc:  # noqa: BLE001
            failed += len(batch)
            print(f"FAILED batch starting at {i}: {exc}")

    # Re-import pass for duplicates reporting: existing fb-post slugs that
    # matched on conflict count as updated (duplicates avoided).
    totals = sb.sql(
        """
        select
          count(*)::int as total,
          count(*) filter (where status = 'pending')::int as pending,
          count(*) filter (where status = 'approved')::int as approved,
          count(*) filter (where slug like 'fb-post-%')::int as facebook
        from public.businesses
        """
    )[0]

    print("--- import summary ---")
    print(f"imported={imported}")
    print(f"inserted={inserted}")
    print(f"updated_duplicates_avoided={updated}")
    print(f"skipped_validation={len(errors)}")
    print(f"failed={failed}")
    print(f"deleted_non_facebook={deleted}")
    print(f"db_total={totals['total']}")
    print(f"db_pending={totals['pending']}")
    print(f"db_approved={totals['approved']}")
    print(f"db_facebook={totals['facebook']}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
