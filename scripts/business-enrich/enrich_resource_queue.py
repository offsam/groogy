#!/usr/bin/env python3
"""Shared BFS resource queue for published-entity enrichment.

Chronology (product rule for all card kinds) — sequential, not one-shot:
  1. source_url alone (provenance / directory / post)
  2. Parse description → contacts / addresses / URLs into fields
  3. Enqueue known card contact URLs (website, IG, booking, …)
  4. Mine each URL; newly discovered URLs go to the *end* of the queue
  5. Stop when the queue is empty (or max_resources)

Website pages use extract_website_profile_deep; Instagram uses extract_instagram_profile.
"""

from __future__ import annotations

import re
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))

from web_enrichment import (  # noqa: E402
    extract_payment_methods,
    extract_instagram_profile,
    extract_website_profile_deep,
    is_plausible_service_title,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))

from shared_hosts import (  # noqa: E402
    is_editorial_url,
    is_shared_non_identity_host,
)
from platform_saas_hosts import (  # noqa: E402
    booking_url_from_maybe_saas,
    is_platform_saas_host,
)

ResourceKind = str  # source | website | instagram | tiktok | facebook | yelp | other

JUNK_HOST_PARTS = (
    "etsy.com",
    "turo.com",
    "maps.apple",
    "maps.app.goo.gl",
    "goo.gl/",
    "fonts.googleapis.com",
    "bit.ly",
    "wa.me/",
    "youtube.com",
    "youtu.be",
    "linktr.ee",
    "eventbrite.com/e/",  # allow eventbrite as source sometimes — filtered below for website kind
    "facebook.com/sharer",
    "facebook.com/share.php",
    "facebook.com/dialog/",
    # App stores / Apple / Huawei / RuStore — booking SaaS footers (Dikidi etc.)
    "itunes.apple.com",
    "apps.apple.com",
    "apple.com",
    "apple.co/",
    "icloud.com",
    "play.google.com",
    "appgallery.huawei",
    "rustore.ru",
    "support.dikidi.app",
)

# Corporate socials of booking / directory platforms — never the card's own.
PLATFORM_SOCIAL_HANDLES = (
    "instagram.com/dikidi_business",
    "instagram.com/dikidi",
    "facebook.com/dikidibusiness",
    "facebook.com/dikidi",
    "vk.com/dikidi",
    "vk.ru/dikidi",
    "instagram.com/glossgenius",
    "facebook.com/glossgenius",
    "instagram.com/booksy",
    "facebook.com/booksy",
)

# When the page we mine is itself a booking SaaS, do not chase its vendor chrome.
BOOKING_PLATFORM_HOSTS = (
    "dikidi.net",
    "dikidi.app",
    "glossgenius.com",
    "booksy.com",
    "vagaro.com",
    "squareup.com",
    "square.site",
    "calendly.com",
    "setmore.com",
)

DIRECTORY_HOSTS = (
    "svoi.us",
    "russianorangepages.com",
    "orange-pages",
    "yellowpages",
)

# Directory brand socials — never attach these to a card as its Instagram/FB.
DIRECTORY_SOCIAL_HANDLES = (
    "instagram.com/svoi.us",
    "instagram.com/svoi",
    "facebook.com/svoi",
)

SKIP_MINE_AS_WEBSITE = DIRECTORY_HOSTS + (
    "instagram.com",
    "facebook.com",
    "fb.com",
    "tiktok.com",
    "yelp.com",
    "t.me",
    "telegram.me",
)


def normalize_http_url(raw: str | None) -> str | None:
    if not raw or not str(raw).strip():
        return None
    w = str(raw).strip()
    if w.startswith("//"):
        w = "https:" + w
    if not re.match(r"^https?://", w, re.I):
        w = "https://" + w
    try:
        u = urlparse(w)
        if not u.hostname or "." not in u.hostname:
            return None
    except Exception:
        return None
    return w.split("#")[0][:500]


def host_of(url: str | None) -> str:
    if not url:
        return ""
    try:
        return (urlparse(url).hostname or "").lower().replace("www.", "")
    except Exception:
        return ""


def is_junk_url(url: str | None) -> bool:
    if not url:
        return True
    low = url.lower()
    return any(p in low for p in JUNK_HOST_PARTS)


def is_directory_social(url: str | None) -> bool:
    if not url:
        return False
    low = url.lower().split("?")[0]
    return any(h in low for h in DIRECTORY_SOCIAL_HANDLES) or any(
        h in low for h in PLATFORM_SOCIAL_HANDLES
    )


