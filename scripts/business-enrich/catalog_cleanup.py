#!/usr/bin/env python3
"""Catalog cleanup: triage misclassified businesses, geocode, convert.

Phases:
  1) triage   — classify approved businesses → keep_business | professional | event | junk
  2) geocode  — fill lat/lng when address exists
  3) convert  — create professionals/events from clear cases; archive source business

Usage:
  python3 scripts/business-enrich/catalog_cleanup.py --triage
  python3 scripts/business-enrich/catalog_cleanup.py --geocode --apply --limit 80
  python3 scripts/business-enrich/catalog_cleanup.py --convert-professionals --dry-run --limit 50
  python3 scripts/business-enrich/catalog_cleanup.py --convert-professionals --apply --limit 50
  python3 scripts/business-enrich/catalog_cleanup.py --convert-events --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "catalog_cleanup"
OUT.mkdir(parents=True, exist_ok=True)

UA = "KrugiCatalogCleanup/1.0 (catalog; contact@krugi.app)"

EVENT_RE = re.compile(
    r"мероприятие|концерт|фестиваль|мастер[- ]?класс|открытый урок|"
    r"вебинар|конференц|встреча\b|ивент|\bevent\b|workshop",
    re.I,
)
DATE_IN_NAME_RE = re.compile(
    r"\d{1,2}[./]\d{1,2}"
    r"|\b(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b",
    re.I,
)
SPECIALIST_RE = re.compile(
    r"репетитор|массажист|фотограф|парикмахер|маникюр|визажист|мастер\b|"
    r"бровист|лашмейкер|косметолог|психолог|няня|сиделка|тренер|"
    r"hairstylist|nail|massage|tutor|photographer|makeup",
    re.I,
)
COMPANY_RE = re.compile(
    r"\b(llc|inc|corp|studio|salon|clinic|academy|school|center|centre|"
    r"restaurant|cafe|магазин|салон|клиника|студия|академия|центр|школа|"
    r"company|group|группа)\b",
    re.I,
)


def slugify(name: str) -> str:
    import hashlib
    import unicodedata

    raw = (name or "").strip().lower()
    # Keep existing latin slug-like strings
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", raw):
        return raw[:60]
    # Strip accents from latin letters
    norm = unicodedata.normalize("NFKD", raw)
    ascii_only = "".join(ch for ch in norm if not unicodedata.combining(ch))
    s = re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")
    if len(s) >= 3 and re.search(r"[a-z]", s):
        return s[:60]
    # Fallback stable slug from original text
    digest = hashlib.md5(raw.encode("utf-8")).hexdigest()[:10]
    return f"pro-{digest}"


def empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def geocode(query: str) -> tuple[float, float, str] | None:
    q = urllib.parse.urlencode({"q": query, "format": "json", "limit": 1})
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{q}",
        headers={"User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if not data:
            return None
        lat = float(data[0]["lat"])
        lon = float(data[0]["lon"])
        precision = "street" if "," in query else "city"
        return lat, lon, precision
    except Exception:
        return None


def fetch_import_map(client: SupabaseRest) -> dict[str, dict[str, Any]]:
    """Map published_entity_id → latest import item meta."""
    out: dict[str, dict[str, Any]] = {}
    offset = 0
    while True:
        rows = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": (
                        "id,entity_type,target_collection,published_entity_id,"
                        "person_name,business_name,title,source_url,source,category"
                    ),
                    "published_entity_type": "eq.business",
                    "published_entity_id": "not.is.null",
                    "order": "approved_at.desc.nullslast",
                    "limit": "1000",
                    "offset": str(offset),
                },
            )
            or []
        )
        if not rows:
            break
        for r in rows:
            eid = r.get("published_entity_id")
            if eid and eid not in out:
                out[eid] = r
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def classify(row: dict[str, Any], ir: dict[str, Any] | None) -> tuple[str, str]:
    """Return (bucket, reason)."""
    name = row.get("name") or ""
    desc = row.get("description") or ""
    blob = f"{name}\n{desc}"
    has_addr = not empty(row.get("address_line"))
    has_coords = row.get("latitude") is not None and row.get("longitude") is not None
    has_web = not empty(row.get("website"))
    entity = (ir or {}).get("entity_type") or ""
    target = (ir or {}).get("target_collection") or ""
    person = ((ir or {}).get("person_name") or "").strip()

    if entity == "event" or target == "events" or (
        EVENT_RE.search(blob) and DATE_IN_NAME_RE.search(name)
    ):
        return "event", "import_event_or_temporal_event_signals"

    if entity == "private_specialist" or target == "private_specialists":
        # Keep as business only if clearly a company with address
        if COMPANY_RE.search(name) and (has_addr or has_coords or has_web):
            return "keep_business", "specialist_import_but_company_signals"
        return "professional", "import_private_specialist"

    if SPECIALIST_RE.search(blob) and not COMPANY_RE.search(name) and not has_addr:
        return "professional", "specialist_keywords_no_address"

    if person and not COMPANY_RE.search(name) and not has_addr and not has_web:
        return "professional", "person_name_no_place"

    if target == "services" and not has_addr and not has_coords and not COMPANY_RE.search(name):
        return "professional", "services_import_no_place"

    if empty(name) or len(name) < 2:
        return "junk", "empty_name"

    # junk: slug/title that is just a phone or "business-" placeholder with no content
    if re.match(r"^business-", row.get("slug") or "") and empty(desc) and not has_addr:
        return "junk", "placeholder_business_empty"

    return "keep_business", "default_keep"


def load_businesses(client: SupabaseRest) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        rows = (
            client._request(
                "GET",
                "/businesses",
                params={
                    "select": (
                        "id,slug,name,status,phone,email,website,instagram_url,"
                        "telegram_url,source_url,source_kind,description,short_description,"
                        "image_url,address_line,city,region,latitude,longitude,"
                        "location_precision,opening_hours,category_id"
                    ),
                    "status": "eq.approved",
                    "order": "created_at.asc",
                    "limit": "500",
                    "offset": str(offset),
                },
            )
            or []
        )
        if not rows:
            break
        out.extend(rows)
        if len(rows) < 500:
            break
        offset += 500
    return out


def run_triage(client: SupabaseRest) -> dict[str, Any]:
    ir_map = fetch_import_map(client)
    rows = load_businesses(client)
    buckets: dict[str, list[dict[str, Any]]] = {
        "keep_business": [],
        "professional": [],
        "event": [],
        "junk": [],
    }
    for row in rows:
        ir = ir_map.get(row["id"])
        bucket, reason = classify(row, ir)
        buckets[bucket].append(
            {
                "id": row["id"],
                "slug": row["slug"],
                "name": row["name"],
                "reason": reason,
                "entity_type": (ir or {}).get("entity_type"),
                "target_collection": (ir or {}).get("target_collection"),
                "has_address": not empty(row.get("address_line")),
                "has_coords": row.get("latitude") is not None,
                "phone": bool(row.get("phone")),
                "instagram": bool(row.get("instagram_url")),
            }
        )
    report = {
        "total": len(rows),
        "counts": {k: len(v) for k, v in buckets.items()},
        "buckets": buckets,
    }
    path = OUT / "triage_report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["counts"], ensure_ascii=False))
    print(f"report={path}")
    return report


def run_geocode(client: SupabaseRest, *, apply: bool, limit: int) -> None:
    rows = load_businesses(client)
    todo = [
        r
        for r in rows
        if not empty(r.get("address_line"))
        and (r.get("latitude") is None or r.get("longitude") is None)
    ][:limit]
    # also city-only fallback for keep_business with city but no coords — optional second pass
    results = []
    for i, row in enumerate(todo, 1):
        query = ", ".join(
            x
            for x in [
                (row.get("address_line") or "").strip(),
                (row.get("city") or "").strip(),
                (row.get("region") or "CA").strip(),
                "USA",
            ]
            if x
        )
        geo = geocode(query)
        item = {"id": row["id"], "slug": row["slug"], "query": query, "geo": geo}
        if geo and apply:
            lat, lon, precision = geo
            client.patch(
                "businesses",
                {"id": f"eq.{row['id']}"},
                {
                    "latitude": lat,
                    "longitude": lon,
                    "location_precision": precision,
                },
            )
            item["status"] = "updated"
        elif geo:
            item["status"] = "dry_run"
        else:
            item["status"] = "not_found"
        results.append(item)
        print(f"[{i}/{len(todo)}] {item['status']} {row['slug']}")
        time.sleep(1.1)  # Nominatim polite
    path = OUT / f"geocode_{'apply' if apply else 'dry'}.json"
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report={path}")


def unique_slug(client: SupabaseRest, base: str) -> str:
    candidate = base
    n = 0
    while True:
        rows = (
            client._request(
                "GET",
                "/professionals",
                params={"select": "id", "slug": f"eq.{candidate}", "limit": "1"},
            )
            or []
        )
        if not rows:
            return candidate
        n += 1
        candidate = f"{base}-{n}"


def convert_professionals(
    client: SupabaseRest, *, apply: bool, limit: int
) -> None:
    triage_path = OUT / "triage_report.json"
    if not triage_path.exists():
        run_triage(client)
    triage = json.loads(triage_path.read_text(encoding="utf-8"))
    biz_by_id = {b["id"]: b for b in load_businesses(client)}
    candidates = [
        c
        for c in triage["buckets"]["professional"]
        if c["id"] in biz_by_id
    ][:limit]
    ir_map = fetch_import_map(client)
    results = []
    for i, c in enumerate(candidates, 1):
        row = biz_by_id.get(c["id"])
        if not row:
            continue
        ir = ir_map.get(row["id"]) or {}
        display = (
            (ir.get("person_name") or "").strip()
            or (row.get("name") or "").strip()
        )
        # Prefer existing business slug when it is already a clean latin slug
        biz_slug = (row.get("slug") or "").strip()
        if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", biz_slug) and len(biz_slug) >= 3:
            base_slug = biz_slug
        else:
            base_slug = slugify(display) or slugify(biz_slug)
        slug = unique_slug(client, base_slug) if apply else base_slug
        source_type = "TELEGRAM"
        src = (row.get("source_kind") or "").lower()
        if src == "facebook":
            source_type = "FACEBOOK"
        elif src == "platform":
            source_type = "IMPORT"

        region = (row.get("region") or "").strip()
        state_code = None
        if region.upper() in {"CA", "CALIFORNIA", "US-CA"} or "CA" == region.upper()[:2]:
            state_code = "US-CA"
        elif re.fullmatch(r"US-[A-Z]{2}", region.upper()):
            state_code = region.upper()

        payload = {
            "owner_profile_id": None,
            "created_by_profile_id": None,
            "source_type": source_type,
            "source_record_id": row["id"],
            "source_url": row.get("source_url") or ir.get("source_url"),
            "imported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "import_batch_id": "catalog_cleanup_specialists_v1",
            "display_name": display[:120],
            "slug": slug,
            "headline": (row.get("short_description") or "")[:160] or None,
            "short_description": (row.get("short_description") or "")[:280] or None,
            "description": row.get("description"),
            "image_url": row.get("image_url")
            if row.get("image_url") and "placeholder" not in (row.get("image_url") or "")
            else None,
            "status": "approved",
            "visibility": "public",
            "city": row.get("city"),
            "region": region or None,
            "state_code": state_code,
            "latitude": None,
            "longitude": None,
            "location_precision": "city" if row.get("city") else None,
            "public_exact_address": False,
            "private_address_line": row.get("address_line"),
            "phone": row.get("phone"),
            "email": row.get("email"),
            "website": row.get("website"),
            "instagram_url": row.get("instagram_url"),
            "opening_hours": row.get("opening_hours"),
            "published_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        item = {
            "business_id": row["id"],
            "business_slug": row["slug"],
            "professional_slug": slug,
            "display_name": display,
            "reason": c.get("reason"),
        }
        if apply:
            try:
                created = client.insert_many("professionals", [payload])
                pid = created[0]["id"] if created else None
                client.patch(
                    "businesses",
                    {"id": f"eq.{row['id']}"},
                    {"status": "archived"},
                )
                item["professional_id"] = pid
                item["status"] = "converted"
            except Exception as exc:  # noqa: BLE001
                item["status"] = "error"
                item["error"] = str(exc)[:300]
        else:
            item["status"] = "dry_run"
        results.append(item)
        print(f"[{i}/{len(candidates)}] {item['status']} {row['slug']} → {slug}")
    path = OUT / f"convert_professionals_{'apply' if apply else 'dry'}.json"
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report={path}")


def convert_events(client: SupabaseRest, *, apply: bool) -> None:
    triage_path = OUT / "triage_report.json"
    if not triage_path.exists():
        run_triage(client)
    triage = json.loads(triage_path.read_text(encoding="utf-8"))
    candidates = triage["buckets"]["event"]
    biz_by_id = {b["id"]: b for b in load_businesses(client)}
    ir_map = fetch_import_map(client)
    results = []
    for i, c in enumerate(candidates, 1):
        row = biz_by_id.get(c["id"])
        if not row:
            continue
        ir = ir_map.get(row["id"]) or {}
        base = slugify(row["name"])
        slug = base
        if apply:
            # ensure unique on events
            n = 0
            while True:
                exists = (
                    client._request(
                        "GET",
                        "/events",
                        params={"select": "id", "slug": f"eq.{slug}", "limit": "1"},
                    )
                    or []
                )
                if not exists:
                    break
                n += 1
                slug = f"{base}-{n}"
        payload = {
            "owner_profile_id": None,
            "provider_business_id": None,
            "title": row["name"][:200],
            "slug": slug,
            "description": row.get("description"),
            "status": "published",
            "starts_at": None,
            "ends_at": None,
            "event_at_label": None,
            "city": row.get("city"),
            "state_code": "US-CA",
            "latitude": row.get("latitude"),
            "longitude": row.get("longitude"),
            "cover_image_url": row.get("image_url")
            if row.get("image_url") and "placeholder" not in (row.get("image_url") or "")
            else None,
            "source_url": row.get("source_url") or ir.get("source_url"),
            "source_channel": row.get("source_kind") or "telegram",
            "source_body": row.get("description"),
            "format": "offline",
        }
        item = {
            "business_id": row["id"],
            "business_slug": row["slug"],
            "event_slug": slug,
            "reason": c.get("reason"),
        }
        if apply:
            try:
                created = client.insert_many("events", [payload])
                item["event_id"] = created[0]["id"] if created else None
                client.patch(
                    "businesses",
                    {"id": f"eq.{row['id']}"},
                    {"status": "archived"},
                )
                item["status"] = "converted"
            except Exception as exc:  # noqa: BLE001
                item["status"] = "error"
                item["error"] = str(exc)[:300]
        else:
            item["status"] = "dry_run"
        results.append(item)
        print(f"[{i}/{len(candidates)}] {item['status']} {row['slug']} → event/{slug}")
    path = OUT / f"convert_events_{'apply' if apply else 'dry'}.json"
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report={path}")


def archive_junk(client: SupabaseRest, *, apply: bool) -> None:
    triage_path = OUT / "triage_report.json"
    if not triage_path.exists():
        run_triage(client)
    triage = json.loads(triage_path.read_text(encoding="utf-8"))
    candidates = triage["buckets"]["junk"]
    results = []
    for c in candidates:
        item = {"id": c["id"], "slug": c["slug"], "reason": c["reason"]}
        if apply:
            client.patch("businesses", {"id": f"eq.{c['id']}"}, {"status": "archived"})
            item["status"] = "archived"
        else:
            item["status"] = "dry_run"
        results.append(item)
        print(f"{item['status']} {c['slug']}")
    path = OUT / f"archive_junk_{'apply' if apply else 'dry'}.json"
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report={path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--triage", action="store_true")
    parser.add_argument("--geocode", action="store_true")
    parser.add_argument("--convert-professionals", action="store_true")
    parser.add_argument("--convert-events", action="store_true")
    parser.add_argument("--archive-junk", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()

    if not any(
        [
            args.triage,
            args.geocode,
            args.convert_professionals,
            args.convert_events,
            args.archive_junk,
        ]
    ):
        print("Pick an action: --triage / --geocode / --convert-professionals / --convert-events / --archive-junk")
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    if args.triage:
        run_triage(client)
    if args.geocode:
        if not args.dry_run and not args.apply:
            print("geocode needs --dry-run or --apply")
            return 2
        run_geocode(client, apply=args.apply, limit=args.limit)
    if args.convert_professionals:
        if not args.dry_run and not args.apply:
            print("convert needs --dry-run or --apply")
            return 2
        convert_professionals(client, apply=args.apply, limit=args.limit)
    if args.convert_events:
        if not args.dry_run and not args.apply:
            print("convert needs --dry-run or --apply")
            return 2
        convert_events(client, apply=args.apply)
    if args.archive_junk:
        if not args.dry_run and not args.apply:
            print("archive needs --dry-run or --apply")
            return 2
        archive_junk(client, apply=args.apply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
