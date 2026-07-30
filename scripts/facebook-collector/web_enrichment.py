"""Website + Instagram enrichment (supplement-only).

Fills EMPTY entity fields after classification. Never overwrites post-derived
data. Sources tagged as `website` / `instagram`. Failures never abort import.
"""

from __future__ import annotations

import html as html_lib
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any

SOURCE_WEBSITE = "website"
SOURCE_INSTAGRAM = "instagram"

USER_AGENT = (
    "Mozilla/5.0 (compatible; KrugiEnrichBot/1.0; +https://krugi.app/bot)"
)
TIMEOUT = 10
MAX_HTML = 700_000

PHONE_RE = re.compile(
    r"(?:\+?\d{1,3}[\s\-.]?)?(?:\(?\d{2,4}\)?[\s\-.]?)?\d{3}[\s\-.]?\d{2,4}[\s\-.]?\d{2,4}"
)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
IG_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?instagram\.com/([A-Za-z0-9._]{2,30})", re.I
)
FB_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:facebook|fb)\.com/[A-Za-z0-9._/\-?=]+", re.I
)
YELP_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?yelp\.com/[A-Za-z0-9._/\-?=]+", re.I
)
TIKTOK_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com)/[A-Za-z0-9._/@\-?=]+",
    re.I,
)
HOURS_HINT_RE = re.compile(
    r"(hours|открыт|работаем|пн|вт|ср|чт|пт|сб|вс|mon|tue|wed|thu|fri|sat|sun|"
    r"\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2})",
    re.I,
)
# A line that actually pairs a day name with a time range — used to confirm a
# hours-hint match is really hours, not just a stray weekday word.
DAY_TIME_LINE_RE = re.compile(
    r"(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)"
    r"[^\n]{0,60}?\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*[-–—to]{1,3}\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?",
    re.I,
)
HOURS_SECTION_HEADING_RE = re.compile(
    r"^(hours|business\s*hours|store\s*hours|opening\s*hours|working\s*hours|"
    r"часы\s*работы|режим\s*работы|мы\s*работаем)\b",
    re.I,
)
# US street-address shape: house number + street name + a common suffix.
# NOTE: longer alternatives (Drive/Street/...) must come before their
# abbreviations (Dr/St/...) — regex alternation matches the first
# alternative that fits at a position, not the longest, so "Dr|Drive" would
# match "Dr" and stop mid-word inside "Drive".
ADDRESS_LINE_RE = re.compile(
    r"\b\d{1,6}\s+[A-Za-z0-9.'\-]+(?:\s+[A-Za-z0-9.'\-]+){0,4}\s+"
    r"(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|"
    r"Parkway|Pkwy|Court|Ct|Place|Pl|Highway|Hwy|Circle|Cir|Terrace|Ter)\.?"
    r"(?:\s*,?\s*(?:Suite|Ste|Unit|#)\s*[A-Za-z0-9\-]+)?"
    r"(?:,\s*[A-Za-z .'\-]+)?(?:,\s*[A-Z]{2})?(?:\s*\d{5}(?:-\d{4})?)?",
    re.I,
)
CONTACT_PATHS = (
    "",
    "/payment",
    "/payments",
    "/tickets",
    "/contact",
    "/contact-us",
    "/contactus",
    "/hours",
    "/about",
    "/about-us",
    "/location",
    "/locations",
    "/visit",
    "/services",
    "/our-services",
    "/menu",
    "/pricing",
    "/prices",
    "/book",
    "/booking",
    "/gallery",
    "/portfolio",
    "/team",
    "/faq",
)

# Same-host paths we never enqueue during deep crawl.
_SKIP_INTERNAL_PATH_RE = re.compile(
    r"(?i)/(?:wp-admin|wp-login|cart|checkout|account|login|signup|cdn-cgi|"
    r"privacy|terms|cookie|wp-json|feed|xmlrpc)(?:/|$)"
    r"|\.(?:pdf|jpe?g|png|gif|webp|svg|css|js|zip|mp4|ico)(?:\?|$)"
)

_PRIORITY_PATH_RE = re.compile(
    r"(?i)/(?:service|services|about|contact|book|booking|price|pricing|"
    r"payment|payments|ticket|tickets|menu|gallery|portfolio|team|faq|hours|location)",
)

PAYMENT_METHOD_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bpay\s*pal\b|\bpaypal\b|пейпал", re.I), "PayPal"),
    (re.compile(r"\bvenmo\b|\bveneno\b|в[еэ]нмо|вемо", re.I), "Venmo"),
    (re.compile(r"\bzell(?:e)?\b|з[еэ]лл", re.I), "Zelle"),
    (re.compile(r"\bcash\s*(?:app|up)\b|\bcashapp\b", re.I), "Cash App"),
    (re.compile(r"\bapple\s*pay\b", re.I), "Apple Pay"),
    (re.compile(r"\bgoogle\s*pay\b|\bg\s*pay\b", re.I), "Google Pay"),
]
PAYMENT_CONTEXT_RE = re.compile(
    r"\b(?:payment|payments|pay\s+with|accepted|checkout|оплат\w*|способ\w*\s+оплат\w*)\b",
    re.I,
)
PAYMENT_CONTEXT_METHOD_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"\b(?:credit\s*)?cards?\b|\bvisa\b|\bmastercard\b|карт(?:а|ой|ы|у)", re.I),
        "Карта",
    ),
        (
            re.compile(
                r"\bcash\b(?!\s*(?:app|up))|наличн\w*|\bк[еэ]ш\b",
                re.I,
            ),
            "Cash",
        ),
    (re.compile(r"\bcheck\b|\bcheque\b|\bчек\b", re.I), "Check"),
]


