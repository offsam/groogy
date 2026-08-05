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
from enrich_follow_policy import (  # noqa: E402
    BOOKING_PLATFORM_HOSTS,
    CMS_CHROME_HOST_PARTS,
    DIRECTORY_HOSTS,
    filter_related_websites_for_queue,
    is_booking_platform_host,
    is_cms_chrome_url,
    is_directory_host,
    is_directory_sidebar_host,
)

ResourceKind = str  # source | website | instagram | tiktok | facebook | yelp | telegram | youtube | trustpilot | other

JUNK_HOST_PARTS = (
    "etsy.com",
    "turo.com",
    "maps.apple",
    "maps.app.goo.gl",
    "goo.gl/",
    "fonts.googleapis.com",
    "bit.ly",
    "wa.me/",
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
    "bazar.club",
    "apteka03.online",
    "apteka03.com",
    "madbid.com",
) + CMS_CHROME_HOST_PARTS

#: Social / review profiles — contact only, never deep-crawl as a website.
SOCIAL_CONTACT_KINDS = frozenset(
    {
        "instagram",
        "tiktok",
        "facebook",
        "yelp",
        "telegram",
        "youtube",
        "trustpilot",
    }
)

#: Telegram product chrome (faq/blog/css/favicons) — not a business channel.
_TELEGRAM_CHROME_PATH_RE = re.compile(
    r"^/(?:img|css|js|s|faq|apps|safety|blog|a|share|proxy|socks|"
    r"setlanguage|iv|privacy|tos|jobs|stickers|themes?|gif|"
    r"addstickers|addtheme|bg|login|account|"
    r"contact(?:-us)?|payments?|tickets?)(?:/|$)",
    re.I,
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

# Directory brand socials — never attach these to a card as its Instagram/FB.
DIRECTORY_SOCIAL_HANDLES = (
    "instagram.com/svoi.us",
    "instagram.com/svoi",
    "facebook.com/svoi",
    "facebook.com/rusocnews",
    "facebook.com/russianorangepages",
    "instagram.com/russianorangepages",
    "instagram.com/rusoc",
    # to4ka page chrome / Bazar Club ad unit
    "instagram.com/bazarclub.us",
    "instagram.com/bazar.club",
    "facebook.com/bazarclub.us",
    "facebook.com/bazar.club",
    "tiktok.com/@bazar.club",
    "t.me/bazar_club",
    "t.me/bazar_club_customer_suport_bot",
    "youtube.com/channel/uce8l2obpla632xamrkozww",
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
    if is_cms_chrome_url(url):
        return True
    if is_telegram_chrome_url(url):
        return True
    low = url.lower()
    return any(p in low for p in JUNK_HOST_PARTS)


def is_telegram_chrome_url(url: str | None) -> bool:
    """True for t.me/faq, /img/favicon, /css/… — not @channel contacts."""
    h = host_of(url)
    if h not in ("t.me", "telegram.me", "telegram.dog", "telegram.org"):
        return False
    if h == "telegram.org":
        return True
    try:
        path = (urlparse(url or "").path or "/").rstrip("/") or "/"
    except Exception:
        return True
    if path == "/":
        return True
    # Private/supergroup posts are source URLs, not chrome — and not contacts.
    if path.startswith("/c/"):
        return False
    # /s/… is Telegram web preview chrome (also CONTACT_PATHS noise on t.me).
    if path.startswith("/s/"):
        return True
    if _TELEGRAM_CHROME_PATH_RE.match(path + "/"):
        return True
    # Bare @username: /startcdl or /startcdl/
    if re.fullmatch(r"/[A-Za-z][A-Za-z0-9_]{3,31}", path):
        return False
    # Message deep-links /joinchat/+… — not a public channel contact for enrich.
    if path.startswith("/joinchat") or path.startswith("/+"):
        return True
    return True


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
    if "youtube.com" in h or "youtu.be" in h:
        return "youtube"
    if "trustpilot.com" in h:
        return "trustpilot"
    # Channel contact vs post vs product chrome.
    if h in ("t.me", "telegram.me", "telegram.dog"):
        if "/c/" in low or is_directory_host(url):
            return "source"
        if is_telegram_chrome_url(url):
            return "other"
        return "telegram"
    if is_directory_host(url) or "facebook.com/groups/" in low:
        return "source"
    return "website"


def is_directory_social(url: str | None) -> bool:
    if not url:
        return False
    low = url.lower().split("?")[0]
    return any(h in low for h in DIRECTORY_SOCIAL_HANDLES) or any(
        h in low for h in PLATFORM_SOCIAL_HANDLES
    )


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


def can_be_own_website(url: str | None) -> bool:
    """A link may stand for *this* card only if it is not platform chrome.

    Directory pages surround a listing with their own meetup, blogroll and news
    widgets; adopting those made a nail salon point at meetup.com/Instagram of
    Meetup and inherit an unrelated realtor's phone, e-mail and NY street.
    """
    n = normalize_http_url(url)
    if not n or is_junk_url(n) or is_directory_host(n):
        return False
    if is_directory_sidebar_host(n):
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
    # Marketing «7213 truck driver vacancies» must never become a street.
    if re.search(
        r"(?i)\b(?:vacanc(?:y|ies)|hiring|jobs?\s+per\s+day|truck\s+driver)\b",
        value,
    ):
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
    # «Drive, Ste.» with the unit number on the next HTML node — drop the
    # dangling suite label so we don't treat «Ste.» as a city later.
    value = re.sub(
        r",?\s*(?:Ste\.?|Suite|Unit|#)\s*$",
        "",
        value,
        flags=re.I,
    ).strip(" ,;|·—–-")
    if len(value) < 6:
        return None
    return value[:300]


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
    preferred_website: str | None = None,
) -> tuple[deque[str], list[str]]:
    """Build BFS queue.

    sequential=True (default):
      - queue starts with source_url only (if any)
      - card_urls returned as deferred — enqueue after source + description pass
    sequential=False:
      - legacy: source first, then all card_urls immediately

    preferred_website: the card's own website field. When set, *only* that host
    may enter the seed list as a website — origin rows often still hold the
    whole ROP sidebar (bike911, homeopathy, …) and must not be mined.
    """
    q: deque[str] = deque()
    seen: set[str] = set()
    pref_host = host_of(preferred_website)

    def add(raw: str | None, *, into: deque[str] | list[str]) -> None:
        n = normalize_http_url(raw)
        if not n or is_junk_url(n) or is_directory_social(n):
            return
        kind = classify_resource(n)
        if kind == "website":
            # Hard rule: one card → one marketing site seed (the field on the card).
            if pref_host and host_of(n) != pref_host:
                return
            if is_directory_sidebar_host(n) and host_of(n) != pref_host:
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
            is_shared_non_identity_host(n)
            or is_editorial_url(n)
            or is_directory_sidebar_host(n)
        ):
            continue
        k = url_key(n)
        if k in visited or k in queued:
            continue
        queued.add(k)
        queue.append(n)
        added.append(n)
    return added


