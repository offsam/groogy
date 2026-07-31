#!/usr/bin/env python3
"""Move home/mobile/person 'businesses' → professionals, archive source cards.

Targets (approved businesses):
  - homemade cakes / food on order / delivery cooks
  - mobile detailing & other выезд services
  - person-named cards without a storefront address
  - brand-ish names that are still just home food / mobile service

Keeps real venues: street address + (yelp/gmaps/hours/rating) or clear storefront.

Usage:
  python3 scripts/business-enrich/move_home_services_to_professionals.py --dry-run
  python3 scripts/business-enrich/move_home_services_to_professionals.py --apply
  python3 scripts/business-enrich/move_home_services_to_professionals.py --apply --limit 30
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "move_home_to_pros"
OUT.mkdir(parents=True, exist_ok=True)
BATCH = "move_home_mobile_person_to_pros_v1"

HOME_FOOD_RE = re.compile(
    r"(?i)("
    r"торт|торты|пирог|пирожн|капкейк|cupcake|cake\b|dessert|десерт|"
    r"выпечк|выпекаю|готовлю|"
    r"homemade|"
    r"домашн(яя|ее|ий|ие)\s*(еда|выпечк|торт|пирог|кухн|пекар|сладост)|"
    r"на\s*заказ.{0,40}(торт|пирог|десерт|еда|выпечк)|"
    r"(торт|пирог|десерт|выпечк|еда).{0,40}на\s*заказ|"
    r"медовик|трайфл|cheesecake|пеку\b|"
    r"кулич|паннетоне|"
    r"икр[аы]\b|caviar|"
    r"доставк[аеи]\s+(рыб|икр|еды|обед)|"
    r"\bbakery\b"
    r")"
)
MOBILE_RE = re.compile(
    r"(?i)("
    r"mobile\s+(detail|auto|car|wash|service)|мобильн(ый|ая|ое)\s*"
    r"(детейл|detail|авто|химчист|мойк)|"
    r"на\s*выезд|выездн|на\s*дому|at\s*your\s*(home|place)|"
    r"we\s*come\s*to\s*you|in[- ]home|home\s*service|"
    r"детаил|детейл|detailing|"
    r"catering|кейтеринг|выездн(ой|ое)\s*(bbq|барбекю|шеф)|"
    r"личный\s*шеф|private\s*chef"
    r")"
)
PERSON_RE = re.compile(
    r"^[A-ZА-ЯЁ][a-zа-яё'\-]+(?:\s+[A-ZА-ЯЁ][a-zа-яё'\-]{0,24}){0,2}$"
)
COMPANY_RE = re.compile(
    r"(?i)\b(llc|inc|corp|company|group|salon|clinic|restaurant|cafe|"
    r"магазин|салон|клиника|ресторан|кафе|центр|center|school|academy|"
    r"студия|studio|showroom|market|shop)\b"
)
STOREFRONT_RE = re.compile(
    r"(?i)(наш\s*адрес|located\s*at|visit\s*(our|us)|приходите|"
    r"часы\s*работы|open\s*(daily|mon)|showroom|мы\s*находимся)"
)
STREET_RE = re.compile(
    r"(?i)\b\d{1,5}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9'.\-]+(?:\s+[A-Za-z0-9'.\-]+){0,3}\s+"
    r"(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|"
    r"Pkwy|Parkway|Pl|Place)\b"
)
ONLINE_TUTOR_RE = re.compile(
    r"(?i)(онлайн[- ]?(школа|урок|занят|курс|репетитор)|"
    r"online\s*(school|tutor|class|lesson|course)|zoom\b)"
)
SPECIALIST_KW = re.compile(
    r"(?i)(репетитор|массажист|фотограф|парикмахер|маникюр|визажист|"
    r"бровист|лашмейкер|косметолог|психолог|няня|сиделка|тренер|"
    r"tutor|photographer|makeup|nail\s*tech|lash|brow|"
    r"колорист|мастер\s+маникюр|частный\s+мастер|"
    r"домашний\s+детский\s+сад|home\s*daycare|nanny)"
)

# business category slug → professional category slug
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


def empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def blob(row: dict[str, Any]) -> str:
    return " ".join(
        filter(
            None,
            [
                row.get("name") or "",
                row.get("short_description") or "",
                row.get("description") or "",
            ],
        )
    )


def slugify(name: str) -> str:
    import hashlib
    import unicodedata

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
                        "image_url,address_line,city,region,state_code,latitude,longitude,"
                        "location_precision,opening_hours,category_id,google_rating,"
                        "google_maps_url,yelp_url"
                    ),
                    "status": "eq.approved",
                    "order": "name.asc",
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


def is_real_venue(row: dict[str, Any], text: str) -> bool:
    """Keep as business — has a place people visit."""
    has_street = not empty(row.get("address_line"))
    has_yelp = not empty(row.get("yelp_url"))
    has_gmaps = not empty(row.get("google_maps_url"))
    has_hours = not empty(row.get("opening_hours"))
    has_rating = row.get("google_rating") is not None
    storefront = bool(STOREFRONT_RE.search(text))
    # Street address + venue signal → keep
    if has_street and (has_yelp or has_gmaps or has_hours or has_rating or storefront):
        return True
    # Street + company name, and NOT home-food/mobile dominant
    if has_street and COMPANY_RE.search(row.get("name") or ""):
        if HOME_FOOD_RE.search(text) or MOBILE_RE.search(text):
            # bakery name with street might still be venue — keep if hours/rating
            return bool(has_hours or has_rating or has_yelp)
        return True
    return False


def classify_move(
    row: dict[str, Any], cat_by_id: dict[str, dict]
) -> tuple[str, str] | None:
    """Return (reason, pro_category_slug) or None to keep as business."""
    text = blob(row)
    name = (row.get("name") or "").strip()
    cat = cat_by_id.get(row.get("category_id") or "") or {}
    biz_cat = cat.get("slug") or ""

    if is_real_venue(row, text):
        return None

    has_street = not empty(row.get("address_line"))
    home_food = bool(HOME_FOOD_RE.search(text))
    mobile = bool(MOBILE_RE.search(text))
    person = bool(PERSON_RE.match(name)) and not COMPANY_RE.search(name)
    specialist = bool(SPECIALIST_KW.search(text))
    online = bool(ONLINE_TUTOR_RE.search(text))
    companyish = bool(COMPANY_RE.search(name))

    # Skip obvious venue-looking names without enough home/mobile signal
    if re.search(r"(?i)\b(moving\s*company|beauty\s*salon|мувинг)\b", name) and not (
        home_food or mobile or person
    ):
        if specialist and not has_street:
            # still a specialist ad for a salon — ok as pro
            pass
        elif not has_street and companyish:
            return None

    # 1) Homemade / cakes / food-on-order — even with a brand name
    if home_food and not has_street:
        return "home_food_no_storefront", "home_food"
    if home_food and mobile:
        return "home_food_mobile", "home_food"
    # Brand cake accounts like delicious_by_va, vika sweet_bakery without street
    if home_food and biz_cat in {"restaurants", "groceries"} and not has_street:
        return "home_food_category", "home_food"

    # 2) Mobile detailing / выезд services
    if mobile and not has_street:
        pro_cat = CAT_MAP.get(biz_cat, "home_services")
        if home_food:
            pro_cat = "home_food"
        return "mobile_service_no_storefront", pro_cat

    # 3) Online tutors / remote-only education
    if online and not has_street:
        return "online_specialist", "pro_other"

    # 4) Person name, no street, not a company venue
    if person and not has_street and not companyish:
        if specialist or biz_cat in {
            "beauty",
            "health",
            "education",
            "services",
            "legal",
            "fitness",
            "childcare",
            "pets",
        }:
            return "person_specialist_no_address", CAT_MAP.get(biz_cat, "pro_other")
        # person + restaurants without street often home cook
        if biz_cat in {"restaurants", "groceries"}:
            return "person_home_food", "home_food"
        if not (row.get("website") or row.get("yelp_url") or row.get("google_maps_url")):
            return "person_name_no_place", CAT_MAP.get(biz_cat, "pro_other")

    # 5) Specialist keywords, no street, no strong company+website venue
    if specialist and not has_street and not (
        companyish and not empty(row.get("website"))
    ):
        return "specialist_keywords_no_address", CAT_MAP.get(biz_cat, "pro_other")

    # 6) Instagram/handle-like food brands without street
    if (
        not has_street
        and biz_cat in {"restaurants", "groceries"}
        and not companyish
        and (home_food or re.search(r"(?i)bakery|cook|chef|кухн", text))
    ):
        return "food_handle_no_storefront", "home_food"

    return None


def build_professional_payload(
    row: dict[str, Any],
    *,
    slug: str,
    pro_category_id: str | None,
    reason: str,
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

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    image = row.get("image_url")
    if image and "placeholder" in image:
        image = None

    return {
        "owner_profile_id": None,
        "created_by_profile_id": None,
        "source_type": source_type,
        "source_record_id": row["id"],
        "source_url": row.get("source_url"),
        "imported_at": now,
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
        "service_area_text": (
            ", ".join(x for x in [row.get("city"), region] if x) or None
        ),
        "published_at": now,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--slug", type=str, default="")
    args = parser.parse_args()
    apply = bool(args.apply)

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    cat_by_id, pro_slug_to_id = load_categories(client)
    rows = load_businesses(client)
    if args.slug:
        rows = [r for r in rows if r.get("slug") == args.slug]

    candidates: list[dict[str, Any]] = []
    kept = 0
    for row in rows:
        hit = classify_move(row, cat_by_id)
        if not hit:
            kept += 1
            continue
        reason, pro_cat_slug = hit
        candidates.append(
            {
                "row": row,
                "reason": reason,
                "pro_category_slug": pro_cat_slug,
                "pro_category_id": pro_slug_to_id.get(pro_cat_slug),
            }
        )

    if args.limit:
        candidates = candidates[: args.limit]

    # Reason breakdown
    from collections import Counter

    reasons = Counter(c["reason"] for c in candidates)
    print(f"approved={len(rows)} move={len(candidates)} keep≈{kept}")
    print("reasons:", dict(reasons))

    results = []
    converted = 0
    errors = 0
    for i, c in enumerate(candidates, 1):
        row = c["row"]
        biz_slug = (row.get("slug") or "").strip()
        if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", biz_slug) and len(biz_slug) >= 3:
            base = biz_slug
        else:
            base = slugify(row.get("name") or biz_slug)
        slug = unique_slug(client, base) if apply else base
        item = {
            "business_id": row["id"],
            "business_slug": row.get("slug"),
            "name": row.get("name"),
            "reason": c["reason"],
            "pro_category": c["pro_category_slug"],
            "professional_slug": slug,
        }
        if apply:
            payload = build_professional_payload(
                row,
                slug=slug,
                pro_category_id=c["pro_category_id"],
                reason=c["reason"],
            )
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
                converted += 1
            except Exception as exc:  # noqa: BLE001
                item["status"] = "error"
                item["error"] = str(exc)[:400]
                errors += 1
        else:
            item["status"] = "dry_run"
            item["preview"] = (row.get("short_description") or "")[:120]
        results.append(item)
        print(
            f"[{i}/{len(candidates)}] {item['status']} {row.get('slug')} "
            f"→ {slug} ({c['reason']}/{c['pro_category_slug']})"
        )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if apply else "dry_run"
    summary = {
        "batch": BATCH,
        "mode": mode,
        "approved_scanned": len(rows),
        "selected": len(candidates),
        "converted": converted,
        "errors": errors,
        "reasons": dict(reasons),
        "results": results,
    }
    path = OUT / f"{mode}_{stamp}.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"{mode}_latest.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nDone ({mode}): selected={len(candidates)} converted={converted} errors={errors}")
    print(f"Wrote {path}")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