def is_booking_platform_host(url: str | None) -> bool:
    h = host_of(url)
    if not h:
        return False
    return any(h == b or h.endswith(f".{b}") for b in BOOKING_PLATFORM_HOSTS)


def is_booking_marketing_page(url: str | None) -> bool:
    """True for SaaS landings (dikidi.net/), false for tenant pages (/1759630)."""
    if not is_booking_platform_host(url):
        return False
    try:
        from dikidi_extract import is_dikidi_company_page

        if is_dikidi_company_page(url):
            return False
    except Exception:
        pass
    # Artist subdomains (vitaliia.glossgenius.com) are tenant pages.
    h = host_of(url)
    if h.count(".") >= 2 and not h.startswith("www."):
        return False
    path = ""
    try:
        path = (urlparse(url or "").path or "").strip("/")
    except Exception:
        path = ""
    # Bare host or /en /pricing style chrome — marketing.
    if not path or path.lower() in {"en", "ru", "pricing", "about", "blog", "help"}:
        return True
    return False


def is_directory_host(url: str | None) -> bool:
    h = host_of(url)
    return any(d in h for d in DIRECTORY_HOSTS)


def can_be_own_website(url: str | None) -> bool:
    """A link may stand for *this* card only if it is not platform chrome.

    Directory pages surround a listing with their own meetup, blogroll and news
    widgets; adopting those made a nail salon point at meetup.com/Instagram of
    Meetup and inherit an unrelated realtor's phone, e-mail and NY street.
    """
    n = normalize_http_url(url)
    if not n or is_junk_url(n) or is_directory_host(n):
        return False
    if is_shared_non_identity_host(n) or is_editorial_url(n) or is_platform_saas_host(n):
        return False
    return classify_resource(n) == "website"


_JUNK_DIKIDI_SERVICE_RE = re.compile(r"(?:шутер|shooter|tactical|dikidi)", re.I)


def _is_junk_dikidi_service_title(title: str) -> bool:
    return bool(_JUNK_DIKIDI_SERVICE_RE.search(title or ""))


def _set_website_or_booking(out: dict[str, Any], raw_url: str | None) -> None:
    """Own marketing site → website; booking SaaS tenant page → booking_url."""
    n = normalize_http_url(raw_url)
    if not n:
        return
    if is_platform_saas_host(n):
        try:
            from dikidi_extract import (
                booking_url_for_company,
                dikidi_company_id,
                is_dikidi_company_page,
            )

            if is_dikidi_company_page(n):
                cid = dikidi_company_id(n)
                if cid:
                    out["booking_url"] = booking_url_for_company(cid)
                    return
        except Exception:
            pass
        book = booking_url_from_maybe_saas(n)
        if book:
            out.setdefault("booking_url", book.split("?")[0][:500])
        return
    out["website"] = n.split("?")[0][:300]


def _sanitize_dikidi_company_extract(out: dict[str, Any], url: str) -> None:
    """Strip Dikidi vendor chrome; never adopt dikidi.net as the card website."""
    try:
        from dikidi_extract import booking_url_for_company, dikidi_company_id
    except Exception:
        booking_url_for_company = None  # type: ignore
        dikidi_company_id = lambda _u: None  # type: ignore

    cid = dikidi_company_id(url)
    if cid and booking_url_for_company:
        out["booking_url"] = booking_url_for_company(cid)
    out.pop("website", None)

    email = out.get("email")
    if email and "@dikidi." in str(email).lower():
        out.pop("email", None)

    for key in ("instagram_url", "facebook_url"):
        val = out.get(key)
        if val and is_directory_social(str(val)):
            out.pop(key, None)

    socials = [
        s
        for s in (out.get("social_links") or [])
        if s and not is_directory_social(str(s))
    ]
    out["social_links"] = socials

    if out.get("services"):
        out["services"] = [
            str(s).strip()
            for s in out["services"]
            if str(s).strip() and not _is_junk_dikidi_service_title(str(s))
        ][:20]
    for offers_key in ("service_offers", "offers"):
        raw_offers = out.get(offers_key)
        if not isinstance(raw_offers, list):
            continue
        filtered = [
            o
            for o in raw_offers
            if isinstance(o, dict)
            and str(o.get("title") or "").strip()
            and not _is_junk_dikidi_service_title(str(o.get("title") or ""))
        ]
        if filtered:
            out[offers_key] = filtered[:40]
        else:
            out.pop(offers_key, None)


