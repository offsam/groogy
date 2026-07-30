#!/usr/bin/env python3
"""Find «Book Now» / booking links on business websites and save booking_url.

Usage:
  python3 scripts/business-enrich/scrape_booking_urls.py --dry-run
  python3 scripts/business-enrich/scrape_booking_urls.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "booking_urls"
OUT.mkdir(parents=True, exist_ok=True)

# Browser-like UA — many Wix / Square / Next sites block custom bots.
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)

BOOK_HOSTS = (
    "calendly.com",
    "cal.com",
    "squareup.com",
    "square.site",
    "book.squareup.com",
    "booksy.com",
    "vagaro.com",
    "fresha.com",
    "setmore.com",
    "acuityscheduling.com",
    "styleseat.com",
    "glossgenius.com",
    "mindbodyonline.com",
    "mindbody.io",
    "book.squareup.com",
    "appointments.square.site",
    "scheduleonce.com",
    "oncehub.com",
    "simplybook.me",
    "bookafy.com",
    "gettimely.com",
    "jane.app",
    "clinicsense.com",
    "thera-link.com",
    "healcode.com",
    "mangomint.com",
    "boulevard.io",
    "zenoti.com",
    "saloniris.com",
    "phorest.com",
    "squire.com",
    "getsquire.com",
    "booker.com",
    "schedulicity.com",
    "genbook.com",
    "appointmentplus.com",
    "youcanbook.me",
    "picktime.com",
    "housecallpro.com",
    "jobber.com",
    "servicetitan.com",
    "tekmetric.com",
    "booking.tekmetric.com",
    # Online ordering — «Заказать онлайн» is the same CTA for food / retail.
    "toasttab.com",
    "order.toasttab.com",
    "chownow.com",
    "slicelife.com",
    "order.online",
    "doordash.com",
    "grubhub.com",
    "ubereats.com",
    "seamless.com",
    "postmates.com",
    "menufy.com",
    "beyondmenu.com",
    "popmenu.com",
    "spoton.com",
    "clover.com",
    "olo.com",
)

# The card's action link: «записаться» for services, «заказать» for food and
# retail. Both land in booking_url, so both belong in one CTA vocabulary.
BOOK_TEXT = re.compile(
    r"^\s*(book\s*now|book\s*online|book\s*an?\s*appointment|"
    r"book\s*appointment|book\s*your\s*(class|service|appointment)|"
    r"schedule\s*(now|online|an?\s*appointment|a\s*visit)?|"
    r"make\s*an?\s*appointment|request\s*an?\s*appointment|"
    r"записаться|запись\s*онлайн|онлайн[\-\s]?запись|"
    r"забронировать|book\s*a\s*(class|session|tour|visit|lesson)|"
    r"reserve\s*now|appointments?|"
    r"order\s*(online|now|here|ahead|food|pickup|takeout|delivery)?|"
    r"online\s*order(?:ing)?|order\s*&\s*pay|"
    r"(?:place|start)\s*(?:your\s*)?order|"
    r"заказать(?:\s*(?:онлайн|сейчас|доставку|еду))?|"
    r"сделать\s*заказ|оформить\s*заказ|"
    r"онлайн[\-\s]?заказ|заказ\s*онлайн)\s*$",
    re.I,
)

# False friends — do NOT use books? (matches "Book" in "Book now").
REJECT_TEXT = re.compile(
    r"bookkeeping|\bbooks\b|get\s*started|sign\s*up|log\s*in|our\s*schedule|"
    r"class\s*schedule|weekly\s*schedule|daily\s*schedule|view\s*schedule",
    re.I,
)

REJECT_HREF = re.compile(
    r"bookkeeping|/books(?:/|$)|eventbrite\.com/.*/signin|eventbrite\.com/signin|"
    r"/login|/signup|/cart|facebook\.com|instagram\.com",
    re.I,
)

BOOK_HREF_HINT = re.compile(
    r"(book|booking|appoint|schedule|calendly|acuity|vagaro|fresha|"
    r"booksy|setmore|styleseat|glossgenius|mindbody|reserve|tekmetric|"
    r"mangomint|squire|запис|"
    r"order|ordering|заказ|toasttab|chownow|slicelife|doordash|grubhub|"
    r"ubereats|menufy|beyondmenu|popmenu|clover|olo)",
    re.I,
)

SKIP_HOST_PARTS = (
    "instagram.com",
    "facebook.com",
    "fb.com",
    "t.me",
    "telegram.me",
    "yelp.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "youtu.be",
    "linkedin.com",
    "tiktok.com",
    "maps.google",
    "maps.app.goo.gl",
    "maps.apple",
    "goo.gl",
    "share.google",
    "bit.ly",
    "etsy.com",
    "airbnb.com",
    "eventbrite.com",
)

# Absolute booking URLs embedded in HTML / JSON / scripts.
PROVIDER_URL_RE = re.compile(
    r"https?://(?:www\.)?(?:"
    r"booking\.mangomint\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"mangomint\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"getsquire\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"book\.squareup\.com/appointments/[A-Za-z0-9_\-/]+|"
    r"squareup\.com/appointments/[A-Za-z0-9_\-/]+|"
    r"vagaro\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"calendly\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"fresha\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"booksy\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"styleseat\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"glossgenius\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"acuityscheduling\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"setmore\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"mindbodyonline\.com/[A-Za-z0-9_\-/?=&%.]+|"
    r"boulevard\.io/[A-Za-z0-9_\-/?=&%.]+|"
    r"simplybook\.me/[A-Za-z0-9_\-/?=&%.]+|"
    r"housecallpro\.com/[A-Za-z0-9_\-/?=&%.]+"
    r")",
    re.I,
)

# Escaped JSON variants: https:\/\/book.squareup.com\/appointments\/TOKEN
SQUARE_ESC_RE = re.compile(
    r"https:\\?/\\?/book\.squareup\.com\\?/appointments\\?/([A-Za-z0-9_\-/]+)",
    re.I,
)
SQUARE_LOC_RE = re.compile(
    r'"squareAppointment"\s*:\s*\{[^}]*"locationId"\s*:\s*"([A-Za-z0-9_\-]+)"',
    re.I,
)
TEKMETRIC_ID_RE = re.compile(
    r"bookingId\s*=\s*['\"]([0-9a-f\-]{20,})['\"]|"
    r"booking\.tekmetric\.com",
    re.I,
)
WIX_BOOK_PAGE_RE = re.compile(
    r'"title"\s*:\s*"(Book(?:ing)?(?:\s+Now|\s+Online|\s+Form|\s+Calendar)?|'
    r"Schedule\s+an?\s+Appointment|Appointments?)"
    r'"[^}]{0,220}"pageUriSEO"\s*:\s*"([^"]+)"',
    re.I,
)
HREF_ATTR_RE = re.compile(
    r"""(?:href|data-href|data-url)\s*=\s*["']([^"']+)["']""",
    re.I,
)


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text_parts: list[str] = []
        self._in_a = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = None
        for k, v in attrs:
            if k.lower() == "href" and v:
                href = v.strip()
                break
        if not href or href.startswith(("javascript:", "mailto:", "tel:")):
            return
        # Keep in-page anchors — scored later; skip empty.
        if href == "#":
            return
        self._href = href
        self._text_parts = []
        self._in_a = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._in_a and self._href:
            text = re.sub(r"\s+", " ", "".join(self._text_parts)).strip()
            self.links.append((self._href, text))
            self._href = None
            self._in_a = False

    def handle_data(self, data: str) -> None:
        if self._in_a:
            self._text_parts.append(data)


def is_real_website(url: str | None) -> bool:
    if not url or not str(url).strip():
        return False
    try:
        host = (urlparse(normalize(url)).hostname or "").lower().removeprefix("www.")
    except Exception:
        return False
    if not host:
        return False
    return not any(h in host for h in SKIP_HOST_PARTS)


def normalize(url: str) -> str:
    u = url.strip()
    if not u.startswith("http"):
        u = "https://" + u
    return u


def unescape_url(u: str) -> str:
    return (
        u.replace("\\/", "/")
        .replace("\\u002F", "/")
        .replace("&amp;", "&")
        .rstrip(".,);]}'\"")
    )


def fetch_html(url: str) -> str | None:
    req = Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=25, context=ssl.create_default_context()) as resp:
            raw = resp.read(2_000_000)
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if "html" not in ctype and not raw[:200].lstrip().lower().startswith(
                (b"<!doctype", b"<html")
            ):
                # Still accept large Next/Wix payloads labeled oddly
                if len(raw) < 500:
                    return None
            for enc in ("utf-8", "latin-1"):
                try:
                    return raw.decode(enc)
                except UnicodeDecodeError:
                    continue
            return raw.decode("utf-8", errors="ignore")
    except Exception:
        return None


def score_candidate(abs_url: str, text: str, page_host: str) -> int:
    try:
        host = (urlparse(abs_url).hostname or "").lower().removeprefix("www.")
    except Exception:
        return -1
    if not host or any(h in host for h in SKIP_HOST_PARTS):
        return -1
    if REJECT_HREF.search(abs_url) or REJECT_TEXT.search(text or ""):
        return -1

    path = (urlparse(abs_url).path or "").lower()
    # Reject bare "#" and empty paths that only equal homepage unless book host
    score = 0
    if BOOK_TEXT.match(text or ""):
        score += 50
    elif BOOK_TEXT.search(text or ""):
        score += 30
    if BOOK_HREF_HINT.search(abs_url):
        score += 20
    if any(h in host for h in BOOK_HOSTS):
        score += 50
    if host == page_host or host.endswith("." + page_host):
        score += 10
    if re.search(
        r"/book(?:-online|-now|/|$)|/booking|/appoint|/schedule-an|/reserve",
        abs_url,
        re.I,
    ):
        score += 30
    # Own ordering page beats an aggregator listed in the footer.
    if re.search(
        r"/order(?:-online|-now|-ahead|/|$)|/online-order(?:ing)?|/ordering(?:/|$)",
        abs_url,
        re.I,
    ):
        score += 30
    if re.search(r"/schedule(?:/|$)", abs_url, re.I) and not BOOK_TEXT.match(text or ""):
        score -= 25
    # Prefer dedicated booking paths over homepage (unless explicit Book Now text)
    if path in ("", "/") and not any(h in host for h in BOOK_HOSTS):
        if not BOOK_TEXT.match(text or ""):
            score -= 20
    # Same-site bare homepage is not a booking deep-link (e.g. "BOOK A TOUR" → /)
    frag = (urlparse(abs_url).fragment or "").lower()
    if (
        (host == page_host or host.endswith("." + page_host))
        and path in ("", "/")
        and not frag
        and not page_host.endswith("square.site")
    ):
        score -= 100
    # Hash-only same-page booking anchors (#booking) are still useful CTAs
    if frag.startswith("book") or frag == "booking":
        score += 25
    # Explicit Book Now CTA to a same-site section hash
    if BOOK_TEXT.match(text or "") and (host == page_host or host.endswith("." + page_host)) and frag:
        score = max(score, 60)
    return score


def _consider(
    best: tuple[int, str, str, str] | None,
    score: int,
    url: str,
    text: str,
    reason: str,
) -> tuple[int, str, str, str] | None:
    if score < 55:
        return best
    if best is None or score > best[0]:
        return (score, url, text, reason)
    return best


def extract_booking_url(page_url: str, html: str) -> dict[str, Any] | None:
    base = normalize(page_url)
    try:
        page_host = (urlparse(base).hostname or "").lower().removeprefix("www.")
    except Exception:
        return None

    best: tuple[int, str, str, str] | None = None

    # 1) Known provider URLs anywhere in the document (incl. JSON / scripts)
    for m in PROVIDER_URL_RE.finditer(html):
        url = unescape_url(m.group(0))
        # Prefer shop root for Vagaro over random deal deep-links
        if "vagaro.com" in url.lower():
            parts = urlparse(url)
            segs = [s for s in parts.path.split("/") if s]
            if segs:
                url = f"{parts.scheme}://{parts.netloc}/{segs[0]}"
        best = _consider(best, 140, url, "(provider url)", "provider_url")

    for m in SQUARE_ESC_RE.finditer(html):
        token = unescape_url(m.group(1))
        url = f"https://book.squareup.com/appointments/{token}"
        sc = 145
        if "/location/" in token:
            sc = 155
        best = _consider(best, sc, url, "(squareup appointments)", "square_book")

    for m in SQUARE_LOC_RE.finditer(html):
        loc = m.group(1)
        url = f"https://book.squareup.com/appointments/{loc}"
        best = _consider(best, 130, url, "(squareAppointment locationId)", "square_location")

    # Prefer dedicated Wix booking pages over forms/calendars.
    WIX_URI_SCORE = {
        "book-online": 135,
        "book-now": 130,
        "booking-calendar": 122,
        "booking-form": 115,
        "appointments": 128,
    }

    # 2) Wix Book Online / Book Now page URIs
    for m in WIX_BOOK_PAGE_RE.finditer(html):
        title, uri = m.group(1), m.group(2)
        uri_l = uri.lower().strip("/")
        if re.search(r"popup-|daily-schedule|class", uri_l, re.I):
            continue
        if not re.search(r"book|appoint", uri_l, re.I):
            continue
        url = urljoin(base.rstrip("/") + "/", uri.lstrip("/"))
        sc = WIX_URI_SCORE.get(uri_l, 120)
        best = _consider(best, sc, url, title, "wix_book_page")

    # 3) Tekmetric (shop modal) → same-site #booking CTA
    if TEKMETRIC_ID_RE.search(html):
        url = urljoin(base, "/#booking")
        best = _consider(best, 100, url, "Tekmetric Book Now", "tekmetric_anchor")

    # 4) Classic <a href> links
    parser = LinkParser()
    try:
        parser.feed(html)
    except Exception:
        parser.links = []

    def resolve_href(href: str) -> str:
        abs_url = urljoin(base, href)
        # Preserve meaningful in-page anchors (booking sections / CTA targets)
        if href.startswith("#") or re.search(r"#.+$", href):
            return abs_url
        return abs_url.split("#")[0]

    for href, text in parser.links:
        abs_url = resolve_href(href)
        sc = score_candidate(abs_url, text, page_host)
        best = _consider(best, sc, abs_url, text, "link_match")

    # 5) href attributes whose nearby context isn't available — score by URL alone
    for href in HREF_ATTR_RE.findall(html):
        if not BOOK_HREF_HINT.search(href) and not any(
            h in href.lower() for h in ("book", "appoint", "vagaro", "calendly")
        ):
            continue
        abs_url = resolve_href(href)
        sc = score_candidate(abs_url, "", page_host)
        best = _consider(best, sc, abs_url, "(href)", "href_hint")

    # 6) Square Online site whose homepage IS the storefront / order flow
    if page_host.endswith("square.site") and best is None:
        best = _consider(best, 70, base.rstrip("/") + "/", "(square.site home)", "square_site_home")

    if not best:
        return None
    return {
        "url": best[1],
        "text": best[2],
        "score": best[0],
        "reason": best[3],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    if not args.apply and not args.dry_run:
        args.dry_run = True

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    sb = SupabaseRest(url, key)

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            sb._request(
                "GET",
                "/businesses",
                params={
                    "select": "id,slug,name,website,booking_url,status",
                    "status": "eq.approved",
                    "website": "not.is.null",
                    "order": "id.asc",
                    "offset": str(offset),
                    "limit": "200",
                },
            )
            or []
        )
        rows.extend(batch)
        if len(batch) < 200:
            break
        offset += 200

    candidates = [r for r in rows if is_real_website(r.get("website"))]
    if args.limit:
        candidates = candidates[: args.limit]

    report: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry_run",
        "scanned": len(candidates),
        "found": [],
        "skipped": [],
        "errors": [],
        "unchanged": [],
    }

    for r in candidates:
        website = normalize(r["website"])
        existing = (r.get("booking_url") or "").strip()
        print(f"… {r['name'][:40]:40} {website[:60]}")
        html = fetch_html(website)
        time.sleep(0.5)
        if not html:
            report["errors"].append(
                {"slug": r["slug"], "website": website, "error": "fetch_failed"}
            )
            print("  ✗ fetch_failed")
            continue
        hit = extract_booking_url(website, html)
        if not hit:
            report["skipped"].append({"slug": r["slug"], "name": r["name"], "website": website})
            print("  · no booking link")
            continue
        item = {
            "id": r["id"],
            "slug": r["slug"],
            "name": r["name"],
            "website": website,
            "booking_url": hit["url"],
            "link_text": hit.get("text"),
            "score": hit.get("score"),
            "reason": hit.get("reason"),
            "had_existing": existing or None,
        }
        report["found"].append(item)
        print(
            f"  → {hit['url'][:90]}  ({hit.get('text')!r}, score={hit.get('score')}, {hit.get('reason')})"
        )
        if existing == hit["url"]:
            report["unchanged"].append(item["slug"])
            continue
        if args.apply:
            sb.patch(
                "businesses",
                {"id": f"eq.{r['id']}"},
                {"booking_url": hit["url"]},
            )

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
                "found": len(report["found"]),
                "skipped": len(report["skipped"]),
                "errors": len(report["errors"]),
                "unchanged": len(report["unchanged"]),
            },
            indent=2,
        )
    )
    print("report", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
