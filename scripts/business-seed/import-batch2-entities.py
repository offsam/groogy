#!/usr/bin/env python3
"""
Import facebook_entities_batch_2.json:
  - 20 new stub cards (batch2-*)
  - apply updates[] notes onto existing canonical businesses (no new duplicates)

Usage:
  python3 scripts/business-seed/import-batch2-entities.py
  python3 scripts/business-seed/import-batch2-entities.py --dry-run
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent / "data" / "facebook_entities_batch_2.json"

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
    "homemade food delivery": "restaurants",
    "homemade desserts": "restaurants",
    "handmade sweets": "restaurants",
    "grocery store": "groceries",
    "lash artist": "beauty",
    "auto broker / leasing": "auto",
    "towing service": "auto",
    "car audio / automotive": "auto",
    "appliance repair": "auto",
    "handyman": "services",
    "travel tours": "services",
    "premium taxi": "services",
    "caregiver job": "services",
    "house assistant job": "services",
    "event desserts request": "services",
    "entertainment event": "services",
    "legal services": "legal",
    "medical education": "education",
    "health & wellness": "medical",
}

# Prefer keeping these out of public catalog until richer data arrives.
PENDING_CATEGORY_HINTS = (
    "job",
    "request",
    "entertainment event",
)

UPDATE_TARGETS = {
    "anastasia kinder": "consolidated-anastasia-kinder-nails",
    "valeriia andriushchenko": "consolidated-valeriia-andriushchenko",
    "neptune seafood": "fb-post-29-neptune-fish-company",
    "artur arutiunov / car towing": "batch2-car-towing",
    "art 4 kids & teens": "consolidated-art4kidsandteens",
    "grand auto group oc": "grand-auto-group",
    "grand auto group": "grand-auto-group",
    "valeriia realtor": "fb-post-19-valeriia-the-realtor-property-listing",
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
    return (value or "item")[:60]


def catalog_category(raw: str) -> str:
    return CATEGORY_MAP.get((raw or "").strip().lower(), "services")


def default_status(category: str) -> str:
    c = (category or "").lower()
    if any(h in c for h in PENDING_CATEGORY_HINTS):
        return "pending"
    return "approved"


def display_name(entity: dict) -> str:
    name = (entity.get("name") or "").strip()
    contact = (entity.get("contact") or "").strip()
    if contact and contact.lower() not in name.lower():
        return f"{name} ({contact})"
    return name


def build_description(entity: dict) -> str:
    parts: list[str] = []
    cat = entity.get("category")
    if cat:
        parts.append(f"Category: {cat}")
    if entity.get("contact"):
        parts.append(f"Contact: {entity['contact']}")
    parts.append(
        "---BATCH2_SOURCE---\n"
        + json.dumps(entity, ensure_ascii=False, sort_keys=True)
    )
    return "\n\n".join(parts)


def upsert_business(
    *,
    slug: str,
    name: str,
    category_raw: str,
    short_description: str,
    description: str,
    status: str,
    dry_run: bool,
) -> None:
    category_id = CATEGORY_IDS[catalog_category(category_raw)]
    sql = f"""
    insert into public.businesses (
      slug, name, short_description, description, status, category_id,
      phone, website, image_url, address_line, city, region, latitude, longitude,
      created_at, updated_at
    ) values (
      {sql_literal(slug)},
      {sql_literal(name)},
      {sql_literal(short_description)},
      {sql_literal(description)},
      {sql_literal(status)}::content_status,
      {sql_literal(category_id)}::uuid,
      null, null, null, null, null, null, null, null,
      now(), now()
    )
    on conflict (slug) do update set
      name = excluded.name,
      short_description = excluded.short_description,
      description = excluded.description,
      status = excluded.status,
      category_id = excluded.category_id,
      updated_at = now()
    returning slug, status;
    """
    if dry_run:
        print(f"  DRY {slug} [{status}] {name}")
        return
    row = sb.sql(sql)[0]
    print(f"  OK {row['slug']} [{row['status']}]")


def append_update_note(slug: str, entity_label: str, changes: list[str], dry_run: bool) -> bool:
    rows = sb.sql(
        f"select id, description from public.businesses where slug = {sql_literal(slug)} limit 1"
    )
    if not rows:
        print(f"  MISS update target {slug} ({entity_label})")
        return False
    note = (
        "---BATCH2_UPDATES---\n"
        + json.dumps(
            {"entity": entity_label, "changes": changes},
            ensure_ascii=False,
        )
    )
    desc = rows[0].get("description") or ""
    if "---BATCH2_UPDATES---" in desc and entity_label in desc:
        # replace prior batch2 update block for this entity if present
        desc = re.sub(
            r"\n*\n---BATCH2_UPDATES---\n\{[^\n]*\"entity\":\s*\""
            + re.escape(entity_label)
            + r"\"[^\n]*\}",
            "",
            desc,
            count=1,
        )
    new_desc = (desc.rstrip() + "\n\n" + note).strip()
    if dry_run:
        print(f"  DRY update {slug}: {changes}")
        return True
    sb.sql(
        f"""
        update public.businesses
        set description = {sql_literal(new_desc)}, updated_at = now()
        where slug = {sql_literal(slug)}
        """
    )
    print(f"  UPDATED {slug}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    batch = json.loads(DATA.read_text())
    print(f"Batch 2: {batch.get('entity_count_new')} new, {batch.get('updates_count')} updates\n")

    print("=== New entities ===")
    for entity in batch.get("new_entities") or []:
        name = display_name(entity)
        base = slugify(entity.get("name") or name)
        slug = f"batch2-{base}"
        cat = entity.get("category") or "services"
        status = default_status(cat)
        short = cat
        if entity.get("contact"):
            short = f"{cat} · {entity['contact']}"
        upsert_business(
            slug=slug,
            name=name,
            category_raw=cat,
            short_description=short[:280],
            description=build_description(entity),
            status=status,
            dry_run=args.dry_run,
        )

    # Ksenia appears only in updates — create stub if missing
    print("\n=== Ensure update-only entities ===")
    ksenia = {
        "name": "Ksenia Andreychenko / Taxes VIP",
        "category": "Legal Services",
    }
    ksenia_slug = "batch2-ksenia-andreychenko-taxes-vip"
    existing = sb.sql(
        f"select slug from public.businesses where slug = {sql_literal(ksenia_slug)} limit 1"
    )
    if not existing:
        upsert_business(
            slug=ksenia_slug,
            name=ksenia["name"],
            category_raw=ksenia["category"],
            short_description=ksenia["category"],
            description=build_description(ksenia),
            status="approved",
            dry_run=args.dry_run,
        )
    else:
        print(f"  exists {ksenia_slug}")

    print("\n=== Apply updates ===")
    targets = dict(UPDATE_TARGETS)
    targets["ksenia andreychenko / taxes vip"] = ksenia_slug
    for upd in batch.get("updates") or []:
        key = (upd.get("entity") or "").strip().lower()
        slug = targets.get(key)
        if not slug:
            print(f"  SKIP unmapped {upd.get('entity')!r}")
            continue
        append_update_note(slug, upd["entity"], upd.get("changes") or [], args.dry_run)

    if not args.dry_run:
        stats = sb.sql(
            """
            select
              count(*) filter (where slug like 'batch2-%')::int as batch2,
              count(*) filter (where slug like 'batch2-%' and status='approved')::int as batch2_approved,
              count(*) filter (where status='approved')::int as approved_total
            from public.businesses
            """
        )[0]
        print("\nStats:", stats)


if __name__ == "__main__":
    main()
