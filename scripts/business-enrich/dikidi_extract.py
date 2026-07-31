#!/usr/bin/env python3
"""Extract salon data from a Dikidi *company* booking page.

Tenant pages look like ``https://dikidi.net/1759630?...`` — not the SaaS
marketing homepage. The page embeds a ``company`` JSON blob (phone, address,
hours, rating, description, image); the service menu lives at
``/mobile/ajax/newrecord/company_services/?company=<id>``.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

UA = "Mozilla/5.0 (compatible; KrugiBizEnrich/1.0; +https://krugi.app)"
TIMEOUT = 18

# https://dikidi.net/1759630 or /1759630?... — not bare dikidi.net/
_DIKIDI_COMPANY_RE = re.compile(
    r"(?i)^https?://(?:www\.)?dikidi\.net/(\d+)(?:[/?#]|$)"
)

_RU_DAY_RANGE = {
    "пн": 1,
    "вт": 2,
    "ср": 3,
    "чт": 4,
    "пт": 5,
    "сб": 6,
    "вс": 0,
}


def dikidi_company_id(url: str | None) -> str | None:
    if not url or not str(url).strip():
        return None
    m = _DIKIDI_COMPANY_RE.match(str(url).strip())
    return m.group(1) if m else None


def is_dikidi_company_page(url: str | None) -> bool:
    return dikidi_company_id(url) is not None


def booking_url_for_company(company_id: str) -> str:
    return f"https://dikidi.net/{company_id}?p=0.pi"


def _http_get(
    url: str,
    *,
    accept: str = "text/html",
    referer: str | None = None,
    ajax: bool = False,
) -> str | None:
    headers = {
        "User-Agent": UA,
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.8",
        "Referer": referer or "https://dikidi.net/",
    }
    if ajax:
        headers["X-Requested-With"] = "XMLHttpRequest"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def _extract_json_object(source: str, brace_start: int) -> str | None:
    depth = 0
    in_str = False
    esc = False
    for i, ch in enumerate(source[brace_start:], brace_start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return source[brace_start : i + 1]
    return None


def _parse_company_blob(html: str) -> dict[str, Any] | None:
    m = re.search(r'"company"\s*:\s*\{', html)
    if not m:
        return None
    brace = html.find("{", m.end() - 1)
    if brace < 0:
        return None
    raw = _extract_json_object(html, brace)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _parse_address(raw: str | None) -> dict[str, str | None]:
    """'Los Angeles, 7551 Santa Monica Boulevard' → street + city hints."""
    value = (raw or "").strip()
    if not value:
        return {}
    # Prefer «City, 123 Street» shape.
    m = re.match(
        r"^(?P<city>[^,]+),\s*(?P<street>\d{1,6}\s+.+)$",
        value,
        re.I,
    )
    if m:
        street = m.group("street").strip()
        city = m.group("city").strip()
        # Dikidi often puts metro area (Los Angeles) while salon is West Hollywood —
        # keep street; city only when it looks local.
        out: dict[str, str | None] = {"address_line": street[:300]}
        if city and city.lower() not in {"los angeles", "la", "сша", "usa", "us"}:
            out["city"] = city[:120]
        return out
    if re.match(r"^\d{1,6}\s+\S", value):
        return {"address_line": value[:300]}
    return {"address_line": value[:300]} if len(value) >= 8 else {}


def _schedule_to_opening_hours(schedule: Any) -> dict[str, Any] | None:
    """Dikidi ``[{day:'Пн—Вс', work_from, work_to}]`` → weekly OpeningHours."""
    if not isinstance(schedule, list) or not schedule:
        return None
    weekly: dict[int, dict[str, Any]] = {
        d: {"day": d, "closed": True} for d in range(7)
    }
    found = False
    for row in schedule:
        if not isinstance(row, dict):
            continue
        day_raw = str(row.get("day") or "").lower().replace(" ", "")
        op = str(row.get("work_from") or "").strip()
        cl = str(row.get("work_to") or "").strip()
        if not re.match(r"^\d{1,2}:\d{2}$", op) or not re.match(r"^\d{1,2}:\d{2}$", cl):
            continue
        days: list[int] = []
        if "—" in day_raw or "-" in day_raw or "–" in day_raw:
            sep = "—" if "—" in day_raw else ("–" if "–" in day_raw else "-")
            a, _, b = day_raw.partition(sep)
            a_k = a[:2]
            b_k = b[:2]
            if a_k in _RU_DAY_RANGE and b_k in _RU_DAY_RANGE:
                start = _RU_DAY_RANGE[a_k]
                end = _RU_DAY_RANGE[b_k]
                # Mon–Sun in Dikidi uses Mon=1 … Sun=0
                order = [1, 2, 3, 4, 5, 6, 0]
                if start in order and end in order:
                    i0 = order.index(start)
                    i1 = order.index(end)
                    if i0 <= i1:
                        days = order[i0 : i1 + 1]
                    else:
                        days = order[i0:] + order[: i1 + 1]
        else:
            key = day_raw[:2]
            if key in _RU_DAY_RANGE:
                days = [_RU_DAY_RANGE[key]]
        for d in days:
            weekly[d] = {"day": d, "open": op, "close": cl}
            found = True
    if not found:
        return None
    return {
        "timezone": "America/Los_Angeles",
        "weekly": [weekly[d] for d in range(7)],
    }


def _prefer_title(name: str) -> str:
    """Keep bilingual Dikidi titles; trim noise."""
    t = re.sub(r"\s+", " ", (name or "").strip())
    return t[:160]


def fetch_company_services(company_id: str) -> list[dict[str, Any]]:
    url = (
        "https://dikidi.net/mobile/ajax/newrecord/company_services/"
        f"?company={urllib.parse.quote(company_id)}"
    )
    raw = _http_get(
        url,
        accept="application/json, text/javascript, */*; q=0.01",
        referer=booking_url_for_company(company_id),
        ajax=True,
    )
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []
    cats = ((payload.get("data") or {}).get("list")) or {}
    if not isinstance(cats, dict):
        return []
    offers: list[dict[str, Any]] = []
    seen: set[str] = set()
    for cat in cats.values():
        if not isinstance(cat, dict):
            continue
        for svc in cat.get("services") or []:
            if not isinstance(svc, dict):
                continue
            title = _prefer_title(str(svc.get("name") or ""))
            if len(title) < 3:
                continue
            key = title.lower()
            if key in seen:
                continue
            seen.add(key)
            entry: dict[str, Any] = {
                "title": title,
                "price_mode": "contact",
                "currency": "USD",
            }
            cost = svc.get("cost")
            try:
                price = float(cost) if cost is not None and str(cost).strip() != "" else None
            except (TypeError, ValueError):
                price = None
            if price is not None and price > 0:
                entry["price_mode"] = "fixed"
                entry["price_amount"] = price
            mins = svc.get("time")
            try:
                duration = int(mins) if mins is not None else None
            except (TypeError, ValueError):
                duration = None
            if duration and duration > 0:
                entry["duration_minutes"] = duration
                entry["attributes"] = {"duration": f"{duration} мин"}
            offers.append(entry)
    # Prefer priced services first — better catalog signal.
    offers.sort(key=lambda o: (0 if o.get("price_amount") else 1, o["title"].lower()))
    return offers[:40]


def extract_dikidi_company(url: str) -> dict[str, Any]:
    """Return enrich fields for a Dikidi company listing URL."""
    cid = dikidi_company_id(url)
    out: dict[str, Any] = {"_status": "skip", "_kind": "dikidi"}
    if not cid:
        out["_error"] = "not_company_page"
        return out

    page_url = booking_url_for_company(cid)
    html = _http_get(url if "://" in url else page_url)
    if not html:
        out["_error"] = "fetch_failed"
        return out

    company = _parse_company_blob(html)
    if not company or str(company.get("id") or "") != cid:
        # Still try services API even if blob missing.
        company = company or {}

    out["_status"] = "ok"
    out["booking_url"] = page_url
    out["website"] = page_url  # until a marketing site is known

    name = str(company.get("name") or "").strip()
    if name:
        out["site_name"] = name[:200]

    desc = str(company.get("description") or "").strip()
    if len(desc) >= 40:
        out["description"] = desc[:4000]

    phone = str(company.get("phone") or "").strip()
    if not phone and isinstance(company.get("phones"), list) and company["phones"]:
        phone = str(company["phones"][0]).strip()
    phone = re.sub(r"[^\d+]", "", phone)
    if phone.startswith("1") and len(phone) == 11:
        phone = "+" + phone
    elif phone.startswith("+"):
        pass
    elif len(phone) == 10:
        phone = "+1" + phone
    if len(phone) >= 10:
        out["phone"] = phone[:40]

    addr_parts = _parse_address(str(company.get("address") or "") if company else None)
    out.update({k: v for k, v in addr_parts.items() if v})

    image = str(company.get("image") or "").strip()
    if image.startswith("http"):
        out["image_url"] = image.split("?")[0][:500]

    hours = _schedule_to_opening_hours(company.get("schedule"))
    if hours:
        out["opening_hours"] = hours
        out["hours"] = json.dumps(company.get("schedule"), ensure_ascii=False)[:500]

    try:
        rating = float(company.get("rating"))
        if 0 < rating <= 5:
            out["dikidi_rating"] = round(rating, 2)
    except (TypeError, ValueError):
        pass

    offers = fetch_company_services(cid)
    if offers:
        out["service_offers"] = offers
        out["services"] = [o["title"] for o in offers]
        out["offers"] = offers

    # Never chase Dikidi corporate app-store / social chrome from the page.
    out["discovered_urls"] = []
    out["social_links"] = []
    return out
