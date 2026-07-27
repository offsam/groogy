#!/usr/bin/env python3
"""Classify import_comment_recommendations into target_bucket before catalog transfer.

Buckets (only when an anchor exists):
  professional | business | service | other
No source/contact/entity match → unclassified (do not auto-transfer).

Usage:
  python3 scripts/business-enrich/classify_recommendation_buckets.py --dry-run
  python3 scripts/business-enrich/classify_recommendation_buckets.py --apply
  python3 scripts/business-enrich/classify_recommendation_buckets.py --apply --force
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from contacts import normalize_phone  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "recommendation_bucket_classify"
OUT.mkdir(parents=True, exist_ok=True)

BUCKETS = ("professional", "business", "service", "other", "unclassified")

BUSINESS_NAME_RE = re.compile(
    r"\b("
    r"llc|inc|ltd|corp|company|co\b|group|agency|studio|salon|clinic|school|"
    r"center|centre|daycare|day\s*care|farm|shop|store|market|cafe|restaurant|"
    r"kitchen|bakery|gym|fitness\s*club|hotel|motel|hostel|"
    r"ооо|ип\b|студия|салон|клиника|школа|центр|магазин|кафе|ресторан|"
    r"детский\s*сад|ясли|ферма|агентство|компания"
    r")\b",
    re.I,
)

SERVICE_NAME_RE = re.compile(
    r"("
    r"уборк|клининг|cleaning|переезд|moving|доставк|delivery|"
    r"регистрац\w*\s+llc|открытие\s+компани|llc\s+регистр|"
    r"handyman|няня\b|sitter|водитель|driver|репетитор|tutor|"
    r"страхован|insurance\s*брокер|вывоз\s+мусор| junk\s*removal|"
    r"ремонт\s+квартир|plumbing|электрик|electrician"
    r")",
    re.I,
)

PERSON_BLOCKLIST = re.compile(
    r"\b(ищу|нужен|нужна|прода[юе]|купл[юю]|отдам|даром|бесплатно)\b",
    re.I,
)


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
    if digits in {"1333533747", "1955320601"}:
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


def has_contact(rec: dict[str, Any]) -> bool:
    if any(plausible_phone(p) for p in (rec.get("phones") or [])):
        return True
    if any(ig_handle(x) for x in (rec.get("instagram") or [])):
        return True
    for w in rec.get("websites") or []:
        s = str(w).strip()
        if not s:
            continue
        if re.search(r"t\.me/|telegram\.me/", s, re.I):
            return True
        if re.match(r"https?://", s, re.I) and "facebook.com" not in s.lower():
            return True
    return False


def has_source_url(rec: dict[str, Any]) -> bool:
    for u in rec.get("source_post_urls") or []:
        s = str(u).strip()
        if s.startswith("http"):
            return True
    return False


def build_item_index(items: list[dict[str, Any]]) -> set[tuple[str, int]]:
    keys: set[tuple[str, int]] = set()
    for item in items:
        u = item.get("source_url") or ""
        m = re.search(r"t\.me/c/(\d+)/(\d+)", u)
        if m:
            keys.add((m.group(1), int(m.group(2))))
        chat = str(item.get("source_chat_id") or "")
        for mid in item.get("source_message_ids") or []:
            try:
                mid_i = int(mid)
            except (TypeError, ValueError):
                continue
            keys.add((chat, mid_i))
            if chat.startswith("-100"):
                keys.add((chat[4:], mid_i))
    return keys


def linked_to_import(rec: dict[str, Any], item_keys: set[tuple[str, int]]) -> bool:
    for url in rec.get("source_post_urls") or []:
        m = re.search(r"t\.me/c/(\d+)/(\d+)", url or "")
        if not m:
            continue
        chat, msg = m.group(1), int(m.group(2))
        if (chat, msg) in item_keys or (f"-100{chat}", msg) in item_keys:
            return True
    return False


def has_anchor(
    rec: dict[str, Any],
    *,
    item_keys: set[tuple[str, int]],
    phone_pro: dict[str, str],
    ig_pro: dict[str, str],
    phone_biz: dict[str, str],
    ig_biz: dict[str, str],
) -> tuple[bool, str]:
    if has_contact(rec):
        return True, "contact"
    if has_source_url(rec):
        return True, "source_url"
    if linked_to_import(rec, item_keys):
        return True, "import_item"
    for p in rec.get("phones") or []:
        ph = plausible_phone(p)
        if ph and (ph in phone_pro or ph in phone_biz):
            return True, "catalog_phone"
    for ig in rec.get("instagram") or []:
        h = ig_handle(ig)
        if h and (h in ig_pro or h in ig_biz):
            return True, "catalog_ig"
    return False, "no_anchor"


def name_tokens(value: str | None) -> list[str]:
    if not value:
        return []
    cleaned = re.sub(r"[^\w\s.@\-]+", " ", value, flags=re.UNICODE)
    stop = {"the", "and", "для", "и", "a", "an"}
    return [
        t
        for t in cleaned.split()
        if len(t) >= 2 and t.lower() not in stop and not t.isdigit()
    ]


def looks_like_person(name: str | None) -> bool:
    if not name:
        return False
    n = name.strip()
    if PERSON_BLOCKLIST.search(n):
        return False
    if BUSINESS_NAME_RE.search(n):
        return False
    if SERVICE_NAME_RE.search(n) and len(name_tokens(n)) <= 2:
        # "Клининг OC" without person — not professional
        return False
    tokens = name_tokens(n)
    if not tokens or len(tokens) > 4:
        return False
    # Mostly letters / dots / hyphens, short
    if re.search(r"\d{4,}", n):
        return False
    letterish = sum(1 for t in tokens if re.search(r"[A-Za-zА-Яа-яЁё]", t))
    return letterish >= max(1, len(tokens) - 1)


def looks_like_business(name: str | None) -> bool:
    if not name:
        return False
    return bool(BUSINESS_NAME_RE.search(name))


def looks_like_service(rec: dict[str, Any]) -> bool:
    name = rec.get("display_name") or ""
    text = "\n".join(
        str(x)
        for x in (
            name,
            *(rec.get("comment_texts") or [])[:3],
            *(rec.get("request_snippets") or [])[:2],
            rec.get("category_guess"),
        )
        if x
    )
    if looks_like_person(name) or looks_like_business(name):
        return False
    return bool(SERVICE_NAME_RE.search(text) or SERVICE_NAME_RE.search(name))


def classify(
    rec: dict[str, Any],
    *,
    item_keys: set[tuple[str, int]],
    phone_pro: dict[str, str],
    ig_pro: dict[str, str],
    phone_biz: dict[str, str],
    ig_biz: dict[str, str],
) -> tuple[str, str]:
    """Return (bucket, reason)."""
    anchored, anchor_reason = has_anchor(
        rec,
        item_keys=item_keys,
        phone_pro=phone_pro,
        ig_pro=ig_pro,
        phone_biz=phone_biz,
        ig_biz=ig_biz,
    )
    if not anchored:
        return "unclassified", anchor_reason

    # Catalog match wins
    for p in rec.get("phones") or []:
        ph = plausible_phone(p)
        if ph and ph in phone_pro:
            return "professional", f"catalog_pro_phone:{anchor_reason}"
        if ph and ph in phone_biz:
            return "business", f"catalog_biz_phone:{anchor_reason}"
    for ig in rec.get("instagram") or []:
        h = ig_handle(ig)
        if h and h in ig_pro:
            return "professional", f"catalog_pro_ig:{anchor_reason}"
        if h and h in ig_biz:
            return "business", f"catalog_biz_ig:{anchor_reason}"

    name = rec.get("display_name")
    if looks_like_business(name):
        return "business", f"business_name:{anchor_reason}"
    if looks_like_person(name):
        return "professional", f"person_name:{anchor_reason}"
    if looks_like_service(rec):
        return "service", f"service_pattern:{anchor_reason}"

    # Soft: category_guess + contact → professional default for specialist categories
    cat = (rec.get("category_guess") or "").lower()
    specialist_cats = (
        "визаж",
        "косметолог",
        "парикмахер",
        "массаж",
        "репетитор",
        "няня",
        "юрист",
        "риелтор",
        "бухгалтерия",
        "нотариус",
        "фитнес",
        "психолог",
    )
    if any(s in cat for s in specialist_cats) and looks_like_person(name):
        return "professional", f"category_person:{anchor_reason}"
    if any(s in cat for s in specialist_cats) and has_contact(rec):
        # named weakly but has contact in beauty/legal etc.
        if name and len(name_tokens(name)) <= 4 and not BUSINESS_NAME_RE.search(name):
            return "professional", f"category_contact:{anchor_reason}"

    return "other", f"anchored_unclear:{anchor_reason}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="Overwrite non-unclassified")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    if not args.apply and not args.dry_run:
        args.dry_run = True

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    recs = fetch_all(
        client,
        "/import_comment_recommendations",
        "id,display_name,kind,category_guess,phones,instagram,websites,"
        "comment_texts,request_snippets,source_post_urls,target_bucket,status",
        extra={"kind": "eq.profi", "status": "in.(pending,approved)"},
    )
    items = fetch_all(
        client,
        "/import_review_items",
        "id,source_url,source_chat_id,source_message_ids",
    )
    item_keys = build_item_index(items)

    pros = fetch_all(
        client,
        "/professionals",
        "id,phone,instagram_url",
        extra={"status": "eq.approved"},
    )
    bizs = fetch_all(
        client,
        "/businesses",
        "id,phone,instagram_url",
        extra={"status": "eq.approved"},
    )
    phone_pro: dict[str, str] = {}
    ig_pro: dict[str, str] = {}
    for p in pros:
        ph = plausible_phone(p.get("phone"))
        if ph:
            phone_pro[ph] = p["id"]
        h = ig_handle(p.get("instagram_url"))
        if h:
            ig_pro[h] = p["id"]
    phone_biz: dict[str, str] = {}
    ig_biz: dict[str, str] = {}
    for b in bizs:
        ph = plausible_phone(b.get("phone"))
        if ph:
            phone_biz[ph] = b["id"]
        h = ig_handle(b.get("instagram_url"))
        if h:
            ig_biz[h] = b["id"]

    planned: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    reason_counts: Counter[str] = Counter()

    for rec in recs:
        bucket, reason = classify(
            rec,
            item_keys=item_keys,
            phone_pro=phone_pro,
            ig_pro=ig_pro,
            phone_biz=phone_biz,
            ig_biz=ig_biz,
        )
        counts[bucket] += 1
        reason_counts[reason.split(":")[0]] += 1
        current = (rec.get("target_bucket") or "unclassified").strip() or "unclassified"
        if not args.force and current != "unclassified" and current in BUCKETS:
            continue
        if current == bucket:
            continue
        planned.append(
            {
                "id": rec["id"],
                "name": rec.get("display_name"),
                "from": current,
                "to": bucket,
                "reason": reason,
            }
        )
        if args.limit and len(planned) >= args.limit:
            break

    applied = 0
    if args.apply:
        for row in planned:
            client._request(
                "PATCH",
                "/import_comment_recommendations",
                params={"id": f"eq.{row['id']}"},
                body={
                    "target_bucket": row["to"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                prefer="return=minimal",
            )
            applied += 1
            if applied % 50 == 0:
                print(f"  patched {applied}/{len(planned)}")
            time.sleep(0.015)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "force": args.force,
        "scanned": len(recs),
        "bucket_counts_all": dict(counts),
        "reason_top": reason_counts.most_common(20),
        "would_update": len(planned),
        "applied": applied,
        "sample": planned[:60],
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
                    "scanned",
                    "bucket_counts_all",
                    "would_update",
                    "applied",
                )
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print("report", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
