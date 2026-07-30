#!/usr/bin/env python3
"""Professional Cleanup Phase 2 — execute Phase 1 classifications.

Source of truth:
  docs/audits/data/professional_cleanup_phase1_classifications.json

Steps:
  1) Merge strong duplicates (Phase1 DUPLICATE → canonical)
  2) High-confidence entity migrations (Business / Marketplace)
  3) Review queue re-evaluation (contacts from own text, category, spam)
  4) Archive junk
  5) Enrich remaining approved professionals (existing fill-empty pipelines)

No schema / RLS / API / runtime changes.

Usage:
  python3 scripts/business-enrich/professional_cleanup_phase2.py --dry-run
  python3 scripts/business-enrich/professional_cleanup_phase2.py --apply
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from source_kind import resolve_source_kind  # noqa: E402
from contacts import (  # noqa: E402
    extract_emails,
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
)
from sb_sql import sql as run_sql  # noqa: E402

PHASE1 = ROOT / "docs" / "audits" / "data" / "professional_cleanup_phase1_classifications.json"
OUT = ROOT / "docs" / "audits" / "data"
OUT.mkdir(parents=True, exist_ok=True)
BATCH = "professional_cleanup_phase2_v1"
NOW = datetime.now(timezone.utc).isoformat()

# High-confidence marketplace only (verified text). Uncertain Phase1 hits stay in review.
MARKETPLACE_MIGRATE = {
    "aleksandr-172200",  # Jeep rental
    "alena-181533-6d9d",  # Kia rental
    "ivanka-180933",  # Prius rental
    "roman-181510-ec0e",  # Camry rental
    "tim-samarin-204949-aaf8",  # Prius fleet rental
    "rudzik-mykhailo-205013-8177",  # room for rent
    "yelena-dean-204832-39fa",  # home rental
    "fbpack-elmira-sibagatova-beauty-room-rental",  # beauty room rental
    "beauty-salon-181011",  # chair/cabinet rental
}

# Phase1 marketplace → demote to review / other disposition
MARKETPLACE_SKIP = {
    "realtor-valeriia",  # realtor marketing, not a listing
    "realtor-valeriia-180843",
    "rita-torikashvili-205809-48fa",  # insurance anecdote
}

# Mis-tagged marketplace → business
MARKETPLACE_TO_BUSINESS = {
    "business-7867507987-172159",  # Amash Law Firm
}

# Mis-tagged job → keep professional (offers nanny services, not hiring)
JOB_SKIP = {"anna-a-a-190937"}

# Soft business names from Phase1 + law firm above
EXTRA_BUSINESS = {
    "worldwide-employment-agency-204942-0650",
    "endo-studio",
    "business-7867507987-172159",
}

# Spam / junk archive beyond Phase1 ARCHIVE
EXTRA_ARCHIVE = {
    "pro-ca48a2fb58-1",  # spam AI link under pickleball title
}

PRO_TO_BIZ_CAT = {
    "beauty": "beauty",
    "massage_wellness": "beauty",
    "fitness": "fitness",
    "legal": "legal",
    "health": "medical",
    "education": "education",
    "auto": "auto",
    "finance": "finance",
    "real_estate": "real_estate",
    "insurance": "insurance",
    "pro_other": "services",
}

CATEGORY_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("legal", re.compile(r"юрист|адвокат|нотариус|\blawyer\b|\battorney\b|\blegal\b|law\s+firm|бюро", re.I)),
    ("beauty", re.compile(r"маникюр|педикюр|брови|ресниц|парикмахер|барбер|визаж|косметолог|\bnails?\b|beauty|salon", re.I)),
    ("massage_wellness", re.compile(r"массаж|\bspa\b|wellness", re.I)),
    ("photo_video", re.compile(r"фотограф|photograph|видеограф", re.I)),
    ("childcare", re.compile(r"няня|сиделка|childcare|babysit", re.I)),
    ("real_estate", re.compile(r"риелтор|риэлтор|\brealtor\b|недвижим", re.I)),
    ("fitness", re.compile(r"тренер|фитнес|yoga|йога|dance|танц|pilates", re.I)),
    ("education", re.compile(r"репетитор|tutor|школа|school|academy|курс", re.I)),
    ("auto", re.compile(r"авто|машин|detail|tint|страхов|insurance|broker", re.I)),
    ("health", re.compile(r"\bmd\b|\bdo\b|врач|доктор|clinic|medical|стоматолог|dentist", re.I)),
    ("home_services", re.compile(r"сантехник|электрик|уборк|клининг|ремонт|handyman", re.I)),
    ("home_food", re.compile(r"торт|выпечк|catering|кондитер|bake", re.I)),
    ("finance", re.compile(r"бухгалтер|accountant|tax|налог", re.I)),
]

BUSINESS_NAME_RE = re.compile(
    r"\b(llc|inc\.?|studio|salon|clinic|spa|agency|school|academy|group|фирм|бюро|студия|салон|клиника|центр|школа|resort|medical\s+group|law\s+firm)\b",
    re.I,
)
JUNK_NAME_RE = re.compile(r"^[\s,.\-—_/\\|]+$|^\d+$")
PRICE_MONTH_RE = re.compile(r"\$\s*(\d{2,5})\s*(?:/\s*)?(?:месяц|month|mo\b)", re.I)


def esc(s: str | None) -> str:
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def esc_lit(s: str) -> str:
    return str(s).replace("'", "''")


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip()) or str(v).strip() == "/placeholder.svg"


def norm_phone(s: str | None) -> str | None:
    digits = re.sub(r"\D", "", s or "")
    return digits[-10:] if len(digits) >= 10 else (digits if len(digits) >= 7 else None)


def pick_first(*vals: Any) -> Any:
    for v in vals:
        if v is None:
            continue
        if isinstance(v, str):
            if v.strip() and v.strip() != "/placeholder.svg":
                return v.strip()
        else:
            return v
    return None


def fetch_pros_by_slugs(slugs: list[str]) -> dict[str, dict[str, Any]]:
    if not slugs:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(slugs), 80):
        chunk = slugs[i : i + 80]
        inlist = ",".join(esc(s) for s in chunk)
        rows = run_sql(
            f"""
            SELECT p.*, c.slug AS category_slug
            FROM professionals p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.slug IN ({inlist})
            """
        )
        for r in rows or []:
            out[r["slug"]] = r
    return out


def entity_counts() -> dict[str, int]:
    rows = run_sql(
        """
        SELECT 'professionals_approved' AS k, count(*)::int AS n FROM professionals WHERE status='approved'
        UNION ALL SELECT 'professionals_archived', count(*)::int FROM professionals WHERE status='archived'
        UNION ALL SELECT 'businesses_approved', count(*)::int FROM businesses WHERE status='approved'
        UNION ALL SELECT 'marketplace_active', count(*)::int FROM listings WHERE listing_type='marketplace_item' AND status='active'
        UNION ALL SELECT 'jobs_published', count(*)::int FROM jobs WHERE status='published'
        """
    )
    return {r["k"]: r["n"] for r in rows}


def merge_fields(canonical: dict[str, Any], members: list[dict[str, Any]]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    keys = [
        "phone",
        "email",
        "website",
        "instagram_url",
        "telegram_url",
        "image_url",
        "city",
        "region",
        "state_code",
        "postal_code",
        "service_area_text",
        "private_address_line",
        "headline",
        "short_description",
        "description",
        "card_summary",
        "source_url",
        "opening_hours",
    ]
    for key in keys:
        if not empty(canonical.get(key)) and key not in ("short_description", "description", "card_summary"):
            continue
        best = None
        best_len = -1
        for m in members:
            v = m.get(key)
            if empty(v) if isinstance(v, str) or v is None else v is None:
                continue
            if key in ("description", "short_description", "card_summary"):
                ln = len(str(v))
                if ln > best_len:
                    best, best_len = v, ln
            else:
                best = v
                break
        if best is not None and (empty(canonical.get(key)) or key in ("description", "short_description", "card_summary")):
            if key in ("description", "short_description", "card_summary"):
                cur = canonical.get(key) or ""
                if len(str(best)) > len(str(cur)):
                    patch[key] = best
            else:
                patch[key] = best

    # Prefer non-pro_other category
    cats = [(m.get("category_id"), m.get("category_slug")) for m in members]
    if canonical.get("category_slug") == "pro_other":
        for cid, slug in cats:
            if cid and slug and slug != "pro_other":
                patch["category_id"] = cid
                break

    # Geo fill-empty
    for key in ("latitude", "longitude"):
        if canonical.get(key) is None:
            for m in members:
                if m.get(key) is not None:
                    patch[key] = m[key]
                    break

    # Display name: prefer cleaner non-junk
    names = [m.get("display_name") for m in members if m.get("display_name")]
    names = [n for n in names if n and not JUNK_NAME_RE.match(n)]
    if names:
        cur = canonical.get("display_name") or ""
        if JUNK_NAME_RE.match(cur) or len(cur) < 2:
            patch["display_name"] = min(names, key=lambda s: (len(s), s))[:200]

    patch["import_batch_id"] = BATCH
    patch["updated_at"] = NOW
    return patch


def apply_pro_patch(pro_id: str, patch: dict[str, Any]) -> None:
    if not patch:
        return
    sets = []
    for k, v in patch.items():
        if v is None:
            continue
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            sets.append(f"{k} = {v}")
        elif isinstance(v, bool):
            sets.append(f"{k} = {'true' if v else 'false'}")
        elif isinstance(v, dict) or isinstance(v, list):
            sets.append(f"{k} = {esc(json.dumps(v))}::jsonb")
        else:
            sets.append(f"{k} = {esc(str(v))}")
    if not sets:
        return
    run_sql(f"UPDATE professionals SET {', '.join(sets)} WHERE id = {esc(pro_id)}")


def archive_pro(pro_id: str, reason: str) -> None:
    run_sql(
        f"""
        UPDATE professionals SET
          status = 'archived',
          visibility = 'private',
          archived_at = now(),
          import_batch_id = {esc(BATCH)},
          updated_at = now()
        WHERE id = {esc(pro_id)} AND status <> 'archived'
        """
    )


def step_duplicates(phase1: dict[str, Any], *, apply: bool) -> dict[str, Any]:
    dups = [r for r in phase1["results"] if r["decision"] == "DUPLICATE"]
    groups: dict[str, list[str]] = defaultdict(list)
    for r in dups:
        m = re.search(r"duplicate of ([^\s(]+)", r["reason"] or "")
        if not m:
            continue
        groups[m.group(1)].append(r["slug"])

    all_slugs = list(groups.keys()) + [s for members in groups.values() for s in members]
    pros = fetch_pros_by_slugs(all_slugs)
    merges = []
    for canonical_slug, member_slugs in sorted(groups.items()):
        canon = pros.get(canonical_slug)
        if not canon:
            merges.append({"canonical": canonical_slug, "status": "missing_canonical", "members": member_slugs})
            continue
        members = [canon] + [pros[s] for s in member_slugs if s in pros]
        live_siblings = [
            m for m in members if m["id"] != canon["id"] and m.get("status") == "approved"
        ]
        patch = merge_fields(canon, members)
        item = {
            "canonical_slug": canonical_slug,
            "canonical_id": canon["id"],
            "archived_slugs": [m["slug"] for m in live_siblings],
            "patch_keys": sorted(k for k in patch if k not in ("updated_at", "import_batch_id")),
            "status": "planned",
        }
        if apply and (live_siblings or patch):
            apply_pro_patch(canon["id"], patch)
            for m in live_siblings:
                archive_pro(m["id"], f"duplicate_of:{canonical_slug}")
            item["status"] = "merged"
        elif not live_siblings:
            item["status"] = "already_archived_or_missing"
        merges.append(item)
    return {
        "groups": len(groups),
        "merged": sum(1 for m in merges if m["status"] == "merged"),
        "items": merges,
    }


def resolve_biz_category_id(pro: dict[str, Any], cat_ids: dict[str, str]) -> str | None:
    pro_slug = pro.get("category_slug") or "pro_other"
    biz_slug = PRO_TO_BIZ_CAT.get(pro_slug, "services")
    blob = " ".join(
        filter(
            None,
            [
                pro.get("display_name"),
                pro.get("headline"),
                pro.get("description"),
                pro.get("short_description"),
            ],
        )
    )
    if re.search(r"medical\s+group|\bmd\b|\bdo\b|clinic|врач", blob, re.I):
        biz_slug = "medical"
    elif re.search(r"law\s+firm|адвокат|юрист|\bllc\b.*law", blob, re.I):
        biz_slug = "legal"
    elif re.search(r"\bspa\b|salon|beauty", blob, re.I):
        biz_slug = "beauty"
    elif re.search(r"school|academy|tutor|owl", blob, re.I):
        biz_slug = "education"
    elif re.search(r"insurance|страхов", blob, re.I):
        biz_slug = "insurance"
    elif re.search(r"agency|employment", blob, re.I):
        biz_slug = "services"
    return cat_ids.get(biz_slug) or cat_ids.get("services")


def source_kind(pro: dict[str, Any]) -> str | None:
    return resolve_source_kind(pro.get("source_url"), pro.get("source_type"))


def step_migrate_business(slugs: list[str], *, apply: bool) -> dict[str, Any]:
    pros = fetch_pros_by_slugs(slugs)
    cat_rows = run_sql("SELECT id, slug FROM categories WHERE domain = 'business'")
    cat_ids = {r["slug"]: r["id"] for r in cat_rows}
    items = []
    for slug in slugs:
        pro = pros.get(slug)
        if not pro:
            items.append({"slug": slug, "status": "missing"})
            continue
        if pro.get("status") == "archived":
            items.append({"slug": slug, "status": "already_archived"})
            continue
        existing = run_sql(
            f"SELECT id, slug, status::text, phone, website, email, instagram_url, telegram_url, "
            f"image_url, city, address_line, short_description, description "
            f"FROM businesses WHERE slug = {esc(slug)} LIMIT 1"
        )
        cat_id = resolve_biz_category_id(pro, cat_ids)
        name = (pro.get("display_name") or slug)[:200]
        payload = {
            "name": name,
            "category_id": cat_id,
            "short_description": pick_first(pro.get("short_description"), pro.get("headline")),
            "description": pick_first(pro.get("description"), pro.get("short_description")),
            "phone": pro.get("phone"),
            "email": pro.get("email"),
            "website": pro.get("website"),
            "instagram_url": pro.get("instagram_url"),
            "telegram_url": pro.get("telegram_url"),
            "image_url": None if empty(pro.get("image_url")) else pro.get("image_url"),
            "address_line": pro.get("private_address_line"),
            "city": pro.get("city"),
            "region": pro.get("region"),
            "state_code": pro.get("state_code"),
            "postal_code": pro.get("postal_code"),
            "latitude": pro.get("latitude"),
            "longitude": pro.get("longitude"),
            "opening_hours": pro.get("opening_hours"),
            "source_url": pro.get("source_url"),
            "source_kind": source_kind(pro),
            "status": "approved",
        }
        item = {"slug": slug, "name": name, "status": "planned", "action": None}
        if not apply:
            item["status"] = "dry_run"
            item["action"] = "restore" if existing else "insert"
            items.append(item)
            continue

        if existing:
            biz = existing[0]
            sets = ["status = 'approved'", "updated_at = now()"]
            seen_cols = {"status", "updated_at"}
            for k, v in payload.items():
                if k in ("name", "status") or k in seen_cols:
                    continue
                if v is None or (isinstance(v, str) and not v.strip()):
                    continue
                cur = biz.get(k)
                if empty(cur) if isinstance(cur, str) or cur is None else cur is None:
                    if isinstance(v, (dict, list)):
                        sets.append(f"{k} = {esc(json.dumps(v))}::jsonb")
                    elif isinstance(v, (int, float)) and not isinstance(v, bool):
                        sets.append(f"{k} = {v}")
                    else:
                        sets.append(f"{k} = {esc(str(v))}")
                    seen_cols.add(k)
            if cat_id and "category_id" not in seen_cols:
                sets.append(f"category_id = {esc(cat_id)}")
            run_sql(f"UPDATE businesses SET {', '.join(sets)} WHERE id = {esc(biz['id'])}")
            item["action"] = "restored_existing"
            item["business_id"] = biz["id"]
        else:
            # unique slug
            clash = run_sql(f"SELECT 1 FROM businesses WHERE slug = {esc(slug)} LIMIT 1")
            biz_slug = slug if not clash else f"{slug}-from-pro"
            cols = ["slug", "name", "status", "updated_at", "created_at"]
            vals = [esc(biz_slug), esc(name), "'approved'", "now()", "now()"]
            for k, v in payload.items():
                if k in ("name", "status") or v is None:
                    continue
                if isinstance(v, str) and not v.strip():
                    continue
                cols.append(k)
                if isinstance(v, (dict, list)):
                    vals.append(f"{esc(json.dumps(v))}::jsonb")
                elif isinstance(v, (int, float)) and not isinstance(v, bool):
                    vals.append(str(v))
                else:
                    vals.append(esc(str(v)))
            inserted = run_sql(
                f"INSERT INTO businesses ({', '.join(cols)}) VALUES ({', '.join(vals)}) RETURNING id, slug"
            )
            item["action"] = "inserted"
            item["business_id"] = inserted[0]["id"]
            item["business_slug"] = inserted[0]["slug"]

        archive_pro(pro["id"], f"migrated_to_business:{slug}")
        item["status"] = "migrated"
        items.append(item)
    return {
        "attempted": len(slugs),
        "migrated": sum(1 for i in items if i["status"] == "migrated"),
        "items": items,
    }


def step_migrate_marketplace(slugs: list[str], *, apply: bool) -> dict[str, Any]:
    pros = fetch_pros_by_slugs(slugs)
    cats = run_sql(
        "SELECT id, slug FROM listing_categories WHERE listing_type = 'marketplace_item' AND is_active"
    )
    cat_by_slug = {c["slug"]: c["id"] for c in cats}
    other_id = cat_by_slug.get("other")
    home_id = cat_by_slug.get("home-garden") or other_id
    admin = run_sql("SELECT id FROM profiles WHERE role = 'admin' LIMIT 1")
    owner_id = admin[0]["id"] if admin else None
    items = []
    for slug in slugs:
        pro = pros.get(slug)
        if not pro:
            items.append({"slug": slug, "status": "missing"})
            continue
        if pro.get("status") == "archived":
            items.append({"slug": slug, "status": "already_archived"})
            continue
        text = " ".join(
            filter(
                None,
                [pro.get("display_name"), pro.get("headline"), pro.get("description"), pro.get("short_description")],
            )
        )
        cat_id = home_id if re.search(r"room|home|house|квартир|комнат|beauty\s*room|кабинет|кресл", text, re.I) else other_id
        title = (pro.get("display_name") or "Объявление")[:120]
        if re.search(r"аренда|сдам|rent", text, re.I):
            # Prefer first line of description as title when informative
            first = (pro.get("description") or pro.get("short_description") or "").strip().splitlines()
            if first and len(first[0]) >= 8:
                title = re.sub(r"\s+", " ", first[0])[:120]
        desc_parts = []
        for k in ("description", "short_description", "headline"):
            v = (pro.get(k) or "").strip()
            if v and v not in desc_parts:
                desc_parts.append(v)
        contacts = []
        if pro.get("phone"):
            contacts.append(f"Телефон: {pro['phone']}")
        if pro.get("telegram_url"):
            contacts.append(f"Telegram: {pro['telegram_url']}")
        if pro.get("instagram_url"):
            contacts.append(f"Instagram: {pro['instagram_url']}")
        if pro.get("email"):
            contacts.append(f"Email: {pro['email']}")
        if contacts:
            desc_parts.append("Контакты:\n" + "\n".join(contacts))
        desc = "\n\n".join(desc_parts)[:8000] or f"{title}. Свяжитесь по контактам."
        price = None
        m = PRICE_MONTH_RE.search(text)
        if m:
            price = float(m.group(1))
        item = {"slug": slug, "title": title, "status": "planned", "price": price}
        if not apply:
            item["status"] = "dry_run"
            items.append(item)
            continue
        if not owner_id or not cat_id:
            item["status"] = "error_missing_owner_or_category"
            items.append(item)
            continue
        # dedupe
        if pro.get("source_url"):
            exist = run_sql(
                f"""
                SELECT id FROM listings
                WHERE source_url = {esc(pro['source_url'])}
                  AND listing_type = 'marketplace_item'
                  AND status = 'active'
                LIMIT 1
                """
            )
            if exist:
                archive_pro(pro["id"], "migrated_marketplace_dedupe")
                item["status"] = "deduped_archived_pro"
                item["listing_id"] = exist[0]["id"]
                items.append(item)
                continue

        price_sql = str(price) if price is not None else "NULL"
        city_sql = esc(pro.get("city")) if pro.get("city") else "NULL"
        state_sql = esc(pro.get("state_code")) if pro.get("state_code") else "NULL"
        src_sql = esc(pro.get("source_url")) if pro.get("source_url") else "NULL"
        sk = esc(source_kind(pro))
        q = f"""
        DO $$
        DECLARE
          v_listing uuid;
        BEGIN
          PERFORM private.enable_trusted_listing_write();
          INSERT INTO public.listings (
            owner_id, listing_type, status, visibility, author_visibility,
            title, description, price_amount, price_currency, is_negotiable,
            city, state_code, publisher_type, source_kind, source_url, published_at
          ) VALUES (
            {esc(owner_id)}::uuid,
            'marketplace_item',
            'active',
            'public',
            'public',
            {esc(title)},
            {esc(desc)},
            {price_sql},
            'USD',
            true,
            {city_sql},
            {state_sql},
            'profile',
            {sk},
            {src_sql},
            now()
          ) RETURNING id INTO v_listing;
          INSERT INTO public.marketplace_listing_details (
            listing_id, category_id, condition, transaction_type, delivery_available, pickup_available, quantity
          ) VALUES (
            v_listing,
            {esc(cat_id)}::uuid,
            NULL,
            'sell',
            false,
            true,
            1
          );
          UPDATE public.professionals SET
            status = 'archived',
            visibility = 'private',
            archived_at = now(),
            import_batch_id = {esc(BATCH)},
            updated_at = now()
          WHERE id = {esc(pro['id'])}::uuid;
        END $$;
        """
        try:
            run_sql(q)
            item["status"] = "migrated"
        except Exception as exc:  # noqa: BLE001
            item["status"] = "error"
            item["error"] = str(exc)[:400]
        items.append(item)
    return {
        "attempted": len(slugs),
        "migrated": sum(1 for i in items if i["status"] == "migrated"),
        "items": items,
    }


def guess_category_slug(pro: dict[str, Any], cat_ids: dict[str, str]) -> str | None:
    blob = " ".join(
        filter(
            None,
            [
                pro.get("display_name"),
                pro.get("headline"),
                pro.get("short_description"),
                pro.get("description"),
                pro.get("card_summary"),
            ],
        )
    )
    for slug, pat in CATEGORY_RULES:
        if slug in cat_ids and pat.search(blob):
            return slug
    return None


def extract_contacts_from_text(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    phones = extract_phones(text or "")
    if phones:
        out["phone"] = phones[0]
    emails = extract_emails(text or "")
    if emails:
        out["email"] = emails[0]
    ig = extract_instagram(text or "")
    if ig:
        handle = ig[0]
        out["instagram_url"] = (
            handle if handle.startswith("http") else f"https://instagram.com/{handle.lstrip('@')}"
        )
    tg = extract_telegram(text or "")
    if tg:
        handle = tg[0]
        out["telegram_url"] = (
            handle if handle.startswith("http") or "t.me" in handle else f"https://t.me/{handle.lstrip('@')}"
        )
    webs = extract_websites(text or "")
    if webs:
        out["website"] = webs[0]
    return out


def step_review(phase1: dict[str, Any], *, apply: bool) -> dict[str, Any]:
    review_slugs = [
        r["slug"]
        for r in phase1["results"]
        if r["decision"] == "NEEDS_REVIEW" and r.get("db_status") == "approved"
    ]
    # Also Phase1 marketplace skips + job skip enter review processing
    review_slugs += list(MARKETPLACE_SKIP) + list(JOB_SKIP)
    review_slugs = sorted(set(review_slugs) - EXTRA_BUSINESS - MARKETPLACE_MIGRATE - EXTRA_ARCHIVE)
    pros = fetch_pros_by_slugs(review_slugs)
    cat_rows = run_sql("SELECT id, slug FROM categories WHERE domain = 'professional'")
    # also business-domain cats used by some pros
    cat_rows2 = run_sql("SELECT id, slug FROM categories")
    cat_ids = {r["slug"]: r["id"] for r in (cat_rows2 or [])}

    reclassified_keep = []
    still_review = []
    enriched = []
    archived = []
    promoted_business = []

    for slug in review_slugs:
        pro = pros.get(slug)
        if not pro or pro.get("status") != "approved":
            continue
        name = (pro.get("display_name") or "").strip()
        text = " ".join(
            filter(
                None,
                [
                    name,
                    pro.get("headline"),
                    pro.get("short_description"),
                    pro.get("description"),
                    pro.get("card_summary"),
                ],
            )
        )
        patch: dict[str, Any] = {}

        # Extract contacts from own text (fill-empty only)
        extracted = extract_contacts_from_text(text)
        for k, v in extracted.items():
            if empty(pro.get(k)):
                patch[k] = v

        # Category upgrade from pro_other
        if (pro.get("category_slug") or "pro_other") == "pro_other":
            guess = guess_category_slug(pro, cat_ids)
            if guess and guess != "pro_other" and cat_ids.get(guess):
                patch["category_id"] = cat_ids[guess]

        # Junk / abandoned
        has_contact = any(
            not empty(pro.get(k)) or k in patch
            for k in ("phone", "email", "website", "instagram_url", "telegram_url")
        )
        has_pitch = any(not empty(pro.get(k)) for k in ("headline", "short_description", "description", "card_summary"))
        if (not name or JUNK_NAME_RE.match(name) or len(name) <= 1) and not has_contact:
            if apply:
                if patch:
                    apply_pro_patch(pro["id"], {**patch, "import_batch_id": BATCH, "updated_at": NOW})
                archive_pro(pro["id"], "review_junk")
            archived.append({"slug": slug, "reason": "junk_name"})
            continue

        # Soft promote to business when clear org name + contact after extract
        contact_after = has_contact
        if BUSINESS_NAME_RE.search(name) and contact_after and re.search(
            r"llc|inc|medical\s+group|law\s+firm|agency|academy|school|resort", name, re.I
        ):
            promoted_business.append(slug)
            continue

        if apply and patch:
            patch["import_batch_id"] = BATCH
            patch["updated_at"] = NOW
            apply_pro_patch(pro["id"], patch)
            enriched.append({"slug": slug, "fields": sorted(patch.keys())})

        # Reclassify to KEEP if now has contact + non-pro_other category
        new_cat = None
        if "category_id" in patch:
            for s, cid in cat_ids.items():
                if cid == patch["category_id"]:
                    new_cat = s
                    break
        cat_ok = (new_cat or pro.get("category_slug")) not in (None, "pro_other")
        if contact_after and cat_ok and has_pitch:
            reclassified_keep.append({"slug": slug, "category": new_cat or pro.get("category_slug")})
        else:
            still_review.append(
                {
                    "slug": slug,
                    "name": name,
                    "reason": (
                        "still_pro_other"
                        if not cat_ok
                        else ("no_contact" if not contact_after else "ambiguous")
                    ),
                }
            )

    return {
        "reviewed": len(review_slugs),
        "reclassified_keep": reclassified_keep,
        "still_review": still_review,
        "contact_enriched": enriched,
        "archived_from_review": archived,
        "promoted_business_slugs": promoted_business,
    }


def step_archive(slugs: list[str], *, apply: bool) -> dict[str, Any]:
    pros = fetch_pros_by_slugs(slugs)
    items = []
    for slug in slugs:
        pro = pros.get(slug)
        if not pro:
            items.append({"slug": slug, "status": "missing"})
            continue
        if pro.get("status") == "archived":
            items.append({"slug": slug, "status": "already_archived"})
            continue
        if apply:
            archive_pro(pro["id"], "phase2_junk")
            items.append({"slug": slug, "status": "archived"})
        else:
            items.append({"slug": slug, "status": "dry_run"})
    return {
        "attempted": len(slugs),
        "archived": sum(1 for i in items if i["status"] == "archived"),
        "items": items,
    }


def step_enrich_remaining(*, apply: bool, client: SupabaseRest) -> dict[str, Any]:
    """Fill-empty contacts from own description + run source enrich script if apply."""
    rows = run_sql(
        """
        SELECT id, slug, display_name, phone, email, website, instagram_url, telegram_url,
               headline, short_description, description, card_summary, city, service_area_text,
               image_url, category_id
        FROM professionals
        WHERE status = 'approved'
        """
    )
    filled = []
    for pro in rows or []:
        text = " ".join(
            filter(
                None,
                [
                    pro.get("display_name"),
                    pro.get("headline"),
                    pro.get("short_description"),
                    pro.get("description"),
                    pro.get("card_summary"),
                ],
            )
        )
        patch = {}
        for k, v in extract_contacts_from_text(text).items():
            if empty(pro.get(k)):
                patch[k] = v
        # city from "City, CA" patterns in text if empty
        if empty(pro.get("city")):
            m = re.search(
                r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*(CA|NY|FL|TX|WA|IL|MA|NJ)\b",
                text,
            )
            if m:
                patch["city"] = m.group(1)
                if empty(pro.get("state_code")):
                    patch["state_code"] = f"US-{m.group(2)}"
        if patch and apply:
            patch["import_batch_id"] = BATCH
            patch["updated_at"] = NOW
            apply_pro_patch(pro["id"], patch)
            filled.append({"slug": pro["slug"], "fields": sorted(patch.keys())})
        elif patch:
            filled.append({"slug": pro["slug"], "fields": sorted(patch.keys()), "status": "dry_run"})

    source_report = None
    if apply:
        import subprocess

        proc = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "business-enrich" / "enrich_professionals_from_sources.py"),
                "--apply",
                "--skip-telegram-photos",
            ],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )
        source_report = {
            "returncode": proc.returncode,
            "stdout_tail": (proc.stdout or "")[-2000:],
            "stderr_tail": (proc.stderr or "")[-1000:],
        }
        # Category backfill for remaining pro_other
        proc2 = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "business-enrich" / "backfill_professional_categories.py"),
                "--apply",
            ],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )
        source_report["category_backfill"] = {
            "returncode": proc2.returncode,
            "stdout_tail": (proc2.stdout or "")[-1500:],
        }

    return {
        "text_extract_enriched": len(filled),
        "items_sample": filled[:40],
        "source_pipeline": source_report,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    apply = bool(args.apply) and not args.dry_run

    load_env()
    import os

    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    phase1 = json.loads(PHASE1.read_text(encoding="utf-8"))
    before = entity_counts()

    business_slugs = sorted(
        {
            *(r["slug"] for r in phase1["results"] if r["decision"] == "MOVE_TO_BUSINESS"),
            *EXTRA_BUSINESS,
            *MARKETPLACE_TO_BUSINESS,
        }
    )
    marketplace_slugs = sorted(MARKETPLACE_MIGRATE)
    archive_slugs = sorted(
        {
            *(
                r["slug"]
                for r in phase1["results"]
                if r["decision"] == "ARCHIVE" and r.get("db_status") == "approved"
            ),
            *EXTRA_ARCHIVE,
        }
    )

    report: dict[str, Any] = {
        "generated_at": NOW,
        "mode": "apply" if apply else "dry-run",
        "batch_id": BATCH,
        "before_counts": before,
        "policy": {
            "marketplace_migrate": sorted(MARKETPLACE_MIGRATE),
            "marketplace_skip_to_review": sorted(MARKETPLACE_SKIP),
            "job_skip_keep_professional": sorted(JOB_SKIP),
            "extra_business": sorted(EXTRA_BUSINESS),
            "extra_archive": sorted(EXTRA_ARCHIVE),
        },
    }

    print("=== Step 1: duplicates ===", flush=True)
    report["duplicates"] = step_duplicates(phase1, apply=apply)
    print(json.dumps({k: report["duplicates"][k] for k in ("groups", "merged")}, ensure_ascii=False), flush=True)

    print("=== Step 2a: business migrations ===", flush=True)
    report["migrate_business"] = step_migrate_business(business_slugs, apply=apply)
    print(
        json.dumps(
            {k: report["migrate_business"][k] for k in ("attempted", "migrated")},
            ensure_ascii=False,
        ),
        flush=True,
    )

    print("=== Step 2b: marketplace migrations ===", flush=True)
    report["migrate_marketplace"] = step_migrate_marketplace(marketplace_slugs, apply=apply)
    print(
        json.dumps(
            {k: report["migrate_marketplace"][k] for k in ("attempted", "migrated")},
            ensure_ascii=False,
        ),
        flush=True,
    )

    print("=== Step 2c: job migrations ===", flush=True)
    report["migrate_job"] = {
        "attempted": 0,
        "migrated": 0,
        "skipped": list(JOB_SKIP),
        "reason": "Phase1 job hit is self-offer (nanny), not hiring — kept as Professional / review",
    }

    print("=== Step 3: review queue ===", flush=True)
    report["review"] = step_review(phase1, apply=apply)
    # Promote soft businesses discovered in review
    promo = report["review"].get("promoted_business_slugs") or []
    if promo:
        print(f"=== Step 3b: promote {len(promo)} review→business ===", flush=True)
        promo_result = step_migrate_business(promo, apply=apply)
        report["migrate_business_from_review"] = promo_result
        report["migrate_business"]["migrated"] += promo_result.get("migrated", 0)
        report["migrate_business"]["items"].extend(promo_result.get("items", []))

    print("=== Step 4: archive junk ===", flush=True)
    report["archive"] = step_archive(archive_slugs, apply=apply)

    print("=== Step 5: enrich remaining ===", flush=True)
    report["enrichment"] = step_enrich_remaining(apply=apply, client=client)

    after = entity_counts()
    report["after_counts"] = after
    report["delta_counts"] = {k: after.get(k, 0) - before.get(k, 0) for k in sorted(set(before) | set(after))}

    # Remaining quality snapshot
    quality = run_sql(
        """
        SELECT
          count(*) FILTER (WHERE status='approved') AS approved,
          count(*) FILTER (WHERE status='approved' AND category_id IN (
            SELECT id FROM categories WHERE slug='pro_other')) AS pro_other,
          count(*) FILTER (
            WHERE status='approved'
              AND coalesce(phone,'')='' AND coalesce(email,'')=''
              AND coalesce(website,'')='' AND coalesce(instagram_url,'')=''
              AND coalesce(telegram_url,'')=''
          ) AS no_contact,
          count(*) FILTER (WHERE status='approved' AND coalesce(city,'')='' AND coalesce(service_area_text,'')='') AS no_location,
          count(*) FILTER (WHERE status='approved' AND coalesce(image_url,'')='') AS no_image
        FROM professionals
        """
    )
    report["remaining_quality"] = quality[0] if quality else {}
    report["still_manual_review_count"] = len(report["review"].get("still_review") or [])

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"professional_cleanup_phase2_{'apply' if apply else 'dry'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    latest = OUT / f"professional_cleanup_phase2_{'apply' if apply else 'dry'}_latest.json"
    latest.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"report": str(path), "delta": report["delta_counts"], "remaining_quality": report["remaining_quality"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