class _HomeParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title: str | None = None
        self.meta: dict[str, str] = {}
        self.links: list[str] = []
        self.logo: str | None = None
        self._in_title = False
        self._json_ld: list[Any] = []
        self._capture_ld = False
        self._ld_chunks: list[str] = []
        self._in_address = False
        self._address_chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        ad = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            key = (ad.get("property") or ad.get("name") or "").lower()
            content = (ad.get("content") or "").strip()
            if key and content and key not in self.meta:
                self.meta[key] = content
        if tag == "link":
            href = ad.get("href") or ""
            rel = (ad.get("rel") or "").lower()
            if href:
                self.links.append(href)
                if not self.logo and any(x in rel for x in ("icon", "apple-touch-icon")):
                    self.logo = href
        if tag == "a":
            href = ad.get("href") or ""
            if href:
                self.links.append(href)
        if tag == "img":
            src = ad.get("src") or ""
            alt = (ad.get("alt") or "").lower()
            cls = (ad.get("class") or "").lower()
            if src and ("logo" in alt or "logo" in cls or "logo" in src.lower()):
                if not self.logo or "logo" in src.lower():
                    self.logo = src
        if tag == "script" and "ld+json" in (ad.get("type") or "").lower():
            self._capture_ld = True
            self._ld_chunks = []
        if tag == "address":
            self._in_address = True
            self._address_chunks.append("")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag == "address":
            self._in_address = False
        if tag == "script" and self._capture_ld:
            self._capture_ld = False
            raw = "".join(self._ld_chunks).strip()
            if raw:
                try:
                    data = json.loads(raw)
                    if isinstance(data, list):
                        self._json_ld.extend(data)
                    else:
                        self._json_ld.append(data)
                except Exception:
                    pass

    def handle_data(self, data: str) -> None:
        if self._in_title and not self.title:
            t = data.strip()
            if t:
                self.title = t
        if self._capture_ld:
            self._ld_chunks.append(data)
        if self._in_address and self._address_chunks:
            self._address_chunks[-1] += data

    @property
    def address_tag_text(self) -> str | None:
        for chunk in self._address_chunks:
            t = re.sub(r"\s+", " ", chunk).strip(" ,")
            if t and len(t) >= 8:
                return t
        return None


def _http_get_text(url: str) -> str | None:
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(MAX_HTML + 1)
            if len(raw) > MAX_HTML:
                raw = raw[:MAX_HTML]
            return raw.decode("utf-8", errors="ignore")
    except Exception:
        return None


def _abs(base: str, href: str | None) -> str | None:
    if not href:
        return None
    href = href.strip()
    if not href or href.startswith("data:"):
        return None
    return urllib.parse.urljoin(base, href)


def _normalize_website(url: str) -> str | None:
    u = (url or "").strip()
    if not u:
        return None
    if u.startswith("@"):
        return None
    if "instagram.com" in u.lower() or "facebook.com" in u.lower():
        return None
    if "://" not in u:
        u = "https://" + u
    try:
        parsed = urllib.parse.urlparse(u)
    except ValueError:
        return None
    if not parsed.netloc or "." not in parsed.netloc:
        return None
    return u


def _ig_username(raw: str) -> str | None:
    value = (raw or "").strip().lstrip("@")
    if not value:
        return None
    m = IG_URL_RE.search(value)
    if m:
        value = m.group(1)
    value = value.split("?")[0].strip("/")
    if value.lower() in {"p", "reel", "reels", "stories", "explore"}:
        return None
    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", value):
        return None
    return value


def _visible_text(html: str) -> str:
    """Strip script/style/tags to plain text, one visible chunk per line."""
    text = html_lib.unescape(re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I))
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text


def extract_payment_methods(text_or_html: str) -> list[str]:
    """Extract canonical payment methods from visible resource content."""
    text = _visible_text(text_or_html) if "<" in text_or_html else text_or_html
    compact = re.sub(r"\s+", " ", text)
    found: list[str] = []
    for pattern, label in PAYMENT_METHOD_PATTERNS:
        if pattern.search(compact):
            found.append(label)

    # Generic Cash/Card/Check need nearby payment language to avoid treating
    # unrelated page copy as an accepted payment method.
    context_chunks = [
        compact[max(0, m.start() - 120) : min(len(compact), m.end() + 240)]
        for m in PAYMENT_CONTEXT_RE.finditer(compact)
    ]
    context = "\n".join(context_chunks)
    if context:
        for pattern, label in PAYMENT_CONTEXT_METHOD_PATTERNS:
            if pattern.search(context) and label not in found:
                found.append(label)
    return found


_DAY_ONLY_RE = re.compile(
    r"^(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)\.?:?$",
    re.I,
)
_TIME_ONLY_RE = re.compile(
    r"\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*[-–—to]{1,3}\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?"
)


def _merge_day_time_lines(lines: list[str]) -> list[str]:
    """Table/grid-layout hours render day and time as separate lines
    ("Mon" / "9:00 am – 5:00 pm" as two <div>s) — tag-stripping turns each
    into its own line, so a day name and its time range never land in the
    same chunk for the downstream parser. Recombine adjacent day-only +
    time-only line pairs before handing the blob off.
    """
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if (
            _DAY_ONLY_RE.match(line)
            and i + 1 < len(lines)
            and _TIME_ONLY_RE.search(lines[i + 1])
            and not _DAY_ONLY_RE.match(lines[i + 1])
        ):
            out.append(f"{line} {lines[i + 1]}")
            i += 2
            continue
        out.append(line)
        i += 1
    return out


def extract_hours_text(html: str) -> str | None:
    """Find an hours blob in visible page text (not just JSON-LD).

    Most small-business sites (Squarespace/Wix/plain HTML) render hours as
    plain text in a footer or a "Hours" section rather than structured
    OpeningHoursSpecification markup — this is why hours previously stayed
    empty even when the JSON-LD scan found nothing. Root-caused: HOURS_HINT_RE
    existed in this file but was never actually applied to anything.
    """
    lines = [ln.strip() for ln in _visible_text(html).splitlines() if ln.strip()]
    # 1) A labeled "Hours" section — grab the heading + next few lines,
    # recombining day/time pairs that a grid layout split across lines.
    for i, ln in enumerate(lines):
        if HOURS_SECTION_HEADING_RE.search(ln):
            window = _merge_day_time_lines(lines[i : i + 16])
            blob = "; ".join(window)
            if DAY_TIME_LINE_RE.search(blob) or HOURS_HINT_RE.search(blob):
                return blob[:600]
    # 2) No heading found — recombine the whole page then fall back to any
    # line(s) that directly pair a day name with a time range.
    merged = _merge_day_time_lines(lines)
    matches = [ln for ln in merged if DAY_TIME_LINE_RE.search(ln)]
    if matches:
        return "; ".join(matches[:10])[:600]
    return None


def extract_address_text(html: str, address_tag_text: str | None) -> str | None:
    """Find a street address in visible text when JSON-LD has none."""
    if address_tag_text and ADDRESS_LINE_RE.search(address_tag_text):
        return address_tag_text[:200]
    lines = [ln.strip() for ln in _visible_text(html).splitlines() if ln.strip()]
    for ln in lines:
        m = ADDRESS_LINE_RE.search(ln)
        if m:
            return m.group(0).strip()[:200]
    return None


