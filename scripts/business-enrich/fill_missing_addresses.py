#!/usr/bin/env python3
"""Fill empty business address_line from description, website, social pages, Places, OCR.

Priority (fill-empty only, street-like addresses only):
  1. short_description + description
  2. Website HTML / JSON-LD
  3. Facebook / Instagram public page HTML
  4. Google Places (name + phone/city)
  5. Vision OCR on business image_url (Gemini) — flyer addresses

Usage:
  python3 scripts/business-enrich/fill_missing_addresses.py
  python3 scripts/business-enrich/fill_missing_addresses.py --apply
  python3 scripts/business-enrich/fill_missing_addresses.py --apply --geocode
  python3 scripts/business-enrich/fill_missing_addresses.py --apply --skip-places --skip-ocr
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from web_enrichment import extract_website_profile  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "fill_addresses"
OUT.mkdir(parents=True, exist_ok=True)

UA = "Mozilla/5.0 (compatible; KrugiAddressFill/1.0; +https://krugi.app)"
TIMEOUT = 12

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

JUNK_ADDR_RE = re.compile(
    r"(?i)\b(?:"
    r"contact\s+us|minutes?|click|subscribe|follow|whats?app|telegram|instagram|"
    r"facebook|email|phone|call\s+now|sign\s+up|log\s+in|password|cookie|"
    r"copyright|all\s+rights|lorem|ipsum|twincret|biopatid|lexus|toyota|"
    r"mercedes|bmw\b|monthly|deposit|\$\d"
    r")\b"
)

LABELED_ADDR_RE = re.compile(
    r"(?im)(?:^|\n)\s*(?:адрес|address|location|локаци[яи]|мы\s+по\s+адресу|"
    r"studio\s+address|адрес\s+студии|office|офис)\s*[:：]\s*(.+)$"
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
    r"Dana Point|Seal Beach|Westminster|Garden Grove|Corona|Riverside|"
    r"Valley Village|Hallandale Beach|North Port"
    r")\b"
)


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def looks_like_street(address: str | None) -> bool:
    if not address:
        return False
    a = address.strip()
    if len(a) < 10 or len(a) > 180:
        return False
    if JUNK_ADDR_RE.search(a):
        return False
    if not re.search(r"(^|\b)\d{1,6}\s+[A-Za-z]", a):
        return False
    # must include a real street suffix
    if not re.search(
        r"(?i)\b(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|"
        r"Way|Court|Ct|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Place|Pl|Terrace|Ter)\b",
        a,
    ):
        return False
    # reject "123 Contact Us Dr" style — street name token too generic
    m = re.match(
        r"(?i)\d{1,5}\s+(?:[NSEW]\.?\s+)?(.+?)\s+"
        r"(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|"
        r"Way|Court|Ct|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Place|Pl|Terrace|Ter)\b",
        a,
    )
    if m:
        name = m.group(1).strip().lower()
        if name in {
            "contact",
            "contact us",
            "us",
            "main menu",
            "home",
            "address",
            "the",
            "a",
            "an",
            "our",
            "your",
            "this",
            "that",
        }:
            return False
        if "address" in name:
            return False
    if re.fullmatch(r"[A-Za-z .'-]+,\s*[A-Z]{2}(,\s*\d{5})?", a):
        return False
    return True


def clean_address(raw: str | None) -> str | None:
    if not raw:
        return None
    cand = raw.strip().rstrip(".,;")
    cand = re.split(r"\s{2,}|\s[+📱📞]|https?://", cand)[0].strip()
    cand = re.sub(r"\s+", " ", cand)
    cand = re.sub(r"(?i)^(?:address|адрес)\s*[:：]?\s*", "", cand)
    # fix duplicated suffixes like "Laguna Canyon Rd St"
    cand = re.sub(
        r"(?i)\b(Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|"
        r"Way|Court|Ct|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Place|Pl|Terrace|Ter)"
        r"\.?\s+\1\b",
        r"\1",
        cand,
    )
    cand = re.sub(
        r"(?i)\b(Road|Rd)\.?\s+(Street|St)\b",
        r"\1",
        cand,
    )
    if re.search(r",(build|suit|orang|californ)$", cand, re.I):
        return None
    if not looks_like_street(cand):
        return None
    return cand[:160]


def extract_address_from_text(text: str) -> str | None:
    if not text:
        return None
    m = LABELED_ADDR_RE.search(text)
    if m:
        cleaned = clean_address(m.group(1))
        if cleaned:
            return cleaned
    m = STREET_RE.search(text)
    if m:
        return clean_address(m.group(1))
    return None


def extract_city(text: str, address: str | None) -> str | None:
    for blob in (address or "", text or ""):
        m = CITY_CA_RE.search(blob)
        if m:
            return m.group(1)
    return None


def http_get_bytes(url: str, max_bytes: int = 2_000_000) -> bytes | None:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": UA, "Accept": "*/*"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read(max_bytes)
    except Exception:
        return None


def http_get_text(url: str) -> str | None:
    raw = http_get_bytes(url, 900_000)
    if raw is None:
        return None
    return raw.decode("utf-8", errors="ignore")


def address_from_website(url: str | None) -> str | None:
    if not url:
        return None
    low = url.lower()
    if any(
        x in low
        for x in (
            "instagram.com",
            "facebook.com",
            "fb.com",
            "t.me/",
            "telegram.",
            "wa.me",
            "linktr.ee",
            "etsy.com",
            "youtube.com",
            "tiktok.com",
        )
    ):
        return None
    try:
        profile = extract_website_profile(url)
    except Exception:
        profile = None
    if isinstance(profile, dict):
        addr = profile.get("address")
        cleaned = clean_address(addr if isinstance(addr, str) else None)
        if cleaned:
            return cleaned
        # JSON-LD sometimes city-only — ignore
    # Contact/about pages
    base = url if "://" in url else f"https://{url}"
    base = base.rstrip("/")
    for path in ("", "/contact", "/contact-us", "/about", "/location", "/locations"):
        page = base if path == "" else base + path
        html = http_get_text(page)
        if not html:
            continue
        # Prefer JSON-LD on page
        for m in re.finditer(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>',
            html,
            re.I,
        ):
            try:
                data = json.loads(m.group(1))
            except Exception:
                continue
            blocks = data if isinstance(data, list) else [data]
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                addr = block.get("address")
                if isinstance(addr, dict):
                    parts = [
                        addr.get("streetAddress"),
                        addr.get("addressLocality"),
                        addr.get("addressRegion"),
                        addr.get("postalCode"),
                    ]
                    joined = ", ".join(str(p) for p in parts if p)
                    cleaned = clean_address(joined) or clean_address(
                        str(addr.get("streetAddress") or "")
                    )
                    if cleaned:
                        return cleaned
                elif isinstance(addr, str):
                    cleaned = clean_address(addr)
                    if cleaned:
                        return cleaned
        text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
        text = re.sub(r"<[^>]+>", "\n", text)
        found = extract_address_from_text(text[:20000])
        if found:
            return found
        time.sleep(0.25)
    return None


def address_from_social_url(url: str | None) -> str | None:
    """Best-effort: public FB/IG HTML often has address in JSON / meta for business pages."""
    if not url:
        return None
    html = http_get_text(url)
    if not html:
        return None
    # JSON-LD
    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>',
        html,
        re.I,
    ):
        try:
            data = json.loads(m.group(1))
        except Exception:
            continue
        blocks = data if isinstance(data, list) else [data]
        for block in blocks:
            if not isinstance(block, dict):
                continue
            addr = block.get("address")
            if isinstance(addr, dict):
                parts = [
                    addr.get("streetAddress"),
                    addr.get("addressLocality"),
                    addr.get("addressRegion"),
                    addr.get("postalCode"),
                ]
                joined = ", ".join(str(p) for p in parts if p)
                cleaned = clean_address(joined)
                if cleaned:
                    return cleaned
            elif isinstance(addr, str):
                cleaned = clean_address(addr)
                if cleaned:
                    return cleaned
    # street regex on visible text
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return extract_address_from_text(text[:15000])


def gemini_ocr_address(image_url: str) -> str | None:
    key = os.environ.get("GOOGLE_API_KEY") or ""
    if not key or not image_url or "placeholder" in image_url:
        return None
    img = http_get_bytes(image_url)
    if not img or len(img) < 500:
        return None
    # detect mime
    mime = "image/jpeg"
    if image_url.lower().endswith(".png") or img[:8].startswith(b"\x89PNG"):
        mime = "image/png"
    elif image_url.lower().endswith(".webp"):
        mime = "image/webp"
    b64 = base64.b64encode(img).decode("ascii")
    body = {
        "contents": [
            {
                "parts": [
                    {
                        "text": (
                            "Extract the physical street address of a business from this flyer/photo. "
                            "Return ONLY JSON: {\"address\": string|null}. "
                            "Address must include street number and street name if present. "
                            "No phone, no social handles. null if no street address."
                        )
                    },
                    {"inline_data": {"mime_type": mime, "data": b64}},
                ]
            }
        ],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 200},
    }
    models = [
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-2.0-flash-lite",
    ]
    for model in models:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={urllib.parse.quote(key)}"
        )
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            text = (
                payload.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
            m = re.search(r"\{[\s\S]*\}", text)
            if not m:
                continue
            data = json.loads(m.group(0))
            return clean_address(data.get("address"))
        except Exception:
            continue
    return None


def places_address(row: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
    """Return (address, extra patch fields) via Google Places."""
    try:
        from google_places import (
            lookup_business_places,
            place_to_fill_empty_patch,
            maps_api_key,
        )
    except Exception:
        return None, {}
    key = maps_api_key()
    if not key:
        return None, {}
    try:
        looked = lookup_business_places(row, key=key, sleep_s=0.2)
    except Exception:
        return None, {}
    if looked.get("decision") != "accept" or not looked.get("place"):
        return None, {}
    filled = place_to_fill_empty_patch(row, looked["place"], allow_address=True)
    patch = filled.get("patch") or {}
    addr = patch.get("address_line")
    cleaned = clean_address(addr) if addr else None
    if not cleaned:
        # Places street parser may return short street — accept if digit+word
        if addr and re.search(r"(^|\b)\d{1,6}\s+[A-Za-z]", addr) and len(addr) >= 8:
            cleaned = addr.strip()[:160]
        else:
            return None, {}
    extra = {
        k: v
        for k, v in patch.items()
        if k != "address_line"
        and empty(row.get(k))
    }
    return cleaned, extra


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


def fetch_targets(client: SupabaseRest) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        chunk = client._request(
            "GET",
            "/businesses",
            params={
                "select": (
                    "id,slug,name,status,phone,email,website,instagram_url,telegram_url,"
                    "source_url,source_kind,address_line,city,region,state_code,"
                    "latitude,longitude,location_precision,google_maps_url,"
                    "google_rating,google_reviews_count,image_url,yelp_url,"
                    "short_description,description"
                ),
                "status": "in.(approved,pending)",
                "order": "updated_at.desc",
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
    missing = [r for r in rows if empty(r.get("address_line"))]

    def priority(r: dict[str, Any]) -> tuple[int, str]:
        score = 0
        if r.get("website"):
            score += 40
        if r.get("yelp_url"):
            score += 30
        if r.get("instagram_url"):
            score += 15
        if r.get("telegram_url"):
            score += 10
        if r.get("image_url") and "placeholder" not in (r.get("image_url") or ""):
            score += 20
        if r.get("phone"):
            score += 10
        if r.get("status") == "approved":
            score += 5
        return (-score, (r.get("name") or "").lower())

    missing.sort(key=priority)
    return missing


def facebook_url_from_row(row: dict[str, Any]) -> str | None:
    blob = "\n".join(
        str(x)
        for x in (
            row.get("website"),
            row.get("source_url"),
            row.get("short_description"),
            row.get("description"),
        )
        if x
    )
    m = re.search(
        r"(https?://(?:www\.)?(?:facebook\.com|fb\.com)/[A-Za-z0-9._\-/]+)",
        blob,
        re.I,
    )
    if not m:
        return None
    url = m.group(1).split("?")[0]
    if "/groups/" in url.lower() or "/permalink/" in url.lower():
        return None
    return url


def resolve_address(row: dict[str, Any], args: argparse.Namespace) -> dict[str, Any] | None:
    blob = "\n".join(
        str(x) for x in (row.get("short_description"), row.get("description")) if x
    )
    # 1) copy
    addr = extract_address_from_text(blob)
    source = "description" if addr else None

    # 2) website
    if not addr and row.get("website"):
        addr = address_from_website(row.get("website"))
        if addr:
            source = "website"
            time.sleep(0.4)

    # 2b) yelp page
    if not addr and row.get("yelp_url"):
        addr = address_from_social_url(row.get("yelp_url"))
        if addr:
            source = "yelp"
        time.sleep(0.4)

    # 3) facebook page
    if not addr:
        fb = facebook_url_from_row(row)
        if fb:
            addr = address_from_social_url(fb)
            if addr:
                source = "facebook"
            time.sleep(0.4)

    # 4) instagram profile page (rarely has street; still try)
    if not addr and row.get("instagram_url") and not args.skip_social:
        addr = address_from_social_url(row.get("instagram_url"))
        if addr:
            source = "instagram"
        time.sleep(0.35)

    # 5) telegram channel page (t.me/username public)
    if not addr and row.get("telegram_url") and not args.skip_social:
        tg = row.get("telegram_url") or ""
        if re.search(r"t\.me/[A-Za-z][A-Za-z0-9_]{3,}$", tg):
            addr = address_from_social_url(tg)
            if addr:
                source = "telegram"
            time.sleep(0.35)

    # 6) Places (may 429 if daily quota exhausted)
    extra: dict[str, Any] = {}
    if not addr and not args.skip_places:
        if row.get("phone") or (row.get("name") and row.get("city") and row.get("website")):
            try:
                addr, extra = places_address(row)
                if addr:
                    source = "google_places"
            except Exception as exc:
                if "429" in str(exc) or "RESOURCE_EXHAUSTED" in str(exc):
                    args.skip_places = True
                    print("Places quota exceeded — skipping further Places calls")
                else:
                    print(f"Places error for {row.get('name')}: {exc}")
            time.sleep(0.25)

    # 7) OCR image
    if not addr and not args.skip_ocr and row.get("image_url"):
        addr = gemini_ocr_address(row["image_url"])
        if addr:
            source = "image_ocr"
        time.sleep(0.2)

    if not addr or not source:
        return None

    patch: dict[str, Any] = {"address_line": addr, **extra}
    if empty(row.get("city")):
        city = extract_city(blob, addr)
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

    if args.geocode and row.get("latitude") is None and "latitude" not in patch:
        city = patch.get("city") or row.get("city") or ""
        state = (patch.get("state_code") or row.get("state_code") or "CA").replace(
            "US-", ""
        )
        query = ", ".join(p for p in (addr, city, state, "USA") if p)
        coords = geocode(query)
        time.sleep(1.05)
        if coords:
            patch["latitude"] = coords[0]
            patch["longitude"] = coords[1]
            patch["location_precision"] = "street"

    return {"source": source, "patch": patch}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--geocode", action="store_true")
    parser.add_argument("--skip-places", action="store_true")
    parser.add_argument("--skip-ocr", action="store_true")
    parser.add_argument("--skip-social", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    targets = fetch_targets(client)
    if args.limit > 0:
        targets = targets[: args.limit]

    planned: list[dict[str, Any]] = []
    by_source: dict[str, int] = {}
    for i, row in enumerate(targets, 1):
        result = resolve_address(row, args)
        if not result:
            continue
        source = result["source"]
        by_source[source] = by_source.get(source, 0) + 1
        planned.append(
            {
                "id": row["id"],
                "slug": row.get("slug"),
                "name": row.get("name"),
                "status": row.get("status"),
                "source": source,
                "patch": result["patch"],
            }
        )
        print(
            f"[{i}/{len(targets)}] {source}: {row.get('name')} → {result['patch'].get('address_line')}"
        )

    if args.apply:
        for item in planned:
            body = {
                **item["patch"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            client.patch("businesses", {"id": f"eq.{item['id']}"}, body)
            print(f"applied {item.get('name')} ← {item['source']}")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "scanned_without_address": len(targets),
        "filled": len(planned),
        "by_source": by_source,
        "items": planned,
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
                "scanned_without_address": len(targets),
                "filled": len(planned),
                "by_source": by_source,
                "report": str(path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