PHONE_IN_TEXT_RE = re.compile(
    r"(?:\+?\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b"
)
EMAIL_IN_TEXT_RE = re.compile(r"[^\s,;]+@[^\s,;]+\.[A-Za-z]{2,}")
URL_IN_TEXT_RE = re.compile(r"(?:https?://|www\.)\S+", re.I)
STREET_START_RE = re.compile(r"\d{1,6}\s+\S")


def sanitize_street_line(raw: str | None) -> str | None:
    """Keep only the street part of a scraped address blob.

    Site footers arrive glued («+1 917 868 0747 d@vesnarealty.com 339 West 71st
    Street»). Contacts belong in their own fields, so they are stripped here and
    the leftover must still start with a house number to count as an address.
    """
    value = (raw or "").replace("\xa0", " ").strip()
    if not value:
        return None
    value = URL_IN_TEXT_RE.sub(" ", value)
    value = EMAIL_IN_TEXT_RE.sub(" ", value)
    value = PHONE_IN_TEXT_RE.sub(" ", value)
    value = re.sub(r"\s{2,}", " ", value).strip(" ,;|·—–-")
    if "@" in value:
        return None
    # Drop leading noise so «Address: 339 West 71st St» and stripped phone
    # prefixes both end up starting at the house number.
    head = STREET_START_RE.search(value)
    if not head:
        return None
    value = value[head.start() :].strip(" ,;|·—–-")
    if len(value) < 6:
        return None
    return value[:300]


def classify_resource(url: str) -> ResourceKind:
    h = host_of(url)
    low = url.lower()
    if "instagram.com" in h:
        return "instagram"
    if "tiktok.com" in h:
        return "tiktok"
    if "facebook.com" in h or h == "fb.com" or h.endswith(".fb.com"):
        return "facebook"
    if "yelp.com" in h:
        return "yelp"
    if "t.me" in h or "telegram.me" in h:
        return "other"
    if is_directory_host(url) or "facebook.com/groups/" in low or "t.me/c/" in low:
        return "source"
    return "website"


def url_key(url: str) -> str:
    n = normalize_http_url(url) or url
    try:
        u = urlparse(n)
        path = (u.path or "/").rstrip("/") or "/"
        return f"{(u.hostname or '').lower().replace('www.', '')}{path}".lower()
    except Exception:
        return n.lower()


def build_initial_queue(
    *,
    source_url: str | None,
    card_urls: list[str | None],
    sequential: bool = True,
) -> tuple[deque[str], list[str]]:
    """Build BFS queue.

    sequential=True (default):
      - queue starts with source_url only (if any)
      - card_urls returned as deferred — enqueue after source + description pass
    sequential=False:
      - legacy: source first, then all card_urls immediately
    """
    q: deque[str] = deque()
    seen: set[str] = set()

    def add(raw: str | None, *, into: deque[str] | list[str]) -> None:
        n = normalize_http_url(raw)
        if not n or is_junk_url(n):
            return
        k = url_key(n)
        if k in seen:
            return
        seen.add(k)
        into.append(n)

    deferred: list[str] = []
    add(source_url, into=q)
    if sequential:
        for u in card_urls:
            add(u, into=deferred)
    else:
        for u in card_urls:
            add(u, into=q)
    return q, deferred


def enqueue_discovered(
    queue: deque[str],
    visited: set[str],
    queued: set[str],
    urls: list[str | None],
) -> list[str]:
    """Append new URLs to the end. Returns list of newly queued."""
    added: list[str] = []
    for raw in urls:
        n = normalize_http_url(raw)
        if not n or is_junk_url(n) or is_directory_social(n):
            continue
        # Don't treat directory hosts as follow-up "website" unless they were the seed source
        kind = classify_resource(n)
        if kind == "website" and is_directory_host(n):
            continue
        # Platform chrome and articles never describe this card — mining them
        # only imports someone else's phone / e-mail / address.
        if kind == "website" and (
            is_shared_non_identity_host(n) or is_editorial_url(n)
        ):
            continue
        k = url_key(n)
        if k in visited or k in queued:
            continue
        queued.add(k)
        queue.append(n)
        added.append(n)
    return added


def _first_str(vals: Any) -> str | None:
    if isinstance(vals, list):
        for v in vals:
            s = str(v).strip() if v is not None else ""
            if s:
                return s
        return None
    if vals is None:
        return None
    s = str(vals).strip()
    return s or None


