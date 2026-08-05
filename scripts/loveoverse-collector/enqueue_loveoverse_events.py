#!/usr/bin/env python3
"""Enqueue Loveoverse LA affiche events → import_comment_recommendations (pending).

Never publishes to public.events — Approve lives in Admin Inbox → Loveoverse.

Sources (public JSON, no HTML scrape):
  GET https://loveoverse.com/api/public/events/catalog/afisha
  GET https://loveoverse.com/api/public/events/catalog/managed
  GET https://loveoverse.com/api/public/events/{eventId}  (managed detail)

Usage:
  python3 scripts/loveoverse-collector/enqueue_loveoverse_events.py
  python3 scripts/loveoverse-collector/enqueue_loveoverse_events.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402
from structure_event_from_text import structure_event_from_text  # noqa: E402

USER_AGENT = "Mozilla/5.0 (compatible; KrugiAfficheBot/1.0; +https://krugi.app)"
API_BASE = "https://loveoverse.com"
SITE_EVENTS = f"{API_BASE}/events"

HUB = {
    "city": "Лос-Анджелес",
    "state": "US-CA",
}

CATEGORY_MAP = [
    (re.compile(r"dating|знаком|singles|speed.?dat|свах|matchmaker", re.I), "networking"),
    (re.compile(r"bachata|salsa|dance|бачат|танц", re.I), "culture"),
    (re.compile(r"culture|культур|concert|концерт|театр|theater|standup|стендап", re.I), "culture"),
    (re.compile(r"game|игр|квиз|quiz|mafia|мафи", re.I), "other"),
    (re.compile(r"part(y|ies)|вечерин|disco|диско", re.I), "music"),
    (re.compile(r"outdoors|природ|beach|volleyball|hike|picnic|пикник", re.I), "outdoors"),
    (re.compile(r"food|drink|ужин|dinner|кинотеатр", re.I), "food"),
    (re.compile(r"business|бизнес|network", re.I), "networking"),
    (re.compile(r"family|дет|kids", re.I), "family"),
    (re.compile(r"sport|fit|yoga", re.I), "sport"),
    (re.compile(r"market|bazaar", re.I), "market"),
    (re.compile(r"festival|ярмар", re.I), "festival"),
]

EMOJI_LOC_RE = re.compile(r"^[\s📍📍]*")


def map_category(*parts: str | None) -> str:
    blob = " ".join(p for p in parts if p)
    for pattern, label in CATEGORY_MAP:
        if pattern.search(blob):
            return label
    return "other"


def fetch_json(url: str, timeout: float = 25.0) -> dict[str, Any] | list[Any] | None:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Referer": SITE_EVENTS,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw)
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        print(f"  fetch fail {url}: {exc}", flush=True)
        return None


def ms_to_iso(value: Any) -> str | None:
    if value is None or value == "":
        return None
    try:
        ms = int(value)
    except (TypeError, ValueError):
        return None
    if ms < 1_000_000_000_000:
        ms *= 1000
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def clean_location(raw: str | None) -> tuple[str | None, str | None]:
    """Return (address_line or venue blob, city guess)."""
    if not raw or not str(raw).strip():
        return None, None
    text = str(raw).strip()
    lines = []
    for ln in text.splitlines():
        t = EMOJI_LOC_RE.sub("", ln).strip()
        t = re.sub(r"^📍\s*", "", t).strip()
        if not t:
            continue
        if re.search(r"точн(ую|ый)\s+локац", t, re.I):
            continue
        if re.search(r"сообщим\s+зарегистрирован", t, re.I):
            continue
        lines.append(t)
    if not lines:
        return None, None
    line = ", ".join(lines)
    city = None
    low = line.lower()
    for needle, label in (
        ("los angeles", "Лос-Анджелес"),
        ("santa monica", "Santa Monica"),
        ("west hollywood", "West Hollywood"),
        ("north hollywood", "North Hollywood"),
        ("studio city", "Studio City"),
        ("burbank", "Burbank"),
        ("commerce", "Commerce"),
        ("hollywood", "Лос-Анджелес"),
    ):
        if needle in low:
            city = label
            break
    return line[:300], city


def price_from_zelle(zelle: Any) -> str | None:
    if not isinstance(zelle, dict) or not zelle.get("enabled"):
        return None
    amounts: list[str] = []
    for key, label in (
        ("femaleAmountCents", "ж"),
        ("maleAmountCents", "м"),
    ):
        cents = zelle.get(key)
        try:
            dollars = int(cents) / 100
        except (TypeError, ValueError):
            continue
        amounts.append(f"${dollars:g} ({label})")
    if not amounts:
        return None
    if len(set(amounts)) == 1:
        return amounts[0].split(" ")[0]
    return " · ".join(amounts)


def phone_from_zelle(zelle: Any) -> str | None:
    if not isinstance(zelle, dict):
        return None
    phone = str(zelle.get("phoneNumber") or "").strip()
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return phone or None


def build_event_blob(
    *,
    title: str,
    description: str | None,
    date_label: str | None,
    time_label: str | None,
    location: str | None,
    organizer: str | None,
) -> str:
    parts = [title]
    if organizer:
        parts.append(f"Организатор: {organizer}")
    when_bits = [x for x in (date_label, time_label) if x]
    if when_bits:
        parts.append(f"Когда: {' · '.join(when_bits)}")
    if location:
        parts.append(f"Где: {location}")
    if description:
        parts.append(description)
    return "\n".join(parts)


def base_row(
    *,
    external_id: str,
    catalog: str,
    title: str,
    description: str | None,
    source_url: str,
    registration_url: str | None,
    cover: str | None,
    category: str,
    city: str | None,
    address_line: str | None,
    venue_name: str | None,
    event_at: str | None,
    starts_at: str | None,
    ends_at: str | None,
    price_label: str | None,
    phones: list[str],
    instagram: list[str],
    websites: list[str],
    organizer: str | None,
    tags: list[str],
    source_language: str,
) -> dict[str, Any]:
    cluster_key = f"loveoverse:{external_id}"
    groups = [f"loveoverse:{catalog}"]
    if organizer:
        groups.append(organizer[:120])
    return {
        "cluster_key": cluster_key,
        "kind": "event",
        "display_name": title[:200],
        "title_original": title[:200],
        "description_original": (description or "")[:4000] or None,
        "phones": phones[:5],
        "instagram": instagram[:5],
        "websites": websites[:5],
        "mention_count": 1,
        "third_party_mention_count": 1 if catalog == "afisha" else 0,
        "self_ad_mention_count": 1 if catalog == "managed" else 0,
        "comment_texts": [description] if description else [title],
        "request_snippets": [description] if description else [],
        "source_post_urls": [source_url],
        "source_groups": groups,
        "category_guess": category,
        "category": category,
        "recommender_names": [],
        "last_posted_at": datetime.now(timezone.utc).isoformat(),
        "event_at": event_at,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "city": city or HUB["city"],
        "state_code": HUB["state"],
        "venue_name": venue_name,
        "address_line": address_line,
        "price_label": price_label,
        "cover_image_url": cover,
        "registration_url": registration_url or source_url,
        "directory_source": f"loveoverse:{catalog}",
        "target_bucket": "other",
        "source_channel": "loveoverse",
        "external_source": "loveoverse",
        "external_id": external_id[:120],
        "source_language": source_language,
        "status": "pending",
        "tags": tags[:8],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def enrich_with_structure(row: dict[str, Any], blob: str) -> dict[str, Any]:
    structured = structure_event_from_text(blob) if blob.strip() else {}
    clean_desc = structured.get("description")
    if clean_desc:
        row["comment_texts"] = [clean_desc]
        row["request_snippets"] = [clean_desc]
        # Keep original dump in description_original; narrative stays structured.
        if not row.get("description_original"):
            row["description_original"] = blob[:4000]

    if not row.get("starts_at") and structured.get("starts_at"):
        row["starts_at"] = structured["starts_at"]
    if not row.get("event_at") and structured.get("event_at_label"):
        row["event_at"] = structured["event_at_label"]
    if not row.get("address_line") and structured.get("address_line"):
        row["address_line"] = structured["address_line"]
    if structured.get("city") and row.get("city") == HUB["city"]:
        row["city"] = structured["city"]
    if not row.get("price_label") and structured.get("price_label"):
        row["price_label"] = structured["price_label"]
    if structured.get("phone"):
        phones = list(row.get("phones") or [])
        if structured["phone"] not in phones:
            phones.insert(0, structured["phone"])
        row["phones"] = phones[:5]
    for ig in structured.get("instagram") or []:
        instagram = list(row.get("instagram") or [])
        if ig not in instagram:
            instagram.append(ig)
        row["instagram"] = instagram[:5]
    for url in structured.get("website") or []:
        websites = list(row.get("websites") or [])
        if url not in websites and "loveoverse.com" not in url.lower():
            websites.append(url)
        row["websites"] = websites[:5]
    if not row.get("registration_url") and structured.get("registration_url"):
        row["registration_url"] = structured["registration_url"]
    return row


def normalize_afisha(event: dict[str, Any]) -> dict[str, Any] | None:
    eid = str(event.get("eventId") or event.get("id") or "").strip()
    title = str(event.get("title") or "").strip()
    if not eid or not title:
        return None
    source_url = str(event.get("sourceUrl") or "").strip() or f"{SITE_EVENTS}"
    location = str(event.get("location") or "").strip() or None
    address_line, city = clean_location(location)
    organizer = str(event.get("organizer") or "").strip() or None
    date_label = str(event.get("dateLabel") or "").strip() or None
    time_label = str(event.get("timeLabel") or "").strip() or None
    description = str(event.get("description") or "").strip() or None
    category = map_category(
        event.get("categorySlug"),
        event.get("categoryLabel"),
        title,
        organizer,
    )
    tags = [
        t
        for t in (
            str(event.get("categorySlug") or "").strip(),
            str(event.get("categoryLabel") or "").strip(),
            "afisha",
        )
        if t
    ]
    websites: list[str] = []
    instagram: list[str] = []
    if source_url:
        low = source_url.lower()
        if "instagram.com" in low:
            m = re.search(r"instagram\.com/([A-Za-z0-9._]+)", source_url, re.I)
            if m and m.group(1).lower() not in {"p", "reel", "stories"}:
                instagram.append(m.group(1).lower())
        elif "loveoverse.com" not in low:
            websites.append(source_url)

    row = base_row(
        external_id=f"afisha:{eid}",
        catalog="afisha",
        title=title,
        description=description,
        source_url=source_url,
        registration_url=source_url,
        cover=None,
        category=category,
        city=city,
        address_line=address_line,
        venue_name=None,
        event_at=date_label,
        starts_at=None,
        ends_at=None,
        price_label=None,
        phones=[],
        instagram=instagram,
        websites=websites,
        organizer=organizer,
        tags=tags,
        source_language="ru",
    )
    blob = build_event_blob(
        title=title,
        description=description,
        date_label=date_label,
        time_label=time_label,
        location=location,
        organizer=organizer,
    )
    return enrich_with_structure(row, blob)


def normalize_managed(
    event: dict[str, Any],
    *,
    detail: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    src = detail or event
    eid = str(src.get("eventId") or event.get("eventId") or "").strip()
    title = str(src.get("title") or event.get("title") or "").strip()
    if not eid or not title:
        return None
    source_url = f"{SITE_EVENTS}/{eid}"
    location = str(src.get("location") or "").strip() or None
    address_line, city = clean_location(location)
    org = src.get("organization") if isinstance(src.get("organization"), dict) else None
    organizer = str((org or {}).get("name") or "").strip() or None
    description = str(src.get("description") or "").strip() or None
    cover = str(src.get("imageUrl") or "").strip() or None
    starts_at = ms_to_iso(src.get("nextOccurrenceDate") or src.get("eventDate"))
    ends_at = ms_to_iso(src.get("nextOccurrenceEndDate") or src.get("eventEndDate"))
    event_at = starts_at
    zelle = src.get("zellePayment")
    price_label = price_from_zelle(zelle)
    phone = phone_from_zelle(zelle)
    phones = [phone] if phone else []
    category = map_category(
        src.get("eventCategory"),
        title,
        organizer,
        " ".join(str(t) for t in (src.get("interestTags") or [])),
    )
    tags = ["managed"]
    if src.get("eventCategory"):
        tags.append(str(src["eventCategory"]))
    for t in src.get("interestTags") or []:
        if t:
            tags.append(str(t))

    row = base_row(
        external_id=f"managed:{eid}",
        catalog="managed",
        title=title,
        description=description,
        source_url=source_url,
        registration_url=source_url,
        cover=cover,
        category=category,
        city=city,
        address_line=address_line,
        venue_name=None,
        event_at=event_at,
        starts_at=starts_at,
        ends_at=ends_at,
        price_label=price_label,
        phones=phones,
        instagram=[],
        websites=[],
        organizer=organizer,
        tags=tags,
        source_language="ru",
    )
    date_label = None
    if starts_at:
        try:
            date_label = datetime.fromisoformat(starts_at).astimezone(timezone.utc).strftime(
                "%Y-%m-%d %H:%M UTC"
            )
        except ValueError:
            date_label = starts_at
    blob = build_event_blob(
        title=title,
        description=description,
        date_label=date_label,
        time_label=None,
        location=location,
        organizer=organizer,
    )
    return enrich_with_structure(row, blob)


def discover_all(*, fetch_details: bool, sleep_s: float) -> list[dict[str, Any]]:
    collected: dict[str, dict[str, Any]] = {}

    print("=== afisha catalog ===", flush=True)
    afisha = fetch_json(f"{API_BASE}/api/public/events/catalog/afisha")
    events = (afisha or {}).get("events") if isinstance(afisha, dict) else None
    if not isinstance(events, list):
        print("  afisha: empty/fail", flush=True)
        events = []
    print(f"  raw {len(events)}", flush=True)
    for event in events:
        if not isinstance(event, dict):
            continue
        row = normalize_afisha(event)
        if row:
            collected[row["external_id"]] = row

    print("=== managed catalog ===", flush=True)
    managed = fetch_json(f"{API_BASE}/api/public/events/catalog/managed")
    events = (managed or {}).get("events") if isinstance(managed, dict) else None
    if not isinstance(events, list):
        print("  managed: empty/fail", flush=True)
        events = []
    print(f"  raw {len(events)}", flush=True)
    for event in events:
        if not isinstance(event, dict):
            continue
        detail = None
        eid = str(event.get("eventId") or "").strip()
        if fetch_details and eid:
            payload = fetch_json(f"{API_BASE}/api/public/events/{eid}")
            if isinstance(payload, dict) and isinstance(payload.get("event"), dict):
                detail = payload["event"]
            time.sleep(max(0.05, sleep_s))
        row = normalize_managed(event, detail=detail)
        if row:
            collected[row["external_id"]] = row

    return list(collected.values())


def upsert_pending(client: SupabaseRest, rows: list[dict[str, Any]]) -> dict[str, int]:
    stats = {"inserted": 0, "updated": 0, "skipped": 0, "errors": 0}
    for row in rows:
        external_id = row["external_id"]
        existing = client._request(
            "GET",
            "/import_comment_recommendations",
            params={
                "select": "id,status",
                "external_source": "eq.loveoverse",
                "external_id": f"eq.{external_id}",
                "kind": "eq.event",
                "limit": "1",
            },
        )
        if existing:
            cur = existing[0]
            if cur.get("status") in {"approved", "rejected", "merged"}:
                stats["skipped"] += 1
                continue
            try:
                client._request(
                    "PATCH",
                    "/import_comment_recommendations",
                    params={"id": f"eq.{cur['id']}"},
                    body={k: v for k, v in row.items() if k != "status"},
                    prefer="return=minimal",
                )
                stats["updated"] += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  update fail {external_id}: {exc}", flush=True)
                stats["errors"] += 1
            continue

        try:
            client._request(
                "POST",
                "/import_comment_recommendations",
                body=row,
                prefer="resolution=merge-duplicates,return=minimal",
            )
            stats["inserted"] += 1
        except Exception as exc:  # noqa: BLE001
            try:
                patched = client._request(
                    "PATCH",
                    "/import_comment_recommendations",
                    params={
                        "source_channel": "eq.loveoverse",
                        "cluster_key": f"eq.{row['cluster_key']}",
                        "status": "eq.pending",
                    },
                    body=row,
                    prefer="return=representation",
                )
                if patched:
                    stats["updated"] += 1
                else:
                    print(f"  upsert fail {external_id}: {exc}", flush=True)
                    stats["errors"] += 1
            except Exception as exc2:  # noqa: BLE001
                print(f"  upsert fail {external_id}: {exc} / {exc2}", flush=True)
                stats["errors"] += 1
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write pending rows (default: dry-run print only)",
    )
    parser.add_argument(
        "--no-details",
        action="store_true",
        help="Skip managed event detail fetches",
    )
    parser.add_argument("--sleep", type=float, default=0.25)
    args = parser.parse_args()

    rows = discover_all(
        fetch_details=not args.no_details,
        sleep_s=max(0.05, args.sleep),
    )
    print(f"Total unique: {len(rows)}", flush=True)

    if not args.apply:
        for row in rows:
            print(
                f"  - {row['external_id']}: {row['display_name'][:70]} | "
                f"{row.get('city')} | {row.get('category')} | {row.get('event_at')}",
                flush=True,
            )
        print("Dry-run only. Pass --apply to enqueue pending.", flush=True)
        return 0

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        print(
            "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        return 2
    client = SupabaseRest(url, key)
    stats = upsert_pending(client, rows)
    print(f"Done: {stats}", flush=True)
    print(
        "Review in Admin → Inbox → Loveoverse — ждут выкладки (no auto-publish).",
        flush=True,
    )
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
