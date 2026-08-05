#!/usr/bin/env python3
"""Publish classified recommendations into professionals / businesses catalogs.

Uses target_bucket + category_guess (+ text) to pick the right leaf category.

  professional → public.professionals (professional taxonomy)
  business     → public.businesses (business taxonomy)
  service/other/unclassified → skipped

Match existing by phone / Instagram (fill-empty merge). Else create.

Usage:
  python3 scripts/business-enrich/publish_recommendation_catalog.py --dry-run
  python3 scripts/business-enrich/publish_recommendation_catalog.py --apply
  python3 scripts/business-enrich/publish_recommendation_catalog.py --apply --bucket professional
  python3 scripts/business-enrich/publish_recommendation_catalog.py --apply --bucket business
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
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from source_kind import resolve_source_kind  # noqa: E402
from contacts import normalize_phone  # noqa: E402
from backfill_professional_categories import infer_slug as infer_pro_slug  # noqa: E402
from promotions_from_text import (  # noqa: E402
    add_missing_entity_promotions,
    promotions_from_ad_text,
    strip_promotion_blocks,
)
from recommendation_subject import (  # noqa: E402
    clean_public_description,
    extract_employer,
    is_corporate_instagram,
    personal_website_or_none,
    resolve_professional_display_name,
    short_teaser,
    strip_recommender_voice,
)


def public_narrative(rec: dict[str, Any], text: str | None) -> str | None:
    """Third-party opinion stays in «Рекомендации сообщества», not in the card."""
    if not text:
        return None
    if int(rec.get("third_party_mention_count") or 0) > 0:
        return strip_recommender_voice(text)
    return text

OUT = Path(__file__).resolve().parent / "data" / "recommendation_catalog_publish"
OUT.mkdir(parents=True, exist_ok=True)

BATCH = "recommendation_catalog_publish_v1"

# category_guess → professional leaf slug
GUESS_TO_PRO: dict[str, str] = {
    "визаж / beauty": "beauty",
    "парикмахер": "beauty",
    "косметология": "beauty",
    "массаж": "massage_wellness",
    "репетитор": "education",
    "няня": "childcare",
    "риелтор": "real_estate",
    "юрист": "legal",
    "бухгалтерия / нотариус": "finance",
    "фитнес": "fitness",
    "автосервис": "auto",
    "авто / страхование": "insurance",
    "ремонт / стройка": "home_services",
    "клининг": "home_services",
    "переезд / перевозки": "home_services",
    "кейтеринг / цветы": "home_food",
    "фото / видео": "photo_video",
    "услуга / специалист": "pro_other",
}

# category_guess → business leaf slug
GUESS_TO_BIZ: dict[str, str] = {
    "визаж / beauty": "beauty",
    "парикмахер": "beauty",
    "косметология": "beauty",
    "массаж": "beauty",
    "репетитор": "education",
    "риелтор": "real_estate",
    "юрист": "legal",
    "бухгалтерия / нотариус": "finance",
    "фитнес": "fitness",
    "автосервис": "auto",
    "авто / страхование": "insurance",
    "ремонт / стройка": "services",
    "клининг": "services",
    "переезд / перевозки": "services",
    "кейтеринг / цветы": "events",
    "фото / видео": "services",
    "няня": "services",
    "услуга / специалист": "services",
}

BIZ_INFER_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("beauty", re.compile(r"визаж|маникюр|парикмахер|салон|beauty|косметолог|барбер", re.I)),
    ("auto", re.compile(r"автосервис|механик|тониров|детейлинг|авто\b", re.I)),
    ("legal", re.compile(r"юрист|адвокат|нотариус|legal", re.I)),
    ("finance", re.compile(r"бухгалтер|tax\b|налог|финанс", re.I)),
    ("insurance", re.compile(r"страхов", re.I)),
    ("real_estate", re.compile(r"риелтор|недвижим|realtor", re.I)),
    ("fitness", re.compile(r"фитнес|gym|йога|спорт", re.I)),
    ("education", re.compile(r"школ|репетитор|tutor|образован", re.I)),
    ("medical", re.compile(r"клиник|медицин|стоматолог|dentist", re.I)),
    ("restaurants", re.compile(r"ресторан|кафе|кухн|кейтеринг|bakery", re.I)),
    ("events", re.compile(r"event|мероприят|цветы|флорист", re.I)),
    ("pets", re.compile(r"вет|зоо|pet\b|собак|кошк", re.I)),
    ("services", re.compile(r"ремонт|клининг|уборк|переезд|handyman|студия", re.I)),
]


def fetch_all(
    client: SupabaseRest, path: str, select: str, extra: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        params: dict[str, str] = {
            "select": select,
            "order": "id.asc",
            "offset": str(offset),
            "limit": "1000",
        }
        if extra:
            params.update(extra)
        batch = client._request("GET", path, params=params) or []
        out.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return out


def plausible_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    ph = normalize_phone(raw)
    if not ph:
        return None
    digits = re.sub(r"\D", "", ph)
    if len(digits) == 11 and digits.startswith("1") and (
        digits[1] in "01" or digits[4] in "01"
    ):
        return None
    return ph


def ig_handle(raw: Any) -> str | None:
    if raw is None:
        return None
    v = str(raw).strip().lstrip("@")
    m = re.search(r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})", v, re.I)
    handle = (m.group(1) if m else v).split("?")[0].split("/")[0]
    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", handle or ""):
        return None
    if handle.lower() in {"reel", "p", "stories", "explore", "accounts"}:
        return None
    return handle.lower()


def tg_url_from_websites(websites: list[Any]) -> str | None:
    for w in websites or []:
        m = re.search(r"(?:t\.me|telegram\.me)/([A-Za-z0-9_]{4,32})", str(w), re.I)
        if m and not m.group(1).isdigit() and m.group(1).lower() not in {"c", "s"}:
            return f"https://t.me/{m.group(1)}"
    return None


def plain_website(websites: list[Any]) -> str | None:
    for w in websites or []:
        s = str(w).strip()
        if not s.startswith("http"):
            continue
        low = s.lower()
        if any(
            x in low
            for x in (
                "instagram.com",
                "facebook.com",
                "t.me/",
                "telegram.me",
                "wa.me",
            )
        ):
            continue
        return s.split("?")[0][:300]
    return None


def slugify(name: str, *, prefix: str = "item") -> str:
    raw = (name or "").strip().lower()
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", raw) and len(raw) >= 3:
        return raw[:60]
    norm = unicodedata.normalize("NFKD", raw)
    ascii_only = "".join(ch for ch in norm if not unicodedata.combining(ch))
    s = re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")
    if len(s) >= 3 and re.search(r"[a-z]", s):
        return s[:60]
    digest = hashlib.md5(raw.encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{digest}"


def unique_slug(client: SupabaseRest, table: str, base: str) -> str:
    candidate = base
    n = 0
    while True:
        rows = (
            client._request(
                "GET",
                f"/{table}",
                params={"select": "id", "slug": f"eq.{candidate}", "limit": "1"},
            )
            or []
        )
        if not rows:
            return candidate
        n += 1
        candidate = f"{base}-{n}"[:70]


def rec_text(rec: dict[str, Any]) -> str:
    return "\n".join(
        str(x)
        for x in (
            rec.get("display_name"),
            rec.get("category_guess"),
            *(rec.get("comment_texts") or [])[:4],
            *(rec.get("request_snippets") or [])[:2],
        )
        if x
    )


def resolve_pro_category_slug(rec: dict[str, Any]) -> str:
    guess = (rec.get("category_guess") or "").strip().lower()
    if guess in GUESS_TO_PRO:
        # Still allow text to refine notarус vs бухгалтер
        inferred = infer_pro_slug(rec_text(rec))
        if guess == "бухгалтерия / нотариус":
            return inferred if inferred in {"finance", "legal"} else "finance"
        if inferred != "pro_other":
            # Prefer stronger text inference when guess is generic
            if guess in {"услуга / специалист", "кейтеринг / цветы"}:
                return inferred
        return GUESS_TO_PRO[guess]
    return infer_pro_slug(rec_text(rec))


def resolve_biz_category_slug(rec: dict[str, Any]) -> str:
    guess = (rec.get("category_guess") or "").strip().lower()
    if guess in GUESS_TO_BIZ:
        return GUESS_TO_BIZ[guess]
    blob = rec_text(rec)
    for slug, pat in BIZ_INFER_RULES:
        if pat.search(blob):
            return slug
    return "services"


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def empty_image(url: Any) -> bool:
    u = (url or "").strip()
    if not u:
        return True
    low = u.lower()
    return low.endswith(".svg") or "placeholder" in low or "/images/categories/" in low


def mark_recommendation(
    client: SupabaseRest,
    rec_id: str,
    *,
    entity_type: str,
    entity_id: str,
    dry_run: bool,
) -> None:
    if dry_run:
        return
    client._request(
        "PATCH",
        "/import_comment_recommendations",
        params={"id": f"eq.{rec_id}"},
        body={
            "status": "approved",
            "published_entity_type": entity_type,
            "published_entity_id": entity_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        prefer="return=minimal",
    )


def merge_into_professional(
    client: SupabaseRest,
    pro: dict[str, Any],
    rec: dict[str, Any],
    category_id: str | None,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if empty(pro.get("category_id")) and category_id:
        patch["category_id"] = category_id
    if empty_image(pro.get("image_url")) and not empty_image(rec.get("cover_image_url")):
        patch["image_url"] = rec["cover_image_url"]
    if empty(pro.get("phone")):
        for p in rec.get("phones") or []:
            ph = plausible_phone(p)
            if ph:
                patch["phone"] = ph
                break
    if empty(pro.get("instagram_url")):
        for ig in rec.get("instagram") or []:
            h = ig_handle(ig)
            if h:
                patch["instagram_url"] = f"https://www.instagram.com/{h}"
                break
    if empty(pro.get("website")):
        w = plain_website(rec.get("websites") or [])
        if w:
            patch["website"] = w
    if empty(pro.get("telegram_url")):
        tg = tg_url_from_websites(rec.get("websites") or [])
        if tg:
            patch["telegram_url"] = tg
    if empty(pro.get("city")) and rec.get("city"):
        patch["city"] = str(rec["city"])[:80]
    if not dry_run and patch:
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        client._request(
            "PATCH",
            "/professionals",
            params={"id": f"eq.{pro['id']}"},
            body=patch,
            prefer="return=minimal",
        )
    return patch


def merge_into_business(
    client: SupabaseRest,
    biz: dict[str, Any],
    rec: dict[str, Any],
    category_id: str | None,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if empty(biz.get("category_id")) and category_id:
        patch["category_id"] = category_id
    if empty_image(biz.get("image_url")) and not empty_image(rec.get("cover_image_url")):
        patch["image_url"] = rec["cover_image_url"]
    if empty(biz.get("phone")):
        for p in rec.get("phones") or []:
            ph = plausible_phone(p)
            if ph:
                patch["phone"] = ph
                break
    if empty(biz.get("instagram_url")):
        for ig in rec.get("instagram") or []:
            h = ig_handle(ig)
            if h:
                patch["instagram_url"] = f"https://www.instagram.com/{h}"
                break
    if empty(biz.get("website")):
        w = plain_website(rec.get("websites") or [])
        if w:
            patch["website"] = w
    if empty(biz.get("telegram_url")):
        tg = tg_url_from_websites(rec.get("websites") or [])
        if tg:
            patch["telegram_url"] = tg
    if empty(biz.get("city")) and rec.get("city"):
        patch["city"] = str(rec["city"])[:80]
    if not dry_run and patch:
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        client._request(
            "PATCH",
            "/businesses",
            params={"id": f"eq.{biz['id']}"},
            body=patch,
            prefer="return=minimal",
        )
    return patch


def create_professional(
    client: SupabaseRest,
    rec: dict[str, Any],
    *,
    category_id: str | None,
    dry_run: bool,
) -> str:
    name = resolve_professional_display_name(rec) or (rec.get("display_name") or "Специалист").strip()
    name = name[:120]
    base = slugify(name, prefix="pro")
    slug = unique_slug(client, "professionals", base) if not dry_run else base
    channel = (rec.get("source_channel") or "").lower()
    source_type = "TELEGRAM" if channel == "telegram" else "FACEBOOK" if channel == "facebook" else "IMPORT"
    phone = None
    for p in rec.get("phones") or []:
        phone = plausible_phone(p)
        if phone:
            break
    ig = None
    for x in rec.get("instagram") or []:
        if is_corporate_instagram(str(x)):
            continue
        h = ig_handle(x)
        if h:
            ig = f"https://www.instagram.com/{h}"
            break
    desc_parts = [t for t in (rec.get("comment_texts") or [])[:3] if t]
    raw_description = "\n\n".join(desc_parts)[:4000] or None
    promotions = promotions_from_ad_text(raw_description)
    narrative = strip_promotion_blocks(raw_description, promotions) or raw_description
    narrative = public_narrative(rec, narrative)
    description = clean_public_description(narrative)
    short = short_teaser(description or narrative)
    employer = extract_employer(raw_description or "")
    employer_name = (employer or {}).get("employer_name")
    employer_role = (employer or {}).get("employer_role")
    website = personal_website_or_none(
        rec.get("websites") or [], employer_name=employer_name
    )
    now = datetime.now(timezone.utc).isoformat()
    body = {
        "owner_profile_id": None,
        "created_by_profile_id": None,
        "source_type": source_type,
        "source_record_id": rec["id"],
        "source_url": (rec.get("source_post_urls") or [None])[0],
        "imported_at": now,
        "import_batch_id": BATCH,
        "display_name": name,
        "slug": slug,
        "headline": (short or rec.get("category_guess") or "")[:160] or None,
        "short_description": short,
        "description": description,
        "image_url": rec.get("cover_image_url") if not empty_image(rec.get("cover_image_url")) else None,
        "status": "approved",
        "visibility": "public",
        "category_id": category_id,
        "city": rec.get("city"),
        "region": None,
        "state_code": rec.get("state_code") or None,
        "location_precision": "city" if rec.get("city") else None,
        "public_exact_address": False,
        "phone": phone,
        "website": website,
        "instagram_url": ig,
        "telegram_url": tg_url_from_websites(rec.get("websites") or []),
        "employer_name": employer_name,
        "employer_role": employer_role,
        "employer_business_id": None,
        "third_party_mention_count": int(rec.get("third_party_mention_count") or 0),
        "self_ad_mention_count": int(rec.get("self_ad_mention_count") or 0),
        "published_at": now,
    }
    # Only link a catalog business when the employer itself is Russian/diaspora.
    if employer and employer.get("is_russian_catalog") and employer_name and not dry_run:
        biz_id = find_or_create_russian_employer_business(
            client, employer_name=employer_name, rec=rec
        )
        if biz_id:
            body["employer_business_id"] = biz_id
    if dry_run:
        return f"dry-{slug}"
    rows = client._request(
        "POST",
        "/professionals",
        body=body,
        prefer="return=representation",
    )
    if isinstance(rows, list) and rows:
        pro_id = rows[0]["id"]
        add_missing_entity_promotions(
            client,
            owner_type="professional",
            owner_id=pro_id,
            promotions=promotions,
            category_id=category_id,
        )
        return pro_id
    raise RuntimeError(f"professional insert failed for {name}")


def find_or_create_russian_employer_business(
    client: SupabaseRest,
    *,
    employer_name: str,
    rec: dict[str, Any],
) -> str | None:
    """Attach only Russian/diaspora employers to the public business catalog."""
    name = employer_name.strip()[:120]
    if not name:
        return None
    existing = (
        client._request(
            "GET",
            "/businesses",
            params={
                "select": "id,name,status",
                "name": f"ilike.{name}",
                "status": "eq.approved",
                "limit": "3",
            },
        )
        or []
    )
    for row in existing:
        if names_match_local(row.get("name"), name):
            return row["id"]
    website = plain_website(rec.get("websites") or [])
    phone = None
    for p in rec.get("phones") or []:
        phone = plausible_phone(p)
        if phone:
            break
    now = datetime.now(timezone.utc).isoformat()
    base = slugify(name, prefix="biz")
    slug = unique_slug(client, "businesses", base)
    rows = client._request(
        "POST",
        "/businesses",
        body={
            "name": name,
            "slug": slug,
            "status": "approved",
            "website": website,
            "phone": phone,
            "city": rec.get("city"),
            "state_code": rec.get("state_code") or None,
            "source_url": (rec.get("source_post_urls") or [None])[0],
            "source_kind": resolve_source_kind(
                (rec.get("source_post_urls") or [None])[0],
                rec.get("directory_source") or rec.get("source_channel"),
            ),
            "created_at": now,
            "updated_at": now,
        },
        prefer="return=representation",
    )
    if isinstance(rows, list) and rows:
        return rows[0]["id"]
    return None


def names_match_local(a: Any, b: Any) -> bool:
    na = re.sub(r"[^a-z0-9а-яё]+", "", str(a or "").lower())
    nb = re.sub(r"[^a-z0-9а-яё]+", "", str(b or "").lower())
    return bool(na and nb and (na == nb or na in nb or nb in na))


def create_business(
    client: SupabaseRest,
    rec: dict[str, Any],
    *,
    category_id: str | None,
    dry_run: bool,
) -> str:
    name = (rec.get("display_name") or "Бизнес").strip()[:120]
    base = slugify(name, prefix="biz")
    slug = unique_slug(client, "businesses", base) if not dry_run else base
    phone = None
    for p in rec.get("phones") or []:
        phone = plausible_phone(p)
        if phone:
            break
    website = plain_website(rec.get("websites") or [])
    desc_parts = [t for t in (rec.get("comment_texts") or [])[:3] if t]
    raw_description = "\n\n".join(desc_parts)[:4000] or None
    promotions = promotions_from_ad_text(raw_description)
    narrative = strip_promotion_blocks(raw_description, promotions) or raw_description
    narrative = public_narrative(rec, narrative)
    description = clean_public_description(narrative)
    channel = (rec.get("source_channel") or "").lower()
    ig = None
    for x in rec.get("instagram") or []:
        if is_corporate_instagram(str(x)):
            continue
        h = ig_handle(x)
        if h:
            ig = f"https://www.instagram.com/{h}"
            break
    now = datetime.now(timezone.utc).isoformat()
    body = {
        "name": name,
        "slug": slug,
        "short_description": short_teaser(description or narrative),
        "description": description,
        "phone": phone,
        "website": website,
        "city": rec.get("city"),
        "state_code": rec.get("state_code") or None,
        "status": "approved",
        "category_id": category_id,
        "image_url": rec.get("cover_image_url")
        if not empty_image(rec.get("cover_image_url"))
        else None,
        "instagram_url": ig,
        "telegram_url": tg_url_from_websites(rec.get("websites") or []),
        "source_url": (rec.get("source_post_urls") or [None])[0],
        "source_kind": resolve_source_kind(
            (rec.get("source_post_urls") or [None])[0],
            rec.get("directory_source") or channel,
        ),
        "created_at": now,
        "updated_at": now,
    }
    if dry_run:
        return f"dry-{slug}"
    rows = client._request(
        "POST",
        "/businesses",
        body=body,
        prefer="return=representation",
    )
    if isinstance(rows, list) and rows:
        biz_id = rows[0]["id"]
        add_missing_entity_promotions(
            client,
            owner_type="business",
            owner_id=biz_id,
            promotions=promotions,
            category_id=category_id,
        )
        return biz_id
    raise RuntimeError(f"business insert failed for {name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--bucket",
        choices=["professional", "business", "all"],
        default="all",
    )
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    if not args.apply and not args.dry_run:
        args.dry_run = True
    dry_run = not args.apply

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    cats = fetch_all(client, "/categories", "id,slug,name,domain", extra={"is_active": "eq.true"})
    by_slug = {c["slug"]: c for c in cats}

    buckets = (
        ["professional", "business"]
        if args.bucket == "all"
        else [args.bucket]
    )
    recs: list[dict[str, Any]] = []
    for b in buckets:
        recs.extend(
            fetch_all(
                client,
                "/import_comment_recommendations",
                "id,display_name,kind,category_guess,phones,instagram,websites,"
                "comment_texts,request_snippets,source_post_urls,cover_image_url,"
                "source_channel,status,target_bucket,city,"
                "third_party_mention_count,self_ad_mention_count,"
                "published_entity_type,published_entity_id",
                extra={
                    "status": "eq.pending",
                    "kind": "eq.profi",
                    "target_bucket": f"eq.{b}",
                },
            )
        )

    # Skip already published
    recs = [r for r in recs if not r.get("published_entity_id")]

    pros = fetch_all(
        client,
        "/professionals",
        "id,display_name,phone,instagram_url,website,telegram_url,image_url,category_id,city",
        extra={"status": "eq.approved"},
    )
    bizs = fetch_all(
        client,
        "/businesses",
        "id,name,phone,instagram_url,website,telegram_url,image_url,category_id,city",
        extra={"status": "eq.approved"},
    )
    phone_pro: dict[str, dict[str, Any]] = {}
    ig_pro: dict[str, dict[str, Any]] = {}
    for p in pros:
        ph = plausible_phone(p.get("phone"))
        if ph:
            phone_pro[ph] = p
        h = ig_handle(p.get("instagram_url"))
        if h:
            ig_pro[h] = p
    phone_biz: dict[str, dict[str, Any]] = {}
    ig_biz: dict[str, dict[str, Any]] = {}
    for b in bizs:
        ph = plausible_phone(b.get("phone"))
        if ph:
            phone_biz[ph] = b
        h = ig_handle(b.get("instagram_url"))
        if h:
            ig_biz[h] = b

    planned: list[dict[str, Any]] = []
    cat_counts: Counter[str] = Counter()
    action_counts: Counter[str] = Counter()

    for rec in recs:
        bucket = rec.get("target_bucket")
        if bucket == "professional":
            cat_slug = resolve_pro_category_slug(rec)
            cat = by_slug.get(cat_slug) or by_slug.get("pro_other")
            hit = None
            for p in rec.get("phones") or []:
                ph = plausible_phone(p)
                if ph and ph in phone_pro:
                    hit = phone_pro[ph]
                    break
            if not hit:
                for ig in rec.get("instagram") or []:
                    h = ig_handle(ig)
                    if h and h in ig_pro:
                        hit = ig_pro[h]
                        break
            action = "merge_professional" if hit else "create_professional"
            planned.append(
                {
                    "rec_id": rec["id"],
                    "name": rec.get("display_name"),
                    "bucket": bucket,
                    "action": action,
                    "category_slug": cat_slug,
                    "category_id": cat["id"] if cat else None,
                    "match_id": hit["id"] if hit else None,
                    "guess": rec.get("category_guess"),
                }
            )
            cat_counts[f"pro:{cat_slug}"] += 1
            action_counts[action] += 1
        elif bucket == "business":
            cat_slug = resolve_biz_category_slug(rec)
            cat = by_slug.get(cat_slug) or by_slug.get("services")
            hit = None
            for p in rec.get("phones") or []:
                ph = plausible_phone(p)
                if ph and ph in phone_biz:
                    hit = phone_biz[ph]
                    break
            if not hit:
                for ig in rec.get("instagram") or []:
                    h = ig_handle(ig)
                    if h and h in ig_biz:
                        hit = ig_biz[h]
                        break
            action = "merge_business" if hit else "create_business"
            planned.append(
                {
                    "rec_id": rec["id"],
                    "name": rec.get("display_name"),
                    "bucket": bucket,
                    "action": action,
                    "category_slug": cat_slug,
                    "category_id": cat["id"] if cat else None,
                    "match_id": hit["id"] if hit else None,
                    "guess": rec.get("category_guess"),
                }
            )
            cat_counts[f"biz:{cat_slug}"] += 1
            action_counts[action] += 1

        if args.limit and len(planned) >= args.limit:
            break

    applied = 0
    errors: list[dict[str, Any]] = []
    if args.apply:
        pro_by_id = {p["id"]: p for p in pros}
        biz_by_id = {b["id"]: b for b in bizs}
        for row in planned:
            rec = next(r for r in recs if r["id"] == row["rec_id"])
            try:
                if row["action"] == "merge_professional":
                    pro = pro_by_id[row["match_id"]]
                    merge_into_professional(
                        client, pro, rec, row["category_id"], dry_run=False
                    )
                    entity_id = pro["id"]
                    mark_recommendation(
                        client,
                        rec["id"],
                        entity_type="professional",
                        entity_id=entity_id,
                        dry_run=False,
                    )
                elif row["action"] == "create_professional":
                    entity_id = create_professional(
                        client, rec, category_id=row["category_id"], dry_run=False
                    )
                    mark_recommendation(
                        client,
                        rec["id"],
                        entity_type="professional",
                        entity_id=entity_id,
                        dry_run=False,
                    )
                elif row["action"] == "merge_business":
                    biz = biz_by_id[row["match_id"]]
                    merge_into_business(
                        client, biz, rec, row["category_id"], dry_run=False
                    )
                    entity_id = biz["id"]
                    mark_recommendation(
                        client,
                        rec["id"],
                        entity_type="business",
                        entity_id=entity_id,
                        dry_run=False,
                    )
                elif row["action"] == "create_business":
                    entity_id = create_business(
                        client, rec, category_id=row["category_id"], dry_run=False
                    )
                    mark_recommendation(
                        client,
                        rec["id"],
                        entity_type="business",
                        entity_id=entity_id,
                        dry_run=False,
                    )
                else:
                    continue
                applied += 1
                print(
                    f"ok {row['action']} {row['name']} → {row['category_slug']} "
                    f"({row['bucket']})"
                )
                time.sleep(0.03)
            except Exception as exc:  # noqa: BLE001
                errors.append(
                    {"id": row["rec_id"], "name": row["name"], "error": str(exc)[:300]}
                )
                print(f"fail {row['name']}: {exc}")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "bucket_filter": args.bucket,
        "candidates": len(planned),
        "applied": applied,
        "errors": len(errors),
        "action_counts": dict(action_counts),
        "category_counts": dict(sorted(cat_counts.items(), key=lambda x: -x[1])),
        "sample": planned[:50],
        "error_sample": errors[:20],
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if args.apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / ("apply_latest.json" if args.apply else "dry_run_latest.json")).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                k: report[k]
                for k in (
                    "mode",
                    "candidates",
                    "applied",
                    "errors",
                    "action_counts",
                    "category_counts",
                )
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print("report", path)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
