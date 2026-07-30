#!/usr/bin/env python3
"""Enrich professionals via BFS resource queue.

Order per card:
  1) source_url first
  2) enqueue website / social from card + newly discovered URLs (BFS)
  3) fill-empty patch + professional_services when empty

Usage:
  python3 scripts/business-enrich/enrich_professionals_card_first.py --dry-run --limit 20
  python3 scripts/business-enrich/enrich_professionals_card_first.py --apply --slug …
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
from web_enrichment import (  # noqa: E402
    extract_payment_methods,
    extract_website_profile,
    is_plausible_service_title,
)
from enrich_resource_queue import run_resource_bfs  # noqa: E402
from source_record_urls import source_record_urls  # noqa: E402
from completeness_score import is_weak_description, _is_real_text  # noqa: E402
from fill_missing_addresses import (  # noqa: E402
    CITY_CA_RE,
    clean_address,
    extract_address_from_text,
    extract_city,
    looks_like_street,
)

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
    u = (url or "").strip().lower().split("?")[0]
    if not u:
        return True
    if any(m in u for m in PLACEHOLDER_IMG) or u.endswith(".svg"):
        return True
    if "telegram.org/img" in u or "website_icon" in u:
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
    desc = (prof.get("description") or "").strip()
    if desc and len(desc) >= 40:
        out["description"] = desc[:4000]
    svcs = [str(s).strip() for s in (prof.get("services") or []) if str(s).strip()]
    if svcs:
        out["services"] = svcs[:20]
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

    payment_blob = "\n".join(
        str(x)
        for x in (
            pro.get("description"),
            pro.get("short_description"),
            found.get("description"),
        )
        if x
    )
    discovered_payments: list[str] = []
    for method in list(found.get("payment_methods") or []) + extract_payment_methods(
        payment_blob
    ):
        label = str(method).strip()
        if label and label not in discovered_payments:
            discovered_payments.append(label)
    if not (pro.get("payment_methods") or []) and discovered_payments:
        patch["payment_methods"] = discovered_payments

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
        ig = str(found["instagram_url"]).lower()
        if "instagram.com/svoi" not in ig and "facebook.com/sharer" not in ig:
            patch["instagram_url"] = found["instagram_url"]

    if found.get("telegram_url") and empty(pro.get("telegram_url")):
        patch["telegram_url"] = found["telegram_url"]

    if found.get("image_url") and is_placeholder_image(pro.get("image_url")):
        img = str(found["image_url"]).strip()
        if img.startswith("http") and not is_placeholder_image(img):
            patch["image_url"] = img[:500]

    # Website/og bio → description (was never written before). Overwrite weak
    # junk (Instagram dumps, group recommendation comments) only.
    site_desc = (found.get("description") or "").strip()
    if site_desc and _is_real_text(site_desc) and not is_weak_description(site_desc):
        if is_weak_description(pro.get("description")):
            patch["description"] = site_desc[:4000]
        if is_weak_description(pro.get("short_description")):
            patch["short_description"] = site_desc[:280]

    # Booking CTA — fill-empty; replace platform chrome mistaken for booking.
    try:
        from booking_extract import (
            is_booking_platform_url,
            is_junk_booking_url,
            resolve_booking_url,
        )
    except Exception:  # pragma: no cover
        is_booking_platform_url = None  # type: ignore
        is_junk_booking_url = None  # type: ignore
        resolve_booking_url = None  # type: ignore

    if is_booking_platform_url and (
        empty(pro.get("booking_url"))
        or (is_junk_booking_url and is_junk_booking_url(pro.get("booking_url")))
    ):
        book = (found.get("booking_url") or "").strip() or None
        if book and is_junk_booking_url and is_junk_booking_url(book):
            book = None
        if not book and found.get("website") and resolve_booking_url:
            book = resolve_booking_url(str(found["website"]))
        if not book and is_booking_platform_url(pro.get("website")):
            book = str(pro.get("website") or "").strip() or None
        if book and not (is_junk_booking_url and is_junk_booking_url(book)):
            patch["booking_url"] = book[:500]

    if is_booking_platform_url:
        marketing = (found.get("marketing_website") or "").strip() or None
        cur_web = patch.get("website") if "website" in patch else pro.get("website")
        if marketing and (empty(cur_web) or is_booking_platform_url(cur_web)):
            patch["website"] = marketing[:500]

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
            "id,slug,display_name,description,short_description,website,booking_url,phone,email,"
            "city,postal_code,private_address_line,image_url,instagram_url,telegram_url,"
            "source_url,region,state_code,payment_methods,category_id,status"
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
            or not (p.get("payment_methods") or [])
        )
        if needs:
            out.append(p)
    return out


def enrich_one(
    pro: dict[str, Any],
    *,
    client: SupabaseRest | None = None,
    on_event: Any = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Sequential enrich: source → description → contacts/URLs → BFS discovery.

    Does not dump website/IG/booking into the queue up front.
    """
    card_urls = [
        pro.get("website") if not is_junk_website(pro.get("website")) else None,
        pro.get("booking_url"),
        pro.get("instagram_url"),
        pro.get("telegram_url"),
    ]
    card_urls.extend(source_record_urls(client, pro.get("id")))
    # Existing card narrative — mined only AFTER source (or as pre_seed if no source)
    card_blob = "\n".join(
        str(x)
        for x in (
            pro.get("display_name"),
            pro.get("short_description"),
            pro.get("description"),
        )
        if x
    )
    text_notes: dict[str, Any] = {}

    def after_resource(
        found: dict[str, Any], layer: dict[str, Any]
    ) -> list[str]:
        """Parse description into fields; return newly found URLs to enqueue."""
        blob = "\n".join(
            str(x)
            for x in (
                card_blob,
                found.get("description"),
                layer.get("description") if isinstance(layer, dict) else None,
            )
            if x
        )
        from_text = mine_text(blob)
        text_notes.clear()
        text_notes.update(
            {k: v for k, v in from_text.items() if not str(k).startswith("_")}
        )
        # Fill empty found keys from description
        for k in ("phone", "email", "instagram_url", "telegram_url", "website"):
            if from_text.get(k) and not found.get(k):
                found[k] = from_text[k]
        if from_text.get("address_line") and not found.get("address_line"):
            found["address_line"] = from_text["address_line"]
        if from_text.get("city") and not found.get("city"):
            found["city"] = from_text["city"]
        if from_text.get("postal_code") and not found.get("postal_code"):
            found["postal_code"] = from_text["postal_code"]

        urls: list[str] = []
        for key in (
            "website",
            "instagram_url",
            "telegram_url",
            "booking_url",
            "facebook_url",
            "yelp_url",
        ):
            if from_text.get(key):
                urls.append(str(from_text[key]))
        return urls

    bfs = run_resource_bfs(
        source_url=pro.get("source_url"),
        card_urls=card_urls,
        max_resources=12,
        website_pages=10,
        on_event=on_event,
        sequential=True,
        after_resource=after_resource,
    )
    found = dict(bfs.get("found") or {})

    # Prefer street-looking address_line
    addr = found.get("address_line") or found.get("address")
    if addr and looks_like_street(str(addr)):
        cleaned = clean_address(str(addr)) or str(addr)
        found["address_line"] = cleaned[:160]
        if not found.get("city"):
            c = extract_city(cleaned, cleaned)
            if c:
                found["city"] = c
        if not found.get("postal_code"):
            z = plausible_zip(cleaned)
            if z:
                found["postal_code"] = z

    debug = {
        "bfs_steps": bfs.get("steps") or [],
        "visited": bfs.get("visited") or [],
        "card_text": dict(text_notes),
        "services": found.get("services") or [],
        "service_offers": found.get("service_offers") or [],
        "sequential": True,
    }
    return found, debug