def extract_website_profile(url: str) -> dict[str, Any]:
    """Fetch homepage and extract public business signals."""
    out: dict[str, Any] = {"source": SOURCE_WEBSITE, "url": url, "status": "unavailable"}
    norm = _normalize_website(url)
    if not norm:
        out["error"] = "bad_url"
        return out
    out["url"] = norm
    html = _http_get_text(norm)
    if not html:
        out["error"] = "fetch_failed"
        return out

    parser = _HomeParser()
    try:
        parser.feed(html)
    except Exception:
        out["error"] = "parse_failed"
        return out

    # Meta / title
    name = (
        parser.meta.get("og:site_name")
        or parser.meta.get("og:title")
        or parser.title
    )
    description = (
        parser.meta.get("og:description")
        or parser.meta.get("description")
        or parser.meta.get("twitter:description")
    )
    logo = _abs(
        norm,
        parser.meta.get("og:image")
        or parser.logo
        or parser.meta.get("twitter:image"),
    )

    phones: list[str] = []
    emails: list[str] = []
    address: str | None = None
    hours: str | None = None
    social: list[str] = []
    service_offers: list[dict[str, Any]] = []

    def _walk_json_ld(node: Any) -> None:
        if isinstance(node, list):
            for it in node:
                _walk_json_ld(it)
            return
        if not isinstance(node, dict):
            return
        # Always mine Service/Offer catalogs (ItemList on booking sites, etc.)
        service_offers.extend(_service_offers_from_json_ld(node))
        if isinstance(node.get("@graph"), list):
            for it in node["@graph"]:
                _walk_json_ld(it)

        types = node.get("@type")
        type_l = (
            " ".join(types) if isinstance(types, list) else str(types or "")
        ).lower()
        nonlocal name, description, address, hours
        if not any(
            t in type_l
            for t in ("localbusiness", "organization", "store", "professional")
        ) and not node.get("telephone"):
            # still allow generic Organization-like
            if not node.get("name") and not node.get("email"):
                return
        if not name and node.get("name"):
            name = str(node["name"]).strip()
        if not description and node.get("description"):
            description = str(node["description"]).strip()
        tel = node.get("telephone") or node.get("phone")
        if tel:
            phones.extend(_as_list(tel))
        em = node.get("email")
        if em:
            emails.extend(_as_list(em))
        addr = node.get("address")
        if isinstance(addr, dict):
            parts = [
                addr.get("streetAddress"),
                addr.get("addressLocality"),
                addr.get("addressRegion"),
                addr.get("postalCode"),
            ]
            joined = ", ".join(str(p) for p in parts if p)
            if joined:
                address = joined
        elif isinstance(addr, str) and addr.strip():
            address = addr.strip()
        oh = node.get("openingHours") or node.get("openingHoursSpecification")
        if isinstance(oh, str):
            hours = oh
        elif isinstance(oh, list) and oh:
            hours = "; ".join(str(x) for x in oh[:8])

    # JSON-LD LocalBusiness / Organization + any Service ItemLists
    for block in parser._json_ld:
        _walk_json_ld(block)
    # Regex fallbacks on visible HTML (mailto / tel / plain)
    for m in re.finditer(r"mailto:([^\"'\s>]+)", html, re.I):
        emails.append(urllib.parse.unquote(m.group(1)))
    for m in re.finditer(r"tel:([^\"'\s>]+)", html, re.I):
        phones.append(urllib.parse.unquote(m.group(1)))
    for m in EMAIL_RE.finditer(html):
        emails.append(m.group(0))
    # Conservative phone harvest from meta/JSON only already done; add a few
    # from visible body text. Previously capped to html[:8000], which for a
    # typical page is still <head>/nav — a footer phone number never got
    # scanned. Now scans the full cleaned visible text (page is already
    # capped at MAX_HTML on fetch, so this stays bounded).
    for m in PHONE_RE.finditer(_visible_text(html)):
        candidate = re.sub(r"[^\d+]", "", m.group(0))
        if 10 <= len(candidate) <= 15:
            phones.append(m.group(0).strip())

    # Hours: JSON-LD found nothing above — try visible page text.
    if not hours:
        hours = extract_hours_text(html)

    # Address: JSON-LD found nothing above — try an <address> tag, then
    # a plain-text street-address pattern anywhere on the page.
    if not address:
        address = extract_address_text(html, parser.address_tag_text)

    for href in parser.links:
        abs_u = _abs(norm, href) or href
        if IG_URL_RE.search(abs_u):
            social.append(abs_u.split("?")[0])
        if FB_URL_RE.search(abs_u) and "/groups/" not in abs_u.lower():
            social.append(abs_u.split("?")[0])
        if YELP_URL_RE.search(abs_u):
            social.append(abs_u.split("?")[0])
        if TIKTOK_URL_RE.search(abs_u):
            social.append(abs_u.split("?")[0])

    # Hours snippet from meta
    for key, val in parser.meta.items():
        if "hour" in key and val and not hours:
            hours = val

    internal = _same_host_internal_links(norm, parser.links)
    related = _related_external_websites(norm, parser.links)
    offers = _merge_service_offers(service_offers)[:20]
    payment_methods = extract_payment_methods(html)

    out.update(
        {
            "status": "ok",
            "name": _clean_title(name),
            "description": (description or "").strip()[:800] or None,
            "phone": _uniq(_normalize_phones(phones))[:5],
            "email": _uniq([e.lower() for e in emails if "@" in e])[:5],
            "address": address,
            "hours": hours,
            "logo": logo,
            "social_links": _uniq(social)[:15],
            "services": [o["title"] for o in offers if o.get("title")],
            "service_offers": offers,
            "payment_methods": payment_methods,
            "internal_links": internal[:40],
            "related_websites": related[:15],
        }
    )
    return out


def _same_host_internal_links(base: str, hrefs: list[str]) -> list[str]:
    """Same-host HTML pages worth enqueueing for deep crawl (BFS)."""
    parsed_base = urllib.parse.urlparse(base)
    host = (parsed_base.hostname or "").lower().removeprefix("www.")
    if not host:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for href in hrefs:
        abs_u = _abs(base, href)
        if not abs_u:
            continue
        abs_u = abs_u.split("#")[0].split("?")[0]
        try:
            p = urllib.parse.urlparse(abs_u)
        except Exception:
            continue
        h = (p.hostname or "").lower().removeprefix("www.")
        if h != host:
            continue
        path = p.path or "/"
        if _SKIP_INTERNAL_PATH_RE.search(path):
            continue
        key = abs_u.rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(abs_u)
    # Prefer contact/services-ish paths first
    out.sort(key=lambda u: (0 if _PRIORITY_PATH_RE.search(u) else 1, u))
    return out


