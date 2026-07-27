#!/usr/bin/env python3
"""Enrich businesses FROM their own card copy (description / short_description).

This is the gap the user hit: source posts and free-text descriptions already
contain phones, Instagram, addresses — but structured columns stay empty.

Rules:
  - Only fill EMPTY fields (never overwrite)
  - Mine description + short_description (+ website misplaced socials)
  - Optionally geocode when address_line is newly set and lat/lng missing

Usage:
  python3 scripts/business-enrich/enrich_from_card_copy.py --dry-run --limit 30
  python3 scripts/business-enrich/enrich_from_card_copy.py --apply
  python3 scripts/business-enrich/enrich_from_card_copy.py --apply --geocode
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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

OUT = Path(__file__).resolve().parent / "data" / "card_copy_enrich"
OUT.mkdir(parents=True, exist_ok=True)

UA = "KrugiCardCopyEnrich/1.0 (catalog; contact@krugi.app)"

SOURCE_FOOTER_RE = re.compile(
    r"(?im)^(?:источник|source|original post)\s*[:：].*$"
)
FB_ENTITY_DUMP_RE = re.compile(
    r"\n?---FB_ENTITY_[\w-]+---\s*\{[\s\S]*?\n\}",
    re.I,
)

ADDRESS_LABELED_RE = re.compile(
    r"(?im)(?:^|\n)\s*(?:адрес|address|location|локаци[яи]|мы\s+по\s+адресу|"
    r"studio\s+address|адрес\s+студии)\s*[:：]\s*(.+)$"
)

# US-ish street line: 123 Main St / 23221 S Pointe Dr, Suite 103
STREET_RE = re.compile(
    r"(?i)\b(\d{1,6}\s+[A-Za-z0-9.#\-]+(?:\s+[A-Za-z0-9.#\-]+){0,6}"
    r"\s(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|"
    r"way|ct|court|cir|circle|hwy|highway|pkwy|parkway|pl|place|suite|ste|"
    r"unit|apt)\.?\b"
    r"(?:\s*(?:#|suite|ste|unit|apt)\.?\s*[A-Za-z0-9\-]+)?"
    r"(?:\s*,\s*[A-Za-z][A-Za-z .'\-]{2,40})?"
    r"(?:\s*,\s*(?:CA|NY|FL|TX|WA|IL|AZ|NV|OR|CO|GA|NC|NJ|PA|OH|MI|MA)"
    r"(?:\s+\d{5}(?:-\d{4})?)?)?)"
)

CITY_CA_RE = re.compile(
    r"(?i)\b("
    r"Los Angeles|Orange County|Irvine|Newport Beach|Laguna Hills|"
    r"Laguna Woods|Laguna Niguel|Mission Viejo|Costa Mesa|Huntington Beach|"
    r"Santa Ana|Anaheim|Tustin|Fountain Valley|Fullerton|Yorba Linda|"
    r"San Diego|San Francisco|Sacramento|San Jose|Glendale|Burbank|"
    r"Sherman Oaks|Beverly Hills|West Hollywood|Long Beach|Torrance|"
    r"Pasadena|Encino|Van Nuys|Reseda|Woodland Hills|Calabasas|"
    r"Aliso Viejo|Lake Forest|Rancho Santa Margarita|San Clemente|"
    r"Dana Point|Seal Beach|Westminster|Garden Grove|Corona|Riverside"
    r")\b"
)

FACEBOOK_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:facebook\.com|fb\.com)/[A-Za-z0-9._\-/]+",
    re.I,
)
YELP_RE = re.compile(
    r"(?:https?://)?(?:www\.)?yelp\.com/[^\s<>\"']+",
    re.I,
)


def empty(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str):
        s = v.strip()
        return (not s) or s == "/placeholder.svg"
    return False


def card_blob(row: dict[str, Any]) -> str:
    parts = [
        row.get("name"),
        row.get("short_description"),
        row.get("description"),
        row.get("website"),
        row.get("instagram_url"),
        row.get("telegram_url"),
    ]
    text = "\n".join(str(p) for p in parts if p and str(p).strip())
    text = SOURCE_FOOTER_RE.sub("", text)
    text = FB_ENTITY_DUMP_RE.sub("", text)
    return text.strip()


def normalize_instagram_url(handle_or_url: str | None) -> str | None:
    if not handle_or_url:
        return None
    v = handle_or_url.strip()
    m = re.search(r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})", v, re.I)
    handle = (m.group(1) if m else v.lstrip("@")).strip().strip("/")
    handle = handle.split("?")[0].split("/")[0]
    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", handle or ""):
        return None
    if handle.lower() in {"reel", "p", "stories", "explore", "accounts"}:
        return None
    return f"https://www.instagram.com/{handle}"


def normalize_telegram_url(handle: str | None) -> str | None:
    if not handle:
        return None
    h = handle.strip().lstrip("@")
    if not re.fullmatch(r"[A-Za-z0-9_]{4,32}", h or ""):
        return None
    if h.isdigit() or h.lower() in {"c", "share", "joinchat"}:
        return None
    return f"https://t.me/{h}"


def normalize_website(url: str | None) -> str | None:
    if not url:
        return None
    v = url.strip().rstrip(".,);]")
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    lower = v.lower()
    if any(
        x in lower
        for x in (
            "instagram.com",
            "facebook.com",
            "fb.com",
            "t.me/",
            "telegram.me",
            "wa.me/",
            "yelp.com",
            "maps.google",
            "goo.gl/maps",
        )
    ):
        return None
    return v[:300]


def extract_facebook(text: str) -> str | None:
    m = FACEBOOK_RE.search(text or "")
    if not m:
        return None
    url = m.group(0)
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    # Skip post permalinks as "page" — still useful as contact presence
    return url.split("?")[0][:300]


def extract_yelp(text: str) -> str | None:
    m = YELP_RE.search(text or "")
    if not m:
        return None
    url = m.group(0)
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    return url.split("?")[0][:300]


def extract_address(text: str) -> str | None:
    m = ADDRESS_LABELED_RE.search(text or "")
    if m:
        cand = m.group(1).strip().rstrip(".,;")
        # Stop at phone/emoji spam
        cand = re.split(r"(?:\s{2,}|\s[+📱📞])", cand)[0].strip()
        if 8 <= len(cand) <= 160:
            return cand[:160]
    m = STREET_RE.search(text or "")
    if m:
        cand = m.group(1).strip().rstrip(".,;")
        if 8 <= len(cand) <= 160:
            return cand[:160]
    return None


def extract_city(text: str, address: str | None) -> str | None:
    for blob in (address or "", text or ""):
        m = CITY_CA_RE.search(blob)
        if m:
            return m.group(1)
    return None


def needs_card_enrichment(row: dict[str, Any]) -> bool:
    return any(
        empty(row.get(k))
        for k in (
            "phone",
            "email",
            "instagram_url",
            "telegram_url",
            "website",
            "address_line",
            "yelp_url",
        )
    )


def extract_telegram_labeled(text: str) -> list[str]:
    """Only labeled Telegram contacts — bare t.me links are often source posts."""
    found: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(
        r"(?i)(?:telegram|телеграм(?:м)?|тг)\s*[:：]\s*@?([A-Za-z0-9_]{4,32})\b",
        text or "",
    ):
        h = m.group(1).lower()
        if h.isdigit() or h in {"share", "joinchat", "c"}:
            continue
        if h not in seen:
            seen.add(h)
            found.append(h)
    return found


def clean_address(raw: str | None) -> str | None:
    if not raw:
        return None
    cand = raw.strip().rstrip(".,;")
    cand = re.split(r"\s{2,}|\s[+📱📞]|https?://", cand)[0].strip()
    # Truncation junk: ends with partial word after comma
    if re.search(r",(build|suit|orang|californ)$", cand, re.I):
        return None
    if len(cand) < 10 or len(cand) > 160:
        return None
    if re.fullmatch(
        r"(?i)(?:california|ca|orange county|los angeles|irvine|newport beach|usa)",
        cand,
    ):
        return None
    # Must look like a street (digit + street type) OR labeled multi-token place
    if not STREET_RE.search(cand) and not re.search(r"\d", cand):
        return None
    return cand[:160]


def build_patch(row: dict[str, Any]) -> dict[str, Any]:
    blob = card_blob(row)
    if not blob:
        return {}

    patch: dict[str, Any] = {}

    website_raw = (row.get("website") or "").strip()
    if website_raw:
        if "instagram.com" in website_raw.lower() and empty(row.get("instagram_url")):
            ig = normalize_instagram_url(website_raw)
            if ig:
                patch["instagram_url"] = ig
        if re.search(r"t\.me/|telegram\.me", website_raw, re.I) and empty(
            row.get("telegram_url")
        ):
            # Only if website itself is a profile link, not a post
            tgs = extract_telegram(website_raw)
            tg = normalize_telegram_url(tgs[0] if tgs else None)
            if tg and "/c/" not in website_raw:
                patch["telegram_url"] = tg

    if empty(row.get("phone")):
        phones = extract_phones(blob)
        phone = None
        for cand in phones:
            digits = re.sub(r"\D", "", cand or "")
            # Prefer NANP (+1XXXXXXXXXX) or reasonable intl (<=12 digits)
            if len(digits) == 11 and digits.startswith("1"):
                phone = cand
                break
            if 10 <= len(digits) <= 12:
                phone = cand
                break
        if phone:
            patch["phone"] = phone

    if empty(row.get("email")):
        emails = extract_emails(blob)
        if emails:
            patch["email"] = emails[0]

    if empty(row.get("instagram_url")) and "instagram_url" not in patch:
        igs = extract_instagram(blob)
        ig = normalize_instagram_url(igs[0] if igs else None)
        if not ig:
            # Full URL fallback
            m = re.search(
                r"(?:https?://)?(?:www\.)?instagram\.com/([A-Za-z0-9._]{2,30})",
                blob,
                re.I,
            )
            if m:
                ig = normalize_instagram_url(m.group(0))
        if ig:
            patch["instagram_url"] = ig

    if empty(row.get("telegram_url")) and "telegram_url" not in patch:
        tgs = extract_telegram_labeled(blob)
        tg = normalize_telegram_url(tgs[0] if tgs else None)
        if tg:
            patch["telegram_url"] = tg

    website_is_junk = bool(
        website_raw
        and re.search(
            r"instagram\.com|facebook\.com|fb\.com|t\.me/|telegram\.me|yelp\.com",
            website_raw,
            re.I,
        )
    )
    if empty(row.get("website")) or website_is_junk:
        webs = extract_websites(blob)
        web = None
        for candidate in webs:
            web = normalize_website(candidate)
            if web and len(web) > 12 and "." in web.split("//", 1)[-1]:
                # Reject truncated hosts like instagram.co
                host = re.sub(r"^https?://(?:www\.)?", "", web, flags=re.I).split("/")[0]
                if host.endswith((".com", ".net", ".org", ".io", ".us", ".app", ".biz", ".coach")):
                    break
                # Reject truncated hosts like "instagram.co"
                if re.search(r"\.[a-z]{2,}$", host) and not host.endswith(".co"):
                    break
                web = None
        if web:
            patch["website"] = web
        elif website_is_junk:
            patch["website"] = None

    if empty(row.get("yelp_url")):
        yelp = extract_yelp(blob)
        if yelp:
            patch["yelp_url"] = yelp

    if empty(row.get("address_line")):
        addr = clean_address(extract_address(blob))
        if addr:
            patch["address_line"] = addr

    if empty(row.get("city")):
        city = extract_city(blob, patch.get("address_line") or row.get("address_line"))
        if city:
            patch["city"] = city
            if city.lower() in {
                "irvine",
                "newport beach",
                "laguna hills",
                "laguna woods",
                "mission viejo",
                "costa mesa",
                "huntington beach",
                "santa ana",
                "anaheim",
                "tustin",
                "aliso viejo",
                "lake forest",
            }:
                patch.setdefault("region", "Orange County")
                patch.setdefault("state_code", "CA")
            elif city.lower() in {
                "los angeles",
                "glendale",
                "burbank",
                "sherman oaks",
                "beverly hills",
                "long beach",
                "pasadena",
                "encino",
                "van nuys",
                "valley village",
            }:
                patch.setdefault("region", "Los Angeles")
                patch.setdefault("state_code", "CA")
            elif city.lower() == "orange county":
                patch["city"] = "Orange County"
                patch.setdefault("region", "Orange County")
                patch.setdefault("state_code", "CA")

    return patch


def geocode(query: str) -> tuple[float, float] | None:
    q = urllib.parse.urlencode({"q": query, "format": "json", "limit": "1"})
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{q}",
        headers={"User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if not data:
            return None
        return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception:
        return None


def fetch_businesses(client: SupabaseRest, limit: int, offset: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page = 200
    cur = offset
    while len(rows) < limit:
        chunk = client._request(
            "GET",
            "/businesses",
            params={
                "select": (
                    "id,slug,name,status,phone,email,website,instagram_url,telegram_url,"
                    "yelp_url,address_line,city,region,state_code,latitude,longitude,"
                    "short_description,description,image_url"
                ),
                "status": "eq.approved",
                "order": "updated_at.desc",
                "limit": str(min(page, limit - len(rows))),
                "offset": str(cur),
            },
        )
        if not isinstance(chunk, list) or not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        cur += page
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--geocode", action="store_true")
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--offset", type=int, default=0)
    args = parser.parse_args()

    load_env()
    import os

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    businesses = fetch_businesses(client, args.limit, args.offset)
    planned: list[dict[str, Any]] = []
    skipped = 0

    for row in businesses:
        if not needs_card_enrichment(row):
            skipped += 1
            continue
        patch = build_patch(row)
        if not patch:
            skipped += 1
            continue

        if args.geocode and patch.get("address_line") and row.get("latitude") is None:
            city = patch.get("city") or row.get("city") or ""
            state = patch.get("state_code") or row.get("state_code") or "CA"
            query = ", ".join(
                p for p in (patch["address_line"], city, state, "USA") if p
            )
            coords = geocode(query)
            time.sleep(1.1)
            if coords:
                patch["latitude"] = coords[0]
                patch["longitude"] = coords[1]
                patch["location_precision"] = "street"

        planned.append(
            {
                "id": row["id"],
                "slug": row["slug"],
                "name": row.get("name"),
                "patch": patch,
            }
        )

    if args.apply:
        for item in planned:
            body = {**item["patch"], "updated_at": datetime.now(timezone.utc).isoformat()}
            # PostgREST: omit keys with explicit None if we want clear — send null
            client.patch("businesses", {"id": f"eq.{item['id']}"}, body)

    field_hits: dict[str, int] = {}
    for item in planned:
        for k in item["patch"]:
            field_hits[k] = field_hits.get(k, 0) + 1

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "scanned": len(businesses),
        "updated": len(planned),
        "skipped": skipped,
        "field_hits": dict(sorted(field_hits.items(), key=lambda x: -x[1])),
        "sample": planned[:40],
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
                "mode": report["mode"],
                "scanned": report["scanned"],
                "updated": report["updated"],
                "skipped": skipped,
                "field_hits": report["field_hits"],
                "report": str(path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
