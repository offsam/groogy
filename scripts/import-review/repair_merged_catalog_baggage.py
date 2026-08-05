#!/usr/bin/env python3
"""Repair fill-empty baggage on already-merged catalog cards.

Donor live rows are gone after merge. Recover contacts / sources from:
  - domain_events business.merged (keep_id / drop_id)
  - import_review_items published onto keep (and folded duplicates)
  - orphaned queue/recs still pointing at drop_id
  - live cards with ≥2 distinct import source_urls (even without an event)

Strict fill-empty: never overwrite non-empty keep fields.
Secondary source_url → community_mention with source_record_id merged-source:…

Usage:
  python3 scripts/import-review/repair_merged_catalog_baggage.py --dry-run
  python3 scripts/import-review/repair_merged_catalog_baggage.py --dry-run --limit 50
  python3 scripts/import-review/repair_merged_catalog_baggage.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "data"

BIZ_SELECT = (
    "id,slug,name,phone,email,website,instagram_url,telegram_url,google_maps_url,"
    "booking_url,yelp_url,city,region,state_code,address_line,postal_code,"
    "description,short_description,image_url,contact_links,source_url,source_kind,status"
)
PRO_SELECT = (
    "id,slug,display_name,phone,email,website,instagram_url,telegram_url,booking_url,"
    "city,region,state_code,private_address_line,postal_code,description,"
    "short_description,image_url,contact_links,source_url,source_type,status"
)
QUEUE_SELECT = (
    "id,title,business_name,person_name,review_status,published_entity_id,"
    "published_entity_type,duplicate_of_item_id,duplicate_of_entity_id,"
    "duplicate_of_entity_type,source_url,source,phone,whatsapp,instagram,website,"
    "email,telegram_username,city,state,address_line,description,source_text,"
    "preview_image_url,created_at"
)
REC_SELECT = (
    "id,display_name,status,phones,instagram,websites,city,source_post_urls,"
    "published_entity_id,published_entity_type,duplicate_of_entity_id,"
    "duplicate_of_entity_type,created_at"
)

SOCIAL_HOST_RE = re.compile(
    r"instagram\.com|facebook\.com|fb\.com|t\.me/|telegram\.me|"
    r"tiktok\.com|wa\.me|whatsapp\.com|yelp\.com",
    re.I,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def empty(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str) and not v.strip():
        return True
    if isinstance(v, (list, dict)) and len(v) == 0:
        return True
    return False


def as_list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x).strip() for x in v if x is not None and str(x).strip()]
    s = str(v).strip()
    return [s] if s else []


def first_nonempty(values: list[str]) -> str | None:
    for v in values:
        if v and v.strip():
            return v.strip()
    return None


def normalize_source_url(raw: str | None) -> str | None:
    if not raw or not str(raw).strip():
        return None
    url = str(raw).strip().rstrip("/")
    if url.startswith("//"):
        url = "https:" + url
    if not re.match(r"^https?://", url, re.I):
        if url.startswith(("t.me/", "telegram.me/", "facebook.com", "fb.com", "www.")):
            url = "https://" + url.lstrip("/")
        else:
            return None
    try:
        u = urlparse(url)
        if not u.hostname:
            return None
        path = (u.path or "").rstrip("/")
        return f"{u.scheme.lower()}://{u.hostname.lower()}{path}"
    except Exception:  # noqa: BLE001
        return url.lower().rstrip("/")


def infer_source_kind(url: str, source: str | None = None) -> str | None:
    u = (url or "").lower()
    s = (source or "").lower()
    if "facebook.com" in u or "fb.com" in u or s.startswith("facebook"):
        return "facebook"
    if "t.me/" in u or "telegram.me" in u or s.startswith("telegram"):
        return "telegram"
    if any(
        x in u
        for x in ("svoi.us", "orange", "yellow", "to4ka", "echoru", "zerkalo")
    ):
        return "directory"
    return "directory" if url else None


def ig_url(raw: str | None) -> str | None:
    if not raw or not str(raw).strip():
        return None
    v = str(raw).strip()
    if re.match(r"^https?://", v, re.I):
        return v
    handle = re.sub(r"^@+", "", v).strip().strip("/")
    if not re.match(r"^[A-Za-z0-9._]{1,30}$", handle):
        return None
    if handle.lower() in {"gmail.com", "yahoo.com", "whatsapp", "telegram"}:
        return None
    return f"https://www.instagram.com/{handle}"


def tg_url(raw: str | None) -> str | None:
    if not raw or not str(raw).strip():
        return None
    v = str(raw).strip()
    if re.match(r"^https?://", v, re.I):
        return v
    handle = re.sub(r"^@+", "", v).strip()
    if not re.match(r"^[A-Za-z0-9_]{4,32}$", handle):
        return None
    if handle.lower() in {"telegram", "whatsapp"}:
        return None
    return f"https://t.me/{handle}"


def plain_website(urls: list[str]) -> str | None:
    for u in urls:
        if not u:
            continue
        if SOCIAL_HOST_RE.search(u):
            continue
        if re.match(r"^https?://", u, re.I):
            return u.strip()
        if "." in u and " " not in u:
            return "https://" + u.lstrip("/")
    return None


def phone_first(phones: list[str]) -> str | None:
    for p in phones:
        digits = re.sub(r"\D", "", p)
        if len(digits) >= 7:
            return p.strip()
    return None


def parse_contact_links(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        channel = str(item.get("channel") or "").strip().lower()
        value = str(item.get("value") or "").strip()
        if not channel or not value:
            continue
        label = item.get("label")
        label_s = str(label).strip()[:60] if label else None
        key = f"{channel}:{value.lower()}:{label_s or ''}"
        if key in seen:
            continue
        seen.add(key)
        out.append({"channel": channel, "value": value[:300], "label": label_s})
    return out


def union_contact_links(keep: Any, extra: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return parse_contact_links([*parse_contact_links(keep), *extra])


def fetch_all(
    client: SupabaseRest,
    table: str,
    select: str,
    *,
    extra: dict[str, str] | None = None,
    page: int = 500,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    last = "00000000-0000-0000-0000-000000000000"
    while True:
        params = {
            "select": select,
            "id": f"gt.{last}",
            "order": "id.asc",
            "limit": str(page),
            **(extra or {}),
        }
        batch = client._request("GET", f"/{table}", params=params) or []
        if not batch:
            break
        rows.extend(batch)
        last = str(batch[-1]["id"])
        if len(batch) < page:
            break
    return rows


def fetch_events(client: SupabaseRest) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/domain_events",
                params={
                    "select": "id,event_type,entity_id,payload,created_at",
                    "event_type": "eq.business.merged",
                    "order": "id.asc",
                    "offset": str(offset),
                    "limit": "500",
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < 500:
            break
    return rows


def queue_to_bag(item: dict[str, Any]) -> dict[str, Any]:
    phones = as_list(item.get("phone")) + as_list(item.get("whatsapp"))
    emails = as_list(item.get("email"))
    webs = as_list(item.get("website"))
    igs = as_list(item.get("instagram"))
    links: list[dict[str, Any]] = []
    for wa in as_list(item.get("whatsapp")):
        links.append({"channel": "whatsapp", "value": wa, "label": None})
    for w in webs:
        if "tiktok.com" in w.lower() or "vm.tiktok.com" in w.lower():
            links.append({"channel": "tiktok", "value": w, "label": None})
        elif "facebook.com" in w.lower() or "fb.com" in w.lower():
            links.append({"channel": "facebook", "value": w, "label": None})

    title = (
        item.get("business_name")
        or item.get("person_name")
        or item.get("title")
        or "источник"
    )
    desc = (item.get("description") or item.get("source_text") or "").strip() or None
    return {
        "origin": "import",
        "origin_id": item.get("id"),
        "label": str(title)[:120],
        "phone": phone_first(phones),
        "email": first_nonempty(emails),
        "website": plain_website(webs),
        "instagram_url": ig_url(first_nonempty(igs)),
        "telegram_url": tg_url(item.get("telegram_username")),
        "city": (item.get("city") or "").strip() or None,
        "state_code": (item.get("state") or "").strip() or None,
        "address_line": (item.get("address_line") or "").strip() or None,
        "description": desc,
        "image_url": (item.get("preview_image_url") or "").strip() or None,
        "source_url": normalize_source_url(item.get("source_url"))
        or (item.get("source_url") or "").strip()
        or None,
        "source_kind": infer_source_kind(
            str(item.get("source_url") or ""), item.get("source")
        ),
        "contact_links": links,
    }


def rec_to_bag(rec: dict[str, Any]) -> dict[str, Any]:
    phones = as_list(rec.get("phones"))
    igs = as_list(rec.get("instagram"))
    webs = as_list(rec.get("websites"))
    urls = as_list(rec.get("source_post_urls"))
    src = normalize_source_url(urls[0] if urls else None) or (
        urls[0] if urls else None
    )
    return {
        "origin": "recommendation",
        "origin_id": rec.get("id"),
        "label": str(rec.get("display_name") or "рекомендация")[:120],
        "phone": phone_first(phones),
        "email": None,
        "website": plain_website(webs),
        "instagram_url": ig_url(first_nonempty(igs)),
        "telegram_url": None,
        "city": (rec.get("city") or "").strip() or None,
        "state_code": None,
        "address_line": None,
        "description": None,
        "image_url": None,
        "source_url": src,
        "source_kind": infer_source_kind(str(src or "")),
        "contact_links": [],
    }


def build_patch(
    keep: dict[str, Any],
    bags: list[dict[str, Any]],
    *,
    kind: str,
) -> tuple[dict[str, Any], list[str], list[dict[str, str]]]:
    """Return patch, filled labels, secondary sources [{url,label}]."""
    patch: dict[str, Any] = {}
    filled: list[str] = []
    secondaries: list[dict[str, str]] = []

    def take(field: str, label: str, value: Any) -> None:
        if field in patch:
            return
        if empty(keep.get(field)) and not empty(value):
            patch[field] = value
            filled.append(label)

    extra_links: list[dict[str, Any]] = []
    keep_src_norm = normalize_source_url(keep.get("source_url"))
    seen_sec: set[str] = set()

    for bag in bags:
        take("phone", "телефон", bag.get("phone"))
        take("email", "email", bag.get("email"))
        take("website", "сайт", bag.get("website"))
        take("instagram_url", "instagram", bag.get("instagram_url"))
        take("telegram_url", "telegram", bag.get("telegram_url"))
        take("booking_url", "запись", bag.get("booking_url"))
        take("city", "город", bag.get("city"))
        take("state_code", "штат", bag.get("state_code"))
        take("postal_code", "ZIP", bag.get("postal_code"))
        take("image_url", "фото", bag.get("image_url"))
        if kind == "business":
            take("address_line", "адрес", bag.get("address_line"))
            take("yelp_url", "yelp", bag.get("yelp_url"))
            take("google_maps_url", "карты", bag.get("google_maps_url"))
        else:
            if empty(keep.get("private_address_line")) and not empty(
                bag.get("address_line")
            ):
                if "private_address_line" not in patch:
                    patch["private_address_line"] = bag["address_line"]
                    filled.append("адрес")

        keep_desc = str(keep.get("description") or "").strip()
        drop_desc = str(bag.get("description") or "").strip()
        if drop_desc and (
            not keep_desc or len(drop_desc) >= len(keep_desc) + 80
        ):
            if "description" not in patch or len(drop_desc) > len(
                str(patch.get("description") or "")
            ):
                patch["description"] = drop_desc
                if "описание" not in filled:
                    filled.append("описание")

        for link in bag.get("contact_links") or []:
            extra_links.append(link)

        src = bag.get("source_url")
        if not src:
            continue
        src_norm = normalize_source_url(src) or src.lower().rstrip("/")
        if empty(keep.get("source_url")) and "source_url" not in patch:
            patch["source_url"] = src
            kind_col = "source_kind" if kind == "business" else "source_type"
            if empty(keep.get(kind_col)) and bag.get("source_kind"):
                patch[kind_col] = bag["source_kind"]
            filled.append("источник")
            keep_src_norm = src_norm
        elif keep_src_norm and src_norm and src_norm != keep_src_norm:
            if src_norm not in seen_sec:
                seen_sec.add(src_norm)
                secondaries.append(
                    {"url": src, "label": str(bag.get("label") or "источник")[:120]}
                )
                if "второй источник" not in filled:
                    filled.append("второй источник")

    merged_links = union_contact_links(keep.get("contact_links"), extra_links)
    keep_links = parse_contact_links(keep.get("contact_links"))
    if len(merged_links) > len(keep_links):
        patch["contact_links"] = merged_links
        added = {l["channel"] for l in merged_links} - {
            l["channel"] for l in keep_links
        }
        filled.append(
            f"соцсети ({', '.join(sorted(added))})" if added else "соцсети"
        )

    return patch, list(dict.fromkeys(filled)), secondaries


def existing_mention_urls(
    client: SupabaseRest, *, kind: str, entity_id: str
) -> set[str]:
    table = (
        "professional_community_mentions"
        if kind == "professional"
        else "business_community_mentions"
    )
    fk = "professional_id" if kind == "professional" else "business_id"
    rows = (
        client._request(
            "GET",
            f"/{table}",
            params={
                "select": "source_url,source_record_id",
                fk: f"eq.{entity_id}",
                "limit": "200",
            },
        )
        or []
    )
    out: set[str] = set()
    for r in rows:
        n = normalize_source_url(r.get("source_url"))
        if n:
            out.add(n)
        rid = r.get("source_record_id")
        if isinstance(rid, str) and rid.startswith("merged-source:"):
            out.add(rid.replace("merged-source:", "", 1))
    return out


def insert_secondary_source(
    client: SupabaseRest,
    *,
    kind: str,
    entity_id: str,
    url: str,
    label: str,
    apply: bool,
) -> bool:
    norm = normalize_source_url(url) or url.lower().rstrip("/")
    record_id = f"merged-source:{norm}"
    table = (
        "professional_community_mentions"
        if kind == "professional"
        else "business_community_mentions"
    )
    fk = "professional_id" if kind == "professional" else "business_id"
    by_rid = (
        client._request(
            "GET",
            f"/{table}",
            params={
                "select": "id",
                fk: f"eq.{entity_id}",
                "source_record_id": f"eq.{record_id}",
                "limit": "1",
            },
        )
        or []
    )
    if by_rid:
        return False
    by_url = (
        client._request(
            "GET",
            f"/{table}",
            params={
                "select": "id",
                fk: f"eq.{entity_id}",
                "source_url": f"eq.{url}",
                "limit": "1",
            },
        )
        or []
    )
    if by_url:
        return False
    if not apply:
        return True
    body: dict[str, Any] = {
        fk: entity_id,
        "kind": "community_mention",
        "source_channel": "import",
        "source_label": label[:120],
        "source_url": url,
        "source_record_id": record_id,
        "status": "published",
        "published_at": now_iso(),
    }
    if kind == "business":
        body["snippet"] = f"Источник карточки при слиянии: {label}"[:500]
        body["author_label"] = "merge"
    client._request("POST", f"/{table}", body=body, prefer="return=minimal")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    apply = bool(args.apply)

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    events = fetch_events(client)
    keep_to_drops: dict[str, set[str]] = defaultdict(set)
    drop_to_keep: dict[str, str] = {}
    for ev in events:
        payload = ev.get("payload") or {}
        if not isinstance(payload, dict):
            continue
        keep_id = str(payload.get("keep_id") or ev.get("entity_id") or "")
        drop_id = str(payload.get("drop_id") or "")
        if keep_id and drop_id and keep_id != drop_id:
            keep_to_drops[keep_id].add(drop_id)
            drop_to_keep[drop_id] = keep_id

    print(f"merge events: {len(events)} keep cards: {len(keep_to_drops)}")

    queue = fetch_all(
        client,
        "import_review_items",
        QUEUE_SELECT,
        extra={"published_entity_id": "not.is.null"},
    )
    # Also pull rows that only have duplicate_of_entity_* (no published yet)
    queue_dup_entity = fetch_all(
        client,
        "import_review_items",
        QUEUE_SELECT,
        extra={"duplicate_of_entity_id": "not.is.null"},
    )
    seen_q = {str(r["id"]) for r in queue}
    for r in queue_dup_entity:
        if str(r["id"]) not in seen_q:
            queue.append(r)
            seen_q.add(str(r["id"]))

    print(f"queue rows with entity link: {len(queue)}")

    recs = fetch_all(
        client,
        "import_comment_recommendations",
        REC_SELECT,
        extra={"published_entity_id": "not.is.null"},
    )
    recs_dup = fetch_all(
        client,
        "import_comment_recommendations",
        REC_SELECT,
        extra={"duplicate_of_entity_id": "not.is.null"},
    )
    seen_r = {str(r["id"]) for r in recs}
    for r in recs_dup:
        if str(r["id"]) not in seen_r:
            recs.append(r)
            seen_r.add(str(r["id"]))
    print(f"recommendation rows with entity link: {len(recs)}")

    # Index queue by published entity and by drop orphan targets
    by_published: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    by_item_id: dict[str, dict[str, Any]] = {}
    children_of: dict[str, list[dict[str, Any]]] = defaultdict(list)
    orphan_queue_retarget: list[dict[str, Any]] = []

    for item in queue:
        by_item_id[str(item["id"])] = item
        et = str(item.get("published_entity_type") or "").lower()
        eid = item.get("published_entity_id")
        if eid and et in {"business", "professional"}:
            # Orphan: points at destroyed drop → retarget to keep
            drop_s = str(eid)
            if drop_s in drop_to_keep:
                keep_s = drop_to_keep[drop_s]
                orphan_queue_retarget.append(
                    {
                        "queue_id": item["id"],
                        "from_entity_id": drop_s,
                        "to_entity_id": keep_s,
                        "entity_type": "business",
                    }
                )
                by_published[("business", keep_s)].append(item)
            else:
                by_published[(et, str(eid))].append(item)
        det = str(item.get("duplicate_of_entity_type") or "").lower()
        did = item.get("duplicate_of_entity_id")
        if did and det in {"business", "professional"}:
            by_published[(det, str(did))].append(item)

    for item in queue:
        parent = item.get("duplicate_of_item_id")
        if parent:
            children_of[str(parent)].append(item)

    by_rec: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    orphan_rec_retarget: list[dict[str, Any]] = []
    for rec in recs:
        et = str(rec.get("published_entity_type") or "").lower()
        eid = rec.get("published_entity_id")
        if eid and et in {"business", "professional"}:
            drop_s = str(eid)
            if drop_s in drop_to_keep:
                keep_s = drop_to_keep[drop_s]
                orphan_rec_retarget.append(
                    {
                        "rec_id": rec["id"],
                        "from_entity_id": drop_s,
                        "to_entity_id": keep_s,
                        "entity_type": "business",
                    }
                )
                by_rec[("business", keep_s)].append(rec)
            else:
                by_rec[(et, str(eid))].append(rec)
        det = str(rec.get("duplicate_of_entity_type") or "").lower()
        did = rec.get("duplicate_of_entity_id")
        if did and det in {"business", "professional"}:
            by_rec[(det, str(did))].append(rec)

    # Candidate keep ids: merge keeps + multi-source published entities
    candidates: dict[tuple[str, str], str] = {}
    for keep_id in keep_to_drops:
        candidates[("business", keep_id)] = "merge_event"

    for (et, eid), items in by_published.items():
        urls = {
            normalize_source_url(i.get("source_url")) or str(i.get("source_url") or "").strip()
            for i in items
            if i.get("source_url")
        }
        urls.discard("")
        urls.discard("None")
        # Also count folded children of published items
        for item in list(items):
            for ch in children_of.get(str(item["id"]), []):
                u = normalize_source_url(ch.get("source_url")) or (
                    str(ch.get("source_url") or "").strip()
                )
                if u:
                    urls.add(u)
        if len(urls) >= 2 or len(items) >= 2:
            candidates.setdefault((et, eid), "multi_source")

    for (et, eid), items in by_rec.items():
        if len(items) >= 2:
            candidates.setdefault((et, eid), "multi_rec")

    print(f"candidate keep cards: {len(candidates)}")

    # Load live cards for candidates
    biz_ids = [eid for (et, eid) in candidates if et == "business"]
    pro_ids = [eid for (et, eid) in candidates if et == "professional"]

    def fetch_by_ids(
        table: str, select: str, ids: list[str]
    ) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for i in range(0, len(ids), 80):
            chunk = ids[i : i + 80]
            if not chunk:
                continue
            values = ",".join(chunk)
            rows = (
                client._request(
                    "GET",
                    f"/{table}",
                    params={"select": select, "id": f"in.({values})"},
                )
                or []
            )
            for r in rows:
                out[str(r["id"])] = r
        return out

    businesses = fetch_by_ids("businesses", BIZ_SELECT, biz_ids)
    professionals = fetch_by_ids("professionals", PRO_SELECT, pro_ids)
    print(
        f"live keeps found: businesses={len(businesses)} professionals={len(professionals)}"
    )

    repairs: list[dict[str, Any]] = []
    skipped_gone = 0

    ordered = sorted(candidates.items(), key=lambda x: (x[0][0], x[0][1]))
    if args.limit is not None:
        ordered = ordered[: args.limit]

    for (et, eid), reason in ordered:
        live = businesses.get(eid) if et == "business" else professionals.get(eid)
        if not live:
            skipped_gone += 1
            continue
        if str(live.get("status") or "") == "archived":
            continue

        bags: list[dict[str, Any]] = []
        for item in by_published.get((et, eid), []):
            bags.append(queue_to_bag(item))
            for ch in children_of.get(str(item["id"]), []):
                bags.append(queue_to_bag(ch))
        for drop_id in keep_to_drops.get(eid, set()):
            for item in queue:
                if str(item.get("published_entity_id") or "") == drop_id:
                    bags.append(queue_to_bag(item))
                    for ch in children_of.get(str(item["id"]), []):
                        bags.append(queue_to_bag(ch))

        for rec in by_rec.get((et, eid), []):
            bags.append(rec_to_bag(rec))

        # Dedupe bags by origin_id
        seen_bag: set[str] = set()
        uniq_bags: list[dict[str, Any]] = []
        for b in bags:
            key = f"{b.get('origin')}:{b.get('origin_id')}"
            if key in seen_bag:
                continue
            seen_bag.add(key)
            uniq_bags.append(b)

        if not uniq_bags:
            continue

        patch, filled, secondaries = build_patch(live, uniq_bags, kind=et)
        # Filter secondaries already present as mentions
        if secondaries:
            have = existing_mention_urls(client, kind=et, entity_id=eid)
            keep_n = normalize_source_url(live.get("source_url"))
            if keep_n:
                have.add(keep_n)
            if patch.get("source_url"):
                pn = normalize_source_url(str(patch["source_url"]))
                if pn:
                    have.add(pn)
            secondaries = [
                s
                for s in secondaries
                if (normalize_source_url(s["url"]) or s["url"].lower()) not in have
            ]
            if not secondaries and "второй источник" in filled:
                filled = [f for f in filled if f != "второй источник"]

        if not patch and not secondaries:
            continue

        name = live.get("name") or live.get("display_name") or eid
        repairs.append(
            {
                "entity_type": et,
                "entity_id": eid,
                "slug": live.get("slug"),
                "name": name,
                "reason": reason,
                "filled": filled,
                "patch": patch,
                "secondary_sources": secondaries,
                "donor_bags": len(uniq_bags),
            }
        )

    # Deduplicate orphan retargets
    oq_seen: set[str] = set()
    orphan_queue_clean: list[dict[str, Any]] = []
    for row in orphan_queue_retarget:
        k = str(row["queue_id"])
        if k in oq_seen:
            continue
        oq_seen.add(k)
        orphan_queue_clean.append(row)

    or_seen: set[str] = set()
    orphan_rec_clean: list[dict[str, Any]] = []
    for row in orphan_rec_retarget:
        k = str(row["rec_id"])
        if k in or_seen:
            continue
        or_seen.add(k)
        orphan_rec_clean.append(row)

    summary = {
        "mode": "apply" if apply else "dry_run",
        "merge_events": len(events),
        "candidates": len(candidates),
        "skipped_missing_live": skipped_gone,
        "repairs": len(repairs),
        "orphan_queue_retarget": len(orphan_queue_clean),
        "orphan_rec_retarget": len(orphan_rec_clean),
        "field_fill_counts": defaultdict(int),
    }
    for r in repairs:
        for f in r["filled"]:
            summary["field_fill_counts"][f] += 1
    summary["field_fill_counts"] = dict(summary["field_fill_counts"])

    print(json.dumps({k: v for k, v in summary.items() if k != "samples"}, ensure_ascii=False, indent=2))
    print("--- samples ---")
    for r in repairs[:12]:
        print(
            f"  [{r['entity_type']}] {r['name'][:50]} · {', '.join(r['filled']) or 'sources only'}"
            f" · bags={r['donor_bags']} · secs={len(r['secondary_sources'])}"
        )

    if apply:
        applied = 0
        for r in repairs:
            table = "businesses" if r["entity_type"] == "business" else "professionals"
            body = {**r["patch"], "updated_at": now_iso()} if r["patch"] else {}
            if body:
                client.patch(table, {"id": f"eq.{r['entity_id']}"}, body)
            for sec in r["secondary_sources"]:
                insert_secondary_source(
                    client,
                    kind=r["entity_type"],
                    entity_id=r["entity_id"],
                    url=sec["url"],
                    label=sec["label"],
                    apply=True,
                )
            applied += 1

        for row in orphan_queue_clean:
            client.patch(
                "import_review_items",
                {"id": f"eq.{row['queue_id']}"},
                {
                    "published_entity_type": row["entity_type"],
                    "published_entity_id": row["to_entity_id"],
                    "updated_at": now_iso(),
                },
            )
        for row in orphan_rec_clean:
            client.patch(
                "import_comment_recommendations",
                {"id": f"eq.{row['rec_id']}"},
                {
                    "published_entity_type": row["entity_type"],
                    "published_entity_id": row["to_entity_id"],
                    "updated_at": now_iso(),
                },
            )
        print(
            f"applied repairs={applied} orphan_queue={len(orphan_queue_clean)} "
            f"orphan_rec={len(orphan_rec_clean)}"
        )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        **summary,
        "repairs": repairs,
        "orphan_queue_retarget": orphan_queue_clean,
        "orphan_rec_retarget": orphan_rec_clean,
    }
    path = OUT_DIR / f"repair_merged_catalog_baggage_{summary['mode']}_{stamp}.json"
    latest = OUT_DIR / f"repair_merged_catalog_baggage_{summary['mode']}_latest.json"
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")
    latest.write_text(text, encoding="utf-8")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
