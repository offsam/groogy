#!/usr/bin/env python3
"""Enrich Orange Pages professionals (fix junk sites / bogus city=Orange).

Sources (no invented data):
  1) scripts/business-enrich/data/yellow_pages/rop_cards_latest.json
  2) live re-parse of source_url via enrich_orange_pages_detail (article body)

Also clears leaked sidebar websites (fchconstruction.org, etc.) and overwrites
placeholder city \"Orange\" when the listing text has a real city (Anaheim, …).

Usage:
  python3 scripts/business-enrich/enrich_professionals_from_orange_pages.py --dry-run
  python3 scripts/business-enrich/enrich_professionals_from_orange_pages.py --apply
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
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from enrich_svoi_directory import (  # noqa: E402
    enrich_orange_pages_detail,
    is_orange_pages_junk_website,
    normalize_street_line,
    streetish,
)

OUT = Path(__file__).resolve().parent / "data" / "professional_orange_pages_enrich"
OUT.mkdir(parents=True, exist_ok=True)
ROP_CARDS = (
    Path(__file__).resolve().parent / "data" / "yellow_pages" / "rop_cards_latest.json"
)

CITY_CA_RE = re.compile(
    r"\b(Costa Mesa|Newport Beach|Fullerton|Irvine|Anaheim|Tustin|"
    r"Fountain Valley|Mission Viejo|Laguna Woods|Laguna Niguel|"
    r"Lake Forest|Long Beach|Santa Ana|Huntington Beach|Garden Grove|"
    r"Yorba Linda|San Clemente|Brea|Placentia|Westminster|Buena Park|"
    r"Orange)\b,?\s*CA(?:\s+(\d{5}))?\b",
    re.I,
)
STREET_RE = re.compile(
    r"(?<!\d)(\d{1,5}\s+(?:[A-Za-z0-9.'\-]+\s+){0,6}"
    r"(?:Ave|Avenue|St|Street|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|"
    r"Lane|Ln|Ct|Court|Pl|Place|Pkwy|Parkway)\.?"
    r"(?:\s*,?\s*(?:Suite|Ste\.?|#)\s*[A-Za-z0-9\-]+)?)",
    re.I,
)
BOGUS_CITIES = {"orange", "orange county", "oc"}
BAD_ADDR_RE = re.compile(
    r"wp-|single-format|class=|russian lawyer|women.?s health|"
    r"new!!!|^\s*0\s+lavender|chat drive|view|click",
    re.I,
)


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def plausible_ca_zip(z: str | None) -> str | None:
    if not z:
        return None
    digits = re.sub(r"\D", "", z)[:5]
    # Orange County / SoCal ZIPs are almost always 9xxxx
    if len(digits) == 5 and digits.startswith("9"):
        return digits
    return None


def clean_street(raw: str | None) -> str | None:
    if not raw:
        return None
    line = re.sub(r"\s+", " ", str(raw)).strip()
    line = re.sub(r"^(?:new!+\s*)+", "", line, flags=re.I).strip()
    line = re.split(r",\s*(?:[A-Za-z .]+,?\s*)?CA\b", line, maxsplit=1)[0]
    line = re.sub(r",?\s*\d{5}(?:-\d{4})?\s*$", "", line).strip(" ,")
    if not streetish(line) or BAD_ADDR_RE.search(line):
        return None
    # House number then name — reject "8335 28356 Chat Dr" / date+author junk
    if not re.match(r"^\d{1,5}\s+[A-Za-z]", line):
        return None
    if re.match(r"^\d{1,5}\s+\d+", line):
        return None
    if re.search(r"\b(20\d{2}|olga\s+lannom|rop\s+admin)\b", line, re.I):
        return None
    if not re.search(
        r"\b(ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|way|lane|ln|"
        r"ct|court|pl|place|pkwy|parkway)\b",
        line,
        re.I,
    ):
        return None
    if re.match(r"^0\s+", line):
        return None
    # Too many tokens → likely scraped chrome
    if len(line.split()) > 10:
        return None
    return normalize_street_line(line)[:160]


def norm_url(u: str | None) -> str:
    if not u:
        return ""
    return (
        u.strip()
        .split("?")[0]
        .rstrip("/")
        .lower()
        .replace("https://www.", "https://")
        .replace("http://www.", "http://")
        .replace("http://", "https://")
    )


def load_rop_index() -> dict[str, dict[str, Any]]:
    if not ROP_CARDS.exists():
        return {}
    data = json.loads(ROP_CARDS.read_text(encoding="utf-8"))
    cards = data.get("cards") if isinstance(data, dict) else data
    out: dict[str, dict[str, Any]] = {}
    for card in cards or []:
        src = card.get("source_url")
        if src:
            out[norm_url(src)] = card
    return out


def pick_website(*cands: Any) -> str | None:
    for raw in cands:
        items = raw if isinstance(raw, list) else [raw]
        for item in items:
            if not item:
                continue
            w = str(item).strip()
            if not w or is_orange_pages_junk_website(w):
                continue
            low = w.lower()
            if any(
                x in low
                for x in (
                    "instagram.com",
                    "facebook.com",
                    "fb.com",
                    "t.me/",
                    "yelp.com",
                    "youtube.com",
                )
            ):
                continue
            if not re.match(r"^https?://", w, re.I):
                w = "https://" + w
            try:
                host = (urlparse(w).hostname or "").lower()
            except Exception:
                continue
            if not host or "." not in host:
                continue
            return w.split("?")[0][:300]
    return None


def parse_city_zip_addr(blob: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not blob:
        return out
    city_m = CITY_CA_RE.search(blob)
    if city_m:
        out["city"] = city_m.group(1)
        if city_m.lastindex and city_m.lastindex >= 2 and city_m.group(2):
            z = plausible_ca_zip(city_m.group(2))
            if z:
                out["postal_code"] = z
    if "postal_code" not in out:
        # ZIP only when adjacent to CA
        near = re.search(r"\bCA\s+(\d{5})\b", blob, re.I)
        if near:
            z = plausible_ca_zip(near.group(1))
            if z:
                out["postal_code"] = z
    street_m = STREET_RE.search(blob)
    if street_m:
        cleaned = clean_street(street_m.group(1))
        if cleaned:
            out["address_line"] = cleaned
    return out


def card_to_fill(card: dict[str, Any]) -> dict[str, Any]:
    fill: dict[str, Any] = {}
    blob = " ".join(
        str(x)
        for x in (
            card.get("address"),
            card.get("city"),
            card.get("short_description"),
            card.get("description"),
        )
        if x
    )
    parsed = parse_city_zip_addr(blob)
    if card.get("city") and str(card["city"]).strip().lower() not in BOGUS_CITIES:
        fill["city"] = str(card["city"]).strip()
    elif parsed.get("city"):
        fill["city"] = parsed["city"]

    cleaned = clean_street(card.get("address"))
    if cleaned:
        fill["address_line"] = cleaned
        fill["location_precision"] = "street"
    elif parsed.get("address_line"):
        fill["address_line"] = parsed["address_line"]
        fill["location_precision"] = "street"

    z = plausible_ca_zip(parsed.get("postal_code"))
    if not z and card.get("address"):
        near = re.search(r"\bCA\s+(\d{5})\b", str(card["address"]), re.I)
        z = plausible_ca_zip(near.group(1) if near else None)
    if z:
        fill["postal_code"] = z

    web = pick_website(card.get("websites"))
    if web:
        fill["websites"] = [web]
    phones = [p for p in (card.get("phones") or []) if p]
    if phones:
        fill["phones"] = phones[:4]
    emails = [e for e in (card.get("emails") or []) if e]
    if emails:
        fill["emails"] = emails[:2]
    if card.get("cover_image_url"):
        fill["cover_image_url"] = card["cover_image_url"]
    if card.get("instagram"):
        fill["instagram"] = card["instagram"][:2]
    fill["region"] = "Orange County"
    fill["state_code"] = "US-CA"
    return fill


def merge_fill(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Prefer non-empty values; live scrape can override card when better."""
    out = dict(a)
    for k, v in b.items():
        if v is None or v == "" or v == []:
            continue
        if k not in out or out[k] in (None, "", []):
            out[k] = v
            continue
        # Prefer real city over Orange County label
        if k == "city" and str(out.get("city") or "").lower() in BOGUS_CITIES:
            out[k] = v
        elif k == "websites":
            good = pick_website(v, out.get(k))
            if good:
                out[k] = [good]
        elif k == "address_line" and not streetish(out.get(k)):
            out[k] = v
    return out