def enqueue_seed_urls(
    queue: deque[str],
    visited: set[str],
    queued: set[str],
    urls: list[str | None],
) -> list[str]:
    """Enqueue card-seed URLs (website / IG / …) after the source step.

    Unlike enqueue_discovered, sidebar-advertiser hosts are allowed — the admin
    (or card field) explicitly named this URL as *this* card's resource.
    """
    added: list[str] = []
    for raw in urls:
        n = normalize_http_url(raw)
        if not n or is_junk_url(n) or is_directory_social(n):
            continue
        kind = classify_resource(n)
        if kind == "website" and is_directory_host(n):
            continue
        # Still never seed true platform chrome as a marketing site.
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
        from completeness_score import (
            description_is_richer,
            is_weak_description,
        )
    except Exception:  # pragma: no cover
        def is_weak_description(value: Any) -> bool:  # type: ignore
            return not (isinstance(value, str) and len(value.strip()) >= 40)

        def description_is_richer(  # type: ignore
            new: Any,
            current: Any,
            *,
            new_source: str | None = None,
            current_source: str | None = None,
        ) -> bool:
            return is_weak_description(current) and not is_weak_description(new)

    def _junk_image(url: Any) -> bool:
        if not isinstance(url, str) or not url.strip():
            return True
        low = url.lower().split("?")[0]
        if low.endswith((".ico", ".svg")):
            return True
        return any(
            x in low
            for x in (
                "telegram.org/img",
                "website_icon",
                "/emoji",
                "1x1",
                "pixel.gif",
                "spacer.",
                "favicon",
                "default-favicon",
                "assets.squarespace.com/universal/",
                "/static/images/wix",
            )
        )

    def _junk_email(value: Any) -> bool:
        try:
            from enrich_published_businesses import is_junk_email

            return is_junk_email(str(value or ""))
        except Exception:  # pragma: no cover
            e = str(value or "").lower().strip()
            if not e or "@" not in e:
                return True
            local, _, domain = e.partition("@")
            if local in {"user", "test", "email", "name", "example"}:
                return True
            return domain in {"domain.com", "example.com", "email.com"}

    new_desc_source = str(
        patch.get("_description_source")
        or patch.get("_kind")
        or patch.get("_url_kind")
        or "other"
    ).strip().lower() or "other"

    for k, v in patch.items():
        if k.startswith("_") or v in (None, "", [], {}):
            continue
        cur = found.get(k)
        if k == "description":
            if not isinstance(v, str) or not v.strip():
                continue
            if is_weak_description(v):
                continue
            cur_source = str(found.get("_description_source") or "other").strip().lower()
            if cur in (None, "", [], {}) or description_is_richer(
                v,
                cur,
                new_source=new_desc_source,
                current_source=cur_source,
            ):
                found[k] = v.strip()[:4000]
                found["_description_source"] = new_desc_source
            continue
        if k in ("address", "address_line"):
            # Own website street beats an earlier telegram / source glue line.
            cand = str(v).strip()
            if not cand:
                continue
            try:
                from address_geo import prefer_own_website_street
            except Exception:  # pragma: no cover

                def prefer_own_website_street(existing: Any, website: Any) -> bool:  # type: ignore
                    return not (existing and str(existing).strip())

            cur_s = str(cur).strip() if cur not in (None, "", [], {}) else ""
            kind = new_desc_source
            take = False
            if not cur_s:
                take = True
            elif kind == "website" and prefer_own_website_street(cur_s, cand):
                take = True
            if take:
                found[k] = cand[:160] if k == "address_line" else cand[:200]
                found["_address_source"] = kind
            continue
        if cur in (None, "", [], {}):
            # Never seed found with junk chrome from t.me / telegram.org
            if k == "image_url" and _junk_image(v):
                continue
            if k == "email" and _junk_email(v):
                continue
            if k == "website" and is_platform_saas_host(str(v)):
                book = booking_url_from_maybe_saas(str(v))
                if book and not found.get("booking_url"):
                    found["booking_url"] = book.split("?")[0][:500]
                continue
            found[k] = v
        elif k == "email" and _junk_email(cur) and not _junk_email(v):
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


