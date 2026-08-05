#!/usr/bin/env python3
"""Agent-Reach-stack enrich for business queue rows (fill-empty).

Uses the same upstream tools Agent-Reach documents (not Google Places API):
  - search: mcporter+Exa when available, else Jina Search (s.jina.ai)
  - read:   Jina Reader (r.jina.ai) — same as agent_reach.channels.web

Optional: if `agent_reach` is importable (Python >=3.10), page reads can use
WebChannel.read(); otherwise urllib to r.jina.ai.

Safe defaults:
  - fill-empty only
  - no writes (caller applies)
  - skip when name is missing / search fails

Used by run_enrichment_pipeline.py --agent-reach
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

UA = "KrugiAgentReachEnrich/1.0 (+https://krugi.app)"
TIMEOUT = 25

JUNK_HOST_PARTS = (
    "facebook.com",
    "fb.com",
    "instagram.com",
    "yelp.com",
    "yellowpages.com",
    "maps.google",
    "google.com/maps",
    "google.com/search",
    "google.com/url",
    "googleapis.com",
    "gstatic.com",
    "tripadvisor.",
    "wikipedia.org",
    "reddit.com",
    "tiktok.com",
    "linktr.ee",
    "t.me/",
    "wa.me",
    "jina.ai",
    "duckduckgo.com",
)

PHONE_RE = re.compile(
    r"(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b"
)
EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)
US_ADDR_RE = re.compile(
    r"\b\d{1,6}\s+[A-Za-z0-9 .'-]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|"
    r"Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Hwy|Highway|Pkwy|Parkway)\.?"
    r"(?:\s*,?\s*(?:Suite|Ste|Unit|#)\s*[A-Za-z0-9-]+)?\b",
    re.I,
)
CITY_STATE_RE = re.compile(
    r"\b([A-Za-z .'-]{2,40}),\s*(CA|California|NY|TX|FL|WA|AZ|NV|OR|IL|NJ|PA)\b",
    re.I,
)
ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")
# Prefer ZIP after state code (CA 92618) over street numbers like 24000.
ZIP_AFTER_STATE_RE = re.compile(
    r"\b(?:CA|California|NY|TX|FL|WA|AZ|NV|OR|IL|NJ|PA)\s+(\d{5})(?:-\d{4})?\b",
    re.I,
)
HOURS_RE = re.compile(
    r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|"
    r"Friday|Saturday|Sunday)[a-z]*\s*[:\-–]\s*"
    r"([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM|am|pm)?)\s*[-–to]+\s*"
    r"([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM|am|pm)?)",
    re.I,
)

DAY_MAP = {
    "sun": 0,
    "sunday": 0,
    "mon": 1,
    "monday": 1,
    "tue": 2,
    "tuesday": 2,
    "wed": 3,
    "wednesday": 3,
    "thu": 4,
    "thursday": 4,
    "fri": 5,
    "friday": 5,
    "sat": 6,
    "saturday": 6,
}


def _empty(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str):
        return not v.strip()
    if isinstance(v, (list, dict)):
        return len(v) == 0
    return False


def _normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    if 10 <= len(digits) <= 15:
        return f"+{digits}"
    return None


def _junk_url(url: str) -> bool:
    low = url.lower()
    return any(p in low for p in JUNK_HOST_PARTS)


def _fetch(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "text/plain,application/json,*/*"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read().decode("utf-8", errors="replace")


def read_page(url: str) -> str:
    """Jina Reader via urllib (bounded TIMEOUT). Skip WebChannel — it can hang on SYN."""
    clean = url if url.startswith(("http://", "https://")) else f"https://{url}"
    return _fetch(f"https://r.jina.ai/{clean}")


def build_query(item: dict[str, Any]) -> str:
    name = (
        item.get("business_name")
        or item.get("title")
        or item.get("name")
        or ""
    ).strip()
    city = (item.get("city") or "").strip()
    state = (item.get("state") or item.get("state_code") or "California").strip()
    state = state.replace("US-", "")
    parts = [name]
    if city:
        parts.append(city)
    parts.append(state)
    parts.append("phone address hours")
    return " ".join(p for p in parts if p)


def search_web(query: str) -> tuple[list[dict[str, str]], str]:
    """Exa/mcporter → Jina Search. No DuckDuckGo HTML (often SYN-timeout on Azure)."""
    if shutil.which("mcporter"):
        call = f'exa.web_search_exa(query: {json.dumps(query)}, numResults: 5)'
        try:
            proc = subprocess.run(
                ["mcporter", "call", call],
                capture_output=True,
                text=True,
                timeout=45,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                hits: list[dict[str, str]] = []
                seen: set[str] = set()
                for m in re.finditer(r"https?://[^\s\"'<>]+", proc.stdout):
                    url = m.group(0).rstrip(").,")
                    if _junk_url(url) or url in seen:
                        continue
                    seen.add(url)
                    hits.append({"title": url, "url": url})
                    if len(hits) >= 8:
                        break
                if hits:
                    return hits, "mcporter_exa"
        except Exception:  # noqa: BLE001
            pass

    try:
        text = _fetch(f"https://s.jina.ai/{urllib.parse.quote(query)}")
        hits = []
        seen = set()
        for m in re.finditer(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", text):
            title, url = m.group(1).strip(), m.group(2).strip()
            if _junk_url(url) or url in seen:
                continue
            seen.add(url)
            hits.append({"title": title, "url": url})
            if len(hits) >= 8:
                break
        if not hits:
            for m in re.finditer(r"https?://[^\s\"'<>]+", text):
                url = m.group(0).rstrip(").,")
                if _junk_url(url) or url in seen:
                    continue
                seen.add(url)
                hits.append({"title": url, "url": url})
                if len(hits) >= 8:
                    break
        if hits:
            return hits, "jina_search"
    except Exception:  # noqa: BLE001
        pass

    return [], "none"


def _needs_agent_reach(item: dict[str, Any]) -> bool:
    """Skip network work when nothing fillable remains."""
    return any(
        _empty(item.get(k))
        for k in (
            "phone",
            "email",
            "instagram",
            "website",
            "address_line",
            "city",
            "postal_code",
            "preview_image_url",
        )
    )


def _to_24h(raw: str) -> str:
    t = re.sub(r"\s+", "", raw.strip().upper())
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?(AM|PM)$", t)
    if m:
        h = int(m.group(1))
        minute = m.group(2) or "00"
        ap = m.group(3)
        if ap == "PM" and h < 12:
            h += 12
        if ap == "AM" and h == 12:
            h = 0
        return f"{h:02d}:{minute}"
    m2 = re.match(r"^(\d{1,2}):(\d{2})$", t)
    if m2:
        return f"{int(m2.group(1)):02d}:{m2.group(2)}"
    return raw.strip()


def parse_fields(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    phones = [_normalize_phone(m.group(0)) for m in PHONE_RE.finditer(text)]
    phones = [p for p in phones if p]
    if phones:
        out["phone"] = [phones[0]]
    emails = [m.group(0).lower() for m in EMAIL_RE.finditer(text)]
    emails = [e for e in emails if "example.com" not in e]
    if emails:
        out["email"] = [emails[0]]
    urls = [
        m.group(0).rstrip(").,")
        for m in URL_RE.finditer(text)
        if not _junk_url(m.group(0))
    ]
    if urls:
        out["website"] = [urls[0]]
    addr = US_ADDR_RE.search(text)
    if addr:
        out["address_line"] = re.sub(r"\s+", " ", addr.group(0)).strip()
    cs = CITY_STATE_RE.search(text)
    if cs:
        out["city"] = cs.group(1).strip()
        st = cs.group(2).upper()
        out["state"] = "CA" if st in {"CA", "CALIFORNIA"} else st[:2]
    z = ZIP_AFTER_STATE_RE.search(text) or None
    if z:
        out["postal_code"] = z.group(1)
    else:
        # Only accept ZIPs that look like US postal (not leading street nums in 1xxxx-2xxxx of addresses)
        for m in ZIP_RE.finditer(text):
            zip5 = m.group(1)
            # Skip if immediately after a street-like number context "Suite 31 24000"
            start = m.start()
            before = text[max(0, start - 12) : start].lower()
            if "suite" in before or "ste" in before or "#" in before:
                continue
            # California ZIPs commonly 9xxxx; still allow others if near city comma form
            window = text[max(0, start - 40) : start + 10]
            if CITY_STATE_RE.search(window) or re.search(
                r"\b(?:CA|NY|TX|FL|WA)\b", window, re.I
            ):
                out["postal_code"] = zip5
                break
    weekly = []
    seen_days: set[int] = set()
    for m in HOURS_RE.finditer(text):
        key = m.group(1).lower()
        day = DAY_MAP.get(key) or DAY_MAP.get(key[:3])
        if day is None or day in seen_days:
            continue
        seen_days.add(day)
        weekly.append(
            {
                "day": day,
                "open": _to_24h(m.group(2)),
                "close": _to_24h(m.group(3)),
            }
        )
        if len(weekly) >= 7:
            break
    if weekly:
        out["opening_hours"] = {
            "timezone": "America/Los_Angeles",
            "weekly": weekly,
        }
    return out


def enrich_business_item(item: dict[str, Any]) -> dict[str, Any]:
    """Return fill-empty patch for one queue/business-like dict."""
    name = (
        item.get("business_name")
        or item.get("title")
        or item.get("name")
        or ""
    ).strip()
    if not name:
        return {"ok": False, "patch": {}, "filled": [], "error": "missing_name"}
    if not _needs_agent_reach(item):
        return {"ok": False, "patch": {}, "filled": [], "error": "no_gaps"}

    query = build_query(item)
    hits: list[dict[str, str]] = []
    backend = "none"

    # If we already have a website, prefer reading it (no search needed).
    existing_sites = item.get("website") or []
    if isinstance(existing_sites, str):
        existing_sites = [existing_sites]
    for site in existing_sites:
        site = (site or "").strip()
        if site and not _junk_url(site):
            hits.append({"title": site, "url": site})
            backend = "existing_website"

    if not hits:
        try:
            hits, backend = search_web(query)
        except Exception as exc:  # noqa: BLE001
            return {
                "ok": False,
                "patch": {},
                "filled": [],
                "error": f"search:{exc}",
                "query": query,
            }

    if not hits:
        # Last resort: ask Jina Reader to summarize a Google results page.
        # (Agent-Reach web channel pattern — read a URL as markdown.)
        gq = urllib.parse.quote_plus(query)
        google_url = f"https://www.google.com/search?q={gq}&hl=en&gl=us&num=5"
        try:
            md = read_page(google_url)
            backend = "jina_google_serp"
            # Harvest result links from the SERP markdown (never treat SERP as website).
            for m in re.finditer(r"https?://[^\s\"'<>]+", md):
                url = m.group(0).rstrip(").,")
                if _junk_url(url) or "google." in url.lower():
                    continue
                hits.append({"title": url, "url": url})
                if len(hits) >= 5:
                    break
            # If no outbound links, still try to parse contacts from SERP text
            # without promoting google.com as website.
            if not hits:
                serp_fields = parse_fields(md)
                serp_fields.pop("website", None)
                if serp_fields:
                    found_early = serp_fields
                else:
                    found_early = None
            else:
                found_early = None
        except Exception as exc:  # noqa: BLE001
            return {
                "ok": False,
                "patch": {},
                "filled": [],
                "error": f"no_search_hits:{exc}",
                "query": query,
            }
    else:
        found_early = None

    if not hits and not found_early:
        return {
            "ok": False,
            "patch": {},
            "filled": [],
            "error": "no_search_hits",
            "query": query,
            "backend": backend,
        }

    token = re.sub(r"[^a-z0-9]+", " ", name.lower()).strip().split()
    token = next((t for t in token if len(t) >= 4), "")

    def rank(h: dict[str, str]) -> int:
        host = urllib.parse.urlparse(h["url"]).hostname or ""
        host = host.replace("www.", "").lower()
        return 0 if token and token in host else 1

    ranked = sorted(hits, key=rank)
    found: dict[str, Any] = dict(found_early or {})
    pages = 0
    for hit in ranked[:3]:
        if _junk_url(hit["url"]):
            continue
        try:
            md = read_page(hit["url"])
            pages += 1
            parsed = parse_fields(f"{hit.get('title','')}\n{hit['url']}\n{md}")
            if "website" not in found and not _junk_url(hit["url"]):
                found["website"] = [hit["url"].split("?")[0]]
            for k, v in parsed.items():
                if k not in found and v not in (None, "", [], {}):
                    found[k] = v
            if found.get("phone") and found.get("address_line") and (
                found.get("opening_hours") or found.get("website")
            ):
                break
        except Exception:  # noqa: BLE001
            continue

    patch: dict[str, Any] = {}
    filled: list[str] = []

    def take(dst: str, src_key: str, current: Any) -> None:
        if not _empty(current) or src_key not in found:
            return
        patch[dst] = found[src_key]
        filled.append(dst)

    # Queue shape (arrays for contacts)
    take("phone", "phone", item.get("phone"))
    take("website", "website", item.get("website"))
    take("email", "email", item.get("email"))
    take("address_line", "address_line", item.get("address_line"))
    take("city", "city", item.get("city"))
    take("postal_code", "postal_code", item.get("postal_code"))
    if _empty(item.get("state")) and found.get("state"):
        patch["state"] = found["state"]
        filled.append("state")
    # opening_hours only if column exists on published businesses; queue may ignore
    if _empty(item.get("opening_hours")) and found.get("opening_hours"):
        patch["opening_hours"] = found["opening_hours"]
        filled.append("opening_hours")

    return {
        "ok": bool(filled),
        "query": query,
        "backend": backend,
        "pages": pages,
        "patch": patch,
        "filled": filled,
        "hits": [{"title": h.get("title"), "url": h.get("url")} for h in hits[:5]],
    }


def step_agent_reach(item: dict[str, Any], patch: dict[str, Any]) -> list[str]:
    """Merge Agent-Reach fills into an in-progress pipeline patch (fill-empty)."""
    # Effective current = item + already planned patch
    effective = {**item, **patch}
    if not _needs_agent_reach(effective):
        return []
    result = enrich_business_item(effective)
    if not result.get("ok"):
        return []
    filled: list[str] = []
    for key, value in (result.get("patch") or {}).items():
        # Never overwrite non-empty item or earlier pipeline fills
        cur = patch.get(key, item.get(key))
        if _empty(cur) and not _empty(value):
            # opening_hours is not on import_review_items — skip for queue
            if key == "opening_hours":
                continue
            patch[key] = value
            filled.append(key)
    return filled