def _merge_fill_empty(found: dict[str, Any], patch: dict[str, Any]) -> None:
    # Local import — completeness_score lives next to this module in business-enrich/
    try:
        from completeness_score import is_weak_description
    except Exception:  # pragma: no cover
        def is_weak_description(value: Any) -> bool:  # type: ignore
            return not (isinstance(value, str) and len(value.strip()) >= 40)

    def _junk_image(url: Any) -> bool:
        if not isinstance(url, str) or not url.strip():
            return True
        low = url.lower()
        return any(
            x in low
            for x in (
                "telegram.org/img",
                "website_icon",
                "/emoji",
                "1x1",
                "pixel.gif",
                "spacer.",
            )
        )

    for k, v in patch.items():
        if k.startswith("_") or v in (None, "", [], {}):
            continue
        cur = found.get(k)
        if cur in (None, "", [], {}):
            # Never seed found with junk chrome from t.me / telegram.org
            if k == "description" and is_weak_description(v):
                continue
            if k == "image_url" and _junk_image(v):
                continue
            if k == "website" and is_platform_saas_host(str(v)):
                book = booking_url_from_maybe_saas(str(v))
                if book and not found.get("booking_url"):
                    found["booking_url"] = book.split("?")[0][:500]
                continue
            found[k] = v
        elif k == "description" and is_weak_description(cur) and not is_weak_description(v):
            found[k] = v
        elif k == "image_url" and _junk_image(cur) and not _junk_image(v):
            found[k] = v
        elif k == "services" and isinstance(cur, list) and isinstance(v, list):
            seen = {str(x).strip().lower() for x in cur if not isinstance(x, dict)}
            for s in v:
                if isinstance(s, dict):
                    t = str(s.get("title") or "").strip()
                else:
                    t = str(s).strip()
                if t and t.lower() not in seen:
                    cur.append(t)
                    seen.add(t.lower())
        elif k == "service_offers" and isinstance(cur, list) and isinstance(v, list):
            try:
                from web_enrichment import _merge_service_offers

                found[k] = _merge_service_offers(list(cur) + list(v))[:20]
            except Exception:
                found[k] = list(cur) + list(v)
            # Keep title list in sync
            titles = [
                str(o.get("title")).strip()
                for o in found[k]
                if isinstance(o, dict) and o.get("title")
            ]
            if titles:
                existing = list(found.get("services") or [])
                seen_t = {str(x).strip().lower() for x in existing}
                for t in titles:
                    if t.lower() not in seen_t:
                        existing.append(t)
                        seen_t.add(t.lower())
                found["services"] = existing[:20]
        elif k in ("social_links", "payment_methods") and isinstance(cur, list) and isinstance(v, list):
            seen = {str(x).strip().lower() for x in cur}
            for s in v:
                t = str(s).strip()
                if t and t.lower() not in seen:
                    cur.append(t)
                    seen.add(t.lower())


