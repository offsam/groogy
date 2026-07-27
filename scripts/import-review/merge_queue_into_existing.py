#!/usr/bin/env python3
"""Merge open import-review queue items into already-published businesses.

Match keys (strong only):
  - shared phone
  - shared Instagram handle
  - shared website host (non-social)

On match: call service_enrich_business_from_queue (fill empty business fields,
mark queue item approved → existing business). Removes the card from needs-review.

Usage:
  python3 scripts/import-review/merge_queue_into_existing.py --dry-run
  python3 scripts/import-review/merge_queue_into_existing.py --dry-run --limit 50
  python3 scripts/import-review/merge_queue_into_existing.py --apply --limit 100
  python3 scripts/import-review/merge_queue_into_existing.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402
from description_merge import similarity  # noqa: E402
from eligibility import normalize_instagram, normalize_phone  # noqa: E402

OPEN = ("pending", "in_review", "needs_more_info", "ready_to_publish")
BIZ_STATUSES = ("approved", "pending", "deferred")
JUNK_TITLES = {
    "messenger",
    "gmail.com",
    "whatsapp",
    "telegram",
    "yahoo.com",
    "телефон",
    "контакты",
    "phone",
    "contact",
    "contacts",
    "звоните",
    "call",
    "пиши",
    "пишите",
    "лс",
}


def item_title(item: dict[str, Any]) -> str:
    for field in ("business_name", "title", "person_name"):
        v = (item.get(field) or "").strip()
        if v:
            return v
    return ""


def titles_compatible(queue_title: str, business_name: str, *, desc: str = "") -> bool:
    """Avoid enriching the wrong business when a polluted phone/IG is shared."""
    qt = (queue_title or "").strip()
    bn = (business_name or "").strip()
    if not bn:
        return False
    if bn.lower() in JUNK_TITLES:
        return False
    # Junk queue titles: only allow if description mentions the business brand
    if qt.lower() in JUNK_TITLES or not qt:
        brand = bn.lower()
        blob = f"{desc}".lower()
        # require a distinctive brand token (≥4 chars) from business name in description
        tokens = [t for t in re.split(r"[^\w]+", brand, flags=re.UNICODE) if len(t) >= 4]
        # drop generic service words that appear in many ads
        generic = {
            "service",
            "services",
            "studio",
            "center",
            "центр",
            "услуги",
            "компания",
            "регистрация",
            "online",
            "онлайн",
        }
        tokens = [t for t in tokens if t not in generic]
        return any(t in blob for t in tokens[:4]) if tokens else False

    a, b = qt.lower(), bn.lower()
    if a == b:
        return True
    if a in b or b in a:
        return True
    # Instagram-style handles often match slug/name loosely
    a_clean = a.lstrip("@").replace("_", " ").replace(".", " ")
    b_clean = b.lstrip("@").replace("_", " ").replace(".", " ")
    if a_clean == b_clean or a_clean in b_clean or b_clean in a_clean:
        return True
    if similarity(a_clean, b_clean) >= 0.45:
        return True
    return False


def ig_handle_from_url(url: str | None) -> str | None:
    if not url:
        return None
    return normalize_instagram(url)


def website_host(url: str | None) -> str | None:
    if not url:
        return None
    raw = str(url).strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = "https://" + raw
    try:
        host = (urlparse(raw).hostname or "").lower().removeprefix("www.")
    except Exception:
        return None
    if not host or "." not in host:
        return None
    if host in {
        "instagram.com",
        "facebook.com",
        "fb.com",
        "t.me",
        "telegram.me",
        "wa.me",
        "linktr.ee",
        "eventbrite.com",
        "meetup.com",
        "google.com",
        "maps.google.com",
        "youtu.be",
        "youtube.com",
        "tiktok.com",
        "twitter.com",
        "x.com",
        "bit.ly",
        "forms.gle",
        "docs.google.com",
    }:
        return None
    # shared multi-tenant hosts without distinctive subdomain already filtered;
    # still block bare platforms often pasted as "website"
    if host.endswith(".eventbrite.com") or host.endswith(".meetup.com"):
        return None
    return host


def fetch_open_queue(client: SupabaseRest, *, limit: int | None) -> list[dict[str, Any]]:
    """Fetch all open unpublished queue rows (keyset pagination — offset is unreliable)."""
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    last_id = "00000000-0000-0000-0000-000000000000"
    while True:
        batch = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": (
                        "id,title,business_name,person_name,description,source_text,"
                        "phone,whatsapp,instagram,website,email,city,state,category,"
                        "entity_type,target_collection,telegram_username,"
                        "preview_image_url,occurrence_count,source"
                    ),
                    "review_status": f"in.({','.join(OPEN)})",
                    "published_entity_id": "is.null",
                    "id": f"gt.{last_id}",
                    "order": "id.asc",
                    "limit": "500",
                },
            )
            or []
        )
        if not batch:
            break
        for row in batch:
            rid = str(row.get("id") or "")
            if not rid or rid in seen:
                continue
            seen.add(rid)
            rows.append(row)
            last_id = rid
        if limit is not None and len(rows) >= limit * 4:
            break
        if len(batch) < 500:
            break
    return rows


def fetch_businesses(client: SupabaseRest) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    last_id = "00000000-0000-0000-0000-000000000000"
    while True:
        batch = (
            client._request(
                "GET",
                "/businesses",
                params={
                    "select": "id,name,slug,phone,email,website,instagram_url,city,status",
                    "status": f"in.({','.join(BIZ_STATUSES)})",
                    "id": f"gt.{last_id}",
                    "order": "id.asc",
                    "limit": "500",
                },
            )
            or []
        )
        if not batch:
            break
        for row in batch:
            rid = str(row.get("id") or "")
            if not rid or rid in seen:
                continue
            seen.add(rid)
            rows.append(row)
            last_id = rid
        if len(batch) < 500:
            break
    return rows


def build_business_indexes(
    businesses: list[dict[str, Any]],
) -> tuple[
    dict[str, list[dict[str, Any]]],
    dict[str, list[dict[str, Any]]],
    dict[str, list[dict[str, Any]]],
]:
    by_phone: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_ig: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for b in businesses:
        phone = normalize_phone(str(b.get("phone") or ""))
        if phone:
            by_phone[phone].append(b)
        ig = ig_handle_from_url(b.get("instagram_url"))
        if ig:
            by_ig[ig.lower()].append(b)
        host = website_host(b.get("website"))
        if host:
            by_host[host].append(b)
    return by_phone, by_ig, by_host


def match_business(
    item: dict[str, Any],
    by_phone: dict[str, list[dict[str, Any]]],
    by_ig: dict[str, list[dict[str, Any]]],
    by_host: dict[str, list[dict[str, Any]]] | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    """Return (business, match_reason) or (None, None)."""
    qtitle = item_title(item)
    desc = f"{item.get('description') or ''}\n{item.get('source_text') or ''}"
    by_host = by_host or {}

    def brand_signal(biz: dict[str, Any]) -> bool:
        """Require evidence the queue ad is about this business, not a polluted phone."""
        bname = str(biz.get("name") or "")
        if titles_compatible(qtitle, bname, desc=desc):
            return True
        tokens = [
            t
            for t in re.split(r"[^\w]+", bname.lower(), flags=re.UNICODE)
            if len(t) >= 4
            and t
            not in {
                "service",
                "services",
                "studio",
                "center",
                "центр",
                "llc",
                "inc",
                "group",
                "adult",
                "health",
                "care",
                "day",
            }
        ]
        blob_l = desc.lower()
        title_l = (qtitle or "").lower().replace(" ", "")
        if any(t in blob_l for t in tokens[:5]):
            return True
        if any(t in title_l for t in tokens[:5]):
            return True
        host = website_host(biz.get("website"))
        if host and host in blob_l:
            return True
        # Strong: queue title equals business name (non-junk)
        if (
            qtitle
            and qtitle.lower() not in JUNK_TITLES
            and normalize_name_key(qtitle) == normalize_name_key(bname)
            and len(normalize_name_key(qtitle)) >= 8
        ):
            return True
        return False

    def pick(
        hits: list[dict[str, Any]], reason: str, *, allow_unique_soft: bool = True
    ) -> tuple[dict[str, Any] | None, str | None]:
        compatible = [
            h
            for h in hits
            if titles_compatible(qtitle, str(h.get("name") or ""), desc=desc)
        ]
        if len(compatible) == 1:
            return compatible[0], reason
        if len(compatible) > 1:
            # Prefer highest name similarity
            compatible.sort(
                key=lambda h: similarity(
                    qtitle.lower().replace("_", " "),
                    str(h.get("name") or "").lower(),
                ),
                reverse=True,
            )
            top = compatible[0]
            second = compatible[1]
            if similarity(qtitle.lower(), str(top.get("name") or "").lower()) >= 0.55 and (
                similarity(qtitle.lower(), str(top.get("name") or "").lower())
                - similarity(qtitle.lower(), str(second.get("name") or "").lower())
                >= 0.1
            ):
                return top, reason
            return None, None
        # Unique published contact + brand evidence (junk titles like «Звоните» OK
        # when description mentions the business / its site).
        if allow_unique_soft and len(hits) == 1 and brand_signal(hits[0]):
            return hits[0], f"{reason}|soft_unique"
        return None, None

    phones: list[str] = []
    for raw in list(item.get("phone") or []) + list(item.get("whatsapp") or []):
        n = normalize_phone(str(raw))
        if n and n not in phones:
            phones.append(n)

    for phone in phones:
        hits = by_phone.get(phone) or []
        if not hits:
            continue
        found = pick(hits, f"phone:{phone}")
        if found[0]:
            return found

    igs: list[str] = []
    for raw in item.get("instagram") or []:
        n = normalize_instagram(str(raw))
        if n and n.lower() not in igs:
            igs.append(n.lower())

    for ig in igs:
        hits = by_ig.get(ig) or []
        if not hits:
            continue
        found = pick(hits, f"instagram:@{ig}")
        if found[0]:
            return found

    website_raw = item.get("website")
    hosts: list[str] = []
    if isinstance(website_raw, list):
        for raw in website_raw:
            h = website_host(str(raw) if raw else None)
            if h and h not in hosts:
                hosts.append(h)
    else:
        h = website_host(str(website_raw) if website_raw else None)
        if h:
            hosts.append(h)
    for host in hosts:
        hits = by_host.get(host) or []
        if not hits:
            continue
        found = pick(hits, f"website:{host}")
        if found[0]:
            return found

    return None, None


def normalize_name_key(name: str) -> str:
    s = (name or "").lower().replace("_", " ").replace(".", " ")
    s = re.sub(r"[^\w\s]+", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def build_name_index(
    businesses: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for b in businesses:
        key = normalize_name_key(str(b.get("name") or ""))
        if len(key) < 5:
            continue
        by_name[key].append(b)
    return by_name


_GENERIC_NAME_KEYS = {
    "александр",
    "александра",
    "алексей",
    "анна",
    "мария",
    "маша",
    "елена",
    "ольга",
    "наталья",
    "наталия",
    "ирина",
    "татьяна",
    "юлия",
    "юля",
    "дмитрий",
    "сергей",
    "андрей",
    "максим",
    "иван",
    "нина",
    "ина",
    "ida",
    "alex",
    "anna",
    "maria",
    "elena",
    "olga",
    "natalia",
    "irina",
    "julia",
    "yulia",
    "dmitry",
    "andrei",
    "maxim",
    "ivan",
    "звоните",
    "телефон",
    "messenger",
    "whatsapp",
    "telegram",
    "контакты",
    "user",
    "unknown",
}


def match_business_by_name(
    item: dict[str, Any],
    by_name: dict[str, list[dict[str, Any]]],
) -> tuple[dict[str, Any] | None, str | None]:
    """Exact/near-exact display name → published business (no contact required)."""
    title = item_title(item)
    key = normalize_name_key(title)
    if len(key) < 8 or key in _GENERIC_NAME_KEYS:
        return None, None
    tokens = [t for t in key.split() if len(t) >= 2]
    # Single short token names are too ambiguous (Александр, Anna, …)
    if len(tokens) < 2 and len(key) < 12:
        return None, None
    hits = by_name.get(key) or []
    if len(hits) == 1:
        return hits[0], f"name:{key}"
    # Compact form without spaces (IG-style vs spaced brand)
    compact = key.replace(" ", "")
    if len(compact) >= 10:
        compact_hits = [
            b
            for k, lst in by_name.items()
            if k.replace(" ", "") == compact
            for b in lst
        ]
        seen: set[str] = set()
        uniq: list[dict[str, Any]] = []
        for b in compact_hits:
            bid = str(b.get("id"))
            if bid not in seen:
                seen.add(bid)
                uniq.append(b)
        if len(uniq) == 1:
            return uniq[0], f"name_compact:{compact}"
    return None, None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Merge queue cards into existing published businesses"
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    if args.dry_run and args.apply:
        print("Use only one of --dry-run / --apply", file=sys.stderr)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    queue = fetch_open_queue(client, limit=args.limit)
    businesses = fetch_businesses(client)
    by_phone, by_ig, by_host = build_business_indexes(businesses)
    by_name = build_name_index(businesses)

    matches: list[dict[str, Any]] = []
    seen_items: set[str] = set()
    for item in queue:
        item_id = str(item.get("id") or "")
        if not item_id or item_id in seen_items:
            continue
        biz, reason = match_business(item, by_phone, by_ig, by_host)
        if not biz:
            biz, reason = match_business_by_name(item, by_name)
        if not biz or not reason:
            continue
        seen_items.add(item_id)
        matches.append(
            {
                "item_id": item["id"],
                "item_title": item.get("business_name") or item.get("title"),
                "business_id": biz["id"],
                "business_name": biz.get("name"),
                "business_slug": biz.get("slug"),
                "match": reason,
                "occurrence_count": item.get("occurrence_count"),
            }
        )
        if args.limit is not None and len(matches) >= args.limit:
            break

    from collections import Counter

    print(
        json.dumps(
            {
                "queue_scanned": len(queue),
                "businesses_indexed": len(businesses),
                "matches": len(matches),
                "by_match_kind": dict(
                    Counter(
                        (m["match"].split(":")[0].split("|")[0]) for m in matches
                    )
                ),
                "mode": "dry_run" if args.dry_run else "apply",
                "sample": matches[:15],
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    if args.dry_run:
        out = (
            ROOT
            / "scripts"
            / "import-review"
            / "data"
            / "merge_queue_into_existing_dry_run.json"
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps({"matches": matches}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Wrote {out}")
        return 0

    ok = 0
    fail = 0
    results: list[dict[str, Any]] = []
    for m in matches:
        try:
            res = client.rpc_call(
                "service_enrich_business_from_queue",
                {
                    "p_item_id": m["item_id"],
                    "p_business_id": m["business_id"],
                    "p_note": f"Авто-merge по {m['match']}",
                },
            )
            ok += 1
            results.append({"match": m, "result": res})
        except Exception as exc:
            fail += 1
            results.append({"match": m, "error": str(exc)[:300]})

    print(json.dumps({"ok": ok, "fail": fail, "results": results[:20]}, ensure_ascii=False, indent=2))
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