def _mine_directory_listing(url: str) -> dict[str, Any] | None:
    """Article-body parsers for Svoi / Russian Orange Pages — never page chrome.

    Whole-page scrapes of these WordPress directories pull sidebar advertisers
    (fchconstruction.org, liveattheshell.org, …) into the BFS as «own website».
    Returns None when this URL is not a known directory listing.
    """
    if not is_directory_host(url):
        return None
    host = host_of(url)
    out: dict[str, Any] = {
        "_url": url,
        "_kind": "source",
        "discovered_urls": [],
    }
    try:
        from enrich_svoi_directory import (
            enrich_orange_pages_detail,
            enrich_svoi_page,
            is_orange_pages_junk_website,
        )
    except Exception as exc:  # pragma: no cover
        out["_status"] = "error"
        out["_error"] = f"directory_import:{exc}"[:200]
        return out

    if "russianorangepages" in host or ("orange" in host and "pages" in host):
        detail = enrich_orange_pages_detail({"source_post_urls": [url]})
    elif "svoi.us" in host:
        detail = enrich_svoi_page({"source_post_urls": [url], "phones": [], "websites": []})
    elif "to4ka.us" in host or "api.to4ka" in host:
        try:
            from enrich_to4ka_directory import (
                enrich_to4ka_listing,
                is_to4ka_junk_website,
            )
        except Exception as exc:  # pragma: no cover
            out["_status"] = "error"
            out["_error"] = f"to4ka_import:{exc}"[:200]
            return out
        detail = enrich_to4ka_listing(url)
        # Reuse the svoi/ROP packing path below; junk website filter is to4ka-specific.
        err = detail.get("_svoi_error")
        if err:
            out["_status"] = "fetch_failed"
            out["_error"] = str(err)[:200]
            return out
        out["_status"] = "ok"
        phones = detail.get("phones") or []
        if phones:
            out["phone"] = str(phones[0])[:40]
        if detail.get("description"):
            out["description"] = str(detail["description"])[:4000]
        if detail.get("address_line"):
            out["address"] = str(detail["address_line"])[:200]
            out["address_line"] = str(detail["address_line"])[:160]
        if detail.get("city"):
            out["city"] = str(detail["city"])[:80]
        if detail.get("postal_code"):
            out["postal_code"] = str(detail["postal_code"])[:16]
        for raw in detail.get("websites") or []:
            w = str(raw).strip()
            if not w or is_to4ka_junk_website(w):
                continue
            if can_be_own_website(w):
                _set_website_or_booking(out, w)
                out["discovered_urls"].append(w)
        # Never enqueue related sites from to4ka chrome.
        out["social_links"] = []
        out["discovered_urls"] = list(out.get("discovered_urls") or [])
        return out
    else:
        return None

    err = detail.get("_svoi_error")
    if err:
        out["_status"] = "fetch_failed"
        out["_error"] = str(err)[:200]
        return out

    out["_status"] = "ok"
    phones = detail.get("phones") or []
    if phones:
        out["phone"] = str(phones[0])[:40]
    emails = detail.get("emails") or []
    if emails:
        out["email"] = str(emails[0])[:120]
    if detail.get("description"):
        out["description"] = str(detail["description"])[:4000]
    if detail.get("address_line"):
        out["address"] = str(detail["address_line"])[:200]
        out["address_line"] = str(detail["address_line"])[:160]
    if detail.get("city"):
        out["city"] = str(detail["city"])[:80]
    if detail.get("postal_code"):
        out["postal_code"] = str(detail["postal_code"])[:16]
    if detail.get("cover_image_url"):
        out["image_url"] = str(detail["cover_image_url"])[:500]

    socials: list[str] = []
    for handle in detail.get("instagram") or []:
        h = str(handle).strip().lstrip("@")
        if h:
            ig = f"https://www.instagram.com/{h}"
            out["instagram_url"] = ig
            socials.append(ig)
            break
    if detail.get("instagram_url"):
        ig = str(detail["instagram_url"]).split("?")[0][:300]
        out["instagram_url"] = ig
        if ig not in socials:
            socials.append(ig)
    if detail.get("facebook_url"):
        fb = str(detail["facebook_url"]).split("?")[0][:300]
        out["facebook_url"] = fb
        socials.append(fb)
    if detail.get("yelp_url"):
        yp = str(detail["yelp_url"]).split("?")[0][:300]
        out["yelp_url"] = yp
        socials.append(yp)

    for raw in detail.get("websites") or []:
        w = str(raw).strip()
        if not w:
            continue
        if "russianorangepages" in host and is_orange_pages_junk_website(w):
            continue
        ck = classify_resource(w)
        if ck in ("instagram", "facebook", "yelp", "tiktok"):
            if not is_directory_social(w):
                socials.append(w)
                key = {
                    "instagram": "instagram_url",
                    "facebook": "facebook_url",
                    "yelp": "yelp_url",
                    "tiktok": "tiktok_url",
                }[ck]
                out.setdefault(key, w.split("?")[0][:300])
            continue
        if can_be_own_website(w):
            _set_website_or_booking(out, w)
            out["discovered_urls"].append(w)

    # Dedupe socials / discovered
    seen: set[str] = set()
    uniq_socials: list[str] = []
    for s in socials:
        k = s.strip().lower().rstrip("/")
        if not k or k in seen:
            continue
        seen.add(k)
        uniq_socials.append(s)
    out["social_links"] = uniq_socials
    for s in uniq_socials:
        if s not in out["discovered_urls"]:
            out["discovered_urls"].append(s)
    return out


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

    if kind in ("tiktok", "facebook", "telegram", "youtube"):
        # Contact / profile URL only — never deep-crawl Telegram product chrome
        # (faq/blog/css) or YouTube shells as if they were the shop site.
        out["_status"] = "link_only"
        key = {
            "tiktok": "tiktok_url",
            "facebook": "facebook_url",
            "telegram": "telegram_url",
            "youtube": "youtube_url",
        }[kind]
        clean = url.split("?")[0][:300]
        if key:
            out[key] = clean
        out["social_links"] = [clean]
        return out

    if kind == "trustpilot":
        # Light TrustScore fetch only — never BFS into Trustpilot chrome.
        try:
            from trustpilot_extract import extract_trustpilot_profile

            tp = extract_trustpilot_profile(url)
            for k, v in tp.items():
                if k.startswith("_") and k not in ("_status", "_error", "_url", "_kind"):
                    continue
                out[k] = v
            out["_status"] = tp.get("_status") or out.get("_status")
            if tp.get("_error"):
                out["_error"] = tp["_error"]
            out["trustpilot_url"] = tp.get("trustpilot_url") or url.split("?")[0][:300]
            out["social_links"] = list(
                tp.get("social_links") or [out["trustpilot_url"]]
            )
            out["discovered_urls"] = []
            return out
        except Exception as exc:  # pragma: no cover
            out["_status"] = "error"
            out["_error"] = f"trustpilot:{exc}"[:200]
            out["trustpilot_url"] = url.split("?")[0][:300]
            out["social_links"] = [out["trustpilot_url"]]
            out["discovered_urls"] = []
            return out

    if kind == "yelp":
        try:
            from yelp_extract import extract_yelp_biz_profile

            yelp = extract_yelp_biz_profile(url)
            for k, v in yelp.items():
                if k.startswith("_") and k not in ("_status", "_error", "_url", "_kind"):
                    continue
                out[k] = v
            out["_status"] = yelp.get("_status") or out.get("_status")
            if yelp.get("_error"):
                out["_error"] = yelp["_error"]
            # Always keep the biz URL even when Yelp blocks the body.
            out["yelp_url"] = yelp.get("yelp_url") or url.split("?")[0][:300]
            out["social_links"] = list(yelp.get("social_links") or [out["yelp_url"]])
            if yelp.get("website") and can_be_own_website(str(yelp["website"])):
                out.setdefault("discovered_urls", [])
                if yelp["website"] not in out["discovered_urls"]:
                    out["discovered_urls"].append(str(yelp["website"]))
            return out
        except Exception as exc:  # pragma: no cover
            out["_status"] = "error"
            out["_error"] = f"yelp:{exc}"[:200]
            out["yelp_url"] = url.split("?")[0][:300]
            out["social_links"] = [out["yelp_url"]]
            return out

    if kind == "source":
        # Treat as HTML page (directory / post) — shallow deep fetch still helps
        # discover website links via profile social + JSON-LD.
        pass

    # Directory listings: article body only (never WordPress sidebar blogroll).
    if kind == "source" and is_directory_host(url):
        directory = _mine_directory_listing(url)
        if directory is not None:
            return directory

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
            try:
                from enrich_published_businesses import is_junk_email as _junk_em
            except Exception:  # pragma: no cover
                def _junk_em(value: str) -> bool:
                    return False

            if not _junk_em(email):
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
            low = logo.lower()
            if (
                logo
                and "telegram.org/img" not in low
                and "favicon" not in low
                and "default-favicon" not in low
                and not low.endswith((".ico", ".svg"))
                and "assets.squarespace.com/universal/" not in low
            ):
                out["image_url"] = logo
        street = sanitize_street_line(prof.get("address"))
        if street:
            out["address"] = street
            out["address_line"] = street
        multi = []
        for raw_addr in list(prof.get("addresses") or []):
            cleaned = sanitize_street_line(raw_addr)
            if cleaned and cleaned not in multi:
                multi.append(cleaned)
        if street and street not in multi:
            multi.insert(0, street)
        if multi:
            out["addresses"] = multi[:8]
            if not out.get("address_line"):
                out["address"] = multi[0]
                out["address_line"] = multi[0]
        book = (prof.get("booking_url") or "").strip()
        if book and book.startswith("http"):
            out["booking_url"] = book[:500]
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
        related_raw = [
            s
            for s in (prof.get("related_websites") or [])
            if s
            and not is_junk_url(str(s))
            and not is_directory_host(str(s))
            and not is_shared_non_identity_host(str(s))
            and not is_editorial_url(str(s))
        ]
        # Single policy SoT — never chase blogroll/XFN from the card's own site.
        related = filter_related_websites_for_queue(
            [str(r) for r in related_raw],
            kind=kind,
            page_url=url,
            can_be_own_website=can_be_own_website,
        )
        if kind == "source" and is_directory_host(url):
            # Belt-and-suspenders: directory related_websites must never enter BFS
            # (policy already returns []; specialized parser handles ROP/Svoi).
            related = []
            keep: list[str] = []
            for link in socials:
                ck = classify_resource(str(link))
                if ck in SOCIAL_CONTACT_KINDS and not is_directory_social(
                    str(link)
                ):
                    keep.append(str(link))
            socials = keep
        if is_booking_marketing_page(url):
            # Bare Dikidi / GlossGenius / Booksy landing = vendor chrome, not the salon.
            # Tenant company pages (dikidi.net/1759630) are handled above.
            socials = [
                s
                for s in socials
                if not is_directory_social(str(s))
                and classify_resource(str(s)) in SOCIAL_CONTACT_KINDS
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
        # Own marketing site: never enqueue foreign websites (sidebar / blogroll).
        # Keep socials, booking CTAs, and same-host pages only.
        if kind == "website" and not is_booking_platform_host(url):
            own_host = host_of(url)
            keep_disc: list[str] = []
            for d in discovered:
                ck = classify_resource(str(d))
                if ck in SOCIAL_CONTACT_KINDS:
                    keep_disc.append(str(d))
                    continue
                if ck == "website" and (
                    host_of(str(d)) == own_host or is_booking_platform_host(str(d))
                ):
                    keep_disc.append(str(d))
            discovered = keep_disc
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
        "yelp_rating",
        "yelp_reviews_count",
        "trustpilot_url",
        "trustpilot_rating",
        "trustpilot_reviews_count",
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
    preferred_website: str | None = None,
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

    preferred_website: card.website — only this sidebar-advertiser host may be
    seeded (not Live at the Shell / Art-A-Fair glue alongside FCH).
    """
    mine = mine_fn or mine_resource
    queue, deferred = build_initial_queue(
        source_url=source_url,
        card_urls=card_urls,
        sequential=sequential,
        preferred_website=preferred_website or next(
            (u for u in card_urls if u and classify_resource(u) == "website"),
            None,
        ),
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
        # Prefer the card's own website first when the source died — don't waste
        # the resource budget on secondary socials before the marketing site.
        ordered = list(deferred)
        deferred.clear()
        websites = [u for u in ordered if classify_resource(u) == "website"]
        rest = [u for u in ordered if classify_resource(u) != "website"]
        added = enqueue_seed_urls(queue, visited, queued, websites + rest)
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

    # Show deferred card URLs in the admin UI up front (website / IG / …),
    # so a failed source does not look like «we never looked at the site».
    if sequential and deferred:
        for u in list(deferred):
            nk = classify_resource(u)
            emit(
                {
                    "type": "resource",
                    "url": u,
                    "kind": _resource_kind_label(u, nk),
                    "status": "queued",
                    "detail": "после источника",
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
        merge_patch = {
            kk: vv
            for kk, vv in layer.items()
            if not kk.startswith("_") and kk != "discovered_urls"
        }
        # Keep kind for description richness tie-break (website > source > …).
        merge_patch["_kind"] = kind_label if kind_label != "booking" else kind
        _merge_fill_empty(found, merge_patch)
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
                reason=(
                    "источник недоступен — сайт карточки"
                    if just_did_source
                    and str(layer.get("_status") or "")
                    in ("fetch_failed", "unavailable", "error", "parse_failed")
                    else (
                        "после источника и описания"
                        if just_did_source
                        else "после описания"
                    )
                )
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
            merge_patch = {
                kk: vv
                for kk, vv in layer.items()
                if not kk.startswith("_") and kk != "discovered_urls"
            }
            merge_patch["_kind"] = kind_label if kind_label != "booking" else kind
            _merge_fill_empty(found, merge_patch)
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
