#!/usr/bin/env python3
"""Enqueue Eventbrite discovery events → import_comment_recommendations (pending only).

Never publishes to public.events — Approve lives in Admin Inbox → Events.

Usage:
  python3 scripts/eventbrite-collector/enqueue_eventbrite_events.py
  python3 scripts/eventbrite-collector/enqueue_eventbrite_events.py --apply
  python3 scripts/eventbrite-collector/enqueue_eventbrite_events.py --apply --max-per-hub 40

Discovery URLs (public Search API retired 2019):
  https://www.eventbrite.com/d/{location}/{category}/
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402

USER_AGENT = (
    "Mozilla/5.0 (compatible; KrugiAfficheBot/1.0; +https://krugi.app)"
)

# CA hubs first — location slug is state--city (Eventbrite discovery format).
CA_HUBS: list[dict[str, str]] = [
    {"slug": "ca--sacramento", "city": "Сакраменто", "state": "US-CA"},
    {"slug": "ca--san-francisco", "city": "Сан-Франциско", "state": "US-CA"},
    {"slug": "ca--los-angeles", "city": "Лос-Анджелес", "state": "US-CA"},
    {"slug": "ca--san-diego", "city": "Сан-Диего", "state": "US-CA"},
    {"slug": "ca--anaheim", "city": "Orange County", "state": "US-CA"},
]

# Broad things-to-do categories (not music-only).
DISCOVERY_CATEGORIES = [
    "events",
    "food-and-drink",
    "festivals",
    "performing-arts",
    "music",
    "sports-and-fitness",
    "family-and-education",
    "hobbies",
    "community",
]

CATEGORY_MAP = [
    (re.compile(r"festival|fair|parade|carnival|oktoberfest", re.I), "festival"),
    (re.compile(r"food|drink|beer|wine|culinary|tasting|farm", re.I), "food"),
    (re.compile(r"family|kid|children|parent|education", re.I), "family"),
    (re.compile(r"outdoor|hike|park|garden|pick|berry|nature|beach", re.I), "outdoors"),
    (re.compile(r"sport|fitness|run|yoga|bike|golf", re.I), "sport"),
    (re.compile(r"music|concert|dj|performing", re.I), "music"),
    (re.compile(r"art|museum|theater|theatre|film|culture|comedy", re.I), "culture"),
    (re.compile(r"network|business|startup|meetup|conference", re.I), "networking"),
    (re.compile(r"market|bazaar|flea|craft|maker", re.I), "market"),
]

EVENT_ID_RE = re.compile(r"/e/[^/?#]+-tickets-(\d+)", re.I)
JSON_LD_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.I | re.S,
)


def map_category(raw: str | None, discovery_slug: str) -> str:
    blob = f"{raw or ''} {discovery_slug}"
    for pattern, label in CATEGORY_MAP:
        if pattern.search(blob):
            return label
    return "other"


def fetch_html(url: str, timeout: float = 25.0) -> str | None:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            charset = "utf-8"
            ctype = resp.headers.get("Content-Type") or ""
            if "charset=" in ctype.lower():
                charset = ctype.lower().split("charset=")[-1].split(";")[0].strip() or "utf-8"
            return raw.decode(charset, errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"  fetch fail {url}: {exc}", flush=True)
        return None


def parse_json_ld_blocks(html: str) -> list[Any]:
    out: list[Any] = []
    for match in JSON_LD_RE.finditer(html):
        blob = unescape(match.group(1)).strip()
        if not blob:
            continue
        try:
            data = json.loads(blob)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            out.extend(data)
        else:
            out.append(data)
    return out


def extract_event_id(url: str) -> str | None:
    m = EVENT_ID_RE.search(url or "")
    if m:
        return m.group(1)
    # fallback: trailing digits in path
    m2 = re.search(r"(\d{8,})/?$", (url or "").split("?")[0])
    return m2.group(1) if m2 else None


def walk_events(node: Any, acc: list[dict[str, Any]]) -> None:
    if isinstance(node, list):
        for item in node:
            walk_events(item, acc)
        return
    if not isinstance(node, dict):
        return
    types = node.get("@type")
    type_list = types if isinstance(types, list) else [types]
    type_list = [str(t or "") for t in type_list]
    if any(t.lower() == "event" for t in type_list):
        acc.append(node)
    if "@graph" in node:
        walk_events(node["@graph"], acc)
    if "itemListElement" in node:
        walk_events(node["itemListElement"], acc)
    if "item" in node:
        walk_events(node["item"], acc)


def venue_from_location(loc: Any) -> tuple[str | None, str | None, str | None]:
    """Return venue_name, address_line, city."""
    if isinstance(loc, list) and loc:
        loc = loc[0]
    if not isinstance(loc, dict):
        return None, None, (str(loc).strip() if loc else None)
    name = loc.get("name")
    addr = loc.get("address")
    if isinstance(addr, dict):
        street = addr.get("streetAddress")
        city = addr.get("addressLocality")
        parts = [street, city, addr.get("addressRegion"), addr.get("postalCode")]
        line = ", ".join(str(p).strip() for p in parts if p)
        return (
            str(name).strip() if name else None,
            line or None,
            str(city).strip() if city else None,
        )
    if isinstance(addr, str) and addr.strip():
        return (str(name).strip() if name else None, addr.strip(), None)
    return (str(name).strip() if name else None, None, None)


def price_label_from_offers(offers: Any) -> str | None:
    if isinstance(offers, list) and offers:
        offers = offers[0]
    if not isinstance(offers, dict):
        return None
    price = offers.get("price")
    currency = offers.get("priceCurrency") or "USD"
    if price is None or price == "":
        availability = str(offers.get("availability") or "")
        if "Free" in availability or str(offers.get("price")) == "0":
            return "Бесплатно"
        return None
    try:
        amount = float(price)
        if amount == 0:
            return "Бесплатно"
        return f"${amount:g} {currency}".strip()
    except (TypeError, ValueError):
        return f"{price} {currency}".strip()


def normalize_event(
    node: dict[str, Any],
    *,
    hub: dict[str, str],
    discovery_category: str,
) -> dict[str, Any] | None:
    url = (
        node.get("url")
        or node.get("@id")
        or (node.get("sameAs") if isinstance(node.get("sameAs"), str) else None)
    )
    if not url or not isinstance(url, str):
        return None
    if "eventbrite.com" not in url.lower():
        return None
    external_id = extract_event_id(url)
    if not external_id:
        return None

    title = (node.get("name") or "").strip()
    if not title:
        return None
    description = (node.get("description") or "").strip() or None
    start = node.get("startDate")
    end = node.get("endDate")
    image = node.get("image")
    if isinstance(image, list) and image:
        image = image[0]
    if isinstance(image, dict):
        image = image.get("url")
    cover = str(image).strip() if image else None

    venue_name, address_line, city_from_loc = venue_from_location(node.get("location"))
    price_label = price_label_from_offers(node.get("offers"))
    category = map_category(
        " ".join(
            str(x)
            for x in [
                discovery_category,
                node.get("keywords"),
                title,
            ]
            if x
        ),
        discovery_category,
    )

    starts_at = None
    event_at = None
    if isinstance(start, str) and start.strip():
        event_at = start.strip()
        try:
            starts_at = datetime.fromisoformat(start.replace("Z", "+00:00")).astimezone(
                timezone.utc
            ).isoformat()
        except ValueError:
            starts_at = None

    ends_at = None
    if isinstance(end, str) and end.strip():
        try:
            ends_at = datetime.fromisoformat(end.replace("Z", "+00:00")).astimezone(
                timezone.utc
            ).isoformat()
        except ValueError:
            ends_at = None

    cluster_key = f"eventbrite:{external_id}"
    return {
        "cluster_key": cluster_key,
        "kind": "event",
        "display_name": title[:200],
        "title_original": title[:200],
        "description_original": (description or "")[:4000] or None,
        "phones": [],
        "instagram": [],
        "websites": [url],
        "mention_count": 1,
        "third_party_mention_count": 0,
        "self_ad_mention_count": 0,
        "comment_texts": [description] if description else [title],
        "request_snippets": [description] if description else [],
        "source_post_urls": [url],
        "source_groups": [f"eventbrite:{hub['slug']}"],
        "category_guess": category,
        "category": category,
        "recommender_names": [],
        "last_posted_at": datetime.now(timezone.utc).isoformat(),
        "event_at": event_at,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "city": city_from_loc or hub["city"],
        "state_code": hub["state"],
        "venue_name": venue_name,
        "address_line": address_line,
        "price_label": price_label,
        "cover_image_url": cover,
        "registration_url": url,
        "directory_source": f"eventbrite:{hub['slug']}",
        "target_bucket": "other",
        "source_channel": "eventbrite",
        "external_source": "eventbrite",
        "external_id": external_id,
        "source_language": "en",
        "status": "pending",
        "tags": [discovery_category],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def discover_hub(
    hub: dict[str, str],
    *,
    max_per_hub: int,
    pages: int,
    sleep_s: float,
) -> list[dict[str, Any]]:
    collected: dict[str, dict[str, Any]] = {}
    for cat in DISCOVERY_CATEGORIES:
        if len(collected) >= max_per_hub:
            break
        for page in range(1, pages + 1):
            if len(collected) >= max_per_hub:
                break
            qs = f"?page={page}" if page > 1 else ""
            url = f"https://www.eventbrite.com/d/{hub['slug']}/{cat}/{qs}"
            print(f"  GET {url}", flush=True)
            html = fetch_html(url)
            time.sleep(sleep_s)
            if not html:
                continue
            blocks = parse_json_ld_blocks(html)
            events: list[dict[str, Any]] = []
            for block in blocks:
                walk_events(block, events)
            if not events:
                # listing page often only has ItemList of URLs — follow a few detail pages
                for m in EVENT_ID_RE.finditer(html):
                    eid = m.group(1)
                    if eid in collected:
                        continue
                    detail = f"https://www.eventbrite.com/e/tickets-{eid}"
                    # Prefer full match URL from href if present
                    href_m = re.search(
                        rf'href=["\'](https://www\.eventbrite\.com/e/[^"\']+-{eid})["\']',
                        html,
                        re.I,
                    )
                    detail_url = href_m.group(1) if href_m else detail
                    dhtml = fetch_html(detail_url)
                    time.sleep(sleep_s)
                    if not dhtml:
                        continue
                    dblocks = parse_json_ld_blocks(dhtml)
                    detail_events: list[dict[str, Any]] = []
                    for b in dblocks:
                        walk_events(b, detail_events)
                    for node in detail_events:
                        row = normalize_event(
                            node, hub=hub, discovery_category=cat
                        )
                        if row:
                            collected[row["external_id"]] = row
                            if len(collected) >= max_per_hub:
                                break
                    if len(collected) >= max_per_hub:
                        break
                continue

            for node in events:
                row = normalize_event(node, hub=hub, discovery_category=cat)
                if not row:
                    continue
                collected[row["external_id"]] = row
                if len(collected) >= max_per_hub:
                    break
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
                "external_source": "eq.eventbrite",
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

        # Prefer unique (source_channel, cluster_key)
        try:
            client._request(
                "POST",
                "/import_comment_recommendations",
                body=row,
                prefer="resolution=merge-duplicates,return=minimal",
            )
            stats["inserted"] += 1
        except Exception as exc:  # noqa: BLE001
            # Fallback: try patch by cluster_key
            try:
                client._request(
                    "PATCH",
                    "/import_comment_recommendations",
                    params={
                        "source_channel": "eq.eventbrite",
                        "cluster_key": f"eq.{row['cluster_key']}",
                        "status": "eq.pending",
                    },
                    body=row,
                    prefer="return=minimal",
                )
                stats["updated"] += 1
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
    parser.add_argument("--max-per-hub", type=int, default=30)
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--sleep", type=float, default=1.2)
    parser.add_argument(
        "--hub",
        action="append",
        help="Limit to hub slug (repeatable), e.g. ca--sacramento",
    )
    args = parser.parse_args()

    hubs = CA_HUBS
    if args.hub:
        wanted = set(args.hub)
        hubs = [h for h in CA_HUBS if h["slug"] in wanted]
        if not hubs:
            print("No matching hubs.", file=sys.stderr)
            return 2

    all_rows: list[dict[str, Any]] = []
    for hub in hubs:
        print(f"=== {hub['slug']} ({hub['city']}) ===", flush=True)
        rows = discover_hub(
            hub,
            max_per_hub=args.max_per_hub,
            pages=max(1, args.pages),
            sleep_s=max(0.2, args.sleep),
        )
        print(f"  discovered {len(rows)}", flush=True)
        all_rows.extend(rows)

    # Dedup across hubs
    by_id: dict[str, dict[str, Any]] = {}
    for row in all_rows:
        by_id[row["external_id"]] = row
    all_rows = list(by_id.values())
    print(f"Total unique: {len(all_rows)}", flush=True)

    if not args.apply:
        for row in all_rows[:15]:
            print(
                f"  - {row['external_id']}: {row['display_name'][:60]} | {row.get('city')} | {row.get('category')}",
                flush=True,
            )
        if len(all_rows) > 15:
            print(f"  … +{len(all_rows) - 15} more", flush=True)
        print("Dry-run only. Pass --apply to enqueue pending.", flush=True)
        return 0

    load_env()
    client = SupabaseRest.from_env()
    stats = upsert_pending(client, all_rows)
    print(f"Done: {stats}", flush=True)
    print(
        "Review in Admin → Inbox → Events — ждут выкладки (no auto-publish).",
        flush=True,
    )
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