def mine_resource(
    url: str,
    *,
    kind: ResourceKind | None = None,
    website_pages: int = 10,
) -> dict[str, Any]:
    """Fetch one resource → fields + discovered_urls."""
    kind = kind or classify_resource(url)
    out: dict[str, Any] = {
        "_url": url,
        "_kind": kind,
        "discovered_urls": [],
    }

    if kind == "instagram":
        prof = extract_instagram_profile(url)
        out["_status"] = prof.get("status")
        if prof.get("status") == "ok" or prof.get("bio") or prof.get("website"):
            if prof.get("bio") or prof.get("description"):
                out["description"] = (prof.get("bio") or prof.get("description") or "")[
                    :2000
                ]
                methods = extract_payment_methods(out["description"])
                if methods:
                    out["payment_methods"] = methods
            if prof.get("avatar") or prof.get("image_url"):
                out["image_url"] = prof.get("avatar") or prof.get("image_url")
            if prof.get("website"):
                out["website"] = prof["website"]
                out["discovered_urls"].append(prof["website"])
            out["instagram_url"] = prof.get("url") or url
            out["social_links"] = [out["instagram_url"]]
        return out

    if kind in ("tiktok", "facebook", "yelp"):
        # Lightweight: keep URL as social link; deep scrapers not wired for all.
        out["_status"] = "link_only"
        key = {
            "tiktok": "tiktok_url",
            "facebook": "facebook_url",
            "yelp": "yelp_url",
        }[kind]
        out[key] = url.split("?")[0][:300]
        out["social_links"] = [url]
        return out

    if kind == "source":
        # Treat as HTML page (directory / post) — shallow deep fetch still helps
        # discover website links via profile social + JSON-LD.
        pass

    # website + source HTML pages
    if kind == "website" or kind == "source" or kind == "other":
        if kind == "website" and any(
            h in host_of(url) for h in ("instagram.com", "facebook.com", "tiktok.com")
        ):
            return out
        # Dikidi tenant company page — structured API, not generic HTML chrome.
        try:
            from dikidi_extract import extract_dikidi_company, is_dikidi_company_page

            if kind == "website" and is_dikidi_company_page(url):
                dikidi = extract_dikidi_company(url)
                for k, v in dikidi.items():
                    if k.startswith("_"):
                        continue
                    out[k] = v
                out["_status"] = dikidi.get("_status") or "ok"
                if dikidi.get("_error"):
                    out["_error"] = dikidi["_error"]
                _sanitize_dikidi_company_extract(out, url)
                return out
        except Exception as exc:  # pragma: no cover
            out["_dikidi_error"] = str(exc)[:200]
        prof = extract_website_profile_deep(url, max_pages=website_pages)
        out["_status"] = prof.get("status")
        if prof.get("status") != "ok":
            out["_error"] = prof.get("error") or prof.get("status")
            return out
        phone = _first_str(prof.get("phone"))
        email = _first_str(prof.get("email"))
        if phone:
            out["phone"] = phone
        if email:
            out["email"] = email
        try:
            from completeness_score import is_weak_description as _weak_desc
        except Exception:  # pragma: no cover
            def _weak_desc(value: Any) -> bool:
                return not (isinstance(value, str) and len(value.strip()) >= 40)

        desc = (prof.get("description") or "").strip()
        if desc and not _weak_desc(desc):
            out["description"] = desc[:4000]
        if prof.get("logo"):
            logo = str(prof["logo"]).strip()[:500]
            if logo and "telegram.org/img" not in logo.lower():
                out["image_url"] = logo
        street = sanitize_street_line(prof.get("address"))
        if street:
            out["address"] = street
            out["address_line"] = street
        if prof.get("hours"):
            out["hours"] = prof["hours"]
        if prof.get("payment_methods"):
            out["payment_methods"] = [
                str(method).strip()
                for method in prof["payment_methods"]
                if str(method).strip()
            ][:12]
        if prof.get("name"):
            name = str(prof["name"]).strip()[:200]
            # Telegram chrome title is useless as site_name
            if name and name.lower() not in {"telegram", "fast. secure. powerful."}:
                out["site_name"] = name
        svcs = [
            str(s).strip()
            for s in (prof.get("services") or [])
            if str(s).strip() and is_plausible_service_title(str(s).strip())
        ]
        offers = [
            o
            for o in (prof.get("service_offers") or [])
            if isinstance(o, dict)
            and str(o.get("title") or "").strip()
            and is_plausible_service_title(
                str(o.get("title") or "").strip(),
                has_price=o.get("price") is not None,
                has_duration=bool(o.get("duration_minutes")),
                typed_service=True,
            )
        ]
        if not svcs and prof.get("hours"):
            # Some clinic sites put service nav into "hours" as semicolon list
            parts = [
                p.strip()
                for p in re.split(r"[;|•·]", str(prof["hours"]))
                if p and p.strip()
            ]
            skip = {
                "hours",
                "directory",
                "(video)",
                "video",
                "wellness",
                "home",
                "contact",
                "about",
            }
            tokens = [
                p
                for p in parts
                if p.lower() not in skip
                and len(p) > 2
                and not re.match(r"(?i)^hours?\b", p)
                and not re.search(r"\d{1,2}:\d{2}", p)
            ]
            # Join consecutive single-word tokens into service phrases
            # e.g. Neck; Pain → Neck Pain; Lower; Back; Pain → Lower Back Pain
            endings = {
                "pain",
                "tunnel",
                "therapy",
                "syndrome",
                "injury",
                "care",
                "massage",
                "treatment",
            }
            merged: list[str] = []
            i = 0
            while i < len(tokens):
                t = tokens[i]
                if " " in t or re.search(r"[a-z][A-Z]", t):
                    merged.append(t)
                    i += 1
                    continue
                if (
                    i + 2 < len(tokens)
                    and " " not in tokens[i + 1]
                    and " " not in tokens[i + 2]
                    and tokens[i + 2].lower() in endings
                    and tokens[i + 1].lower() not in endings
                ):
                    merged.append(" ".join(tokens[i : i + 3]))
                    i += 3
                    continue
                if (
                    i + 1 < len(tokens)
                    and " " not in tokens[i + 1]
                    and tokens[i + 1].lower() in endings
                ):
                    merged.append(" ".join(tokens[i : i + 2]))
                    i += 2
                    continue
                merged.append(t)
                i += 1
            if len(merged) >= 2:
                svcs = merged[:20]
        if offers:
            out["service_offers"] = offers[:20]
            if not svcs:
                svcs = [str(o["title"]).strip() for o in offers]
        if svcs:
            out["services"] = svcs[:20]
        # Booking CTA (GlossGenius / Calendly / Book Now links)
        try:
            from booking_extract import resolve_booking_url

            book = resolve_booking_url(url)
            if book:
                out["booking_url"] = book
                # Always enqueue booking pages — they carry priced service offers
                out.setdefault("discovered_urls", [])
                if book not in out["discovered_urls"]:
                    out["discovered_urls"].append(book)
        except Exception:
            pass
        socials = [
            s
            for s in (prof.get("social_links") or [])
            if s and not is_junk_url(str(s)) and not is_directory_social(str(s))
        ]
        related = [
            s
            for s in (prof.get("related_websites") or [])
            if s
            and not is_junk_url(str(s))
            and not is_directory_host(str(s))
            and not is_shared_non_identity_host(str(s))
            and not is_editorial_url(str(s))
        ]
        if kind == "source" and is_directory_host(url):
            # From directory pages only follow the listed company's own links —
            # never the portal's meetup / blogroll / news chrome.
            keep: list[str] = []
            for link in socials:
                ck = classify_resource(str(link))
                if ck == "website":
                    if can_be_own_website(str(link)):
                        keep.append(str(link))
                elif ck in ("instagram", "tiktok", "facebook", "yelp") and not is_directory_social(
                    str(link)
                ):
                    keep.append(str(link))
            socials = keep
            related = [r for r in related if can_be_own_website(str(r))]
        if is_booking_marketing_page(url):
            # Bare Dikidi / GlossGenius / Booksy landing = vendor chrome, not the salon.
            # Tenant company pages (dikidi.net/1759630) are handled above.
            socials = [
                s
                for s in socials
                if not is_directory_social(str(s))
                and classify_resource(str(s)) in ("instagram", "facebook", "tiktok", "yelp")
                and "dikidi" not in str(s).lower()
                and "glossgenius" not in str(s).lower()
                and "booksy" not in str(s).lower()
            ]
            related = [r for r in related if can_be_own_website(str(r))]
            for vendor_key in (
                "phone",
                "email",
                "instagram_url",
                "facebook_url",
                "yelp_url",
                "services",
                "service_offers",
            ):
                out.pop(vendor_key, None)
        out["social_links"] = socials
        discovered = list(out.get("discovered_urls") or []) + list(socials) + list(related)
        # Dedupe preserving order
        seen_d: set[str] = set()
        uniq_d: list[str] = []
        for d in discovered:
            dk = str(d).strip().lower().rstrip("/")
            if not dk or dk in seen_d:
                continue
            seen_d.add(dk)
            uniq_d.append(str(d))
        out["discovered_urls"] = uniq_d
        # Prefer non-directory page as own website when mining a source page
        if kind == "source":
            # discover same-site contact pages already handled by deep; also keep external site
            for link in socials + related:
                if can_be_own_website(link):
                    _set_website_or_booking(out, link)
                    out["discovered_urls"].append(link)
        elif kind == "website":
            _set_website_or_booking(out, url)
            # Booking platforms often link to the real marketing site
            for link in related:
                if classify_resource(link) == "website":
                    out["discovered_urls"].append(link)
            try:
                from booking_extract import is_booking_platform_url

                if is_booking_platform_url(url):
                    for link in related:
                        if link and not is_booking_platform_url(link):
                            out.setdefault("marketing_website", str(link).split("?")[0][:300])
                            break
            except Exception:
                pass
        return out
    return out


