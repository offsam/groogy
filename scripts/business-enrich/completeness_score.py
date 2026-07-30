#!/usr/bin/env python3
"""Completeness score for businesses and professionals.

Pure scoring logic — no DB writes. `calculate_completeness_score()` takes an
entity_type and a plain dict (the row, plus a couple of pre-fetched related
counts — see REQUIRED_EXTRA_KEYS below) and returns an int score.

To actually write scores back to businesses.completeness_score /
professionals.completeness_score, run this file with --apply (see main()).
Default is --dry-run: prints computed scores for a sample, writes nothing.

Weight tables are exactly as specified for this infrastructure-prep task.
Business weights sum to 98, not 100 (the spec's own arithmetic) — see
BUSINESS_WEIGHT_TOTAL_NOTE below. facebook_url/whatsapp are NOT current
columns on businesses (confirmed live 2026-07-27 via information_schema) —
their 2+2 points are scored as 0 unless/until those columns exist, per the
spec's own "если поле есть" (if the field exists) qualifier. This is flagged,
not silently corrected — do not rescale to force a 100 max.

Usage:
  python3 scripts/business-enrich/completeness_score.py --dry-run --entity business --limit 5
  python3 scripts/business-enrich/completeness_score.py --dry-run --entity professional --limit 5
  python3 scripts/business-enrich/completeness_score.py --apply --entity business
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402

BUSINESS_WEIGHT_TOTAL_NOTE = (
    "Spec line items sum to 98, not the stated 100; facebook_url/whatsapp "
    "(2+2 pts) don't exist as businesses columns today, so today's "
    "reachable max is 96. Reported as-is, not rescaled."
)

# Generic filler that should NOT count as a real description/short_description.
# Not exhaustive — see docs/audits/ENRICHMENT_INFRASTRUCTURE_V1.md for why this
# heuristic is a starting point, not a solved problem.
_PLACEHOLDER_DESCRIPTIONS = {
    "без описания",
    "нет описания",
    "no description",
    "n/a",
    "тбд",
    "tbd",
}
_MIN_REAL_DESCRIPTION_LEN = 40
_MIN_REAL_DESCRIPTION_WORDS = 6


_URL_SPAN_RE = re.compile(r"https?://[^\s<>\"']+|www\.[^\s<>\"']+", re.I)
_SOCIAL_IN_DESC_RE = re.compile(
    r"instagram\.com|instagr\.am|t\.me/|telegram\.(?:me|org)|facebook\.com/\S",
    re.I,
)
# Telegram / group recommendation dump — not the specialist's own bio.
_COMMENTISH_DESC_RE = re.compile(
    r"(?i)^(?:девочки|девушки|ребята|кто\s+знает|подскажите|рекомендую|"
    r"очень\s+советую|есть\s+кто|looking\s+for|does\s+anyone|"
    r"please\s+recommend|hi\s+girls|good\s+morning)\b"
    r"|^\s*@\w{3,}"
)


def _is_real_text(value: Any, *, min_len: int = _MIN_REAL_DESCRIPTION_LEN) -> bool:
    """True if value looks like real written content, not a stub/placeholder."""
    if not isinstance(value, str):
        return False
    text = value.strip()
    if not text:
        return False
    if text.lower() in _PLACEHOLDER_DESCRIPTIONS:
        return False
    if len(text) < min_len:
        return False
    if len(text.split()) < _MIN_REAL_DESCRIPTION_WORDS:
        return False
    return True


def is_weak_description(value: Any) -> bool:
    """True if description is empty, placeholder, link-dump, or a group comment.

    Safe to overwrite when a website/og bio is available.
    """
    if not isinstance(value, str):
        return True
    text = value.strip()
    if not text:
        return True
    if text.lower() in _PLACEHOLDER_DESCRIPTIONS:
        return True
    if _COMMENTISH_DESC_RE.search(text):
        return True
    if _SOCIAL_IN_DESC_RE.search(text):
        stripped = _URL_SPAN_RE.sub(" ", text)
        stripped = re.sub(r"\s+", " ", stripped).strip()
        # Social URL(s) with little leftover prose → weak; keep long bios that
        # merely mention Instagram once at the end.
        if len(stripped) < 48:
            return True
        if len(stripped.split()) < 8:
            return True
    urls = _URL_SPAN_RE.findall(text)
    if urls and sum(len(u) for u in urls) >= max(24, int(len(text) * 0.35)):
        return True
    if not _is_real_text(text):
        return True
    return False


def _has(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


# ---------------------------------------------------------------------------
# Business
# ---------------------------------------------------------------------------

# Extra keys the caller must pre-fetch and merge into the row dict before
# scoring a business — these aren't columns on `businesses` itself.
BUSINESS_EXTRA_KEYS = (
    "offers_count",           # count(*) from business_offers where business_id = biz.id
    "offers_with_price_count",  # count(*) from business_offers where business_id=... and (price_amount is not null or price_min is not null)
    "offers_featured_count",  # count(*) from business_offers where business_id=... and is_featured = true  (proxy for "promotions")
    "jobs_count",             # count(*) from jobs where business_id = biz.id
)

BUSINESS_WEIGHTS: dict[str, int] = {
    "name": 5,
    "category_id": 5,
    "city": 3,
    "postal_code": 2,
    "address_line": 5,
    "geo": 3,  # latitude AND longitude
    "opening_hours": 8,
    "description": 8,
    "image_url": 5,
    "phone": 5,
    "website": 5,
    "instagram_url": 3,
    "telegram_url": 2,
    "facebook_url": 2,  # not a live column today — see BUSINESS_WEIGHT_TOTAL_NOTE
    "whatsapp": 2,       # not a live column today — see BUSINESS_WEIGHT_TOTAL_NOTE
    "email": 2,
    "booking_url": 3,
    "google_rating": 5,
    "google_reviews_count_gt_10": 3,
    "yelp_rating": 3,
    "offers_count_ge_3": 5,
    "offers_with_price_ge_1": 5,
    "promotions": 3,      # proxy: offers_featured_count >= 1 — no dedicated promotions table exists
    "jobs": 2,            # proxy: jobs_count >= 1
    "source_url": 2,
    "short_description": 2,
}


def calculate_business_completeness_score(row: dict[str, Any]) -> dict[str, Any]:
    """Score a businesses row (+ BUSINESS_EXTRA_KEYS). Returns {score, breakdown}."""
    w = BUSINESS_WEIGHTS
    breakdown: dict[str, int] = {}

    breakdown["name"] = w["name"] if _has(row.get("name")) else 0
    breakdown["category_id"] = w["category_id"] if _has(row.get("category_id")) else 0
    breakdown["city"] = w["city"] if _has(row.get("city")) else 0
    breakdown["postal_code"] = w["postal_code"] if _has(row.get("postal_code")) else 0
    breakdown["address_line"] = w["address_line"] if _has(row.get("address_line")) else 0
    breakdown["geo"] = (
        w["geo"] if row.get("latitude") is not None and row.get("longitude") is not None else 0
    )
    breakdown["opening_hours"] = w["opening_hours"] if _has(row.get("opening_hours")) else 0
    breakdown["description"] = (
        w["description"]
        if _is_real_text(row.get("description")) or _is_real_text(row.get("short_description"))
        else 0
    )
    breakdown["image_url"] = w["image_url"] if _has(row.get("image_url")) else 0
    breakdown["phone"] = w["phone"] if _has(row.get("phone")) else 0
    breakdown["website"] = w["website"] if _has(row.get("website")) else 0
    breakdown["instagram_url"] = w["instagram_url"] if _has(row.get("instagram_url")) else 0
    breakdown["telegram_url"] = w["telegram_url"] if _has(row.get("telegram_url")) else 0
    # facebook_url / whatsapp: score 0 unless the caller's row actually has
    # these keys (i.e. the schema grew them after this was written).
    breakdown["facebook_url"] = w["facebook_url"] if _has(row.get("facebook_url")) else 0
    breakdown["whatsapp"] = w["whatsapp"] if _has(row.get("whatsapp")) else 0
    breakdown["email"] = w["email"] if _has(row.get("email")) else 0
    breakdown["booking_url"] = w["booking_url"] if _has(row.get("booking_url")) else 0
    breakdown["google_rating"] = w["google_rating"] if _has(row.get("google_rating")) else 0
    breakdown["google_reviews_count_gt_10"] = (
        w["google_reviews_count_gt_10"] if (row.get("google_reviews_count") or 0) > 10 else 0
    )
    breakdown["yelp_rating"] = w["yelp_rating"] if _has(row.get("yelp_rating")) else 0
    breakdown["offers_count_ge_3"] = (
        w["offers_count_ge_3"] if (row.get("offers_count") or 0) >= 3 else 0
    )
    breakdown["offers_with_price_ge_1"] = (
        w["offers_with_price_ge_1"] if (row.get("offers_with_price_count") or 0) >= 1 else 0
    )
    breakdown["promotions"] = (
        w["promotions"] if (row.get("offers_featured_count") or 0) >= 1 else 0
    )
    breakdown["jobs"] = w["jobs"] if (row.get("jobs_count") or 0) >= 1 else 0
    breakdown["source_url"] = w["source_url"] if _has(row.get("source_url")) else 0
    breakdown["short_description"] = (
        w["short_description"] if _is_real_text(row.get("short_description"), min_len=15) else 0
    )

    score = sum(breakdown.values())
    return {"score": score, "breakdown": breakdown, "max_possible": sum(w.values())}


# ---------------------------------------------------------------------------
# Professional
# ---------------------------------------------------------------------------

PROFESSIONAL_WEIGHTS: dict[str, int] = {
    "display_name": 8,
    "category_id_not_other": 10,
    "city": 8,
    "postal_code": 3,
    "any_contact": 15,
    "phone": 5,
    "website": 5,
    "instagram_url": 4,
    "telegram_url": 4,
    "email": 3,
    "headline": 5,
    "description": 8,
    "card_summary": 5,
    "image_url": 8,
    "opening_hours": 5,
    "service_area_text": 4,
}

# Slug(s) that count as the "dump" category — not a real classification.
_PRO_OTHER_SLUGS = {"pro_other"}


def calculate_professional_completeness_score(row: dict[str, Any]) -> dict[str, Any]:
    """Score a professionals row. `row` should include `category_slug` (join
    categories on category_id) if you want the pro_other exclusion to work —
    falls back to "has category_id at all" if category_slug isn't provided.
    """
    w = PROFESSIONAL_WEIGHTS
    breakdown: dict[str, int] = {}

    breakdown["display_name"] = w["display_name"] if _has(row.get("display_name")) else 0

    if "category_slug" in row:
        category_ok = _has(row.get("category_id")) and row.get("category_slug") not in _PRO_OTHER_SLUGS
    else:
        category_ok = _has(row.get("category_id"))
    breakdown["category_id_not_other"] = w["category_id_not_other"] if category_ok else 0

    breakdown["city"] = w["city"] if _has(row.get("city")) or _has(row.get("service_area_text")) else 0
    breakdown["postal_code"] = w["postal_code"] if _has(row.get("postal_code")) else 0

    contacts = [row.get("phone"), row.get("website"), row.get("instagram_url"), row.get("telegram_url"), row.get("email")]
    has_any_contact = any(_has(c) for c in contacts)
    breakdown["any_contact"] = w["any_contact"] if has_any_contact else 0

    breakdown["phone"] = w["phone"] if _has(row.get("phone")) else 0
    breakdown["website"] = w["website"] if _has(row.get("website")) else 0
    breakdown["instagram_url"] = w["instagram_url"] if _has(row.get("instagram_url")) else 0
    breakdown["telegram_url"] = w["telegram_url"] if _has(row.get("telegram_url")) else 0
    breakdown["email"] = w["email"] if _has(row.get("email")) else 0
    breakdown["headline"] = w["headline"] if _has(row.get("headline")) else 0
    breakdown["description"] = (
        w["description"]
        if _is_real_text(row.get("description")) or _is_real_text(row.get("short_description"))
        else 0
    )
    breakdown["card_summary"] = w["card_summary"] if _has(row.get("card_summary")) else 0
    breakdown["image_url"] = w["image_url"] if _has(row.get("image_url")) else 0
    breakdown["opening_hours"] = w["opening_hours"] if _has(row.get("opening_hours")) else 0
    breakdown["service_area_text"] = w["service_area_text"] if _has(row.get("service_area_text")) else 0

    score = sum(breakdown.values())
    return {"score": score, "breakdown": breakdown, "max_possible": sum(w.values())}


def calculate_completeness_score(entity_type: str, row: dict[str, Any]) -> dict[str, Any]:
    """Dispatch by entity_type ('business' | 'professional')."""
    if entity_type == "business":
        return calculate_business_completeness_score(row)
    if entity_type == "professional":
        return calculate_professional_completeness_score(row)
    raise ValueError(f"Unknown entity_type for scoring: {entity_type!r}")


# ---------------------------------------------------------------------------
# CLI — fetch real rows (+ extra counts), score, optionally write back
# ---------------------------------------------------------------------------

BUSINESS_SELECT = (
    "id,slug,name,category_id,city,postal_code,address_line,latitude,longitude,"
    "opening_hours,description,short_description,image_url,phone,website,"
    "instagram_url,telegram_url,email,booking_url,google_rating,"
    "google_reviews_count,yelp_rating,source_url,status"
)

PROFESSIONAL_SELECT = (
    "id,slug,display_name,category_id,city,postal_code,service_area_text,"
    "phone,website,instagram_url,telegram_url,email,headline,description,"
    "short_description,card_summary,image_url,opening_hours,status"
)


def _fetch_all(client: SupabaseRest, path: str, select: str, total_limit: int) -> list[dict[str, Any]]:
    """Paginate past the PostgREST max-rows cap (1000/request)."""
    rows: list[dict[str, Any]] = []
    page = 1000
    offset = 0
    while len(rows) < total_limit:
        batch = client._request(
            "GET",
            path,
            params={
                "select": select,
                "status": "eq.approved",
                "order": "id.asc",
                "limit": str(min(page, total_limit - len(rows))),
                "offset": str(offset),
            },
        ) or []
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def _fetch_business_extras(client: SupabaseRest, business_ids: list[str]) -> dict[str, dict[str, int]]:
    """One pass over business_offers + jobs for the given business ids."""
    extras: dict[str, dict[str, int]] = {
        bid: {"offers_count": 0, "offers_with_price_count": 0, "offers_featured_count": 0, "jobs_count": 0}
        for bid in business_ids
    }
    if not business_ids:
        return extras
    chunk = 50
    for i in range(0, len(business_ids), chunk):
        ids = business_ids[i : i + chunk]
        values = ",".join(ids)
        offers = client._request(
            "GET",
            "/business_offers",
            params={
                "select": "business_id,price_amount,price_min,is_featured",
                "business_id": f"in.({values})",
            },
        ) or []
        for o in offers:
            bid = o.get("business_id")
            if bid not in extras:
                continue
            extras[bid]["offers_count"] += 1
            if o.get("price_amount") is not None or o.get("price_min") is not None:
                extras[bid]["offers_with_price_count"] += 1
            if o.get("is_featured"):
                extras[bid]["offers_featured_count"] += 1
        jobs = client._request(
            "GET",
            "/jobs",
            params={"select": "business_id", "business_id": f"in.({values})"},
        ) or []
        for j in jobs:
            bid = j.get("business_id")
            if bid in extras:
                extras[bid]["jobs_count"] += 1
    return extras


def main() -> int:
    parser = argparse.ArgumentParser(description="Compute (and optionally write) completeness_score")
    parser.add_argument("--entity", choices=["business", "professional"], required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    results: list[dict[str, Any]] = []

    if args.entity == "business":
        rows = _fetch_all(client, "/businesses", BUSINESS_SELECT, args.limit)
        extras = _fetch_business_extras(client, [r["id"] for r in rows])
        for r in rows:
            merged = {**r, **extras.get(r["id"], {})}
            scored = calculate_business_completeness_score(merged)
            results.append({"id": r["id"], "slug": r.get("slug"), **scored})
            if args.apply:
                client._request(
                    "PATCH",
                    "/businesses",
                    params={"id": f"eq.{r['id']}"},
                    body={"completeness_score": scored["score"]},
                    prefer="return=minimal",
                )
    else:
        rows = _fetch_all(client, "/professionals", PROFESSIONAL_SELECT, args.limit)
        for r in rows:
            scored = calculate_professional_completeness_score(r)
            results.append({"id": r["id"], "slug": r.get("slug"), **scored})
            if args.apply:
                client._request(
                    "PATCH",
                    "/professionals",
                    params={"id": f"eq.{r['id']}"},
                    body={"completeness_score": scored["score"]},
                    prefer="return=minimal",
                )

    print(json.dumps({"mode": "apply" if args.apply else "dry_run", "entity": args.entity, "count": len(results)}))
    for r in results:
        print(f"- {r.get('slug')}: {r['score']}/{r['max_possible']}")
    print(json.dumps(results, ensure_ascii=False, indent=2))
    if args.entity == "business":
        print(f"\nNOTE: {BUSINESS_WEIGHT_TOTAL_NOTE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