_RELATED_SITE_SKIP_HOSTS = (
    "instagram.com",
    "instagr.am",
    "facebook.com",
    "fb.com",
    "fb.me",
    "tiktok.com",
    "youtube.com",
    "youtu.be",
    "twitter.com",
    "x.com",
    "linkedin.com",
    "pinterest.com",
    "pin.it",
    "wa.me",
    "whatsapp.com",
    "t.me",
    "telegram.me",
    "telegram.org",
    "schema.org",
    "w3.org",
    "google.com",
    "googleapis.com",
    "gstatic.com",
    "googletagmanager.com",
    "cookiebot.com",
    "cdn.",
    "static.",
    "fonts.",
    "glossgenius.com",  # booking chrome — follow artist subdomain separately
    "squareup.com",
    "square.site",
    "calendly.com",
    "booksy.com",
    "vagaro.com",
    "gumroad.com",
)


def _related_external_websites(base: str, hrefs: list[str]) -> list[str]:
    """Other sites linked from the page (e.g. Framer from GlossGenius)."""
    parsed_base = urllib.parse.urlparse(base)
    base_host = (parsed_base.hostname or "").lower().removeprefix("www.")
    # Parent platform host (vitaliia.glossgenius.com → glossgenius.com)
    parent = ".".join(base_host.split(".")[-2:]) if base_host.count(".") >= 1 else base_host
    out: list[str] = []
    seen: set[str] = set()
    for href in hrefs:
        abs_u = _abs(base, href)
        if not abs_u or not abs_u.startswith("http"):
            continue
        abs_u = abs_u.split("#")[0].split("?")[0]
        try:
            p = urllib.parse.urlparse(abs_u)
        except Exception:
            continue
        h = (p.hostname or "").lower().removeprefix("www.")
        if not h or h == base_host:
            continue
        if h == parent or h.endswith("." + parent):
            continue
        if any(s in h for s in _RELATED_SITE_SKIP_HOSTS):
            continue
        if _SKIP_INTERNAL_PATH_RE.search(p.path or "/"):
            continue
        key = abs_u.rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(abs_u)
    # Prefer personal-site TLDs / builders first
    def _prio(u: str) -> int:
        low = u.lower()
        if any(x in low for x in ("framer.website", "wixsite.com", "webflow.io", "carrd.co")):
            return 0
        return 1

    out.sort(key=_prio)
    return out


def website_profile_gaps(profile: dict[str, Any] | None) -> list[str]:
    """Fields still missing from a merged website profile (stop when empty)."""
    if not profile or profile.get("status") != "ok":
        return ["fetch"]
    gaps: list[str] = []
    if not profile.get("phone"):
        gaps.append("phone")
    if not profile.get("email"):
        gaps.append("email")
    if not profile.get("address"):
        gaps.append("address")
    if not profile.get("hours"):
        gaps.append("hours")
    if not profile.get("services"):
        gaps.append("services")
    if not profile.get("payment_methods"):
        gaps.append("payment_methods")
    desc = (profile.get("description") or "").strip()
    if len(desc) < 40:
        gaps.append("description")
    if not (profile.get("logo") or "").strip():
        gaps.append("logo")
    social = " ".join(str(s).lower() for s in (profile.get("social_links") or []))
    if "instagram.com" not in social and "instagr.am" not in social:
        gaps.append("instagram")
    return gaps


def extract_website_profile_deep(
    url: str,
    *,
    max_pages: int = 10,
    on_page: Any | None = None,
) -> dict[str, Any]:
    """BFS crawl of same-host pages until card gaps are filled or budget ends.

    Seeds: the given URL, common contact/services paths, then internal links
    discovered on each fetched page. Does **not** stop early just because
    phone+address+hours appeared — keeps going while services / description /
    email / logo / social are still missing and pages remain.

    on_page(event) optional: live progress for admin enrich UI
      {url, status: running|done|error, outcome?: ok|empty|error, fields?, error?}
    """
    from collections import deque

    def _emit_page(payload: dict[str, Any]) -> None:
        if not on_page:
            return
        try:
            on_page(payload)
        except Exception:
            pass

    base = _normalize_website(url)
    if not base:
        return {"source": SOURCE_WEBSITE, "url": url, "status": "unavailable", "error": "bad_url"}
    parsed = urllib.parse.urlparse(base)
    root = f"{parsed.scheme}://{parsed.netloc}"
    host = (parsed.hostname or "").lower().removeprefix("www.")

    queue: deque[str] = deque()
    seen_keys: set[str] = set()

    def enqueue(raw: str | None) -> None:
        if not raw:
            return
        u = _normalize_website(raw) or str(raw).strip()
        if not u.startswith("http"):
            u = urllib.parse.urljoin(root + "/", str(raw).lstrip("/"))
        try:
            p = urllib.parse.urlparse(u)
        except Exception:
            return
        h = (p.hostname or "").lower().removeprefix("www.")
        if h != host:
            return
        path = p.path or "/"
        if _SKIP_INTERNAL_PATH_RE.search(path):
            return
        key = u.rstrip("/").lower()
        if key in seen_keys:
            return
        seen_keys.add(key)
        queue.append(u.split("#")[0].split("?")[0])

    enqueue(base)
    enqueue(root + "/")
    for path in CONTACT_PATHS:
        if path:
            enqueue(urllib.parse.urljoin(root + "/", path.lstrip("/")))

    merged: dict[str, Any] | None = None
    pages_tried: list[dict[str, Any]] = []
    while queue and len(pages_tried) < max(1, max_pages):
        page_url = queue.popleft()
        _emit_page({"url": page_url, "status": "running", "kind": "website"})
        profile = extract_website_profile(page_url)
        useful = []
        for kk in (
            "phone",
            "email",
            "description",
            "address",
            "hours",
            "services",
            "service_offers",
            "payment_methods",
            "logo",
            "social_links",
        ):
            vv = profile.get(kk)
            if vv not in (None, "", [], {}):
                useful.append(kk if kk != "logo" else "image_url")
        page_status = profile.get("status")
        if page_status == "ok" and useful:
            outcome = "ok"
            err = None
        elif page_status == "ok":
            outcome = "empty"
            err = "ничего не извлечено"
        else:
            outcome = "error"
            err = str(profile.get("error") or page_status or "error")
        pages_tried.append(
            {
                "url": page_url,
                "status": page_status,
                "outcome": outcome,
                "fields": useful,
                "error": err,
                "gaps_after": None,
            }
        )
        _emit_page(
            {
                "url": page_url,
                "kind": "website",
                "status": "error" if outcome == "error" else "done",
                "outcome": outcome,
                "fields": useful,
                "error": err,
            }
        )
        if profile.get("status") == "ok":
            merged = merge_website_profiles(merged, profile)
            for link in profile.get("internal_links") or []:
                enqueue(link)
            gaps = website_profile_gaps(merged)
            pages_tried[-1]["gaps_after"] = gaps
            if not gaps:
                break
            # Still missing fields — keep BFS; do not bail on contacts alone.

    if merged is None:
        merged = {
            "source": SOURCE_WEBSITE,
            "url": base,
            "status": "unavailable",
            "error": "fetch_failed",
        }
    merged["pages_tried"] = pages_tried
    merged["gaps_remaining"] = website_profile_gaps(merged)
    return merged


