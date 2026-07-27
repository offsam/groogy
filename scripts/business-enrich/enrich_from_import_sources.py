#!/usr/bin/env python3
"""Fill empty business fields from import_review_items linked by source_url / published id.

Uses already-collected Telegram/Facebook source payloads — no Places.
Fill-empty only: phone, email, website, instagram, telegram, image, address (from text),
short_description/description when thin.

Usage:
  python3 scripts/business-enrich/enrich_from_import_sources.py --dry-run
  python3 scripts/business-enrich/enrich_from_import_sources.py --apply
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
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from contacts import (  # noqa: E402
    extract_emails,
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
    normalize_phone,
)

OUT = Path(__file__).resolve().parent / "data" / "import_source_enrich"
OUT.mkdir(parents=True, exist_ok=True)

STREET_RE = re.compile(
    r"(?i)(?<![\w-])("
    r"\d{1,5}\s+(?:[NSEW]\.?\s+)?"
    r"(?:[A-Za-z0-9.'\-]+\s+){0,4}"
    r"(?:[A-Za-z0-9.'\-]{2,})\s+"
    r"(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|"
    r"Way|Court|Ct|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Place|Pl|Terrace|Ter)"
    r"\.?"
    r"(?:\s*(?:#|Suite|Ste\.?|Unit|Apt\.?)\s*[A-Za-z0-9\-]+)?"
    r"(?:\s*,\s*[A-Za-z][A-Za-z .'\-]{2,40})?"
    r"(?:\s*,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?"
    r")"
)

JUNK_ADDR = re.compile(
    r"(?i)\b(?:contact\s+us|minutes?|click|whats?app|telegram|instagram|facebook|\$\d)\b"
)


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def norm_url(u: str | None) -> str:
    if not u:
        return ""
    return u.strip().split("?")[0].rstrip("/").lower().replace("https://www.", "https://").replace("http://www.", "http://").replace("http://", "https://")


def looks_like_street(a: str) -> bool:
    a = a.strip()
    if len(a) < 10 or len(a) > 180:
        return False
    if JUNK_ADDR.search(a):
        return False
    if not STREET_RE.search(a):
        return False
    return True


def extract_address(text: str) -> str | None:
    m = STREET_RE.search(text or "")
    if not m:
        return None
    cand = m.group(1).strip().rstrip(".,;")
    return cand[:160] if looks_like_street(cand) else None


def normalize_instagram(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if not raw:
        return None
    v = str(raw).strip()
    m = re.search(r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})", v, re.I)
    handle = (m.group(1) if m else v.lstrip("@")).strip().strip("/")
    handle = handle.split("?")[0].split("/")[0]
    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", handle or ""):
        return None
    if handle.lower() in {"reel", "p", "stories", "explore", "accounts"}:
        return None
    return f"https://www.instagram.com/{handle}"


def normalize_website(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if not raw:
        return None
    v = str(raw).strip()
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    low = v.lower()
    if any(
        x in low
        for x in (
            "instagram.com",
            "facebook.com",
            "fb.com",
            "t.me/",
            "telegram.me",
            "wa.me/",
        )
    ):
        return None
    try:
        host = (urlparse(v).hostname or "").lower()
    except Exception:
        return None
    if not host or "." not in host:
        return None
    return v.split("?")[0][:300]


def first_phone(raw: Any, text: str) -> str | None:
    cands: list[str] = []
    if isinstance(raw, list):
        cands.extend(str(x) for x in raw if x)
    elif raw:
        cands.append(str(raw))
    cands.extend(extract_phones(text))
    for cand in cands:
        ph = normalize_phone(cand) or cand
        digits = re.sub(r"\D", "", ph or "")
        if len(digits) >= 10:
            return ph if ph.startswith("+") else (normalize_phone(cand) or ph)
    return None


def first_email(raw: Any, text: str) -> str | None:
    if isinstance(raw, list) and raw:
        return str(raw[0]).strip().lower()
    if isinstance(raw, str) and "@" in raw:
        return raw.strip().lower()
    emails = extract_emails(text)
    return emails[0] if emails else None


def needs_gap(row: dict[str, Any]) -> bool:
    img = (row.get("image_url") or "").strip()
    img_empty = (not img) or "placeholder" in img or img.endswith(".svg")
    return (
        empty(row.get("phone"))
        or empty(row.get("instagram_url"))
        or empty(row.get("website"))
        or empty(row.get("telegram_url"))
        or empty(row.get("address_line"))
        or empty(row.get("email"))
        or img_empty
        or row.get("opening_hours") is None
        or len((row.get("description") or "").strip()) < 80
    )


def build_patch(biz: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    text = "\n".join(
        str(x)
        for x in (
            item.get("source_text"),
            item.get("description"),
            item.get("title"),
            item.get("business_name"),
        )
        if x
    )
    patch: dict[str, Any] = {}

    if empty(biz.get("phone")):
        ph = first_phone(item.get("phone"), text)
        if ph:
            patch["phone"] = ph

    if empty(biz.get("email")):
        em = first_email(item.get("email"), text)
        if em:
            patch["email"] = em

    if empty(biz.get("instagram_url")):
        ig = normalize_instagram(item.get("instagram"))
        if not ig:
            found = extract_instagram(text)
            ig = normalize_instagram(found[0] if found else None)
        if ig:
            patch["instagram_url"] = ig

    if empty(biz.get("website")):
        web = normalize_website(item.get("website"))
        if not web:
            webs = extract_websites(text)
            web = normalize_website(webs[0] if webs else None)
        if web:
            patch["website"] = web

    if empty(biz.get("telegram_url")):
        tg = item.get("telegram_username")
        if tg:
            h = str(tg).lstrip("@").strip()
            if re.fullmatch(r"[A-Za-z0-9_]{4,32}", h) and not h.isdigit():
                patch["telegram_url"] = f"https://t.me/{h}"
        if "telegram_url" not in patch:
            tgs = extract_telegram(text)
            if tgs:
                h = tgs[0].lstrip("@")
                if re.fullmatch(r"[A-Za-z0-9_]{4,32}", h) and not h.isdigit():
                    patch["telegram_url"] = f"https://t.me/{h}"

    if empty(biz.get("address_line")):
        addr = extract_address(text)
        if addr:
            patch["address_line"] = addr

    img = (biz.get("image_url") or "").strip()
    img_empty = (not img) or "placeholder" in img or img.endswith(".svg")
    preview = (item.get("preview_image_url") or "").strip()
    if img_empty and preview and preview.startswith("http"):
        patch["image_url"] = preview[:500]

    desc = (biz.get("description") or "").strip()
    src_desc = (item.get("description") or item.get("source_text") or "").strip()
    # Also mine contacts from description even when not replacing copy
    if empty(biz.get("phone")) and "phone" not in patch:
        ph = first_phone(None, src_desc or text)
        if ph:
            patch["phone"] = ph
    if empty(biz.get("instagram_url")) and "instagram_url" not in patch:
        found = extract_instagram(src_desc or text)
        ig = normalize_instagram(found[0] if found else None)
        if ig:
            patch["instagram_url"] = ig

    if src_desc and (
        len(desc) < 80
        or "источник:" in desc.lower()
        or "контакты:" in desc.lower()
        or "telegram id" in desc.lower()
    ):
        cleaned = src_desc
        cleaned = re.sub(r"(?im)^(?:контакты|источник|telegram\s*id)\s*:.*$", "", cleaned)
        cleaned = re.sub(r"https?://\S+", " ", cleaned)
        # strip phones/emails/handles from public narrative
        for ph in extract_phones(cleaned):
            cleaned = cleaned.replace(ph, " ")
        cleaned = re.sub(
            r"(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})",
            " ",
            cleaned,
        )
        cleaned = re.sub(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", " ", cleaned)
        cleaned = re.sub(r"(?:^|[\s(,])@[A-Za-z0-9._]{3,30}\b", " ", cleaned)
        cleaned = re.sub(r"(?i)\b(?:тел(?:ефон)?|phone|звоните)\s*[:：]?\s*", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if len(cleaned) >= 40:
            patch["description"] = cleaned[:4000]
            if empty(biz.get("short_description")):
                patch["short_description"] = cleaned[:240]

    return patch


def fetch_businesses(client: SupabaseRest) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        chunk = client._request(
            "GET",
            "/businesses",
            params={
                "select": (
                    "id,slug,name,status,phone,email,website,instagram_url,telegram_url,"
                    "source_url,source_kind,description,short_description,image_url,"
                    "address_line,opening_hours"
                ),
                "status": "eq.approved",
                "source_url": "not.is.null",
                "limit": "200",
                "offset": str(offset),
            },
        )
        if not isinstance(chunk, list) or not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < 200:
            break
        offset += 200
    return [r for r in rows if needs_gap(r)]


def fetch_review_index(client: SupabaseRest) -> tuple[dict[str, dict], dict[str, dict]]:
    by_url: dict[str, dict] = {}
    by_entity: dict[str, dict] = {}
    offset = 0
    while True:
        chunk = client._request(
            "GET",
            "/import_review_items",
            params={
                "select": (
                    "id,source,source_url,source_text,description,title,business_name,"
                    "phone,email,website,instagram,telegram_username,preview_image_url,"
                    "published_entity_id,published_entity_type,review_status"
                ),
                "or": "(source.eq.facebook,source.eq.telegram)",
                "limit": "500",
                "offset": str(offset),
            },
        )
        if not isinstance(chunk, list) or not chunk:
            break
        for row in chunk:
            url = norm_url(row.get("source_url"))
            if url:
                by_url[url] = row
            ent = row.get("published_entity_id")
            if ent and row.get("published_entity_type") in (None, "business", "Business"):
                by_entity[str(ent)] = row
        if len(chunk) < 500:
            break
        offset += 500
    return by_url, by_entity


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
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

    businesses = fetch_businesses(client)
    by_url, by_entity = fetch_review_index(client)
    print(f"needy businesses with source_url: {len(businesses)}")
    print(f"review index urls={len(by_url)} entities={len(by_entity)}")

    planned: list[dict[str, Any]] = []
    field_hits: dict[str, int] = {}
    matched = 0
    for biz in businesses:
        item = by_entity.get(str(biz["id"])) or by_url.get(norm_url(biz.get("source_url")))
        if not item:
            continue
        matched += 1
        patch = build_patch(biz, item)
        if not patch:
            continue
        for k in patch:
            field_hits[k] = field_hits.get(k, 0) + 1
        planned.append(
            {
                "id": biz["id"],
                "slug": biz.get("slug"),
                "name": biz.get("name"),
                "source_kind": biz.get("source_kind"),
                "review_id": item.get("id"),
                "patch": patch,
            }
        )
        if args.limit and len(planned) >= args.limit:
            break

    if args.apply:
        for item in planned:
            body = {
                **item["patch"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            client.patch("businesses", {"id": f"eq.{item['id']}"}, body)
            print(
                f"applied {item['name']} ← {item['source_kind']} "
                f"{','.join(item['patch'].keys())}"
            )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "needy": len(businesses),
        "matched_review": matched,
        "updated": len(planned),
        "field_hits": dict(sorted(field_hits.items(), key=lambda x: -x[1])),
        "sample": planned[:40],
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if args.apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / ("apply_latest.json" if args.apply else "dry_run_latest.json")).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: report[k] for k in ("mode", "needy", "matched_review", "updated", "field_hits",)}, ensure_ascii=False, indent=2))
    print("report", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