# Fields that count as "useful" for ✓ vs ✗ in the admin enrich route UI.
_USEFUL_RESOURCE_FIELDS = frozenset(
    {
        "phone",
        "email",
        "description",
        "website",
        "booking_url",
        "marketing_website",
        "services",
        "service_offers",
        "offers",
        "opening_hours",
        "image_url",
        "address",
        "address_line",
        "hours",
        "instagram_url",
        "telegram_url",
        "facebook_url",
        "yelp_url",
        "tiktok_url",
        "social_links",
        "city",
        "postal_code",
        "payment_methods",
    }
)


def _resource_kind_label(url: str, kind: str) -> str:
    try:
        from booking_extract import is_booking_platform_url

        if is_booking_platform_url(url):
            return "booking"
    except Exception:
        pass
    return kind


def _useful_fields(layer: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for kk, vv in layer.items():
        if kk.startswith("_") or kk in ("discovered_urls", "site_name"):
            continue
        if kk not in _USEFUL_RESOURCE_FIELDS:
            continue
        if vv in (None, "", [], {}):
            continue
        out.append(kk)
    return out


def _resource_outcome(layer: dict[str, Any], fields: list[str]) -> tuple[str, str | None]:
    """Return (outcome, error_reason). outcome: ok | empty | error."""
    status = str(layer.get("_status") or "")
    err = layer.get("_error")
    if err or status in ("unavailable", "error", "fetch_failed", "parse_failed"):
        reason = str(err or status or "error")[:200]
        return "error", reason
    if not fields:
        return "empty", "ничего не извлечено"
    return "ok", None


def run_resource_bfs(
    *,
    source_url: str | None,
    card_urls: list[str | None],
    max_resources: int = 12,
    website_pages: int = 10,
    sleep_s: float = 0.15,
    mine_fn: Callable[..., dict[str, Any]] | None = None,
    on_event: Callable[[dict[str, Any]], None] | None = None,
    sequential: bool = True,
    after_resource: Callable[[dict[str, Any], dict[str, Any]], list[str] | None]
    | None = None,
) -> dict[str, Any]:
    """Run BFS over resources. Returns found fields + steps debug.

    sequential=True (default product rule):
      1) source_url first (alone)
      2) after source (or immediately if no source): release deferred card_urls
         + whatever after_resource returns (description → contacts/links)
      3) continue BFS — newly discovered URLs go to the end; no parallel grab

    on_event receives resource progress dicts:
      {type:"resource", url, kind, status: queued|running|done|error,
       outcome?: ok|empty|error, fields?, error?, enqueued?}

    after_resource(found, layer) may return extra URLs to enqueue (e.g. after
    re-mining an updated description).
    """
    mine = mine_fn or mine_resource
    queue, deferred = build_initial_queue(
        source_url=source_url,
        card_urls=card_urls,
        sequential=sequential,
    )
    visited: set[str] = set()
    queued: set[str] = {url_key(u) for u in queue}
    found: dict[str, Any] = {}
    steps: list[dict[str, Any]] = []
    processed = 0
    deferred_released = (not sequential) or (not deferred)

    def emit(payload: dict[str, Any]) -> None:
        if on_event:
            try:
                on_event(payload)
            except Exception:
                pass

    def release_deferred(*, reason: str) -> list[str]:
        nonlocal deferred_released
        if deferred_released:
            return []
        deferred_released = True
        added = enqueue_discovered(queue, visited, queued, list(deferred))
        deferred.clear()
        for nu in added:
            nk = classify_resource(nu)
            emit(
                {
                    "type": "resource",
                    "url": nu,
                    "kind": _resource_kind_label(nu, nk),
                    "status": "queued",
                    "detail": reason,
                }
            )
        return added

    # Announce only what's actually in the queue now (source)
    for u in list(queue):
        k0 = classify_resource(u)
        if source_url and url_key(source_url) == url_key(u):
            k0 = "source"
        emit(
            {
                "type": "resource",
                "url": u,
                "kind": _resource_kind_label(u, k0),
                "status": "queued",
            }
        )

    # No source → description/contacts phase first via after_resource(None), then deferred
    if sequential and not queue:
        if after_resource:
            try:
                extra = after_resource(found, {"_phase": "pre_seed"}) or []
            except Exception:
                extra = []
            for nu in enqueue_discovered(queue, visited, queued, list(extra)):
                emit(
                    {
                        "type": "resource",
                        "url": nu,
                        "kind": _resource_kind_label(nu, classify_resource(nu)),
                        "status": "queued",
                        "detail": "из описания",
                    }
                )
        release_deferred(reason="после описания")

    while queue and processed < max_resources:
        url = queue.popleft()
        k = url_key(url)
        if k in visited:
            continue
        visited.add(k)
        kind = classify_resource(url)
        if source_url and url_key(source_url) == k:
            kind = "source"
        kind_label = _resource_kind_label(url, kind)
        emit(
            {
                "type": "resource",
                "url": url,
                "kind": kind_label,
                "status": "running",
            }
        )
        layer = mine(url, kind=kind, website_pages=website_pages)
        processed += 1
        discovered = list(layer.get("discovered_urls") or [])
        if layer.get("website"):
            discovered.append(layer["website"])
        for s in layer.get("social_links") or []:
            discovered.append(s)
        added = enqueue_discovered(queue, visited, queued, discovered)
        _merge_fill_empty(
            found,
            {
                kk: vv
                for kk, vv in layer.items()
                if not kk.startswith("_") and kk != "discovered_urls"
            },
        )
        fields = _useful_fields(layer)
        outcome, err_reason = _resource_outcome(layer, fields)
        step = {
            "url": url,
            "kind": kind_label,
            "status": layer.get("_status"),
            "outcome": outcome,
            "error": err_reason,
            "enqueued": added,
            "fields": fields,
        }
        steps.append(step)
        emit(
            {
                "type": "resource",
                "url": url,
                "kind": kind_label,
                "status": "error" if outcome == "error" else "done",
                "outcome": outcome,
                "fields": fields,
                "error": err_reason,
                "enqueued": added,
            }
        )
        for nu in added:
            nk = classify_resource(nu)
            emit(
                {
                    "type": "resource",
                    "url": nu,
                    "kind": _resource_kind_label(nu, nk),
                    "status": "queued",
                }
            )

        # After source (or first resource when sequential): mine description, then card URLs
        just_did_source = bool(source_url and url_key(source_url) == k)
        if sequential and not deferred_released and (just_did_source or not source_url):
            if after_resource:
                try:
                    extra = after_resource(found, layer) or []
                except Exception:
                    extra = []
                for nu in enqueue_discovered(queue, visited, queued, list(extra)):
                    emit(
                        {
                            "type": "resource",
                            "url": nu,
                            "kind": _resource_kind_label(nu, classify_resource(nu)),
                            "status": "queued",
                            "detail": "из описания",
                        }
                    )
            release_deferred(
                reason="после источника и описания"
                if just_did_source
                else "после описания"
            )
        elif after_resource:
            # Later resources may refresh description → new links
            try:
                extra = after_resource(found, layer) or []
            except Exception:
                extra = []
            for nu in enqueue_discovered(queue, visited, queued, list(extra)):
                emit(
                    {
                        "type": "resource",
                        "url": nu,
                        "kind": _resource_kind_label(nu, classify_resource(nu)),
                        "status": "queued",
                        "detail": "из описания",
                    }
                )

        if sleep_s > 0:
            time.sleep(sleep_s)

    # Source was empty/failed and deferred never released
    if sequential and not deferred_released:
        if after_resource:
            try:
                extra = after_resource(found, {"_phase": "fallback"}) or []
            except Exception:
                extra = []
            enqueue_discovered(queue, visited, queued, list(extra))
        release_deferred(reason="источник пуст — контакты карточки")
        # Process remaining if budget left
        while queue and processed < max_resources:
            url = queue.popleft()
            k = url_key(url)
            if k in visited:
                continue
            visited.add(k)
            kind = classify_resource(url)
            kind_label = _resource_kind_label(url, kind)
            emit(
                {
                    "type": "resource",
                    "url": url,
                    "kind": kind_label,
                    "status": "running",
                }
            )
            layer = mine(url, kind=kind, website_pages=website_pages)
            processed += 1
            discovered = list(layer.get("discovered_urls") or [])
            if layer.get("website"):
                discovered.append(layer["website"])
            for s in layer.get("social_links") or []:
                discovered.append(s)
            added = enqueue_discovered(queue, visited, queued, discovered)
            _merge_fill_empty(
                found,
                {
                    kk: vv
                    for kk, vv in layer.items()
                    if not kk.startswith("_") and kk != "discovered_urls"
                },
            )
            fields = _useful_fields(layer)
            outcome, err_reason = _resource_outcome(layer, fields)
            steps.append(
                {
                    "url": url,
                    "kind": kind_label,
                    "status": layer.get("_status"),
                    "outcome": outcome,
                    "error": err_reason,
                    "enqueued": added,
                    "fields": fields,
                }
            )
            emit(
                {
                    "type": "resource",
                    "url": url,
                    "kind": kind_label,
                    "status": "error" if outcome == "error" else "done",
                    "outcome": outcome,
                    "fields": fields,
                    "error": err_reason,
                    "enqueued": added,
                }
            )
            for nu in added:
                emit(
                    {
                        "type": "resource",
                        "url": nu,
                        "kind": _resource_kind_label(nu, classify_resource(nu)),
                        "status": "queued",
                    }
                )
            if after_resource:
                try:
                    extra = after_resource(found, layer) or []
                except Exception:
                    extra = []
                for nu in enqueue_discovered(queue, visited, queued, list(extra)):
                    emit(
                        {
                            "type": "resource",
                            "url": nu,
                            "kind": _resource_kind_label(nu, classify_resource(nu)),
                            "status": "queued",
                            "detail": "из описания",
                        }
                    )
            if sleep_s > 0:
                time.sleep(sleep_s)

    return {
        "found": found,
        "steps": steps,
        "visited": sorted(visited),
        "remaining_queue": list(queue),
    }
