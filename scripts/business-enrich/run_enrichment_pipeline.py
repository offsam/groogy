#!/usr/bin/env python3
"""Universal enrichment pipeline for the import_review_items queue.

Takes queue records (pending / in_review / needs_more_info) for one entity
type and fills EMPTY fields only, in this fixed order:

  step 1  source_text  — extract phone/email/website/instagram/telegram
                         from the record's own source_text + description
  step 2  website      — if the record has (or step 1 found) a website and
                         contacts are still missing, fetch the site and
                         extract phone/email/instagram from it
  step 3  directories  — match against local directory dumps
                         (data/yellow_pages/*_latest.json: svoi, rop,
                         boston, echoru) by phone or exact name; fill
                         phone/email/instagram/city/preview image

After each record the completeness score is recomputed (before → after) so
the effect of the run is visible per record and in totals.

Safe by design:
  * dry-run is the DEFAULT — nothing is written without --apply
  * fill-empty only — a non-empty queue field is never overwritten
  * review fields (status, notes, decisions) are never touched

Usage (run these exactly; nothing else is required):

  # test on 5 records, no writes
  python3 scripts/business-enrich/run_enrichment_pipeline.py --entity business --limit 5

  # real run, writes to the queue, batches of 50
  python3 scripts/business-enrich/run_enrichment_pipeline.py --entity business --apply

  # other entity types
  python3 scripts/business-enrich/run_enrichment_pipeline.py --entity professional --limit 5
  python3 scripts/business-enrich/run_enrichment_pipeline.py --entity listing --limit 5

  # offline mode (skip the website-fetch step)
  python3 scripts/business-enrich/run_enrichment_pipeline.py --entity business --no-website --limit 5

Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
(load_env() picks them up automatically, same as the other scripts here).

A JSON report is written to data/enrichment_pipeline/ after every run.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from contacts import (  # noqa: E402
    extract_emails,
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
    normalize_phone,
)
from completeness_score import calculate_completeness_score  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "enrichment_pipeline"
OUT.mkdir(parents=True, exist_ok=True)

DIRECTORY_DUMPS = [
    ROOT / "scripts" / "business-enrich" / "data" / "yellow_pages" / name
    for name in (
        "svoi_cards_latest.json",
        "rop_cards_latest.json",
        "boston_pages_latest.json",
        "echoru_latest.json",
    )
]

# --entity value → import_review_items.entity_type
ENTITY_MAP = {
    "business": "business",
    "professional": "private_specialist",
    "listing": "marketplace_listing",
}

QUEUE_STATUSES = "(pending,in_review,needs_more_info)"

QUEUE_SELECT = (
    "id,entity_type,review_status,title,business_name,person_name,category,"
    "description,source_text,source_url,city,state,price,currency,"
    "phone,whatsapp,email,website,instagram,telegram_username,telegram_user_id,"
    "preview_image_url,photos_count"
)


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def empty_str(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def empty_list(v: Any) -> bool:
    return not (isinstance(v, list) and len(v) > 0)


def phone_digits(raw: str) -> str:
    """Last 10 digits — the US-local key used for matching."""
    d = re.sub(r"\D", "", raw or "")
    return d[-10:] if len(d) >= 10 else ""


def norm_name(raw: str) -> str:
    return re.sub(r"[^a-zа-я0-9]", "", (raw or "").lower())


def norm_instagram(raw: Any) -> str | None:
    """Any instagram spelling → bare handle, or None if it isn't one."""
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if not raw:
        return None
    v = str(raw).strip()
    m = re.search(r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})", v, re.I)
    handle = (m.group(1) if m else v.lstrip("@")).split("?")[0].split("/")[0]
    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", handle or ""):
        return None
    if handle.lower() in {"reel", "p", "stories", "explore", "accounts"}:
        return None
    return handle


def norm_website(raw: Any) -> str | None:
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if not raw:
        return None
    v = str(raw).strip()
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    low = v.lower()
    if any(x in low for x in ("instagram.com", "facebook.com", "fb.com", "t.me/", "telegram.me", "wa.me/")):
        return None
    if "." not in v.split("//", 1)[-1]:
        return None
    return v.split("?")[0].rstrip("/")[:300]


def item_text(item: dict[str, Any]) -> str:
    return "\n".join(
        str(x)
        for x in (item.get("source_text"), item.get("description"), item.get("title"), item.get("business_name"))
        if x
    )


# ---------------------------------------------------------------------------
# step 1 — source_text
# ---------------------------------------------------------------------------