def city_is_bogus(city: Any) -> bool:
    return empty(city) or str(city).strip().lower() in BOGUS_CITIES


def build_patch(pro: dict[str, Any], fill: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}

    if fill.get("address_line"):
        cleaned = clean_street(fill["address_line"]) or (
            fill["address_line"]
            if streetish(fill["address_line"]) and not BAD_ADDR_RE.search(fill["address_line"])
            else None
        )
        if cleaned and (
            empty(pro.get("private_address_line"))
            or not streetish(pro.get("private_address_line"))
            or BAD_ADDR_RE.search(str(pro.get("private_address_line") or ""))
        ):
            patch["private_address_line"] = cleaned
            patch["location_precision"] = fill.get("location_precision") or "street"
            patch["public_exact_address"] = False

    if fill.get("postal_code") and empty(pro.get("postal_code")):
        z = plausible_ca_zip(str(fill["postal_code"]))
        if z:
            patch["postal_code"] = z

    if fill.get("city") and city_is_bogus(pro.get("city")):
        city = str(fill["city"]).strip()
        if city.lower() not in BOGUS_CITIES:
            patch["city"] = city

    if fill.get("region") and (
        empty(pro.get("region")) or str(pro.get("region") or "").lower() in BOGUS_CITIES
    ):
        patch["region"] = fill["region"]

    if fill.get("state_code") and empty(pro.get("state_code")):
        patch["state_code"] = fill["state_code"]

    # Website: fill empty OR replace junk sidebar leak
    web = pick_website(fill.get("websites"))
    if web:
        if empty(pro.get("website")) or is_orange_pages_junk_website(pro.get("website")):
            patch["website"] = web
    elif is_orange_pages_junk_website(pro.get("website")):
        patch["website"] = None  # clear junk; PostgREST null

    if empty(pro.get("phone")) and fill.get("phones"):
        patch["phone"] = str(fill["phones"][0]).strip()

    if empty(pro.get("email")) and fill.get("emails"):
        patch["email"] = str(fill["emails"][0]).strip().lower()

    if empty(pro.get("image_url")) and fill.get("cover_image_url"):
        patch["image_url"] = str(fill["cover_image_url"]).strip()

    if empty(pro.get("instagram_url")) and fill.get("instagram"):
        handle = str(fill["instagram"][0]).lstrip("@").strip()
        if handle:
            patch["instagram_url"] = f"https://www.instagram.com/{handle}"

    return patch


