#!/usr/bin/env python3
"""Enrich professionals card-by-card (not directory-brand scrapers).

Order per card (exactly as product requires):
  1) Mine the card itself — description / short_description / existing fields
  2) If a website is on the card (or found in text) — fetch it for
     address / phone / email / image / Instagram
  3) Then open source_url and mine whatever is still missing
  4) PATCH this card, then move to the next

Junk already in fields (sidebar websites, city=Orange placeholder, bad phones)
may be overwritten when a better value is found.

Usage:
  python3 scripts/business-enrich/enrich_professionals_card_first.py --dry-run --limit 20
  python3 scripts/business-enrich/enrich_professionals_card_first.py --apply --category pro_other
  python3 scripts/business-enrich/enrich_professionals_card_first.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

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
from fill_missing_addresses import (  # noqa: E402
    CITY_CA_RE,
    clean_address,
    extract_address_from_text,
    extract_city,
    looks_like_street,
)
from web_enrichment import extract_website_profile  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "professional_card_first"
OUT.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
TIMEOUT = 12
MAX_HTML = 700_000

SKIP_MINE_HOSTS = (
    "linktr.ee",
    "etsy.com",
    "vagaro.com",
    "eventbrite.com",
    "usmobile.com",
    "capitalone.com",
    "lastbottlewines.com",
    "oclandfills.com",
    "parasolka.org",
    "drd.sh",
    "bit.ly",
    "i.capitalone.com",
)
JUNK_WEB_HOSTS = (
    "fchconstruction.org",
    "liveattheshell.org",
    "ocparks.com",
    "art-a-fair.com",
    "fonts.googleapis.com",
    "facebook.com/sharer",
)
# Directory hosts: OK as source_url, not as the professional's own website to mine.
DIRECTORY_HOSTS = (
    "russianorangepages.com",
    "svoi.us",
)
BOGUS_CITIES = {"orange", "orange county", "oc"}
PLACEHOLDER_IMG = ("placeholder", "/images/categories/")
ZIP_NEAR_CA = re.compile(r"\bCA\s+(\d{5})\b", re.I)
CITY_STATE_RE = re.compile(
    r"\b("
    r"Los Angeles|Irvine|Newport Beach|Laguna Hills|Laguna Woods|Laguna Niguel|"
    r"Mission Viejo|Costa Mesa|Huntington Beach|Santa Ana|Anaheim|Tustin|"
    r"Fountain Valley|Fullerton|Yorba Linda|San Diego|San Francisco|Sacramento|"
    r"San Jose|Glendale|Burbank|Sherman Oaks|Beverly Hills|West Hollywood|"
    r"Long Beach|Torrance|Pasadena|Encino|Van Nuys|Reseda|Woodland Hills|"
    r"Calabasas|Aliso Viejo|Lake Forest|Rancho Santa Margarita|San Clemente|"
    r"Dana Point|Seal Beach|Westminster|Garden Grove|Corona|Riverside|"
    r"Hallandale Beach|North Port|Orange"
    r")\b,?\s*CA(?:\s+(\d{5}))?\b",
    re.I,
)


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def is_junk_website(url: str | None) -> bool:
    """True only for known bad sidebar/chrome URLs (not for empty)."""
    if not url or not str(url).strip():
        return False
    low = url.lower()
    return any(h in low for h in JUNK_WEB_HOSTS)


def is_directory_website(url: str | None) -> bool:
    if not url:
        return False
    low = url.lower()
    return any(h in low for h in DIRECTORY_HOSTS)


def is_bogus_city(city: Any) -> bool:
    return empty(city) or str(city).strip().lower() in BOGUS_CITIES


def is_placeholder_image(url: Any) -> bool:
    u = (url or "").strip().lower()
    if not u:
        return True
    if any(m in u for m in PLACEHOLDER_IMG) or u.endswith(".svg"):
        return True
    if "favicon" in u or u.endswith(".ico"):
        return True
    if "/static/images/wix" in u:
        return True
    return False


def plausible_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    ph = normalize_phone(raw) or (
        raw.strip() if raw.strip().startswith("+") else None
    )
    if not ph:
        return None
    digits = re.sub(r"\D", "", ph)
    if len(digits) == 11 and digits.startswith("1"):
        if digits[1] in "01" or digits[4] in "01":
            return None
    if len(digits) < 10 or len(digits) > 15:
        return None
    return ph if ph.startswith("+") else f"+{digits}"


def pick_website(cands: list[str | None]) -> str | None:
    for raw in cands:
        if not raw or not str(raw).strip():
            continue
        if is_junk_website(raw) or is_directory_website(raw) or any(h in raw.lower() for h in SKIP_MINE_HOSTS):
            continue
        w = raw.strip()
        low = w.lower()
        if any(
            x in low
            for x in (
                "instagram.com",
                "facebook.com",
                "fb.com",
                "yelp.com",
                "youtube.com",
                "wa.me",
                "t.me/",
                "telegram.me",
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
        return w.split("#")[0].split("?")[0][:300]
    return None


def plausible_zip(blob: str) -> str | None:
    m = ZIP_NEAR_CA.search(blob or "")
    if m and m.group(1).startswith("9"):
        return m.group(1)
    m2 = CITY_STATE_RE.search(blob or "")
    if m2 and m2.lastindex and m2.lastindex >= 2 and m2.group(2):
        z = m2.group(2)
        if z.startswith("9"):
            return z
    return None


def http_get_text(url: str) -> str | None:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(MAX_HTML + 1)
            if len(raw) > MAX_HTML:
                raw = raw[:MAX_HTML]
            return raw.decode("utf-8", errors="ignore")
    except Exception:
        return None


def html_to_text(html: str) -> str:
    t = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    t = re.sub(r"<br\s*/?>", "\n", t, flags=re.I)
    t = re.sub(r"</p>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def mine_text(blob: str) -> dict[str, Any]:
    """Pull structured contacts/location from free text."""
    out: dict[str, Any] = {"_from": "text"}
    if not blob or len(blob.strip()) < 8:
        return out

    addr = extract_address_from_text(blob)
    if addr and looks_like_street(addr):
        out["address_line"] = clean_address(addr) or addr

    city = extract_city(blob, out.get("address_line"))
    # Prefer "City, CA" over bare Orange County
    m = CITY_STATE_RE.search(blob)
    if m:
        c = m.group(1)
        if c.lower() not in BOGUS_CITIES:
            city = c
    if city and city.lower() not in BOGUS_CITIES:
        out["city"] = city

    z = plausible_zip(blob)
    if z:
        out["postal_code"] = z

    phones = []
    for raw in extract_phones(blob):
        ph = plausible_phone(raw)
        if ph and ph not in phones:
            phones.append(ph)
    if phones:
        out["phone"] = phones[0]

    emails = extract_emails(blob)
    if emails:
        em = emails[0].lower()
        if "@" in em and not em.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")):
            if not re.search(r"@(2x\.|email\.com$)", em):
                out["email"] = em

    webs = extract_websites(blob) or []
    web = pick_website(list(webs) + re.findall(
        r"(?:Website|Сайт)\s*[:：]\s*((?:https?://)?[^\s<,]+)", blob, re.I
    ))
    if web:
        out["website"] = web

    ig = extract_instagram(blob)
    if ig:
        handle = ig[0] if isinstance(ig, list) else ig
        handle = str(handle).lstrip("@").split("/")[-1]
        if handle:
            out["instagram_url"] = f"https://www.instagram.com/{handle}"

    tg = extract_telegram(blob)
    if tg:
        out["telegram_url"] = tg[0] if isinstance(tg, list) else tg

    # Cover image hint when blob happens to be HTML
    og = re.search(r'property=["\']og:image["\']\s+content=["\']([^"\']+)', blob, re.I)
    if og:
        img = og.group(1).strip()
        low = img.lower()
        if "wp-content/uploads" in low or any(
            x in low for x in (".jpg", ".jpeg", ".png", ".webp")
        ):
            out["image_url"] = img

    return out


def normalize_fetch_url(url: str) -> str:
    """Fix common dead redirects (old wix.com → wixsite.com)."""
    w = url.strip()
    if not re.match(r"^https?://", w, re.I):
        w = "https://" + w
    w = re.sub(r"^http://", "https://", w, flags=re.I)
    # elzagus.wix.com/path → elzagus.wixsite.com/path
    w = re.sub(
        r"^(https://)([a-z0-9-]+)\.wix\.com(/.*)?$",
        r"\1\2.wixsite.com\3",
        w,
        flags=re.I,
    )
    return w


def mine_website(url: str) -> dict[str, Any]:
    out: dict[str, Any] = {"_from": "website", "_url": url}
    fetch_url = normalize_fetch_url(url)
    out["_fetch_url"] = fetch_url
    prof = extract_website_profile(fetch_url)
    if prof.get("status") != "ok":
        out["_error"] = prof.get("error") or prof.get("status")
        return out

    if prof.get("address") and looks_like_street(str(prof["address"])):
        cleaned = clean_address(str(prof["address"]))
        if cleaned:
            out["address_line"] = cleaned
            city = extract_city(str(prof["address"]), cleaned)
            if city and city.lower() not in BOGUS_CITIES:
                out["city"] = city
            z = plausible_zip(str(prof["address"]))
            if z:
                out["postal_code"] = z

    # Also mine page text for City, CA / street if JSON-LD missed
    html = http_get_text(fetch_url)
    if html:
        text_bits = mine_text(html_to_text(html)[:20000])
        for k, v in text_bits.items():
            if k.startswith("_"):
                continue
            if k not in out or not out[k]:
                out[k] = v
        og = re.search(
            r'property=["\']og:image["\']\s+content=["\']([^"\']+)', html, re.I
        )
        if og:
            img = og.group(1).strip()
            if img and not any(b in img.lower() for b in ("avatar", "emoji", "1x1")):
                out.setdefault("image_url", img)
    out["website"] = fetch_url  # prefer working URL

    phones = prof.get("phone") or []
    if isinstance(phones, list) and phones:
        ph = plausible_phone(str(phones[0]))
        if ph:
            out["phone"] = ph
    emails = prof.get("email") or []
    if isinstance(emails, list) and emails:
        em = str(emails[0]).lower()
        if "@" in em and not em.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")):
            out["email"] = em
    if prof.get("logo") and "image_url" not in out:
        out["image_url"] = prof["logo"]
    for link in prof.get("social_links") or []:
        if "instagram.com" in link.lower() and "instagram_url" not in out:
            out["instagram_url"] = link.split("?")[0]
            break
    return out


def mine_source(url: str, *, client: SupabaseRest | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"_from": "source", "_url": url}
    if not url or not url.startswith("http"):
        return out

    # 1) Svoi company page — structured address/cover
    if "svoi.us" in url.lower():
        try:
            from enrich_svoi_directory import enrich_svoi_page

            svoi = enrich_svoi_page({"source_post_urls": [url], "phones": [], "websites": []})
            if svoi.get("address_line") and looks_like_street(str(svoi["address_line"])):
                cleaned = clean_address(str(svoi["address_line"]))
                if cleaned:
                    out["address_line"] = cleaned
            if svoi.get("city") and str(svoi["city"]).lower() not in BOGUS_CITIES:
                out["city"] = str(svoi["city"]).strip()
            if svoi.get("postal_code"):
                z = re.sub(r"\D", "", str(svoi["postal_code"]))[:5]
                if len(z) == 5:
                    out["postal_code"] = z
            if svoi.get("websites"):
                w = pick_website(list(svoi["websites"]))
                if w:
                    out["website"] = w
            if svoi.get("phones"):
                ph = plausible_phone(str(svoi["phones"][0]))
                if ph:
                    out["phone"] = ph
            if svoi.get("emails"):
                out["email"] = str(svoi["emails"][0]).lower()
            if svoi.get("cover_image_url"):
                out["image_url"] = svoi["cover_image_url"]
            out["_via"] = "svoi_page"
            return out
        except Exception as exc:  # noqa: BLE001
            out["_svoi_error"] = str(exc)[:160]

    # 2) Orange Pages — article parser (and card dump fallback)
    if "russianorangepages.com" in url.lower():
        try:
            from enrich_svoi_directory import enrich_orange_pages_detail

            rop = enrich_orange_pages_detail({"source_post_urls": [url], "phones": []})
            if not rop.get("_svoi_error"):
                if rop.get("address_line") and looks_like_street(str(rop["address_line"])):
                    cleaned = clean_address(str(rop["address_line"]))
                    if cleaned:
                        out["address_line"] = cleaned
                if rop.get("city") and str(rop["city"]).lower() not in BOGUS_CITIES:
                    out["city"] = str(rop["city"]).strip()
                if rop.get("postal_code"):
                    out["postal_code"] = str(rop["postal_code"])[:5]
                if rop.get("websites"):
                    w = pick_website(list(rop["websites"]))
                    if w:
                        out["website"] = w
                if rop.get("phones"):
                    ph = plausible_phone(str(rop["phones"][0]))
                    if ph:
                        out["phone"] = ph
                if rop.get("emails"):
                    out["email"] = str(rop["emails"][0]).lower()
                if rop.get("cover_image_url"):
                    out["image_url"] = rop["cover_image_url"]
                out["_via"] = "orange_pages"
                if out.get("address_line") or out.get("website") or out.get("city"):
                    return out
        except Exception as exc:  # noqa: BLE001
            out["_rop_error"] = str(exc)[:160]
        # Fallback: local scrape dump
        dump = (
            Path(__file__).resolve().parent
            / "data"
            / "yellow_pages"
            / "rop_cards_latest.json"
        )
        if dump.exists():
            try:
                data = json.loads(dump.read_text(encoding="utf-8"))
                cards = data.get("cards") if isinstance(data, dict) else data
                nu = (
                    url.strip()
                    .rstrip("/")
                    .lower()
                    .replace("http://", "https://")
                    .replace("https://www.", "https://")
                )
                for card in cards or []:
                    cu = (card.get("source_url") or "").strip().rstrip("/").lower()
                    cu = cu.replace("http://", "https://").replace("https://www.", "https://")
                    if cu != nu:
                        continue
                    blob = "\n".join(
                        str(x)
                        for x in (
                            card.get("address"),
                            card.get("description"),
                            card.get("short_description"),
                        )
                        if x
                    )
                    mined = mine_text(blob)
                    out.update({k: v for k, v in mined.items() if not k.startswith("_")})
                    w = pick_website(list(card.get("websites") or []))
                    if w:
                        out["website"] = w
                    if card.get("phones"):
                        ph = plausible_phone(str(card["phones"][0]))
                        if ph:
                            out["phone"] = ph
                    if card.get("cover_image_url"):
                        out["image_url"] = card["cover_image_url"]
                    if card.get("city") and str(card["city"]).lower() not in BOGUS_CITIES:
                        out["city"] = str(card["city"]).strip()
                    out["_via"] = "rop_dump"
                    return out
            except Exception as exc:  # noqa: BLE001
                out["_dump_error"] = str(exc)[:160]

    # 3) Stored import_review row (Telegram/FB post body we already collected)
    if client is not None:
        try:
            items = (
                client._request(
                    "GET",
                    "/import_review_items",
                    params={
                        "select": (
                            "source_url,phone,email,website,instagram,city,"
                            "preview_image_url,description,source_text,telegram_username"
                        ),
                        "source_url": f"eq.{url}",
                        "limit": "1",
                    },
                )
                or []
            )
            if items:
                item = items[0]
                blob = "\n".join(
                    str(x)
                    for x in (item.get("source_text"), item.get("description"))
                    if x
                )
                mined = mine_text(blob)
                out.update({k: v for k, v in mined.items() if not k.startswith("_")})
                if item.get("city") and str(item["city"]).lower() not in BOGUS_CITIES:
                    out.setdefault("city", str(item["city"]).strip())
                ph = plausible_phone(
                    item.get("phone")[0]
                    if isinstance(item.get("phone"), list) and item.get("phone")
                    else item.get("phone")
                )
                if ph:
                    out.setdefault("phone", ph)
                w = pick_website(
                    item.get("website")
                    if isinstance(item.get("website"), list)
                    else [item.get("website")]
                )
                if w:
                    out.setdefault("website", w)
                if item.get("email"):
                    em = item["email"]
                    if isinstance(em, list):
                        em = em[0] if em else None
                    if em and "@" in str(em):
                        out.setdefault("email", str(em).lower())
                if item.get("instagram"):
                    ig = item["instagram"]
                    if isinstance(ig, list):
                        ig = ig[0] if ig else None
                    if ig:
                        handle = str(ig).lstrip("@").split("/")[-1]
                        out.setdefault(
                            "instagram_url", f"https://www.instagram.com/{handle}"
                        )
                if item.get("preview_image_url"):
                    out.setdefault("image_url", item["preview_image_url"])
                out["_via"] = "import_review"
                if any(
                    out.get(k)
                    for k in (
                        "address_line",
                        "website",
                        "phone",
                        "image_url",
                        "city",
                        "email",
                    )
                ):
                    return out
        except Exception as exc:  # noqa: BLE001
            out["_iri_error"] = str(exc)[:160]

    # 4) Live fetch for public pages (skip private telegram / FB groups)
    if "t.me/c/" in url or "facebook.com/groups/" in url:
        out["_skip"] = "private_or_group"
        return out
    html = http_get_text(url)
    if not html:
        out["_error"] = "fetch_failed"
        return out

    # Prefer article body for directory pages
    art = re.search(r"<article\b[^>]*>(.*?)</article>", html, re.I | re.S)
    body = art.group(1) if art else html
    text = html_to_text(body)[:20000]
    # Cut chrome
    for cut in (
        "You may also like",
        "Sign Up for our Newsletter",
        "Похожие",
        "Share this",
    ):
        if cut in text:
            text = text.split(cut, 1)[0]

    mined = mine_text(text)
    out.update({k: v for k, v in mined.items() if not k.startswith("_")})

    # og:image from full page for ROP/svoi covers
    og = re.search(r'property=["\']og:image["\']\s+content=["\']([^"\']+)', html, re.I)
    if og:
        img = og.group(1).strip()
        if img and "avatar" not in img.lower():
            out.setdefault("image_url", img)

    # Website labeled in source text only (not sidebar href soup)
    if not out.get("website"):
        for raw in re.findall(
            r"(?:Website|Сайт|Webste)\s*[:：]\s*((?:https?://)?[^\s<,]+)",
            text,
            re.I,
        ):
            w = pick_website([raw.rstrip(".,;")])
            if w:
                out["website"] = w
                break
    out["_via"] = "live_html"
    return out


def merge_layers(*layers: dict[str, Any]) -> dict[str, Any]:
    """Earlier layers win for each field (card text → website → source)."""
    merged: dict[str, Any] = {}
    for layer in layers:
        for k, v in layer.items():
            if k.startswith("_") or v in (None, "", []):
                continue
            if k not in merged or merged[k] in (None, "", []):
                merged[k] = v
    return merged


def build_patch(pro: dict[str, Any], found: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}

    if found.get("address_line") and looks_like_street(found["address_line"]):
        cur = pro.get("private_address_line")
        if empty(cur) or not looks_like_street(cur):
            patch["private_address_line"] = found["address_line"][:160]
            patch["location_precision"] = "street"
            patch["public_exact_address"] = False

    if found.get("city") and str(found["city"]).lower() not in BOGUS_CITIES:
        if is_bogus_city(pro.get("city")):
            patch["city"] = str(found["city"]).strip()

    if found.get("postal_code") and empty(pro.get("postal_code")):
        z = re.sub(r"\D", "", str(found["postal_code"]))[:5]
        if len(z) == 5 and z.startswith("9"):
            patch["postal_code"] = z

    web = found.get("website")
    if web and not is_junk_website(web) and not is_directory_website(web):
        cur = pro.get("website") or ""
        if (
            empty(cur)
            or is_junk_website(cur)
            or ("wix.com/" in cur.lower() and "wixsite.com" in web.lower())
        ):
            patch["website"] = web
    elif is_junk_website(pro.get("website")):
        patch["website"] = None

    if found.get("phone"):
        ph = plausible_phone(found["phone"])
        cur = plausible_phone(pro.get("phone"))
        if ph and (not cur or empty(pro.get("phone"))):
            patch["phone"] = ph

    if found.get("email") and empty(pro.get("email")):
        patch["email"] = str(found["email"]).strip().lower()[:200]

    if found.get("instagram_url") and empty(pro.get("instagram_url")):
        patch["instagram_url"] = found["instagram_url"]

    if found.get("telegram_url") and empty(pro.get("telegram_url")):
        patch["telegram_url"] = found["telegram_url"]

    if found.get("image_url") and is_placeholder_image(pro.get("image_url")):
        img = str(found["image_url"]).strip()
        if img.startswith("http") and not is_placeholder_image(img):
            patch["image_url"] = img[:500]

    return patch


def resolve_category_id(client: SupabaseRest, slug: str) -> str | None:
    # professionals.category_id → categories / platform table
    for table in ("categories", "professional_categories", "entity_categories"):
        try:
            rows = client._request(
                "GET",
                f"/{table}",
                params={"select": "id,slug", "slug": f"eq.{slug}", "limit": "3"},
            )
            if rows:
                return rows[0]["id"]
        except Exception:
            continue
    # Known seed id from prior runs for pro_other
    if slug == "pro_other":
        return "b1000001-0000-4000-8000-000000000008"
    return None


def fetch_pros(
    client: SupabaseRest,
    *,
    category: str | None,
    limit: int,
    only_gaps: bool,
) -> list[dict[str, Any]]:
    params: dict[str, str] = {
        "select": (
            "id,slug,display_name,description,short_description,website,phone,email,"
            "city,postal_code,private_address_line,image_url,instagram_url,telegram_url,"
            "source_url,region,state_code,category_id,status"
        ),
        "status": "eq.approved",
        "order": "updated_at.desc",
        "limit": str(limit if limit > 0 else 2000),
    }
    if category:
        cid = resolve_category_id(client, category)
        if cid:
            params["category_id"] = f"eq.{cid}"
    rows = client._request("GET", "/professionals", params=params) or []
    if not only_gaps:
        return rows
    out = []
    for p in rows:
        needs = (
            empty(p.get("private_address_line"))
            or is_placeholder_image(p.get("image_url"))
            or empty(p.get("website"))
            or is_junk_website(p.get("website"))
            or is_bogus_city(p.get("city"))
            or empty(p.get("phone"))
        )
        if needs:
            out.append(p)
    return out


def enrich_one(
    pro: dict[str, Any], *, client: SupabaseRest | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (found_merged, layers_debug)."""
    desc_blob = "\n".join(
        str(x)
        for x in (
            pro.get("display_name"),
            pro.get("short_description"),
            pro.get("description"),
            pro.get("website") if not is_junk_website(pro.get("website")) else None,
        )
        if x
    )
    layer_card = mine_text(desc_blob)

    # Website on card (existing or mined from description)
    website = pick_website(
        [layer_card.get("website"), pro.get("website")]
    )
    layer_web: dict[str, Any] = {}
    if website:
        layer_web = mine_website(website)
        time.sleep(0.2)

    # If website found only on source later, we re-fetch below
    layer_src = mine_source(pro.get("source_url") or "", client=client)
    time.sleep(0.15)

    # If source revealed a website and card/web layers had none — fetch it now
    src_web = pick_website([layer_src.get("website")])
    if src_web and not website:
        layer_web = mine_website(src_web)
        website = src_web
        time.sleep(0.2)

    # Priority: card text → own website → source page
    # But website-layer keys for address/image beat empty card text
    found = merge_layers(layer_card, layer_web, layer_src)
    if layer_web.get("website"):
        found["website"] = layer_web["website"]
    elif website and not found.get("website"):
        found["website"] = website
    # Prefer website-derived street over nothing
    if layer_web.get("address_line"):
        found["address_line"] = layer_web["address_line"]
        for k in ("city", "postal_code"):
            if layer_web.get(k):
                found[k] = layer_web[k]
    if layer_web.get("image_url") and not is_placeholder_image(layer_web["image_url"]):
        found["image_url"] = layer_web["image_url"]
    elif is_placeholder_image(found.get("image_url")):
        found.pop("image_url", None)

    debug = {
        "card": {k: v for k, v in layer_card.items() if not k.startswith("_") or k == "_from"},
        "website": {
            k: v
            for k, v in layer_web.items()
            if k.startswith("_") or k in (
                "address_line", "city", "postal_code", "phone", "email",
                "image_url", "instagram_url", "website",
            )
        },
        "source": {
            k: v
            for k, v in layer_src.items()
            if k.startswith("_") or k in (
                "address_line", "city", "postal_code", "phone", "email",
                "image_url", "website",
            )
        },
    }
    return found, debug


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--category", default=None, help="e.g. pro_other")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--slug", default=None, help="Single slug")
    ap.add_argument("--all-gaps", action="store_true", help="Only cards with gaps")
    args = ap.parse_args()
    if not args.dry_run and not args.apply:
        print("Pass --dry-run or --apply", flush=True)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    if args.slug:
        pros = (
            client._request(
                "GET",
                "/professionals",
                params={
                    "select": (
                        "id,slug,display_name,description,short_description,website,"
                        "phone,email,city,postal_code,private_address_line,image_url,"
                        "instagram_url,telegram_url,source_url,region,state_code,"
                        "category_id,status"
                    ),
                    "slug": f"eq.{args.slug}",
                    "limit": "1",
                },
            )
            or []
        )
    else:
        pros = fetch_pros(
            client,
            category=args.category,
            limit=args.limit,
            only_gaps=args.all_gaps or bool(args.category),
        )

    report: list[dict[str, Any]] = []
    updated = 0
    for i, pro in enumerate(pros, 1):
        print(
            f"\n[{i}/{len(pros)}] CARD {pro.get('slug')} — "
            f"{(pro.get('display_name') or '')[:50]}",
            flush=True,
        )
        found, debug = enrich_one(pro, client=client)
        patch = build_patch(pro, found)
        entry = {
            "slug": pro.get("slug"),
            "display_name": pro.get("display_name"),
            "layers": debug,
            "found": {k: v for k, v in found.items() if not str(k).startswith("_")},
            "patch": patch,
        }
        report.append(entry)
        if not patch:
            print("  → no patch", flush=True)
            continue
        print(f"  → {'APPLY' if args.apply else 'dry'} {patch}", flush=True)
        if args.apply:
            client._request(
                "PATCH",
                "/professionals",
                params={"id": f"eq.{pro['id']}"},
                body=patch,
            )
            updated += 1

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if args.apply else 'dry'}_{stamp}.json"
    path.write_text(
        json.dumps(
            {"updated": updated, "total": len(pros), "report": report},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nWrote {path} updated={updated}/{len(pros)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