def step_source_text(item: dict[str, Any], patch: dict[str, Any]) -> list[str]:
    """Extract contacts from the record's own text. Fill-empty only."""
    text = item_text(item)
    if not text.strip():
        return []
    filled: list[str] = []

    if empty_list(item.get("phone")) and "phone" not in patch:
        phones = []
        for p in extract_phones(text):
            np = normalize_phone(p) or p
            if phone_digits(np) and np not in phones:
                phones.append(np)
        if phones:
            patch["phone"] = phones[:3]
            filled.append("phone")

    if empty_list(item.get("email")) and "email" not in patch:
        emails = extract_emails(text)
        if emails:
            patch["email"] = [e.lower() for e in emails[:3]]
            filled.append("email")

    if empty_list(item.get("website")) and "website" not in patch:
        web = norm_website((extract_websites(text) or [None])[0])
        if web:
            patch["website"] = [web]
            filled.append("website")

    if empty_list(item.get("instagram")) and "instagram" not in patch:
        ig = norm_instagram((extract_instagram(text) or [None])[0])
        if ig:
            patch["instagram"] = [ig]
            filled.append("instagram")

    if empty_str(item.get("telegram_username")) and "telegram_username" not in patch:
        tgs = extract_telegram(text)
        if tgs:
            h = tgs[0].lstrip("@")
            if re.fullmatch(r"[A-Za-z0-9_]{4,32}", h) and not h.isdigit():
                patch["telegram_username"] = h
                filled.append("telegram_username")

    return filled


# ---------------------------------------------------------------------------
# step 2 — website
# ---------------------------------------------------------------------------

# Big platforms/marketplaces whose contact pages describe THE PLATFORM, not the
# queue record's business (found in testing: a post recommending vistaprint.com
# pulled Vistaprint's own support phone). Extends JUNK_HOST_PARTS from
# enrich_published_businesses.py, which is also applied below.
PLATFORM_HOSTS = (
    "vistaprint.com",
    "wix.com",
    "squarespace.com",
    "godaddy.com",
    "weebly.com",
    "canva.com",
    "amazon.com",
    "ebay.com",
    "walmart.com",
    "google.com",
    "yelp.com",
    "zillow.com",
    "craigslist.org",
    "avito.ru",
    "wildberries.ru",
    "ozon.ru",
)


def is_fetchable_business_site(url: str) -> bool:
    from enrich_published_businesses import is_junk_website  # shared denylist

    low = url.lower()
    if is_junk_website(low):
        return False
    return not any(h in low for h in PLATFORM_HOSTS)


def step_website(item: dict[str, Any], patch: dict[str, Any], max_pages: int) -> list[str]:
    """Fetch the record's website and extract still-missing contacts."""
    still_missing = (
        (empty_list(item.get("phone")) and "phone" not in patch)
        or (empty_list(item.get("email")) and "email" not in patch)
        or (empty_list(item.get("instagram")) and "instagram" not in patch)
    )
    if not still_missing:
        return []
    site = norm_website(item.get("website") or patch.get("website"))
    if not site or not is_fetchable_business_site(site):
        return []

    from web_enrichment import extract_website_profile_deep  # slow import — only when needed

    try:
        profile = extract_website_profile_deep(site, max_pages=max_pages)
    except Exception as exc:  # network errors must never kill the batch
        print(f"    website fetch failed: {exc}")
        return []
    if profile.get("status") != "ok":
        return []

    filled: list[str] = []
    if empty_list(item.get("phone")) and "phone" not in patch and profile.get("phone"):
        phones = [normalize_phone(p) or p for p in profile["phone"] if phone_digits(p)]
        if phones:
            patch["phone"] = phones[:3]
            filled.append("phone")
    if empty_list(item.get("email")) and "email" not in patch and profile.get("email"):
        patch["email"] = [str(e).lower() for e in profile["email"][:3]]
        filled.append("email")
    if empty_list(item.get("instagram")) and "instagram" not in patch:
        for link in profile.get("social_links") or []:
            ig = norm_instagram(link)
            if ig:
                patch["instagram"] = [ig]
                filled.append("instagram")
                break
    return filled


# ---------------------------------------------------------------------------
# step 3 — directories (local dumps, no network)
# ---------------------------------------------------------------------------

