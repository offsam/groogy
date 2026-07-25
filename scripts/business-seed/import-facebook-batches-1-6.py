#!/usr/bin/env python3
"""
Import facebook entity batches 1–6 (richer stubs with phones/services).

Rules:
  - Deduplicate within the pack by normalized name (merge fields).
  - If phone or strong name matches an existing business → enrich that row.
  - Otherwise insert slug fbpack-{name-slug} as approved.
  - Never overwrite ratings / review counters.
  - Idempotent by slug + enrich path.

Usage:
  python3 scripts/business-seed/import-facebook-batches-1-6.py
  python3 scripts/business-seed/import-facebook-batches-1-6.py --dry-run
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(__file__).resolve().parent / "data" / "facebook-batches-1-6"

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
    "automotive": "auto",
    "real estate": "services",
    "beauty": "beauty",
    "beauty wellness": "beauty",
    "events": "services",
    "professional services": "services",
    "food": "restaurants",
    "retail food": "groceries",
    "home services": "services",
    "travel": "services",
    "legal services": "legal",
    "transportation": "services",
    "education": "education",
    "sports education": "education",
    "fashion services": "services",
    "creative services": "services",
    "care services": "services",
    "health": "medical",
    "healthcare": "medical",
    "entertainment": "services",
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


def norm_phone(raw) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        for item in raw:
            hit = norm_phone(item)
            if hit:
                return hit
        return None
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) >= 10 else None


def format_phone(raw) -> str | None:
    digits = norm_phone(raw)
    if not digits:
        return None
    if len(digits) == 10:
        return f"+1-{digits[0:3]}-{digits[3:6]}-{digits[6:]}"
    return f"+{digits}"


def norm_name(name: str) -> str:
    n = (name or "").lower()
    n = re.sub(r"[^a-z0-9а-яё]+", " ", n, flags=re.I)
    for w in (
        "inc",
        "llc",
        "realtor",
        "los angeles",
        "condo",
        "nail studio",
        "art classes",
        "desserts",
        "summer night",
    ):
        n = re.sub(rf"\b{re.escape(w)}\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def catalog_category(raw: str) -> str:
    return CATEGORY_MAP.get((raw or "").strip().lower(), "services")


def to_state_code(raw: str | None) -> str | None:
    if not raw:
        return None
    text = str(raw).strip().upper()
    if re.fullmatch(r"US-[A-Z]{2}", text):
        return text
    if re.fullmatch(r"[A-Z]{2}", text):
        return f"US-{text}"
    return None


def parse_location(entity: dict) -> tuple[str | None, str | None, str | None]:
    """Returns city, state_code (US-XX), address_line."""
    address = entity.get("address")
    if isinstance(address, str) and address.strip():
        parts = [p.strip() for p in address.split(",") if p.strip()]
        city = None
        state = None
        if len(parts) >= 2:
            tail = parts[-1]
            m = re.search(r"\b([A-Za-z .]+?)\s+([A-Z]{2})\b", tail)
            if m:
                city = m.group(1).strip()
                state = to_state_code(m.group(2))
            else:
                city = tail
        return city, state, address.strip()

    loc = entity.get("location")
    if isinstance(loc, list) and loc:
        loc = loc[0]
    if isinstance(loc, str) and loc.strip():
        text = loc.strip()
        m = re.match(r"^(.+?)\s+([A-Z]{2})$", text)
        if m:
            return m.group(1).strip(), to_state_code(m.group(2)), None
        if text.lower() in {"orange county", "los angeles", "san diego"}:
            return text, "US-CA", None
        # Do not invent a state — wrong state makes geocoding land in the wrong place.
        return text, None, None

    locations = entity.get("locations")
    if isinstance(locations, list) and locations:
        return parse_location({"location": locations[0]})

    return None, None, None


def website_from(entity: dict) -> str | None:
    w = entity.get("website")
    if not w:
        return None
    w = str(w).strip()
    if not w:
        return None
    if not w.startswith("http"):
        w = "https://" + w
    return w


def merge_entity(a: dict, b: dict) -> dict:
    out = dict(a)
    for k, v in b.items():
        if k.startswith("_"):
            continue
        if v in (None, "", [], {}):
            continue
        cur = out.get(k)
        if cur in (None, "", [], {}):
            out[k] = v
        elif k == "services" and isinstance(cur, list) and isinstance(v, list):
            seen = set(cur)
            for item in v:
                if item not in seen:
                    cur.append(item)
                    seen.add(item)
            out[k] = cur
        elif k == "phone":
            # keep list of all phones
            phones = []
            for src in (cur, v):
                if isinstance(src, list):
                    phones.extend(src)
                else:
                    phones.append(src)
            # unique by digits
            uniq = []
            seen = set()
            for p in phones:
                d = norm_phone(p)
                if d and d not in seen:
                    seen.add(d)
                    uniq.append(p)
            out[k] = uniq[0] if len(uniq) == 1 else uniq
        elif k in ("_files",):
            continue
    files = list(dict.fromkeys((a.get("_files") or []) + (b.get("_files") or [])))
    out["_files"] = files
    return out


def build_description(entity: dict) -> str:
    parts: list[str] = []
    if entity.get("subcategory"):
        parts.append(f"{entity.get('category') or 'Business'} · {entity['subcategory']}")
    elif entity.get("category"):
        parts.append(str(entity["category"]))
    if entity.get("company"):
        parts.append(f"Company: {entity['company']}")
    if entity.get("license"):
        parts.append(f"License: {entity['license']}")
    if entity.get("contact_person"):
        parts.append(f"Contact: {entity['contact_person']}")
    if entity.get("email"):
        parts.append(f"Email: {entity['email']}")
    if entity.get("instagram"):
        ig = str(entity["instagram"]).lstrip("@")
        parts.append(f"Instagram: @{ig}")
    services = entity.get("services") or []
    if services:
        parts.append("Services:\n- " + "\n- ".join(str(s) for s in services))
    parts.append(
        "---FBPACK_SOURCE---\n"
        + json.dumps(
            {k: v for k, v in entity.items() if not k.startswith("_")},
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return "\n\n".join(parts)


def short_description(entity: dict) -> str:
    services = entity.get("services") or []
    if services:
        return ", ".join(str(s) for s in services[:3])[:280]
    sub = entity.get("subcategory") or entity.get("category") or ""
    return str(sub)[:280]


def load_merged_entities() -> list[dict]:
    files = sorted(DATA_DIR.glob("batch_*.json"))
    if not files:
        raise SystemExit(f"No batch files in {DATA_DIR}")

    by_name: dict[str, dict] = {}
    for path in files:
        payload = json.loads(path.read_text())
        for entity in payload.get("entities") or []:
            name = (entity.get("name") or "").strip()
            if not name:
                continue
            item = dict(entity)
            item["_files"] = [path.name]
            key = norm_name(name) or name.lower()
            if key in by_name:
                by_name[key] = merge_entity(by_name[key], item)
            else:
                by_name[key] = item
    return list(by_name.values())


def load_db_rows() -> list[dict]:
    return sb.sql(
        """
        select id, slug, name, phone, website, city, address_line, status,
               description, short_description, category_id
        from public.businesses
        where status <> 'archived'
        """
    )


def find_existing(entity: dict, rows: list[dict]) -> dict | None:
    ph = norm_phone(entity.get("phone"))
    if ph:
        for r in rows:
            if norm_phone(r.get("phone")) == ph:
                return r

    nn = norm_name(entity.get("name") or "")
    if not nn:
        return None

    # Prefer consolidated / enriched / batch2 over fb-post pending
    scored: list[tuple[int, dict]] = []
    for r in rows:
        rn = norm_name(r.get("name") or "")
        if not rn:
            continue
        if nn == rn or nn in rn or rn in nn:
            score = 0
            slug = r.get("slug") or ""
            if slug.startswith("consolidated-"):
                score += 30
            elif slug.startswith("enriched-"):
                score += 20
            elif slug.startswith("batch2-"):
                score += 15
            elif slug.startswith("fbpack-"):
                score += 12
            if r.get("status") == "approved":
                score += 10
            scored.append((score, r))
    if not scored:
        return None
    scored.sort(key=lambda x: -x[0])
    return scored[0][1]


def enrich_existing(row: dict, entity: dict, dry_run: bool) -> None:
    city, state, address = parse_location(entity)
    phone = format_phone(entity.get("phone"))
    website = website_from(entity)

    desc = row.get("description") or ""
    new_block = build_description(entity)
    if "---FBPACK_SOURCE---" in desc:
        desc = desc.split("---FBPACK_SOURCE---", 1)[0].rstrip()
        # also drop trailing services section from prior pack rebuilds if present
        desc = (desc.rstrip() + "\n\n" + new_block).strip()
    else:
        desc = (desc.rstrip() + "\n\n" + new_block).strip() if desc else new_block

    short = row.get("short_description") or short_description(entity)
    if not short or len(short) < 8:
        short = short_description(entity)

    sets = [
        f"description = {sql_literal(desc)}",
        f"short_description = {sql_literal(short[:280])}",
        "updated_at = now()",
    ]
    if phone and not row.get("phone"):
        sets.append(f"phone = {sql_literal(phone)}")
    if website and not row.get("website"):
        sets.append(f"website = {sql_literal(website)}")
    if city and not row.get("city"):
        sets.append(f"city = {sql_literal(city)}")
    if address and not row.get("address_line"):
        sets.append(f"address_line = {sql_literal(address)}")
    if state:
        sets.append(f"state_code = coalesce(nullif(btrim(state_code), ''), {sql_literal(state)})")

    # If pending stub from batch2 with same person — promote when we have phone
    if row.get("status") == "pending" and (phone or website or address):
        sets.append("status = 'approved'")

    sql = f"update public.businesses set {', '.join(sets)} where id = {sql_literal(row['id'])} returning slug, status"
    if dry_run:
        print(f"  DRY enrich {row['slug']}")
        return
    out = sb.sql(sql)[0]
    print(f"  ENRICH {out['slug']} [{out['status']}]")


def insert_new(entity: dict, dry_run: bool) -> None:
    name = (entity.get("name") or "").strip()
    slug = f"fbpack-{slugify(name)}"
    city, state, address = parse_location(entity)
    phone = format_phone(entity.get("phone"))
    website = website_from(entity)
    category_id = CATEGORY_IDS[catalog_category(entity.get("category") or "")]
    desc = build_description(entity)
    short = short_description(entity)

    sql = f"""
    insert into public.businesses (
      slug, name, short_description, description, status, category_id,
      phone, website, image_url, address_line, city, region, state_code,
      latitude, longitude, created_at, updated_at
    ) values (
      {sql_literal(slug)},
      {sql_literal(name)},
      {sql_literal(short)},
      {sql_literal(desc)},
      'approved'::content_status,
      {sql_literal(category_id)}::uuid,
      {sql_literal(phone)},
      {sql_literal(website)},
      null,
      {sql_literal(address)},
      {sql_literal(city)},
      null,
      {sql_literal(state)},
      null, null, now(), now()
    )
    on conflict (slug) do update set
      name = excluded.name,
      short_description = excluded.short_description,
      description = excluded.description,
      status = 'approved',
      category_id = excluded.category_id,
      phone = coalesce(public.businesses.phone, excluded.phone),
      website = coalesce(public.businesses.website, excluded.website),
      address_line = coalesce(public.businesses.address_line, excluded.address_line),
      city = coalesce(public.businesses.city, excluded.city),
      state_code = coalesce(public.businesses.state_code, excluded.state_code),
      updated_at = now()
    returning slug, status;
    """
    if dry_run:
        print(f"  DRY insert {slug}")
        return
    out = sb.sql(sql)[0]
    print(f"  NEW {out['slug']} [{out['status']}]")


def looks_like_street_address(address: str | None) -> bool:
    """Require a street number — city-only geocodes create misleading map pins."""
    if not address or not str(address).strip():
        return False
    # e.g. "1409 E Warner Ave" or "2681 Dow Avenue #A"
    return bool(re.search(r"(^|\b)\d{1,6}\s+[A-Za-zА-Яа-я]", str(address)))


def maybe_geocode(dry_run: bool) -> None:
    if dry_run:
        return
    import json as _json
    import time
    import urllib.parse
    import urllib.request

    rows = sb.sql(
        """
        select id, slug, name, city, address_line, state_code
        from public.businesses
        where status = 'approved'
          and (latitude is null or longitude is null)
          and address_line is not null
          and btrim(address_line) <> ''
          and address_line ~ '[0-9]'
          and address_line ~ '(^|[[:space:]])[0-9]{1,6}[[:space:]]+[A-Za-zА-Яа-я]'
          and (slug like 'fbpack-%' or slug like 'batch2-%')
        order by name
        limit 80
        """
    )
    if not rows:
        print("Geocode: nothing to do (need street address with a number)")
        return

    ua = "RussianBusinessAI/1.0 (catalog geocoder; local admin)"

    def geocode(query: str):
        q = urllib.parse.urlencode(
            {
                "q": query,
                "format": "json",
                "limit": 1,
                "countrycodes": "us",
                "addressdetails": 1,
            }
        )
        req = urllib.request.Request(
            f"https://nominatim.openstreetmap.org/search?{q}",
            headers={"User-Agent": ua},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = _json.loads(resp.read().decode())
        if not data:
            return None
        # Prefer house/street matches over city centroids.
        for item in data:
            cls = (item.get("class") or "", item.get("type") or "")
            if cls[0] in {"place", "boundary"} and cls[1] in {
                "city",
                "town",
                "village",
                "county",
                "state",
                "country",
            }:
                continue
            return float(item["lat"]), float(item["lon"])
        return float(data[0]["lat"]), float(data[0]["lon"])

    ok = 0
    skipped = 0
    for r in rows:
        if not looks_like_street_address(r.get("address_line")):
            skipped += 1
            continue
        state_abbr = (r.get("state_code") or "").replace("US-", "").strip()
        parts = [r["address_line"]]
        if r.get("city"):
            parts.append(r["city"])
        if state_abbr:
            parts.append(state_abbr)
        parts.append("USA")
        query = ", ".join(parts)
        try:
            time.sleep(1.05)
            hit = geocode(query)
        except Exception as exc:
            print(f"  GEO FAIL {r['slug']}: {exc}")
            continue
        if not hit:
            print(f"  GEO MISS {r['slug']}: {query}")
            continue
        lat, lon = hit
        sb.sql(
            f"update public.businesses set latitude={lat}, longitude={lon}, updated_at=now() where id={sql_literal(r['id'])}"
        )
        ok += 1
        print(f"  GEO OK {r['slug']} -> {lat:.5f},{lon:.5f}")
    print(f"Geocoded {ok}/{len(rows)} (skipped city-only: {skipped})")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-geocode", action="store_true")
    args = parser.parse_args()

    entities = load_merged_entities()
    print(f"Merged unique entities: {len(entities)}")
    rows = load_db_rows()

    enriched = 0
    created = 0
    for entity in sorted(entities, key=lambda e: e.get("name") or ""):
        existing = find_existing(entity, rows)
        if existing:
            enrich_existing(existing, entity, args.dry_run)
            enriched += 1
        else:
            insert_new(entity, args.dry_run)
            created += 1
            # refresh local cache for subsequent phone matches within run
            if not args.dry_run:
                rows = load_db_rows()

    print(f"\nDone. enriched={enriched} created={created}")
    if not args.skip_geocode:
        print("\n=== Geocode new/updated without coords ===")
        maybe_geocode(args.dry_run)

    if not args.dry_run:
        stats = sb.sql(
            """
            select
              count(*) filter (where status='approved')::int as approved,
              count(*) filter (where slug like 'fbpack-%')::int as fbpack,
              count(*) filter (where status='approved' and latitude is not null)::int as with_coords
            from public.businesses
            """
        )[0]
        print("Stats:", stats)


if __name__ == "__main__":
    main()