def apply_professional_services(
    client: SupabaseRest,
    professional_id: str,
    services: list[Any],
    *,
    service_offers: list[dict[str, Any]] | None = None,
) -> dict[str, int]:
    """Insert new services and fill-empty price/duration on existing titles.

    Returns counts: inserted / updated.
    """
    stop = {
        "with",
        "and",
        "the",
        "for",
        "a",
        "of",
        "to",
        "in",
        "on",
    }

    def _tokens(title: str) -> set[str]:
        return {
            w
            for w in re.findall(r"[a-z0-9]+", title.lower())
            if len(w) > 2 and w not in stop
        }

    def _soft_title_match(a: str, b: str) -> bool:
        """True when titles likely refer to the same service (Framer ↔ booking).

        Gender / audience variants (Men's, Women's) stay distinct.
        """
        al, bl = a.lower(), b.lower()
        gender_a = bool(re.search(r"\b(men|mens|man|women|womens|woman|male|female)\b", al))
        gender_b = bool(re.search(r"\b(men|mens|man|women|womens|woman|male|female)\b", bl))
        if gender_a != gender_b:
            return False
        ta, tb = _tokens(a), _tokens(b)
        if not ta or not tb:
            return False
        if ta == tb:
            return True
        if ta <= tb or tb <= ta:
            return True
        inter = ta & tb
        if len(inter) >= 2:
            return True
        # scalp micropigmentation ↔ scalp pigmentation
        for x in ta:
            for y in tb:
                if x == y:
                    continue
                if len(x) >= 5 and len(y) >= 5 and (x in y or y in x):
                    if inter or (x[:4] == y[:4]):
                        return True
        # shared distinctive first token (eyeliner …)
        first_a = (re.findall(r"[a-z0-9]+", al) or [""])[0]
        first_b = (re.findall(r"[a-z0-9]+", bl) or [""])[0]
        if first_a and first_a == first_b and first_a not in stop and len(first_a) >= 5:
            return True
        return False
    offers: list[dict[str, Any]] = []
    if service_offers:
        for o in service_offers:
            if isinstance(o, dict) and str(o.get("title") or "").strip():
                offers.append(o)
    for s in services or []:
        if isinstance(s, dict) and str(s.get("title") or "").strip():
            offers.append(s)
        elif isinstance(s, str) and s.strip():
            offers.append({"title": s.strip()[:120]})

    # Dedupe by title, prefer richer
    by_title: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for o in offers:
        title = str(o.get("title") or "").strip()[:120]
        if not title:
            continue
        if not is_plausible_service_title(
            title,
            has_price=o.get("price") is not None,
            has_duration=bool(o.get("duration_minutes")),
            typed_service=True,
        ):
            continue
        key = title.lower()
        prev = by_title.get(key)
        if not prev:
            by_title[key] = {"title": title, **{k: v for k, v in o.items() if k != "title"}}
            order.append(key)
            continue
        merged = dict(prev)
        for k, v in o.items():
            if k == "title" or v in (None, "", [], {}):
                continue
            if merged.get(k) in (None, "", [], {}):
                merged[k] = v
        by_title[key] = merged

    # Prefer offers that have a price when soft-duplicates exist
    priced_keys = [
        k
        for k in order
        if by_title[k].get("price") is not None
        or by_title[k].get("duration_minutes")
    ]
    drop: set[str] = set()
    for k in order:
        if k in drop:
            continue
        if by_title[k].get("price") is not None:
            continue
        for pk in priced_keys:
            if pk == k or pk in drop:
                continue
            if _soft_title_match(by_title[k]["title"], by_title[pk]["title"]):
                drop.add(k)
                break
    order = [k for k in order if k not in drop]

    if not order:
        return {"inserted": 0, "updated": 0, "deactivated": 0}

    existing = (
        client._request(
            "GET",
            "/professional_services",
            params={
                "select": (
                    "id,title,description,price_mode,price_amount,"
                    "currency,duration_minutes"
                ),
                "professional_id": f"eq.{professional_id}",
                "is_active": "eq.true",
                "limit": "50",
            },
        )
        or []
    )
    existing_by_title = {
        str(r.get("title") or "").strip().lower(): r for r in existing if r.get("title")
    }

    def _find_row(title: str) -> dict[str, Any] | None:
        key = title.lower()
        if key in existing_by_title:
            return existing_by_title[key]
        for row in existing:
            rt = str(row.get("title") or "").strip()
            if rt and _soft_title_match(title, rt):
                return row
        return None

    inserted = 0
    updated = 0
    for key in order[:16]:
        offer = by_title[key]
        title = offer["title"]
        price_raw = offer.get("price")
        price: float | None = None
        if price_raw is not None:
            try:
                price = float(price_raw)
            except (TypeError, ValueError):
                price = None
        currency = str(offer.get("currency") or "USD").upper()[:3] or "USD"
        duration = offer.get("duration_minutes")
        try:
            duration_i = int(duration) if duration is not None else None
        except (TypeError, ValueError):
            duration_i = None
        if duration_i is not None and duration_i <= 0:
            duration_i = None
        desc = str(offer.get("description") or "").strip()[:800] or None

        if price is not None and price <= 0:
            price_mode = "free"
            price_amount = None
        elif price is not None:
            price_mode = "fixed"
            price_amount = price
        else:
            price_mode = "contact"
            price_amount = None

        row = _find_row(title)
        if row:
            patch: dict[str, Any] = {}
            cur_mode = str(row.get("price_mode") or "contact")
            cur_amt = row.get("price_amount")
            # Only rename when exact soft stub → prefer offer title on EXACT
            # case-insensitive match already handled; never rename on soft match
            # Fill empty price only (never overwrite a real price)
            if cur_mode in ("contact", "") and cur_amt is None and price is not None:
                patch["price_mode"] = price_mode
                patch["price_amount"] = price_amount
                patch["currency"] = currency
            elif cur_mode == "contact" and cur_amt is None and price_mode == "free":
                patch["price_mode"] = "free"
            if row.get("duration_minutes") in (None, "") and duration_i:
                patch["duration_minutes"] = duration_i
            if not (row.get("description") or "").strip() and desc:
                patch["description"] = desc
            if patch:
                client._request(
                    "PATCH",
                    "/professional_services",
                    params={"id": f"eq.{row['id']}"},
                    body=patch,
                )
                updated += 1
                # Keep local cache in sync for later soft-match / de-dupe
                row.update(patch)
            continue
        body: dict[str, Any] = {
            "professional_id": professional_id,
            "title": title,
            "offer_kind": "service",
            "price_mode": price_mode,
            "price_amount": price_amount,
            "currency": currency,
            "is_active": True,
            "sort_order": len(existing) + inserted,
        }
        if duration_i:
            body["duration_minutes"] = duration_i
        if desc:
            body["description"] = desc
        client._request("POST", "/professional_services", body=body)
        inserted += 1
        existing.append(body)
        existing_by_title[title.lower()] = body

    # Deactivate contact-only stubs that soft-match a priced sibling
    deactivated = 0
    priced_rows = [
        r
        for r in existing
        if r.get("is_active", True)
        and r.get("price_amount") is not None
        and str(r.get("price_mode") or "") != "contact"
    ]
    # Refresh from DB for accurate ids after inserts
    existing = (
        client._request(
            "GET",
            "/professional_services",
            params={
                "select": "id,title,price_mode,price_amount,is_active",
                "professional_id": f"eq.{professional_id}",
                "is_active": "eq.true",
                "limit": "50",
            },
        )
        or []
    )
    priced_rows = [
        r
        for r in existing
        if r.get("price_amount") is not None
        and str(r.get("price_mode") or "") not in ("contact", "")
    ]
    for row in existing:
        if row.get("price_amount") is not None and str(row.get("price_mode")) != "contact":
            continue
        if str(row.get("price_mode") or "contact") != "contact":
            continue
        title = str(row.get("title") or "")
        for pr in priced_rows:
            if pr.get("id") == row.get("id"):
                continue
            if _soft_title_match(title, str(pr.get("title") or "")):
                client._request(
                    "PATCH",
                    "/professional_services",
                    params={"id": f"eq.{row['id']}"},
                    body={"is_active": False},
                )
                deactivated += 1
                break

    return {"inserted": inserted, "updated": updated, "deactivated": deactivated}
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--category", default=None, help="e.g. pro_other")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--slug", default=None, help="Single slug")
    ap.add_argument("--id", default=None, help="Single professional id (preferred)")
    ap.add_argument("--all-gaps", action="store_true", help="Only cards with gaps")
    ap.add_argument(
        "--ndjson",
        action="store_true",
        help="Stream started/resource/finished NDJSON for admin UI",
    )
    args = ap.parse_args()
    if not args.dry_run and not args.apply:
        print("Pass --dry-run or --apply", flush=True)
        return 2
    if args.ndjson and not (args.id or args.slug):
        print("--ndjson requires --id or --slug", flush=True)
        return 2

    def emit(obj: dict[str, Any]) -> None:
        if args.ndjson:
            print(json.dumps(obj, ensure_ascii=False), flush=True)

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    select = (
        "id,slug,display_name,description,short_description,website,booking_url,"
        "phone,email,city,postal_code,private_address_line,image_url,"
        "instagram_url,telegram_url,source_url,region,state_code,payment_methods,"
        "category_id,status"
    )
    if args.id or args.slug:
        params: dict[str, str] = {"select": select, "limit": "1"}
        if args.id:
            params["id"] = f"eq.{args.id}"
        else:
            params["slug"] = f"eq.{args.slug}"
        pros = client._request("GET", "/professionals", params=params) or []
        if not pros:
            msg = f"Professional not found id={args.id!r} slug={args.slug!r}"
            if args.ndjson:
                emit({"type": "error", "message": msg})
            else:
                print(msg, flush=True)
            return 1
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
        label = (
            f"Обогащение специалиста «{pro.get('slug') or pro.get('id')}»"
        )
        if not args.ndjson:
            print(
                f"\n[{i}/{len(pros)}] CARD {pro.get('slug')} — "
                f"{(pro.get('display_name') or '')[:50]}",
                flush=True,
            )
        else:
            emit(
                {
                    "type": "started",
                    "id": pro.get("id"),
                    "label": label,
                    "mode": "apply" if args.apply else "dry-run",
                }
            )

        def on_event(ev: dict[str, Any]) -> None:
            if args.ndjson:
                emit(ev)

        found, debug = enrich_one(pro, client=client, on_event=on_event)
        patch = build_patch(pro, found)
        services = list(found.get("services") or [])
        service_offers = [
            o
            for o in (found.get("service_offers") or [])
            if isinstance(o, dict) and o.get("title")
        ]
        steps = debug.get("bfs_steps") or []
        ok_n = sum(1 for s in steps if s.get("outcome") == "ok")
        fail_n = sum(1 for s in steps if s.get("outcome") in ("empty", "error"))
        entry = {
            "slug": pro.get("slug"),
            "display_name": pro.get("display_name"),
            "layers": debug,
            "found": {
                k: v
                for k, v in found.items()
                if not str(k).startswith("_")
            },
            "patch": patch,
            "services": services,
            "service_offers": service_offers,
            "resources_ok": ok_n,
            "resources_failed": fail_n,
        }
        report.append(entry)
        if not args.ndjson:
            for st in steps:
                print(
                    f"  · {st.get('kind')}: {st.get('url')} → {st.get('fields')}",
                    flush=True,
                )
        if not patch and not services and not service_offers:
            if not args.ndjson:
                print("  → no patch", flush=True)
            if args.ndjson:
                emit(
                    {
                        "type": "finished",
                        "result": {
                            "id": pro.get("id"),
                            "label": label,
                            "skipped": False,
                            "patch": {},
                            "resources": steps,
                            "resources_ok": ok_n,
                            "resources_failed": fail_n,
                            "reason": "Готово — новых полей не нашлось (fill-empty).",
                        },
                    }
                )
            continue
        if not args.ndjson:
            print(
                f"  → {'APPLY' if args.apply else 'dry'} patch={patch} "
                f"services={len(services)} offers={len(service_offers)}",
                flush=True,
            )
        svc_stats: dict[str, int] = {
            "inserted": 0,
            "updated": 0,
            "deactivated": 0,
        }
        if args.apply:
            if patch:
                client._request(
                    "PATCH",
                    "/professionals",
                    params={"id": f"eq.{pro['id']}"},
                    body=patch,
                )
            svc_stats = apply_professional_services(
                client,
                pro["id"],
                services,
                service_offers=service_offers,
            )
            entry["services_inserted"] = svc_stats.get("inserted", 0)
            entry["services_updated"] = svc_stats.get("updated", 0)
            entry["services_deactivated"] = svc_stats.get("deactivated", 0)
            updated += 1
        if args.ndjson:
            emit(
                {
                    "type": "finished",
                    "result": {
                        "id": pro.get("id"),
                        "label": label,
                        "skipped": False,
                        "patch": patch,
                        "resources": steps,
                        "resources_ok": ok_n,
                        "resources_failed": fail_n,
                        "services_inserted": svc_stats.get("inserted", 0),
                        "services_updated": svc_stats.get("updated", 0),
                        "reason": None,
                    },
                }
            )

    if args.ndjson:
        return 0

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