def load_directory_index() -> tuple[dict[str, dict], dict[str, dict]]:
    """Index all local directory cards by phone digits and by normalized name."""
    by_phone: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    for path in DIRECTORY_DUMPS:
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        cards = data.get("cards") or [] if isinstance(data, dict) else data
        for card in cards:
            if not isinstance(card, dict):
                continue
            for p in card.get("phones") or []:
                key = phone_digits(str(p))
                if key and key not in by_phone:
                    by_phone[key] = card
            name = norm_name(card.get("display_name") or "")
            if len(name) >= 6 and name not in by_name:
                by_name[name] = card
    return by_phone, by_name


def step_directories(
    item: dict[str, Any],
    patch: dict[str, Any],
    by_phone: dict[str, dict],
    by_name: dict[str, dict],
) -> tuple[list[str], str | None]:
    """Match a directory card by phone (strong) or exact name (weaker)."""
    card = None
    match_kind = None
    for p in (item.get("phone") or []) + (patch.get("phone") or []):
        card = by_phone.get(phone_digits(str(p)))
        if card:
            match_kind = "phone"
            break
    if not card:
        for raw in (item.get("business_name"), item.get("person_name"), item.get("title")):
            name = norm_name(raw or "")
            if len(name) >= 6 and name in by_name:
                card = by_name[name]
                match_kind = "name"
                break
    if not card:
        return [], None

    filled: list[str] = []
    if empty_list(item.get("phone")) and "phone" not in patch and card.get("phones"):
        phones = [normalize_phone(str(p)) or str(p) for p in card["phones"] if phone_digits(str(p))]
        if phones:
            patch["phone"] = phones[:3]
            filled.append("phone")
    if empty_list(item.get("email")) and "email" not in patch and card.get("emails"):
        patch["email"] = [str(e).lower() for e in card["emails"][:3]]
        filled.append("email")
    if empty_list(item.get("instagram")) and "instagram" not in patch:
        ig = norm_instagram(card.get("instagram"))
        if ig:
            patch["instagram"] = [ig]
            filled.append("instagram")
    if empty_str(item.get("city")) and "city" not in patch and (card.get("city") or "").strip():
        patch["city"] = str(card["city"]).strip()
        filled.append("city")
    if empty_str(item.get("preview_image_url")) and "preview_image_url" not in patch:
        cover = (card.get("cover_image_url") or "").strip()
        if cover.startswith("http"):
            patch["preview_image_url"] = cover[:500]
            filled.append("preview_image_url")
    return filled, match_kind


# ---------------------------------------------------------------------------
# completeness score on a queue record
# ---------------------------------------------------------------------------

LISTING_WEIGHTS = {"title": 20, "price": 20, "description": 20, "image": 15, "city": 10, "contact": 15}