def extract_instagram_profile(username_or_url: str) -> dict[str, Any]:
    """Fetch public Instagram profile HTML / og tags / shared data if present."""
    out: dict[str, Any] = {
        "source": SOURCE_INSTAGRAM,
        "status": "unavailable",
    }
    username = _ig_username(username_or_url)
    if not username:
        out["error"] = "bad_username"
        return out
    out["username"] = username
    url = f"https://www.instagram.com/{username}/"
    out["url"] = url
    html = _http_get_text(url)
    if not html:
        out["error"] = "fetch_failed"
        return out

    meta: dict[str, str] = {}
    for m in re.finditer(
        r'<meta[^>]+(?:property|name)=["\']([^"\']+)["\'][^>]+content=["\']([^"\']*)["\']',
        html,
        re.I,
    ):
        meta[m.group(1).lower()] = m.group(2)
    for m in re.finditer(
        r'<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']([^"\']+)["\']',
        html,
        re.I,
    ):
        meta[m.group(2).lower()] = m.group(1)

    title = meta.get("og:title") or meta.get("twitter:title")
    description = meta.get("og:description") or meta.get("description")
    avatar = meta.get("og:image") or meta.get("twitter:image")
    name = None
    bio = None
    website = None
    category = None

    # Try shared JSON blobs
    for pattern in (
        r"window\._sharedData\s*=\s*(\{.+?\});</script>",
        r'"user"\s*:\s*(\{.+?"username"\s*:\s*"' + re.escape(username) + r'".+?\})',
    ):
        m = re.search(pattern, html, re.I | re.S)
        if not m:
            continue
        try:
            blob = json.loads(m.group(1))
        except Exception:
            continue
        user = _find_ig_user(blob, username)
        if not user:
            continue
        name = user.get("full_name") or name
        bio = user.get("biography") or bio
        website = user.get("external_url") or website
        category = user.get("category_name") or user.get("business_category_name") or category
        if user.get("profile_pic_url_hd") or user.get("profile_pic_url"):
            avatar = user.get("profile_pic_url_hd") or user.get("profile_pic_url") or avatar
        break

    def _unescape(value: str | None) -> str | None:
        if not value:
            return None
        return html_lib.unescape(value).strip() or None

    title = _unescape(title)
    description = _unescape(description)
    avatar = _unescape(avatar)
    name = _unescape(name)
    bio = _unescape(bio)
    website = _unescape(website)
    category = _unescape(category)

    # og:description often: "Name (@user) • Instagram photos..." or bio snippet
    if description and not bio:
        bio = description
    if title and not name:
        # "Name (@user) • Instagram photos and videos"
        name = re.split(r"\(@|•|\|", title)[0].strip() or None

    # Website in bio
    if bio and not website:
        wm = re.search(r"(https?://[^\s]+|www\.[^\s]+)", bio)
        if wm:
            website = wm.group(1)

    out.update(
        {
            "status": "ok" if (name or bio or avatar or website) else "unavailable",
            "name": name,
            "bio": (bio or "").strip()[:800] or None,
            "website": _normalize_website(website) if website else None,
            "category": category,
            "avatar": avatar,
        }
    )
    if out["status"] != "ok":
        out["error"] = "no_public_fields"
    return out


def _find_ig_user(blob: Any, username: str) -> dict[str, Any] | None:
    if isinstance(blob, dict):
        if str(blob.get("username") or "").lower() == username.lower():
            return blob
        for v in blob.values():
            found = _find_ig_user(v, username)
            if found:
                return found
    elif isinstance(blob, list):
        for item in blob:
            found = _find_ig_user(item, username)
            if found:
                return found
    return None


def _clean_title(value: str | None) -> str | None:
    if not value:
        return None
    t = re.split(r"\s*[|\-–—]\s*", value.strip())[0].strip()
    return t[:120] or None


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [str(value).strip()] if str(value).strip() else []


def _services_from_json_ld(block: dict[str, Any]) -> list[str]:
    """Pull service / offer names from LocalBusiness JSON-LD."""
    return [o["title"] for o in _service_offers_from_json_ld(block) if o.get("title")]


def _merge_service_offers(offers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Dedupe by title; keep the richest offer (price/duration/description)."""
    by_title: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for raw in offers:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "").strip()[:120]
        if not title:
            continue
        key = title.lower()
        entry = dict(raw)
        entry["title"] = title
        prev = by_title.get(key)
        if not prev:
            by_title[key] = entry
            order.append(key)
            continue
        merged = dict(prev)
        for k, v in entry.items():
            if v in (None, "", [], {}):
                continue
            if merged.get(k) in (None, "", [], {}):
                merged[k] = v
            elif k == "price" and prev.get("price") is None:
                merged[k] = v
        by_title[key] = merged
    return [by_title[k] for k in order]


def _duration_minutes(raw: Any) -> int | None:
    """Parse schema.org QuantitativeValue / ISO8601 duration → minutes."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and raw > 0:
        return int(raw)
    if isinstance(raw, dict):
        unit = str(raw.get("unitCode") or raw.get("unitText") or "").upper()
        try:
            val = float(raw.get("value") or raw.get("maxValue") or 0)
        except (TypeError, ValueError):
            val = 0
        if val <= 0:
            return None
        if unit in ("HUR", "H", "HR", "HOUR", "HOURS"):
            return int(val * 60)
        return int(val)  # MIN / minutes default
    s = str(raw).strip()
    if not s:
        return None
    # PT2H / PT120M
    m = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?$", s, re.I)
    if m:
        hours = int(m.group(1) or 0)
        mins = int(m.group(2) or 0)
        total = hours * 60 + mins
        return total or None
    m2 = re.search(r"(\d+)\s*(h|hr|hrs|hour|hours|час|часа|часов)", s, re.I)
    m3 = re.search(r"(\d+)\s*(m|min|mins|minute|minutes|мин)", s, re.I)
    total = 0
    if m2:
        total += int(m2.group(1)) * 60
    if m3:
        total += int(m3.group(1))
    return total or None


def _offer_price(offers: Any) -> tuple[float | None, str | None]:
    if isinstance(offers, list) and offers:
        offers = offers[0]
    if not isinstance(offers, dict):
        return None, None
    cur = str(offers.get("priceCurrency") or "USD").upper()[:3] or "USD"
    raw = offers.get("price")
    if raw is None:
        return None, cur
    try:
        price = float(str(raw).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None, cur
    if price < 0:
        return None, cur
    return price, cur


# Site chrome / countdown / vendor footers that look like "services" in JSON-LD.
SERVICE_TITLE_STOP = {
    "home",
    "homepage",
    "контакт",
    "контакты",
    "contact",
    "contact us",
    "contacts",
    "about",
    "about us",
    "company",
    "companies",
    "privacy",
    "privacy policy",
    "terms",
    "terms of use",
    "terms of service",
    "careers",
    "jobs",
    "blog",
    "news",
    "login",
    "sign in",
    "sign up",
    "register",
    "menu",
    "sitemap",
    "search",
    "hours",
    "location",
    "locations",
    "directions",
    "faq",
    "faqs",
    "gallery",
    "inventory",
    "specials",
    "offers",
    "promo",
    "promotions",
    "minutes",
    "seconds",
    "hours",
    "days",
    "видео",
    "video",
    "directory",
    "wellness",
}
SERVICE_VENDOR_RE = re.compile(
    r"\b(?:dealer\.com|wordpress|wix|squarespace|shopify|godaddy|weebly|"
    r"vagaro|glossgenius|booksy|schedulicity|mangomint|fresha)\b",
    re.I,
)
SERVICE_MARKETING_RE = re.compile(
    r"(?:awe-inspiring|get it all in the|intuitive\.?\s*electric|"
    r"digital marketing solutions|operations tools)",
    re.I,
)

# Header / footer strings: a phone, an address or a URL is never a service.
SERVICE_CONTACT_RE = re.compile(
    r"^\+?\(?\d[\d\s().\-]{7,}\d$|"
    r"[\w.+-]+@[\w-]+\.[a-z]{2,}|"
    r"https?://|www\.[a-z]|"
    r"^\d{1,6}\s+[\w.'\-]+(?:\s+[\w.'\-]+){0,6}\s+"
    r"(?:ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|way|ln|lane|"
    r"ct|court|pl|place|hwy|highway|pkwy|parkway|ste|suite|unit)\b\.?,?$|"
    r"^[A-Za-zА-Яа-яЁё .'\-]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?$",
    re.I,
)

# Buttons and nav labels — the CTA of a page, not something the card sells.
SERVICE_CTA_RE = re.compile(
    r"^(?:toggle\s+\w+|skip\s+to\s+\w+|back\s+to\s+top|close\s+menu|"
    r"read\s+more|learn\s+more|see\s+more|view\s+(?:more|menu|menus|all)|"
    r"order\s+(?:online|now|here|ahead)?|online\s+order(?:ing)?|"
    r"book\s+(?:now|online)|call\s+(?:now|us)|get\s+directions|"
    r"subscribe|newsletter|follow\s+us|"
    r"заказать(?:\s+(?:онлайн|сейчас|доставку|еду))?|"
    r"сделать\s+заказ|оформить\s+заказ|"
    r"записаться|запись\s+онлайн|подробнее|наверх)$",
    re.I,
)


def is_plausible_service_title(
    title: str,
    *,
    has_price: bool = False,
    has_duration: bool = False,
    typed_service: bool = False,
) -> bool:
    """Reject nav chrome, countdown labels, and vendor marketing slogans."""
    raw = re.sub(r"\s+", " ", (title or "").strip())
    if len(raw) < 3 or len(raw) > 120:
        return False
    key = raw.lower().strip(" .|-")
    if not key or key in SERVICE_TITLE_STOP:
        return False
    if re.fullmatch(r"\d+", key):
        return False
    if SERVICE_VENDOR_RE.search(raw) or SERVICE_MARKETING_RE.search(raw):
        return False
    if SERVICE_CONTACT_RE.search(raw) or SERVICE_CTA_RE.match(raw.strip(" .|-")):
        return False
    # Bare knowsAbout / ItemList strings need a real offer signal.
    if not typed_service and not has_price and not has_duration:
        if " " not in key and len(key) <= 12:
            return False
        if re.search(r"[.!?]$", raw) and len(raw.split()) >= 4:
            # Marketing sentence, not a service name.
            return False
    return True


def _service_offers_from_json_ld(block: dict[str, Any]) -> list[dict[str, Any]]:
    """Structured services: title, price, currency, duration_minutes, description."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add_service(node: Any, *, from_loose_list: bool = False) -> None:
        if not isinstance(node, dict):
            if isinstance(node, str) and node.strip():
                title = node.strip()[:120]
                if not is_plausible_service_title(title, typed_service=False):
                    return
                key = title.lower()
                if key not in seen:
                    seen.add(key)
                    out.append({"title": title})
            return
        types = node.get("@type")
        type_l = (
            " ".join(types) if isinstance(types, list) else str(types or "")
        ).lower()
        # Unwrap ListItem
        if "listitem" in type_l and isinstance(node.get("item"), dict):
            add_service(node["item"], from_loose_list=from_loose_list)
            return
        name = node.get("name")
        if isinstance(name, dict):
            name = name.get("name")
        # Offer wrapping a service
        if not name and node.get("itemOffered"):
            io = node["itemOffered"]
            if isinstance(io, dict):
                name = io.get("name")
                node = {**io, "offers": node.get("offers") or node}
                types = node.get("@type")
                type_l = (
                    " ".join(types) if isinstance(types, list) else str(types or "")
                ).lower()
        title = str(name or "").strip()[:120]
        if not title:
            return
        key = title.lower()
        offers = node.get("offers")
        price, currency = _offer_price(offers)
        duration = None
        if isinstance(offers, dict):
            duration = _duration_minutes(offers.get("eligibleDuration"))
        if duration is None:
            duration = _duration_minutes(node.get("eligibleDuration"))
        if duration is None:
            duration = _duration_minutes(node.get("duration"))
        typed = "service" in type_l or "product" in type_l or "offer" in type_l
        if from_loose_list and not typed and price is None and duration is None:
            # knowsAbout / bare ItemList often holds slogans and nav labels.
            if not is_plausible_service_title(
                title, has_price=False, has_duration=False, typed_service=False
            ):
                return
        elif not is_plausible_service_title(
            title,
            has_price=price is not None,
            has_duration=bool(duration),
            typed_service=typed,
        ):
            return
        desc = node.get("description")
        desc_s = str(desc).strip()[:800] if desc else None
        entry: dict[str, Any] = {"title": title}
        if price is not None:
            entry["price"] = price
            entry["currency"] = currency or "USD"
        if duration:
            entry["duration_minutes"] = duration
        if desc_s:
            entry["description"] = desc_s
        if key in seen:
            # Prefer richer offer (with price) over bare title
            for i, prev in enumerate(out):
                if str(prev.get("title") or "").lower() == key:
                    if entry.get("price") is not None and prev.get("price") is None:
                        out[i] = {**prev, **entry}
                    elif entry.get("duration_minutes") and not prev.get("duration_minutes"):
                        out[i] = {**prev, **entry}
                    break
            return
        seen.add(key)
        out.append(entry)

    # Direct Service / Product nodes
    types = block.get("@type")
    type_l = (" ".join(types) if isinstance(types, list) else str(types or "")).lower()
    if "service" in type_l or "product" in type_l:
        add_service(block)

    for key in ("makesOffer", "hasOfferCatalog", "knowsAbout", "itemListElement", "@graph"):
        val = block.get(key)
        if val is None:
            continue
        loose = key in {"knowsAbout", "itemListElement"}
        if isinstance(val, dict) and key == "hasOfferCatalog":
            items = val.get("itemListElement") or val.get("itemOffered") or []
            if isinstance(items, list):
                for it in items:
                    add_service(it)
            else:
                add_service(items)
            continue
        if isinstance(val, list):
            for it in val:
                add_service(it, from_loose_list=loose)
        else:
            add_service(val, from_loose_list=loose)
    return out


def _uniq(values: list[str]) -> list[str]:
    return list(dict.fromkeys(v for v in values if v))


def _normalize_phones(values: list[str]) -> list[str]:
    """Keep plausible E.164 / NANP phones; drop HTML digit noise."""
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        raw = (v or "").strip()
        digits = re.sub(r"\D", "", raw)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) == 10:
            # NANP: area code and exchange cannot start with 0/1
            if digits[0] in "01" or digits[3] in "01":
                continue
            phone = f"+1{digits}"
        elif raw.startswith("+") and 11 <= len(re.sub(r"\D", "", raw)) <= 15:
            phone = "+" + re.sub(r"\D", "", raw)
        else:
            continue
        if phone not in seen:
            seen.add(phone)
            out.append(phone)
    return out


def site_origin(url: str) -> str | None:
    """Return https://host/ for a page URL, or None if not a deep path."""
    norm = _normalize_website(url)
    if not norm:
        return None
    parsed = urllib.parse.urlparse(norm)
    if not parsed.netloc:
        return None
    origin = f"{parsed.scheme}://{parsed.netloc}/"
    path = (parsed.path or "").rstrip("/")
    if not path:
        return None
    return origin


def website_fetch_candidates(url: str) -> list[str]:
    """Deep URL first, then site origin (for homepage contacts)."""
    norm = _normalize_website(url)
    if not norm:
        return []
    out = [norm]
    origin = site_origin(norm)
    if origin and origin.rstrip("/") != norm.rstrip("/"):
        out.append(origin)
    return out


def merge_website_profiles(
    primary: dict[str, Any] | None, secondary: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Union contact fields; prefer primary scalars when present.

    For description/name: keep the longer useful text when primary is short.
    """
    if not primary or primary.get("status") != "ok":
        return secondary if secondary and secondary.get("status") == "ok" else primary
    if not secondary or secondary.get("status") != "ok":
        return primary
    merged = dict(primary)
    for key in ("name", "description", "address", "hours", "logo"):
        cur = merged.get(key)
        alt = secondary.get(key)
        if not cur and alt:
            merged[key] = alt
        elif key in ("description", "name") and cur and alt:
            if len(str(alt).strip()) > len(str(cur).strip()) + 20:
                merged[key] = alt
    for key in (
        "phone",
        "email",
        "social_links",
        "services",
        "related_websites",
        "payment_methods",
    ):
        a = list(merged.get(key) or [])
        b = list(secondary.get(key) or [])
        merged[key] = _uniq(a + b)[:20]
    merged["service_offers"] = _merge_service_offers(
        list(merged.get("service_offers") or [])
        + list(secondary.get("service_offers") or [])
    )[:20]
    if merged.get("service_offers") and not merged.get("services"):
        merged["services"] = [
            o["title"] for o in merged["service_offers"] if o.get("title")
        ]
    # Prefer origin URL when secondary is origin and primary was a deep path
    if secondary.get("url") and site_origin(str(primary.get("url") or "")) == secondary.get(
        "url"
    ):
        merged["origin_url"] = secondary.get("url")
    return merged


def _fill_empty(
    entity: dict[str, Any],
    *,
    field: str,
    value: Any,
    source: str,
    applied: list[str],
    sources: dict[str, str],
) -> None:
    current = entity.get(field)
    if isinstance(current, list) and current:
        return
    if isinstance(current, str) and current.strip():
        return
    if current not in (None, [], "", {}):
        return
    if value is None or value == "" or value == []:
        return
    entity[field] = value
    sources[field] = source
    applied.append(field)


def merge_web_enrichment(
    entity: dict[str, Any],
    *,
    website_data: dict[str, Any] | None = None,
    instagram_data: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str], list[str]]:
    """Merge website/IG into empty fields. Returns entity, website_applied, ig_applied."""
    sources = dict(entity.get("field_sources") or {})
    web_applied: list[str] = []
    ig_applied: list[str] = []

    if website_data and website_data.get("status") == "ok":
        src = SOURCE_WEBSITE
        if entity.get("entity_type") == "business":
            _fill_empty(
                entity,
                field="business_name",
                value=website_data.get("name"),
                source=src,
                applied=web_applied,
                sources=sources,
            )
        _fill_empty(
            entity,
            field="description",
            value=website_data.get("description"),
            source=src,
            applied=web_applied,
            sources=sources,
        )
        _fill_empty(
            entity,
            field="phone",
            value=website_data.get("phone") or [],
            source=src,
            applied=web_applied,
            sources=sources,
        )
        _fill_empty(
            entity,
            field="email",
            value=website_data.get("email") or [],
            source=src,
            applied=web_applied,
            sources=sources,
        )
        _fill_empty(
            entity,
            field="address",
            value=website_data.get("address"),
            source=src,
            applied=web_applied,
            sources=sources,
        )
        _fill_empty(
            entity,
            field="hours",
            value=website_data.get("hours"),
            source=src,
            applied=web_applied,
            sources=sources,
        )
        if website_data.get("logo") and not entity.get("website_logo"):
            entity["website_logo"] = {"url": website_data["logo"], "source": src}
            sources["website_logo"] = src
            web_applied.append("website_logo")
        # Social links → instagram/facebook lists if empty
        ig_links = [
            u for u in (website_data.get("social_links") or []) if "instagram.com" in u.lower()
        ]
        if ig_links:
            handles = []
            for u in ig_links:
                h = _ig_username(u)
                if h:
                    handles.append(h)
            _fill_empty(
                entity,
                field="instagram",
                value=_uniq(handles),
                source=src,
                applied=web_applied,
                sources=sources,
            )

    if instagram_data and instagram_data.get("status") == "ok":
        src = SOURCE_INSTAGRAM
        if entity.get("entity_type") in {"private_specialist", "business", None}:
            if entity.get("entity_type") == "private_specialist":
                _fill_empty(
                    entity,
                    field="person_name",
                    value=instagram_data.get("name"),
                    source=src,
                    applied=ig_applied,
                    sources=sources,
                )
            elif entity.get("entity_type") == "business":
                _fill_empty(
                    entity,
                    field="business_name",
                    value=instagram_data.get("name"),
                    source=src,
                    applied=ig_applied,
                    sources=sources,
                )
        _fill_empty(
            entity,
            field="description",
            value=instagram_data.get("bio"),
            source=src,
            applied=ig_applied,
            sources=sources,
        )
        if instagram_data.get("website"):
            _fill_empty(
                entity,
                field="website",
                value=[instagram_data["website"]],
                source=src,
                applied=ig_applied,
                sources=sources,
            )
        if instagram_data.get("avatar") and not entity.get("instagram_avatar"):
            entity["instagram_avatar"] = {
                "url": instagram_data["avatar"],
                "source": src,
            }
            sources["instagram_avatar"] = src
            ig_applied.append("instagram_avatar")
        if (
            instagram_data.get("category")
            and not entity.get("instagram_category")
            and (not entity.get("category") or entity.get("category") == "other")
        ):
            entity["instagram_category"] = instagram_data["category"]
            sources["instagram_category"] = src
            ig_applied.append("instagram_category")
        if instagram_data.get("username"):
            _fill_empty(
                entity,
                field="instagram",
                value=[instagram_data["username"]],
                source=src,
                applied=ig_applied,
                sources=sources,
            )

    if sources:
        entity["field_sources"] = sources
    return entity, web_applied, ig_applied


def enrich_from_website_instagram(
    posts: list[dict[str, Any]],
    *,
    enabled: bool = True,
) -> dict[str, Any]:
    """Enrich analyzed posts from website/Instagram. Never raises."""
    stats: dict[str, Any] = {
        "enabled": enabled,
        "posts": len(posts),
        "website_attempted": 0,
        "website_enriched": 0,
        "instagram_attempted": 0,
        "instagram_enriched": 0,
        "fields_filled": {},
        "errors": 0,
    }
    if not enabled:
        return stats

    field_counts: dict[str, int] = {}

    for post in posts:
        try:
            # Skip pure rejects without contacts worth enriching? Still try if URL present.
            entity = post.get("extracted_entity")
            if not isinstance(entity, dict):
                entity = {}
            websites = entity.get("website") or []
            if isinstance(websites, str):
                websites = [websites]
            instagrams = entity.get("instagram") or []
            if isinstance(instagrams, str):
                instagrams = [instagrams]

            web_data = None
            ig_data = None

            seen_fetch: set[str] = set()
            last_web_attempt: dict[str, Any] | None = None
            for w in websites[:2]:
                page_data: dict[str, Any] | None = None
                for candidate in website_fetch_candidates(str(w)):
                    key = candidate.rstrip("/").lower()
                    if key in seen_fetch:
                        continue
                    seen_fetch.add(key)
                    stats["website_attempted"] += 1
                    fetched = extract_website_profile(candidate)
                    last_web_attempt = fetched
                    if fetched.get("status") == "ok":
                        page_data = merge_website_profiles(page_data, fetched)
                if page_data and page_data.get("status") == "ok":
                    web_data = page_data
                    break
            if web_data is None:
                web_data = last_web_attempt

            for ig in instagrams[:2]:
                stats["instagram_attempted"] += 1
                ig_data = extract_instagram_profile(str(ig))
                if ig_data.get("status") == "ok":
                    break

            if (not web_data or web_data.get("status") != "ok") and (
                not ig_data or ig_data.get("status") != "ok"
            ):
                if web_data or ig_data:
                    post.setdefault("enrichments", []).append(
                        {
                            "source": "website_instagram",
                            "status": "unavailable",
                            "website": web_data,
                            "instagram": ig_data,
                        }
                    )
                continue

            entity, web_applied, ig_applied = merge_web_enrichment(
                entity, website_data=web_data, instagram_data=ig_data
            )
            post["extracted_entity"] = entity

            record: dict[str, Any] = {
                "source": "website_instagram",
                "status": "ok",
                "website": {
                    "status": (web_data or {}).get("status"),
                    "url": (web_data or {}).get("url"),
                    "fields_applied": web_applied,
                    "data": {
                        k: (web_data or {}).get(k)
                        for k in (
                            "name",
                            "description",
                            "phone",
                            "email",
                            "address",
                            "hours",
                            "logo",
                            "social_links",
                        )
                        if (web_data or {}).get(k)
                    }
                    if web_data and web_data.get("status") == "ok"
                    else None,
                },
                "instagram": {
                    "status": (ig_data or {}).get("status"),
                    "username": (ig_data or {}).get("username"),
                    "fields_applied": ig_applied,
                    "data": {
                        k: (ig_data or {}).get(k)
                        for k in ("name", "bio", "website", "category", "avatar")
                        if (ig_data or {}).get(k)
                    }
                    if ig_data and ig_data.get("status") == "ok"
                    else None,
                },
            }
            post.setdefault("enrichments", []).append(record)

            if web_applied:
                stats["website_enriched"] += 1
            if ig_applied:
                stats["instagram_enriched"] += 1
            for f in web_applied + ig_applied:
                field_counts[f] = field_counts.get(f, 0) + 1
        except Exception:
            stats["errors"] += 1
            post.setdefault("enrichments", []).append(
                {"source": "website_instagram", "status": "error"}
            )

    stats["fields_filled"] = field_counts
    return stats
