#!/usr/bin/env python3
"""Migrate approved businesses without street → professionals after address enrich.

Plan: no-street business migrate
  1) Cross-source address enrich (fill_missing_addresses.resolve_address)
  2) Keep if street appears; archive obvious rent/car junk;
     otherwise insert professional + promos/services and archive business

Usage:
  python3 scripts/business-enrich/migrate_no_street_businesses.py --enrich
  python3 scripts/business-enrich/migrate_no_street_businesses.py --enrich --apply --geocode
  python3 scripts/business-enrich/migrate_no_street_businesses.py --convert
  python3 scripts/business-enrich/migrate_no_street_businesses.py --convert --apply
  python3 scripts/business-enrich/migrate_no_street_businesses.py --all --apply --geocode
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from entity_routing import has_street_address  # noqa: E402
from fill_missing_addresses import resolve_address  # noqa: E402
from promotions_from_text import (  # noqa: E402
    add_missing_entity_promotions,
    promotions_from_ad_text,
)

OUT = Path(__file__).resolve().parent / "data" / "migrate_no_street"
OUT.mkdir(parents=True, exist_ok=True)
BATCH = "migrate_no_street_v1"

CAT_MAP = {
    "restaurants": "home_food",
    "groceries": "home_food",
    "beauty": "massage_wellness",
    "health": "health",
    "medical": "health",
    "fitness": "massage_wellness",
    "education": "pro_other",
    "childcare": "childcare",
    "services": "home_services",
    "home_services": "home_services",
    "auto": "home_services",
    "pets": "home_services",
    "legal": "pro_other",
    "events": "celebrations",
    "celebrations": "celebrations",
    "travel": "pro_other",
    "real_estate": "pro_other",
    "finance": "pro_other",
}

RENT_RE = re.compile(
    r"(?i)("
    r"сда[её]тся|сдаю\b|сдаём\b|сдаем\b|"
    r"аренда\s+(квартир|студ|комнат|дом|таунхаус|house|apartment|studio)|"
    r"\bfor\s+rent\b|\blease\b|"
    r"полностью\s+меблирован"
    r")"
)
CAR_RE = re.compile(
    r"(?i)("
    r"\b(toyota|honda|bmw|mercedes|lexus|ford|hyundai|nissan|kia|chevrolet|"
    r"volkswagen|audi|mazda|subaru|tesla)\b.{0,40}(20\d{2}|прода|for\s+sale)|"
    r"прода[юм]\s+авто|прода[юм]\s+машин|"
    r"\bfor\s+sale\b.{0,30}\b(car|auto|suv|sedan|truck)\b|"
    r"car[_\s-]?rental|аренда\s+машин|аренда\s+авто"
    r")"
)
IG_HANDLE_RE = re.compile(
    r"(?:instagram\.com/|@)([A-Za-z0-9._]{2,30})",
    re.I,
)
# Stricter than has_street_address alone — reject «500 of them and st».
US_STREET_RE = re.compile(
    r"(?i)(?<![\w-])("
    r"\d{1,5}\s+(?:[NSEW]\.?\s+)?"
    r"(?:[A-Za-z0-9.'\-]+\s+){0,4}"
    r"(?:[A-Za-z0-9.'\-]{2,})\s+"
    r"(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|"
    r"Way|Court|Ct|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Place|Pl|Terrace|Ter)"
    r"\.?"
    r"(?:\s*(?:#|Suite|Ste\.?|Unit|Apt\.?)\s*[A-Za-z0-9\-]+)?"
    r")"
)
JUNK_FILLED_ADDR_RE = re.compile(
    r"(?i)\b(of them|click|subscribe|follow|whats?app|minutes?|lorem)\b"
)


def empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def write_report(name: str, payload: dict[str, Any]) -> Path:
    path = OUT / f"{name}_{stamp()}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"{name}_latest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return path


def phone_digits(raw: str | None) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits[-10:] if len(digits) >= 10 else digits


def instagram_handle(raw: str | None) -> str | None:
    if not raw:
        return None
    m = IG_HANDLE_RE.search(raw)
    if m:
        return m.group(1).lower().rstrip(".")
    s = raw.strip().lstrip("@").lower()
    if re.fullmatch(r"[a-z0-9._]{2,30}", s):
        return s
    return None


def slugify(name: str) -> str:
    raw = (name or "").strip().lower()
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", raw):
        return raw[:60]
    norm = unicodedata.normalize("NFKD", raw)
    ascii_only = "".join(ch for ch in norm if not unicodedata.combining(ch))
    s = re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")
    if len(s) >= 3 and re.search(r"[a-z]", s):
        return s[:60]
    digest = hashlib.md5(raw.encode("utf-8")).hexdigest()[:10]
    return f"pro-{digest}"


def unique_slug(client: SupabaseRest, base: str) -> str:
    candidate = base[:60] or "pro"
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
        candidate = f"{base[:50]}-{n}"


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
                        "image_url,address_line,city,region,state_code,postal_code,"
                        "latitude,longitude,location_precision,opening_hours,category_id,"
                        "google_rating,google_maps_url,yelp_url,payment_methods"
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
        offset += len(rows)
    return out


def load_categories(client: SupabaseRest) -> tuple[dict[str, dict], dict[str, str]]:
    rows = (
        client._request(
            "GET",
            "/categories",
            params={
                "select": "id,slug,name,domain",
                "is_active": "eq.true",
                "limit": "300",
            },
        )
        or []
    )
    by_id = {r["id"]: r for r in rows}
    pro_slug_to_id = {
        r["slug"]: r["id"] for r in rows if r.get("domain") == "professional"
    }
    return by_id, pro_slug_to_id


def is_no_street(row: dict[str, Any]) -> bool:
    return not has_street_address(
        row.get("address_line"),
        postal_code=row.get("postal_code"),
        location_precision=row.get("location_precision"),
    )


def is_usable_street_patch(patch: dict[str, Any], row: dict[str, Any]) -> bool:
    """Accept only US-looking street lines (and US coords when present)."""
    line = (patch.get("address_line") or "").strip()
    if not line or JUNK_FILLED_ADDR_RE.search(line):
        return False
    if not US_STREET_RE.search(line):
        # Digits + Latin street token without classic suffix (e.g. «175 Vo Van»)
        # still rejected unless Places also put us in US bounds.
        lat = patch.get("latitude")
        lng = patch.get("longitude")
        if not (
            isinstance(lat, (int, float))
            and isinstance(lng, (int, float))
            and 24.0 <= float(lat) <= 50.0
            and -125.0 <= float(lng) <= -66.0
            and has_street_address(
                line,
                postal_code=patch.get("postal_code") or row.get("postal_code"),
                location_precision=patch.get("location_precision"),
            )
        ):
            return False
        # Non-suffix street still needs a digit house number at start.
        if not re.match(r"^\d{1,6}\s+\S", line):
            return False
    lat = patch.get("latitude")
    lng = patch.get("longitude")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        if not (24.0 <= float(lat) <= 50.0 and -125.0 <= float(lng) <= -66.0):
            return False
    return has_street_address(
        line,
        postal_code=patch.get("postal_code") or row.get("postal_code"),
        location_precision=patch.get("location_precision") or "street",
    )


def blob(row: dict[str, Any]) -> str:
    return "\n".join(
        filter(
            None,
            [
                row.get("name") or "",
                row.get("short_description") or "",
                row.get("description") or "",
            ],
        )
    )


def junk_reason(row: dict[str, Any]) -> str | None:
    text = blob(row)
    if RENT_RE.search(text):
        return "junk_rent"
    if CAR_RE.search(text):
        return "junk_car"
    return None


def pro_category_slug(row: dict[str, Any], cat_by_id: dict[str, dict]) -> str:
    cat = cat_by_id.get(row.get("category_id") or "") or {}
    return CAT_MAP.get(cat.get("slug") or "", "pro_other")


def build_professional_payload(
    row: dict[str, Any],
    *,
    slug: str,
    pro_category_id: str | None,
) -> dict[str, Any]:
    display = (row.get("name") or "").strip()[:120]
    src = (row.get("source_kind") or "").lower()
    source_type = "TELEGRAM"
    if src == "facebook":
        source_type = "FACEBOOK"
    elif src == "platform":
        source_type = "IMPORT"

    region = (row.get("region") or "").strip() or None
    state_code = row.get("state_code")
    if not state_code and region:
        if region.upper() in {"CA", "CALIFORNIA"} or region.upper().startswith("CA"):
            state_code = "US-CA"
        elif re.fullmatch(r"US-[A-Z]{2}", region.upper()):
            state_code = region.upper()

    image = row.get("image_url")
    if image and "placeholder" in image:
        image = None

    ts = now_iso()
    return {
        "owner_profile_id": None,
        "created_by_profile_id": None,
        "source_type": source_type,
        "source_record_id": row["id"],
        "source_url": row.get("source_url"),
        "imported_at": ts,
        "import_batch_id": BATCH,
        "display_name": display,
        "slug": slug,
        "headline": (row.get("short_description") or "")[:160] or None,
        "short_description": (row.get("short_description") or "")[:280] or None,
        "description": row.get("description"),
        "image_url": image,
        "status": "approved",
        "visibility": "public",
        "category_id": pro_category_id,
        "city": row.get("city"),
        "region": region,
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
        "telegram_url": row.get("telegram_url"),
        "opening_hours": row.get("opening_hours"),
        "payment_methods": row.get("payment_methods")
        if isinstance(row.get("payment_methods"), list)
        else [],
        "service_area_text": (
            ", ".join(x for x in [row.get("city"), region] if x) or None
        ),
        "published_at": ts,
        "languages": ["ru"],
    }


def find_existing_professional(
    client: SupabaseRest,
    row: dict[str, Any],
    *,
    phone_index: dict[str, str],
    ig_index: dict[str, str],
) -> dict[str, Any] | None:
    # Prior migrate attempt already inserted a pro linked to this business id.
    prior = (
        client._request(
            "GET",
            "/professionals",
            params={
                "select": "id,status",
                "source_record_id": f"eq.{row['id']}",
                "import_batch_id": f"eq.{BATCH}",
                "limit": "1",
            },
        )
        or []
    )
    if prior:
        return {"id": prior[0]["id"], "match": "source_record"}

    digits = phone_digits(row.get("phone"))
    if digits and digits in phone_index:
        pid = phone_index[digits]
        return {"id": pid, "match": "phone"}
    handle = instagram_handle(row.get("instagram_url"))
    if handle and handle in ig_index:
        return {"id": ig_index[handle], "match": "instagram"}
    return None


def build_pro_indexes(client: SupabaseRest) -> tuple[dict[str, str], dict[str, str]]:
    phone_index: dict[str, str] = {}
    ig_index: dict[str, str] = {}
    offset = 0
    while True:
        rows = (
            client._request(
                "GET",
                "/professionals",
                params={
                    "select": "id,phone,instagram_url,status",
                    "status": "eq.approved",
                    "order": "id.asc",
                    "limit": "1000",
                    "offset": str(offset),
                },
            )
            or []
        )
        if not rows:
            break
        for r in rows:
            d = phone_digits(r.get("phone"))
            if d and d not in phone_index:
                phone_index[d] = r["id"]
            h = instagram_handle(r.get("instagram_url"))
            if h and h not in ig_index:
                ig_index[h] = r["id"]
        if len(rows) < 1000:
            break
        offset += len(rows)
    return phone_index, ig_index


def copy_business_offers_to_professional(
    client: SupabaseRest, *, business_id: str, professional_id: str
) -> int:
    try:
        offers = (
            client._request(
                "GET",
                "/business_offers",
                params={
                    "select": (
                        "title,description,price_amount,price_min,price_max,"
                        "currency,is_active"
                    ),
                    "business_id": f"eq.{business_id}",
                    "limit": "50",
                },
            )
            or []
        )
    except Exception:  # noqa: BLE001
        return 0
    inserted = 0
    for offer in offers:
        if offer.get("is_active") is False:
            continue
        title = (offer.get("title") or "").strip()
        if not title:
            continue
        amount = offer.get("price_amount")
        if amount is None:
            amount = offer.get("price_min")
        if amount is not None:
            try:
                amount_f = float(amount)
            except (TypeError, ValueError):
                amount_f = None
        else:
            amount_f = None
        if amount_f is not None and amount_f <= 0:
            price_mode, price_amount = "free", None
        elif amount_f is not None:
            price_mode, price_amount = "fixed", amount_f
        else:
            price_mode, price_amount = "contact", None
        body = {
            "professional_id": professional_id,
            "title": title[:160],
            "description": (offer.get("description") or None),
            "price_mode": price_mode,
            "price_amount": price_amount,
            "currency": (offer.get("currency") or "USD")[:3],
            "is_active": True,
            "sort_order": inserted * 10,
        }
        try:
            client._request("POST", "/professional_services", body=body)
            inserted += 1
        except Exception:  # noqa: BLE001
            continue
    return inserted


def run_enrich(
    client: SupabaseRest,
    *,
    apply: bool,
    geocode: bool,
    limit: int,
    skip_places: bool,
    skip_ocr: bool,
    skip_social: bool,
) -> dict[str, Any]:
    rows = [r for r in load_businesses(client) if is_no_street(r)]
    if limit > 0:
        rows = rows[:limit]

    args = SimpleNamespace(
        apply=apply,
        geocode=geocode,
        skip_places=skip_places,
        skip_ocr=skip_ocr,
        skip_social=skip_social,
    )

    filled: list[dict[str, Any]] = []
    missed = 0
    by_source: Counter[str] = Counter()

    for i, row in enumerate(rows, 1):
        # resolve_address only looks when address_line empty — for junk
        # non-street lines, temporarily clear so sources can replace.
        work = dict(row)
        if work.get("address_line") and not has_street_address(
            work.get("address_line"),
            postal_code=work.get("postal_code"),
            location_precision=None,  # force re-resolve if precision wasn't street
        ):
            # Keep non-street blurbs out of the way for extractors that
            # only fill when empty.
            work["address_line"] = None

        result = resolve_address(work, args)
        if not result:
            missed += 1
            if i % 25 == 0 or i == len(rows):
                print(f"[{i}/{len(rows)}] miss {row.get('slug')}")
            continue

        patch = result["patch"]
        if not is_usable_street_patch(patch, row):
            missed += 1
            print(
                f"[{i}/{len(rows)}] reject_non_street {row.get('slug')} "
                f"← {result['source']}: {patch.get('address_line')!r}"
            )
            continue

        by_source[result["source"]] += 1
        patch = dict(result["patch"])
        # Canon state_code is US-XX (FK → platform_subdivisions).
        sc = patch.get("state_code")
        if isinstance(sc, str) and re.fullmatch(r"[A-Za-z]{2}", sc.strip()):
            patch["state_code"] = f"US-{sc.strip().upper()}"
        item = {
            "id": row["id"],
            "slug": row.get("slug"),
            "name": row.get("name"),
            "source": result["source"],
            "patch": patch,
        }
        if apply:
            body = {**patch, "updated_at": datetime.now(timezone.utc).isoformat()}
            try:
                client.patch("businesses", {"id": f"eq.{row['id']}"}, body)
                item["status"] = "applied"
            except Exception as exc:  # noqa: BLE001
                item["status"] = "error"
                item["error"] = str(exc)[:400]
                print(f"[{i}/{len(rows)}] error {row.get('slug')}: {item['error']}")
                filled.append(item)
                continue
        else:
            item["status"] = "dry_run"
        filled.append(item)
        print(
            f"[{i}/{len(rows)}] {item['status']} {result['source']}: "
            f"{row.get('name')} → {patch.get('address_line')}"
        )

    report = {
        "batch": BATCH,
        "phase": "enrich",
        "mode": "apply" if apply else "dry_run",
        "scanned_no_street": len(rows),
        "filled": len(filled),
        "missed": missed,
        "by_source": dict(by_source),
        "items": filled,
    }
    path = write_report("enrich" if apply else "enrich_dry", report)
    print(
        json.dumps(
            {
                "phase": "enrich",
                "mode": report["mode"],
                "scanned": len(rows),
                "filled": len(filled),
                "missed": missed,
                "by_source": dict(by_source),
                "report": str(path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return report


def run_convert(
    client: SupabaseRest,
    *,
    apply: bool,
    limit: int,
) -> dict[str, Any]:
    cat_by_id, pro_slug_to_id = load_categories(client)
    rows = [r for r in load_businesses(client) if is_no_street(r)]
    if limit > 0:
        rows = rows[:limit]

    phone_index, ig_index = build_pro_indexes(client) if apply else ({}, {})

    results: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()

    for i, row in enumerate(rows, 1):
        junk = junk_reason(row)
        base_slug = (row.get("slug") or "").strip()
        if not (re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", base_slug) and len(base_slug) >= 3):
            base_slug = slugify(row.get("name") or base_slug)

        item: dict[str, Any] = {
            "business_id": row["id"],
            "business_slug": row.get("slug"),
            "name": row.get("name"),
        }

        if junk:
            item["action"] = "archive_junk"
            item["reason"] = junk
            counts[junk] += 1
            if apply:
                try:
                    client.patch(
                        "businesses",
                        {"id": f"eq.{row['id']}"},
                        {"status": "archived", "updated_at": datetime.now(timezone.utc).isoformat()},
                    )
                    item["status"] = "archived"
                    counts["archived_junk"] += 1
                except Exception as exc:  # noqa: BLE001
                    item["status"] = "error"
                    item["error"] = str(exc)[:400]
                    counts["errors"] += 1
            else:
                item["status"] = "dry_run"
            results.append(item)
            print(f"[{i}/{len(rows)}] {item['status']} junk/{junk} {row.get('slug')}")
            continue

        pro_cat = pro_category_slug(row, cat_by_id)
        item["pro_category"] = pro_cat
        item["action"] = "convert_professional"

        existing = (
            find_existing_professional(
                client, row, phone_index=phone_index, ig_index=ig_index
            )
            if apply
            else None
        )
        if existing:
            item["matched_professional_id"] = existing["id"]
            item["match"] = existing["match"]
            item["reason"] = f"duplicate_{existing['match']}"
            counts["duplicate_match"] += 1
            if apply:
                try:
                    client.patch(
                        "businesses",
                        {"id": f"eq.{row['id']}"},
                        {
                            "status": "archived",
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        },
                    )
                    item["status"] = "archived_duplicate"
                    counts["archived_duplicate"] += 1
                except Exception as exc:  # noqa: BLE001
                    item["status"] = "error"
                    item["error"] = str(exc)[:400]
                    counts["errors"] += 1
            else:
                item["status"] = "dry_run_duplicate"
            results.append(item)
            print(
                f"[{i}/{len(rows)}] {item['status']} dupe/{existing['match']} "
                f"{row.get('slug')} → {existing['id']}"
            )
            continue

        slug = unique_slug(client, base_slug) if apply else base_slug
        item["professional_slug"] = slug
        item["reason"] = "no_street_after_enrich"

        if apply:
            payload = build_professional_payload(
                row,
                slug=slug,
                pro_category_id=pro_slug_to_id.get(pro_cat),
            )
            try:
                created = client.insert_many("professionals", [payload])
                pid = created[0]["id"] if created else None
                item["professional_id"] = pid
                if pid:
                    # Index so later rows in this batch de-dupe against us.
                    d = phone_digits(row.get("phone"))
                    if d:
                        phone_index.setdefault(d, pid)
                    h = instagram_handle(row.get("instagram_url"))
                    if h:
                        ig_index.setdefault(h, pid)

                    try:
                        text = blob(row)
                        promos = promotions_from_ad_text(text)
                        promo_inserted = add_missing_entity_promotions(
                            client,
                            owner_type="professional",
                            owner_id=pid,
                            promotions=promos,
                            category_id=pro_slug_to_id.get(pro_cat),
                        )
                        item["promotions_inserted"] = len(promo_inserted)
                    except Exception as promo_exc:  # noqa: BLE001
                        item["promotions_error"] = str(promo_exc)[:200]

                    try:
                        item["services_copied"] = copy_business_offers_to_professional(
                            client, business_id=row["id"], professional_id=pid
                        )
                    except Exception as svc_exc:  # noqa: BLE001
                        item["services_error"] = str(svc_exc)[:200]

                client.patch(
                    "businesses",
                    {"id": f"eq.{row['id']}"},
                    {
                        "status": "archived",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                item["status"] = "converted"
                counts["converted"] += 1
            except Exception as exc:  # noqa: BLE001
                item["status"] = "error"
                item["error"] = str(exc)[:400]
                counts["errors"] += 1
        else:
            item["status"] = "dry_run"
            counts["dry_run_convert"] += 1

        results.append(item)
        print(
            f"[{i}/{len(rows)}] {item['status']} {row.get('slug')} → {slug} ({pro_cat})"
        )

    report = {
        "batch": BATCH,
        "phase": "convert",
        "mode": "apply" if apply else "dry_run",
        "scanned_no_street": len(rows),
        "counts": dict(counts),
        "results": results,
    }
    path = write_report("convert" if apply else "convert_dry", report)
    print(
        json.dumps(
            {
                "phase": "convert",
                "mode": report["mode"],
                "scanned": len(rows),
                "counts": dict(counts),
                "report": str(path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enrich", action="store_true", help="Phase 1: address enrich")
    parser.add_argument("--convert", action="store_true", help="Phase 2: convert/archive")
    parser.add_argument("--all", action="store_true", help="Run enrich then convert")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--geocode", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--skip-places", action="store_true")
    parser.add_argument("--skip-ocr", action="store_true")
    parser.add_argument("--skip-social", action="store_true")
    args = parser.parse_args()

    if not (args.enrich or args.convert or args.all):
        parser.error("Specify --enrich, --convert, or --all")

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    do_enrich = args.enrich or args.all
    do_convert = args.convert or args.all

    if do_enrich:
        run_enrich(
            client,
            apply=args.apply,
            geocode=args.geocode,
            limit=args.limit,
            skip_places=args.skip_places,
            skip_ocr=args.skip_ocr,
            skip_social=args.skip_social,
        )
    if do_convert:
        # After enrich+apply, re-scan live rows (limit only applies within phase).
        run_convert(client, apply=args.apply, limit=args.limit)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