def score_queue_item(entity: str, item: dict[str, Any], patch: dict[str, Any]) -> int:
    """Completeness of the queue record with `patch` applied on top.

    business/professional reuse calculate_completeness_score() with queue
    fields mapped into the scorer's shape (queue has no hours/offers/etc.,
    so this is a floor, not the final published score). `category` presence
    stands in for category_id. Listings use the small table above.
    """
    row = {**item, **patch}

    def first(key: str) -> Any:
        v = row.get(key)
        return v[0] if isinstance(v, list) and v else (v if not isinstance(v, list) else None)

    has_contact = any(
        (row.get(k) if not isinstance(row.get(k), list) else row.get(k))
        for k in ("phone", "whatsapp", "email", "website", "instagram", "telegram_username")
    )

    if entity == "listing":
        s = 0
        if (row.get("title") or row.get("business_name") or "").strip():
            s += LISTING_WEIGHTS["title"]
        if row.get("price") is not None:
            s += LISTING_WEIGHTS["price"]
        if ((row.get("description") or row.get("source_text") or "").strip()):
            s += LISTING_WEIGHTS["description"]
        if (row.get("preview_image_url") or "").strip() or (row.get("photos_count") or 0) > 0:
            s += LISTING_WEIGHTS["image"]
        if (row.get("city") or "").strip():
            s += LISTING_WEIGHTS["city"]
        if has_contact:
            s += LISTING_WEIGHTS["contact"]
        return s

    mapped = {
        "city": row.get("city"),
        "phone": first("phone"),
        "website": first("website"),
        "email": first("email"),
        "instagram_url": first("instagram"),
        "telegram_url": row.get("telegram_username"),
        "description": row.get("description") or row.get("source_text"),
        "image_url": row.get("preview_image_url"),
        "source_url": row.get("source_url"),
        "category_id": row.get("category"),  # presence proxy
    }
    if entity == "business":
        mapped["name"] = row.get("business_name") or row.get("title")
        return calculate_completeness_score("business", mapped)["score"]
    mapped["display_name"] = row.get("person_name") or row.get("title")
    return calculate_completeness_score("professional", mapped)["score"]


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def fetch_batch(client: SupabaseRest, entity_type: str, offset: int, size: int) -> list[dict[str, Any]]:
    return client._request(
        "GET",
        "/import_review_items",
        params={
            "select": QUEUE_SELECT,
            "entity_type": f"eq.{entity_type}",
            "review_status": f"in.{QUEUE_STATUSES}",
            "order": "id.asc",
            "limit": str(size),
            "offset": str(offset),
        },
    ) or []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--entity", choices=sorted(ENTITY_MAP), required=True)
    parser.add_argument("--apply", action="store_true", help="write patches (default: dry-run)")
    parser.add_argument("--limit", type=int, default=0, help="max records total (0 = all)")
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--no-website", action="store_true", help="skip the website-fetch step (offline)")
    parser.add_argument("--website-pages", type=int, default=2, help="max pages per site fetch")
    args = parser.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    entity_type = ENTITY_MAP[args.entity]
    by_phone, by_name = load_directory_index()
    print(f"entity={args.entity} ({entity_type})  mode={'APPLY' if args.apply else 'dry-run'}")
    print(f"directory index: {len(by_phone)} phones, {len(by_name)} names")

    results: list[dict[str, Any]] = []
    step_hits = {"source_text": 0, "website": 0, "directories": 0}
    field_hits: dict[str, int] = {}
    processed = updated = 0
    offset = 0
    batch_no = 0

    while True:
        size = args.batch_size
        if args.limit:
            size = min(size, args.limit - processed)
            if size <= 0:
                break
        batch = fetch_batch(client, entity_type, offset, size)
        if not batch:
            break
        batch_no += 1
        print(f"\n— batch {batch_no}: {len(batch)} records (offset {offset})")

        for item in batch:
            processed += 1
            patch: dict[str, Any] = {}
            score_before = score_queue_item(args.entity, item, {})

            f1 = step_source_text(item, patch)
            f2 = [] if args.no_website else step_website(item, patch, args.website_pages)
            f3, match_kind = step_directories(item, patch, by_phone, by_name)

            score_after = score_queue_item(args.entity, item, patch)
            label = (item.get("business_name") or item.get("person_name") or item.get("title") or item["id"])[:60]

            if patch:
                updated += 1
                for step_name, fields in (("source_text", f1), ("website", f2), ("directories", f3)):
                    if fields:
                        step_hits[step_name] += 1
                for k in patch:
                    field_hits[k] = field_hits.get(k, 0) + 1
                if args.apply:
                    client.patch(
                        "import_review_items",
                        {"id": f"eq.{item['id']}"},
                        {**patch, "updated_at": datetime.now(timezone.utc).isoformat()},
                    )
                steps_str = " ".join(
                    f"{n}({','.join(f)})" for n, f in (("source_text", f1), ("website", f2), ("directories", f3)) if f
                )
                if match_kind:
                    steps_str += f" [dir match: {match_kind}]"
                print(f"  {'APPLIED' if args.apply else 'would fill'}  {label}: {steps_str}  score {score_before}→{score_after}")
            else:
                print(f"  no gaps fillable  {label}  score {score_before}")

            results.append(
                {
                    "id": item["id"],
                    "label": label,
                    "score_before": score_before,
                    "score_after": score_after,
                    "patch": patch,
                    "steps": {"source_text": f1, "website": f2, "directories": f3},
                    "directory_match": match_kind,
                }
            )

        offset += len(batch)
        if len(batch) < size:
            break

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "entity": args.entity,
        "processed": processed,
        "updated": updated,
        "step_hits": step_hits,
        "field_hits": dict(sorted(field_hits.items(), key=lambda x: -x[1])),
        "avg_score_before": round(sum(r["score_before"] for r in results) / len(results), 1) if results else None,
        "avg_score_after": round(sum(r["score_after"] for r in results) / len(results), 1) if results else None,
        "records": results,
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if args.apply else 'dry_run'}_{args.entity}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"{'apply' if args.apply else 'dry_run'}_{args.entity}_latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("\n" + json.dumps({k: report[k] for k in ("mode", "entity", "processed", "updated", "step_hits", "field_hits", "avg_score_before", "avg_score_after")}, ensure_ascii=False, indent=2))
    print("report", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