def fetch_orange_pros(client: SupabaseRest) -> list[dict[str, Any]]:
    rows = (
        client._request(
            "GET",
            "/professionals",
            params={
                "select": (
                    "id,slug,display_name,website,phone,email,city,postal_code,"
                    "private_address_line,image_url,instagram_url,region,state_code,"
                    "source_url,status"
                ),
                "status": "eq.approved",
                "source_url": "ilike.*russianorangepages*",
                "limit": "500",
            },
        )
        or []
    )
    # Also catch junk websites even if source_url missing the host string somehow
    junk = (
        client._request(
            "GET",
            "/professionals",
            params={
                "select": (
                    "id,slug,display_name,website,phone,email,city,postal_code,"
                    "private_address_line,image_url,instagram_url,region,state_code,"
                    "source_url,status"
                ),
                "status": "eq.approved",
                "website": "ilike.*fchconstruction*",
                "limit": "200",
            },
        )
        or []
    )
    by_id = {r["id"]: r for r in rows}
    for j in junk:
        by_id.setdefault(j["id"], j)
    return list(by_id.values())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--skip-live", action="store_true", help="Only use card dump")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    if not args.dry_run and not args.apply:
        print("Pass --dry-run or --apply", flush=True)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    rop = load_rop_index()
    pros = fetch_orange_pros(client)
    if args.limit:
        pros = pros[: args.limit]

    report: list[dict[str, Any]] = []
    updated = 0
    for i, pro in enumerate(pros, 1):
        src = pro.get("source_url") or ""
        card = rop.get(norm_url(src))
        fill: dict[str, Any] = card_to_fill(card) if card else {}
        if not args.skip_live and src:
            live = enrich_orange_pages_detail(
                {"source_post_urls": [src], "phones": pro.get("phone") and [pro["phone"]]}
            )
            # Drop error-only payloads
            if not live.get("_svoi_error"):
                fill = merge_fill(fill, live)
            time.sleep(0.35)

        patch = build_patch(pro, fill)
        entry = {
            "slug": pro.get("slug"),
            "display_name": pro.get("display_name"),
            "source_url": src,
            "had_card": bool(card),
            "before": {
                "city": pro.get("city"),
                "website": pro.get("website"),
                "address": pro.get("private_address_line"),
                "image": bool(pro.get("image_url")),
            },
            "patch": patch,
        }
        report.append(entry)
        if not patch:
            print(f"[{i}/{len(pros)}] skip {pro.get('slug')}", flush=True)
            continue
        print(
            f"[{i}/{len(pros)}] {'APPLY' if args.apply else 'dry'} {pro.get('slug')} → {patch}",
            flush=True,
        )
        if args.apply:
            # null website clear needs explicit null
            client._request(
                "PATCH",
                "/professionals",
                params={"id": f"eq.{pro['id']}"},
                body=patch,
            )
            updated += 1

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = OUT / f"{'apply' if args.apply else 'dry'}_{stamp}.json"
    out_path.write_text(
        json.dumps(
            {
                "updated": updated,
                "total": len(pros),
                "rop_cards_indexed": len(rop),
                "report": report,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {out_path} updated={updated}/{len(pros)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
