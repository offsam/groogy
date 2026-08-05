#!/usr/bin/env python3
"""Import Russian / Slavic-speaking churches across the USA into public.churches.

Sources (public parish directories):
  - Moscow Patriarchate USA (mospatusa.com)
  - ROCOR Eastern / Western / Chicago dioceses (Orthodox Web Solutions tables)
  - United With Ukraine «Churches in North America» (Slavic / RU / UA listings)

Usage:
  python3 scripts/business-enrich/import_usa_churches.py --dry-run
  python3 scripts/business-enrich/import_usa_churches.py --apply
  python3 scripts/business-enrich/import_usa_churches.py --apply --skip-withua
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))
from address_geo import resolve_address_geo, scrub_directory_glue  # noqa: E402
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "usa_churches"
OUT.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (compatible; KrugiChurchImport/1.0; +https://krugi.app)"
)
TIMEOUT = 30

STATE_NAME_TO_CODE = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "district of columbia": "DC",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY",
    "puerto rico": "PR",
}

# Ortho Web Solutions parish tables (ROCOR / MP)
OWS_SOURCES = [
    {
        "id": "mospatusa",
        "url": "https://mospatusa.com/parishdirectory.html",
        "label": "Patriarchal Parishes (Moscow) USA",
    },
    {
        "id": "rocor-eastern",
        "url": "https://www.eadiocese.org/parishes",
        "label": "ROCOR Eastern American Diocese",
    },
    {
        "id": "rocor-western",
        "url": "https://www.wadiocese.com/parishes",
        "label": "ROCOR Western American Diocese",
    },
    {
        "id": "rocor-chicago",
        "url": "https://www.chicagodiocese.org/parishes",
        "label": "ROCOR Chicago & Mid-America Diocese",
    },
]

SKIP_NAME_RE = re.compile(
    r"(?i)(western\s+rite|cemetery|spanish\s+mission|"
    r"misión|paroisse|paroisee|caribbean|haiti|nicaragua|mexico|"
    r"dominica|jamaica|trinidad|costa\s+rica|grenad)"
)

US_COUNTRY_RE = re.compile(r"(?i)^(united\s+states|usa|u\.s\.a\.?|us)?$")


def http_get(url: str) -> str | None:
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        print(f"  fetch fail {url}: {exc}", file=sys.stderr)
        return None


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(s or "")).strip()


def state_code(raw: str | None) -> str | None:
    s = clean(raw)
    if not s:
        return None
    if re.fullmatch(r"[A-Za-z]{2}", s):
        return s.upper()
    return STATE_NAME_TO_CODE.get(s.lower())


def fold_key(*parts: str | None) -> str:
    raw = " ".join(clean(p) for p in parts if p).lower()
    raw = unicodedata.normalize("NFKD", raw)
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", raw)


def slugify(name: str, city: str | None, state: str | None) -> str:
    base = "-".join(x for x in [name, city or "", state or ""] if x)
    norm = unicodedata.normalize("NFKD", base.lower())
    ascii_only = "".join(ch for ch in norm if not unicodedata.combining(ch))
    s = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
    if len(s) >= 3 and re.search(r"[a-z]", s):
        return s[:70]
    digest = hashlib.md5(base.encode("utf-8")).hexdigest()[:10]
    return f"church-{digest}"


def strip_tags(html: str) -> str:
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return clean(text)


def parse_ows_table(html: str, source_url: str, source_id: str) -> list[dict[str, Any]]:
    """Parse Orthodox Web Solutions parish directory tables."""
    rows: list[dict[str, Any]] = []
    # Each data row often: <tr>...<td>Name<a...www></a></td>...<td>City</td><td>State</td>
    for tr in re.finditer(r"(?is)<tr[^>]*>(.*?)</tr>", html):
        cells = re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", tr.group(1))
        if len(cells) < 3:
            continue
        texts = [strip_tags(c) for c in cells]
        # Skip header
        joined = " ".join(texts).lower()
        if "parish" in texts[0].lower() and "city" in joined:
            continue
        name = texts[0]
        if not name or len(name) < 4:
            continue
        name = re.sub(r"\s*\(?\s*www\s*\)?\s*$", "", name, flags=re.I).strip()
        name = re.sub(r"\s+", " ", name)
        if SKIP_NAME_RE.search(name):
            continue
        # Find city/state — usually last two columns
        city = texts[-2] if len(texts) >= 2 else ""
        state_raw = texts[-1] if texts else ""
        country = ""
        for t in texts[1:-2]:
            if US_COUNTRY_RE.match(t) or t.lower() in {
                "united states",
                "usa",
                "mexico",
                "haiti",
                "nicaragua",
                "costa rica",
                "dominica",
                "jamaica",
            }:
                country = t
        if country and country.lower() not in {"", "united states", "usa", "us", "u.s.a."}:
            continue
        sc = state_code(state_raw)
        if not sc:
            # Sometimes state is full name in city column patterns
            sc = state_code(city) if len(city) == 2 else None
        if not sc:
            continue
        # Extract parish website link if present
        website = None
        for m in re.finditer(r'(?is)<a[^>]+href=["\']([^"\']+)["\'][^>]*>\s*\(?www\)?', cells[0]):
            href = m.group(1).strip()
            if href.startswith("http") and "eadiocese" not in href and "wadiocese" not in href:
                website = href
                break
            if href.startswith("http"):
                website = href
                break
        # Detail page link (first <a> without www)
        detail = None
        for m in re.finditer(r'(?is)<a[^>]+href=["\']([^"\']+)["\']', cells[0]):
            href = urllib.parse.urljoin(source_url, m.group(1).strip())
            if "www)" in m.group(0).lower() or href == website:
                continue
            if any(x in href for x in ("parish", "church", "directory", "listing", "detail")):
                detail = href
                break
            if href.startswith("http") and href.rstrip("/") != source_url.rstrip("/"):
                detail = href
                break

        city_clean = clean(city)
        if city_clean.upper() == sc:
            city_clean = ""
        rows.append(
            {
                "name": name[:200],
                "city": city_clean or None,
                "state_code": sc,
                "website": website,
                "source_url": detail or source_url,
                "source_kind": "directory",
                "source_id": source_id,
                "country": "US",
            }
        )
    return rows


def scrape_ows_sources() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for src in OWS_SOURCES:
        print(f"… {src['label']}")
        html = http_get(src["url"])
        if not html:
            continue
        found = parse_ows_table(html, src["url"], src["id"])
        print(f"  {len(found)} USA rows")
        out.extend(found)
        time.sleep(0.4)
    return out


def scrape_withua(max_pages: int = 20) -> list[dict[str, Any]]:
    """Paginate withua explore and fetch listing detail pages for address."""
    out: list[dict[str, Any]] = []
    listing_re = re.compile(
        r'href="(https://withua\.org/listing/[^"]+)/?"[^>]*>[\s\S]*?<h4[^>]*>\s*([^<]+?)\s*</h4>',
        re.I,
    )
    seen_urls: set[str] = set()
    for page in range(1, max_pages + 1):
        url = (
            "https://withua.org/explore/"
            f"?type=churches-in-north-america&onpage={page}"
        )
        print(f"… withua page {page}")
        html = http_get(url)
        if not html:
            break
        batch = listing_re.findall(html)
        if not batch:
            # alternate markup
            batch = re.findall(
                r'href="(https://withua\.org/listing/[^"]+)"[^>]*>',
                html,
                re.I,
            )
            batch = [(u, "") for u in batch]
        new = 0
        for href, title in batch:
            href = href.rstrip("/")
            if href in seen_urls:
                continue
            seen_urls.add(href)
            new += 1
            name = clean(title) if title else ""
            detail_html = http_get(href + "/")
            time.sleep(0.25)
            phone = None
            email = None
            website = None
            address_line = None
            city = None
            state = None
            postal = None
            text = ""
            if detail_html:
                if not name:
                    m = re.search(r"<h1[^>]*>(.*?)</h1>", detail_html, re.I | re.S)
                    if m:
                        name = strip_tags(m.group(1))
                text = strip_tags(detail_html)
                # Prefer "... St, City, ST 12345, USA"
                maddr = re.search(
                    r"(\d{1,6}\s+[A-Za-z0-9.'\-]+(?:\s+[A-Za-z0-9.'\-/#]+){0,8})"
                    r",\s*([A-Za-z .'\-]{2,40}),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?"
                    r"(?:\s*,\s*USA)?",
                    text,
                )
                if not maddr:
                    maddr = re.search(
                        r"(\d{1,6}\s+[A-Za-z0-9.'\-]+(?:\s+[A-Za-z0-9.'\-/#]+){0,8})"
                        r",\s*([A-Za-z .'\-]{2,40}),\s*([A-Z]{2})\b",
                        text,
                    )
                if maddr:
                    address_line = maddr.group(1).strip()
                    city = maddr.group(2).strip()
                    state = maddr.group(3).strip()
                    if maddr.lastindex and maddr.lastindex >= 4:
                        postal = maddr.group(4)
                mphone = re.search(
                    r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}",
                    text,
                )
                if mphone:
                    phone = mphone.group(0)
                memail = re.search(
                    r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}",
                    text,
                    re.I,
                )
                if memail and "withua.org" not in memail.group(0).lower():
                    email = memail.group(0)
                website = pick_website(detail_html)
            # Keep US only
            sc = state_code(state)
            if not sc:
                # Canada / no address — skip
                if re.search(r"\bCanada\b|\bOntario\b|\bAlberta\b", text or "", re.I):
                    continue
                # last resort: state from title "… Ann Arbor" won't help; skip
                continue
            if not name:
                continue
            # withua explore feed is already «Churches in North America» (Slavic diaspora)
            out.append(
                {
                    "name": name[:200],
                    "city": city,
                    "state_code": sc,
                    "postal_code": postal,
                    "address_line": address_line,
                    "phone": phone,
                    "email": email,
                    "website": website,
                    "source_url": href,
                    "source_kind": "directory",
                    "source_id": "withua",
                    "country": "US",
                }
            )
        print(f"  +{new} listings (total unique {len(seen_urls)})")
        if new == 0:
            break
        time.sleep(0.5)
    return out


JUNK_WEBSITE_HOSTS = {
    "gmpg.org",
    "schema.org",
    "w3.org",
    "wordpress.org",
    "wordpress.com",
    "gravatar.com",
    "googleapis.com",
    "gstatic.com",
    "google.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "cdnjs.cloudflare.com",
    "jsdelivr.net",
    "unpkg.com",
    "withua.org",
    "facebook.com",
    "instagram.com",
    "youtube.com",
    "youtu.be",
    "twitter.com",
    "x.com",
    "t.me",
    "telegram.me",
    "maps.google.com",
    "goo.gl",
    "bible.com",
    "youversion.com",
    "linktr.ee",
    "bit.ly",
    "tinyurl.com",
}


def host_key(url: str | None) -> str | None:
    if not url:
        return None
    try:
        host = urllib.parse.urlparse(url).netloc.lower()
    except Exception:
        return None
    host = host[4:] if host.startswith("www.") else host
    if not host or "." not in host or " " in host or "%" in host:
        return None
    if host in JUNK_WEBSITE_HOSTS:
        return None
    # also drop CDN / tracker subdomains of junk parents
    if any(host.endswith("." + junk) for junk in JUNK_WEBSITE_HOSTS):
        return None
    return host


def pick_website(detail_html: str) -> str | None:
    """First plausible external church site; skip meta/CDN/social junk."""
    for m in re.finditer(
        r'href=["\'](https?://[^"\']+)["\']',
        detail_html,
        re.I,
    ):
        cand = m.group(1).strip()
        if cand.startswith("mailto:") or cand.startswith("tel:"):
            continue
        if host_key(cand):
            return cand.split("#")[0].rstrip("/")
    return None


def dedupe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    by_host: dict[str, str] = {}
    for row in rows:
        # scrub junk websites before host-based merge
        if row.get("website") and not host_key(row.get("website")):
            row["website"] = None
        key = fold_key(row.get("name"), row.get("city"), row.get("state_code"))
        if not key:
            continue
        host = host_key(row.get("website"))
        if host and host in by_host:
            # merge into existing host record
            prev = by_key[by_host[host]]
            for k in ("phone", "email", "address_line", "postal_code", "website"):
                if row.get(k) and not prev.get(k):
                    prev[k] = row[k]
            continue
        prev = by_key.get(key)
        if not prev:
            by_key[key] = row
            if host:
                by_host[host] = key
            continue
        score = sum(
            1
            for k in ("website", "phone", "address_line", "email", "postal_code")
            if row.get(k)
        )
        prev_score = sum(
            1
            for k in ("website", "phone", "address_line", "email", "postal_code")
            if prev.get(k)
        )
        if score > prev_score:
            by_key[key] = row
            if host:
                by_host[host] = key
    return list(by_key.values())


def load_existing(client: SupabaseRest) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/churches",
                params={
                    "select": "id,slug,name,city,state_code,website,source_url,status",
                    "order": "name.asc",
                    "limit": "500",
                    "offset": str(offset),
                },
            )
            or []
        )
        if not batch:
            break
        out.extend(batch)
        if len(batch) < 500:
            break
        offset += len(batch)
    return out


def unique_slug(client: SupabaseRest, base: str, existing_slugs: set[str]) -> str:
    candidate = base
    n = 0
    while candidate in existing_slugs:
        n += 1
        candidate = f"{base}-{n}"
    # also check DB
    while True:
        rows = (
            client._request(
                "GET",
                "/churches",
                params={"select": "id", "slug": f"eq.{candidate}", "limit": "1"},
            )
            or []
        )
        if not rows and candidate not in existing_slugs:
            existing_slugs.add(candidate)
            return candidate
        n += 1
        candidate = f"{base}-{n}"


def to_payload(row: dict[str, Any], slug: str, *, geocode: bool = True) -> dict[str, Any]:
    """Build a churches insert row. Street address → geocode at import time
    so the card lands on the map without a later backfill."""
    now = datetime.now(timezone.utc).isoformat()
    raw_addr = (row.get("address_line") or "").strip() or None
    addr = scrub_directory_glue(raw_addr) or None
    city = (row.get("city") or "").strip() or None
    state = (row.get("state_code") or "").strip() or None
    postal = (row.get("postal_code") or "").strip() or None
    payload: dict[str, Any] = {
        "name": row["name"],
        "slug": slug,
        "status": "approved",
        "city": city,
        "state_code": state,
        "postal_code": postal,
        "address_line": addr,
        "phone": row.get("phone"),
        "email": row.get("email"),
        "website": row.get("website"),
        "source_url": row.get("source_url"),
        "source_kind": "directory",
        "published_at": now,
        "description": None,
        "ministries": [],
        "latitude": None,
        "longitude": None,
        "location_precision": None,
    }
    if geocode and addr:
        geo = resolve_address_geo(addr, city, state, postal)
        for key in (
            "latitude",
            "longitude",
            "location_precision",
            "google_maps_url",
            "postal_code",
        ):
            val = (geo.patch or {}).get(key)
            if val is not None:
                payload[key] = val
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--skip-withua", action="store_true")
    parser.add_argument("--only-withua", action="store_true")
    parser.add_argument("--withua-pages", type=int, default=12)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    apply = bool(args.apply)
    if apply:
        args.dry_run = False

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    collected: list[dict[str, Any]] = []
    if not args.only_withua:
        collected.extend(scrape_ows_sources())
    if not args.skip_withua:
        collected.extend(scrape_withua(max_pages=args.withua_pages))

    collected = dedupe(collected)
    if args.limit > 0:
        collected = collected[: args.limit]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    raw_path = OUT / f"usa_churches_raw_{stamp}.json"
    raw_path.write_text(json.dumps(collected, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"collected={len(collected)} wrote {raw_path}")

    existing = load_existing(client)
    by_fold = {
        fold_key(r.get("name"), r.get("city"), r.get("state_code")): r for r in existing
    }
    by_source = {
        clean(r.get("source_url") or "").lower(): r
        for r in existing
        if r.get("source_url")
    }
    by_host = {
        host_key(r.get("website")): r
        for r in existing
        if host_key(r.get("website"))
    }
    existing_slugs = {r["slug"] for r in existing if r.get("slug")}

    to_insert: list[dict[str, Any]] = []
    skipped = 0
    for row in collected:
        key = fold_key(row.get("name"), row.get("city"), row.get("state_code"))
        src = clean(row.get("source_url") or "").lower()
        host = host_key(row.get("website"))
        if key in by_fold or (src and src in by_source) or (host and host in by_host):
            skipped += 1
            continue
        base = slugify(row["name"], row.get("city"), row.get("state_code"))
        slug = unique_slug(client, base, existing_slugs) if apply else base
        to_insert.append(
            {
                "row": row,
                "slug": slug,
                # Geocode only on apply — dry-run should not hit Nominatim.
                "payload": to_payload(row, slug, geocode=apply),
            }
        )
        # prevent duplicates within batch
        by_fold[key] = row
        if host:
            by_host[host] = row
        if src:
            by_source[src] = row

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "apply": apply,
        "collected": len(collected),
        "skipped_existing": skipped,
        "to_insert": len(to_insert),
        "sample": [
            {
                "name": x["row"]["name"],
                "city": x["row"].get("city"),
                "state": x["row"].get("state_code"),
                "source_id": x["row"].get("source_id"),
            }
            for x in to_insert[:25]
        ],
        "inserted": [],
        "errors": [],
    }

    print(
        json.dumps(
            {
                "collected": len(collected),
                "skipped_existing": skipped,
                "to_insert": len(to_insert),
                "mode": "apply" if apply else "dry_run",
            },
            ensure_ascii=False,
        )
    )

    if apply:
        for item in to_insert:
            try:
                created = (
                    client._request(
                        "POST",
                        "/churches",
                        body=item["payload"],
                        prefer="return=representation",
                    )
                    or []
                )
                if isinstance(created, list):
                    created = created[0] if created else None
                if not created or not created.get("id"):
                    raise RuntimeError("empty insert")
                report["inserted"].append(
                    {
                        "id": created["id"],
                        "slug": created.get("slug"),
                        "name": item["row"]["name"],
                    }
                )
            except Exception as exc:  # noqa: BLE001
                report["errors"].append(
                    {"name": item["row"]["name"], "error": str(exc)[:300]}
                )
            time.sleep(0.05)

    out_path = OUT / f"usa_churches_{'apply' if apply else 'dry'}_{stamp}.json"
    latest = OUT / "usa_churches_latest.json"
    text = json.dumps(report, ensure_ascii=False, indent=2)
    out_path.write_text(text, encoding="utf-8")
    latest.write_text(text, encoding="utf-8")
    print(f"wrote {out_path}")
    print(
        f"inserted={len(report['inserted'])} errors={len(report['errors'])} skipped={skipped}"
    )
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
