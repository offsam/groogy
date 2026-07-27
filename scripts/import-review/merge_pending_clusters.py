#!/usr/bin/env python3
"""Merge duplicate pending import-review cards that are the same profile.

Rules (product):
- Completely identical / recurring ads → keep one, mark rest as duplicate.
- Same profile (phone / IG / Telegram / website), different service ads →
  keep one card, union services + merge description; entity_type =
  business (if business name/signals) else private_specialist.
- Doubtful clusters are skipped and written to a manual-review report.

Usage:
  python3 scripts/import-review/merge_pending_clusters.py --dry-run
  python3 scripts/import-review/merge_pending_clusters.py --apply
  python3 scripts/import-review/merge_pending_clusters.py --apply --source-key telegram:la_orange_county
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
from description_merge import merge_descriptions, similarity  # noqa: E402
from eligibility import (  # noqa: E402
    normalize_instagram,
    normalize_phone,
    normalize_website,
)

OPEN_STATUSES = {"pending", "in_review", "ready_to_publish", "needs_more_info"}
JUNK_TITLES = {
    "messenger",
    "gmail.com",
    "whatsapp",
    "telegram",
    "yahoo.com",
    "mail.com",
    "instagram",
    "facebook",
    "unknown",
    "user",
    "la_orangecounty_bot",
    "звоните",
    "телефон",
}
GENERIC_LISTING_TITLES = {"комната", "дом", "квартира", "студия", "room", "house"}
BUSINESS_HINT_RE = re.compile(
    r"\b(llc|inc\.?|corp\.?|company|компани[яи]|студия|салон|агентство|"
    r"центр|clinic|group|insurance|школа|academy)\b",
    re.I,
)
EMOJI_ONLY_RE = re.compile(
    r"^[\W_\d\s"
    r"\U0001F300-\U0001FAFF\U00002700-\U000027BF\U0001F1E0-\U0001F1FF]+$",
    re.UNICODE,
)

ENTITY_TO_COLLECTION = {
    "business": "businesses",
    "private_specialist": "private_specialists",
    "marketplace_listing": "marketplace",
    "job": "jobs",
    "real_estate": "real_estate",
    "event": "events",
    "organization": "organizations",
}


def normalize_email(raw: str) -> str | None:
    value = (raw or "").strip().lower()
    if not value or "@" not in value or "." not in value.split("@")[-1]:
        return None
    return value


GENERIC_WEB_HOSTS = {
    "instagram.com",
    "t.me",
    "wa.me",
    "facebook.com",
    "fb.watch",
    "google.com",
    "maps.google.com",
    "maps.app.goo.gl",
    "goo.gl",
    "youtube.com",
    "youtu.be",
    "linktr.ee",
    "bit.ly",
    "t.co",
    "wa.link",
    "booksy.com",
}


def website_host_key(raw: str) -> str | None:
    href = normalize_website(raw)
    if not href:
        return None
    try:
        host = (urlparse(href).hostname or "").lower()
    except Exception:  # noqa: BLE001
        return None
    if host.startswith("www."):
        host = host[4:]
    if not host or host in GENERIC_WEB_HOSTS:
        return None
    # Shared SaaS booking / maps hosts
    if host.endswith(
        (
            ".google.com",
            ".goo.gl",
            ".youtube.com",
            ".linktr.ee",
            ".bit.ly",
            ".booksy.com",
            ".fb.watch",
        )
    ):
        return None
    return host


def is_junk_title(raw: str | None) -> bool:
    t = (raw or "").strip().lower()
    if not t:
        return True
    if t in JUNK_TITLES:
        return True
    if EMOJI_ONLY_RE.match(t) and len(t) <= 8:
        return True
    if t.endswith((".com", ".net", ".org")) and " " not in t:
        return True
    return False


def display_title(row: dict[str, Any]) -> str:
    return (
        row.get("business_name")
        or row.get("title")
        or row.get("person_name")
        or ""
    ).strip()


def contact_keys(row: dict[str, Any]) -> set[str]:
    """Keys used only for clustering (high confidence)."""
    keys: set[str] = set()
    for p in row.get("phone") or []:
        n = normalize_phone(str(p))
        if n:
            keys.add(f"phone:{n}")
    for ig in row.get("instagram") or []:
        n = normalize_instagram(str(ig))
        if n:
            keys.add(f"ig:{n}")
    tg = (row.get("telegram_username") or "").strip().lstrip("@").lower()
    if tg and tg not in {"telegram", "whatsapp"}:
        # Skip obvious group/channel bots that glue unrelated ads
        if not re.search(r"group|channel|chat|bot$|orangecounty|la_|sac_", tg):
            keys.add(f"tg:{tg}")
    for w in row.get("website") or []:
        host = website_host_key(str(w))
        if host:
            keys.add(f"web:{host}")
    # Strong display-name key (alphabetical twin cards without shared phone yet)
    title = display_title(row)
    if title and not is_junk_title(title):
        norm = re.sub(r"[^\w\s]+", " ", title.lower(), flags=re.UNICODE)
        norm = re.sub(r"\s+", " ", norm).strip()
        tokens = [t for t in norm.split() if len(t) >= 2]
        if len(norm) >= 10 and (len(tokens) >= 2 or len(norm) >= 14):
            keys.add(f"name:{norm}")
    return keys


def all_contact_keys(row: dict[str, Any]) -> set[str]:
    keys = contact_keys(row)
    for e in row.get("email") or []:
        n = normalize_email(str(e))
        if n:
            keys.add(f"email:{n}")
    return keys


def completeness_score(row: dict[str, Any]) -> tuple:
    keys = contact_keys(row)
    title = display_title(row)
    desc = (row.get("description") or "").lower()
    brand_hit = 0
    for ig in row.get("instagram") or []:
        n = normalize_instagram(str(ig))
        if n and n.lower() in desc.replace(" ", ""):
            brand_hit += 3
        if n and n.split(".")[0].lower() in desc:
            brand_hit += 2
    if "kalinka" in desc and "паспорт" in desc:
        brand_hit += 5
    return (
        brand_hit,
        0 if is_junk_title(title) else 2,
        1 if row.get("business_name") else 0,
        len(keys),
        min(len(desc), 2000),
        int(row.get("photos_count") or 0),
        int(row.get("occurrence_count") or 0),
        row.get("source_posted_at") or "",
    )


def union_lists(*lists: list | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for lst in lists:
        for raw in lst or []:
            v = str(raw).strip()
            if not v:
                continue
            key = v.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(v)
    return out


def pick_best_title(rows: list[dict[str, Any]]) -> str | None:
    candidates: list[str] = []
    for r in rows:
        for field in ("business_name", "title", "person_name"):
            v = (r.get(field) or "").strip()
            if v and not is_junk_title(v):
                candidates.append(v)
    if not candidates:
        return None
    candidates.sort(key=lambda s: (len(s) > 60, len(s)))
    return candidates[0][:120]


def pick_best_description(rows: list[dict[str, Any]], title: str | None = None) -> str | None:
    return merge_descriptions(rows, title=title)


def pick_entity_routing(rows: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """business card vs specialist vs keep typed lanes (job/RE/mkt/event)."""
    types = [str(r.get("entity_type")) for r in rows if r.get("entity_type")]
    for special in ("job", "real_estate", "marketplace_listing", "event", "organization"):
        if types.count(special) >= max(1, (len(types) + 1) // 2):
            return special, ENTITY_TO_COLLECTION.get(special)

    business_votes = 0
    for r in rows:
        bn = (r.get("business_name") or "").strip()
        title = display_title(r)
        blob = f"{bn} {title} {r.get('description') or ''}"
        if r.get("entity_type") == "business":
            business_votes += 2
        if bn and bn.lower() != (r.get("person_name") or "").strip().lower():
            if BUSINESS_HINT_RE.search(bn) or BUSINESS_HINT_RE.search(blob):
                business_votes += 2
            elif len(bn) >= 4 and " " in bn:
                business_votes += 1
        if BUSINESS_HINT_RE.search(blob):
            business_votes += 1

    if business_votes >= 2 or types.count("business") > types.count("private_specialist"):
        return "business", "businesses"
    return "private_specialist", "private_specialists"


def titles_compatible(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Avoid chaining unrelated businesses that only share a bad phone/IG."""
    title_a = display_title(a)
    title_b = display_title(b)
    desc_a = a.get("description") or ""
    desc_b = b.get("description") or ""

    igs_a = {
        normalize_instagram(str(ig))
        for ig in (a.get("instagram") or [])
        if normalize_instagram(str(ig))
    }
    igs_b = {
        normalize_instagram(str(ig))
        for ig in (b.get("instagram") or [])
        if normalize_instagram(str(ig))
    }
    shared = {x.lower() for x in igs_a & igs_b if x}
    if shared:
        blob = f"{title_a} {title_b} {desc_a} {desc_b}".lower()
        if not any(ig in blob.replace(" ", "") or ig.split(".")[0] in blob for ig in shared):
            phones_a = {
                normalize_phone(str(p)) for p in (a.get("phone") or []) if normalize_phone(str(p))
            }
            phones_b = {
                normalize_phone(str(p)) for p in (b.get("phone") or []) if normalize_phone(str(p))
            }
            if not (phones_a & phones_b) or similarity(desc_a, desc_b) < 0.45:
                return False

    if is_junk_title(title_a) or is_junk_title(title_b):
        return similarity(desc_a, desc_b) >= 0.25 or not desc_a or not desc_b

    ta = title_a.lower()
    tb = title_b.lower()
    if ta == tb:
        return True
    if ta in tb or tb in ta:
        return True
    if similarity(title_a, title_b) >= 0.5:
        return True
    if similarity(desc_a, desc_b) >= 0.45:
        return True
    return False


def _same_recurring_ad(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Near-identical listing body → treat as the same recurring ad."""
    da = (a.get("description") or a.get("source_text") or "").strip()
    db = (b.get("description") or b.get("source_text") or "").strip()
    if len(da) < 40 or len(db) < 40:
        return False
    if da == db:
        return True
    return similarity(da, db) >= 0.72


def cluster_kind(rows: list[dict[str, Any]]) -> str:
    """exact_duplicate | profile_multi_service."""
    titles = []
    for r in rows:
        t = display_title(r).lower()
        if t and not is_junk_title(t):
            titles.append(t)
    uniq = set(titles)
    if len(uniq) <= 1:
        return "exact_duplicate"
    if all(similarity(a, b) >= 0.78 for i, a in enumerate(titles) for b in titles[i + 1 :]):
        return "exact_duplicate"
    # Same body across cards → recurring ad even with mixed titles
    descs = [(r.get("description") or "").strip() for r in rows if (r.get("description") or "").strip()]
    if len(descs) >= 2 and all(similarity(descs[0], d) >= 0.72 for d in descs[1:]):
        return "exact_duplicate"
    return "profile_multi_service"


def is_doubtful_cluster(rows: list[dict[str, Any]], kind: str) -> tuple[bool, str]:
    titles = [display_title(r) for r in rows]
    clean = [t for t in titles if t and not is_junk_title(t)]
    if any(EMOJI_ONLY_RE.match(t.strip()) for t in titles if t) and not clean:
        return True, "emoji_or_symbol_title"
    # CTA-only titles are OK when description bodies match (recurring business ads)
    cta_only = all(
        (not t) or is_junk_title(t) or (t or "").strip().lower() in {"звоните", "телефон"}
        for t in titles
    )
    descs = [(r.get("description") or "").strip() for r in rows]
    bodies_match = (
        len(descs) >= 2
        and min(len(d) for d in descs) >= 40
        and all(similarity(descs[0], d) >= 0.65 for d in descs[1:])
    )
    if cta_only and not bodies_match and not clean:
        return True, "cta_title_not_profile"
    if kind == "profile_multi_service" and len(set(x.lower() for x in clean)) >= 2:
        pairs_ok = 0
        pairs = 0
        for i, a in enumerate(clean):
            for b in clean[i + 1 :]:
                pairs += 1
                if similarity(a, b) >= 0.35 or a.lower() in b.lower() or b.lower() in a.lower():
                    pairs_ok += 1
        if pairs and pairs_ok == 0:
            if not any(similarity(descs[0], d) >= 0.45 for d in descs[1:] if descs[0]):
                return True, "different_names_low_overlap"
    return False, ""


def build_clusters(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for r in rows:
        parent[r["id"]] = r["id"]

    id_to_row = {r["id"]: r for r in rows}
    key_to_ids: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        for k in contact_keys(r):
            if k.startswith("phone:"):
                digits = re.sub(r"\D", "", k)
                if len(digits) < 10 or len(digits) > 15:
                    continue
            key_to_ids[k].append(r["id"])

    usable_keys: dict[str, list[str]] = {}
    for key, ids in key_to_ids.items():
        if len(ids) < 2:
            continue
        # Recurring ads often exceed 25 (same phone, dozens of posts).
        # Cap only pathological shared/spam numbers.
        if len(ids) > 200:
            continue
        usable_keys[key] = ids

    for _key, ids in usable_keys.items():
        for i, left in enumerate(ids):
            for right in ids[i + 1 :]:
                if titles_compatible(id_to_row[left], id_to_row[right]):
                    union(left, right)
                elif _key.startswith("phone:") and _same_recurring_ad(
                    id_to_row[left], id_to_row[right]
                ):
                    # Same phone + near-identical body → one profile even if
                    # titles are junk («Звоните») / slightly different.
                    union(left, right)

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        groups[find(r["id"])].append(r)

    clusters = [g for g in groups.values() if len(g) >= 2]
    clusters.sort(key=lambda g: -len(g))
    return clusters


def find_unmerged_contact_conflicts(
    rows: list[dict[str, Any]], merged_ids: set[str]
) -> list[dict[str, Any]]:
    """Same strong contact, different open cards that were NOT clustered → manual check."""
    key_to_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        if r["id"] in merged_ids:
            continue
        for k in contact_keys(r):
            if k.startswith("phone:") or k.startswith("ig:") or k.startswith("web:"):
                key_to_rows[k].append(r)
    out = []
    for key, group in key_to_rows.items():
        if len(group) < 2:
            continue
        titles = sorted({display_title(r) or "?" for r in group})
        if len(titles) < 2:
            continue
        if all(similarity(a, b) >= 0.5 for i, a in enumerate(titles) for b in titles[i + 1 :]):
            continue
        out.append(
            {
                "key": key,
                "n": len(group),
                "titles": titles[:8],
                "ids": [r["id"] for r in group][:12],
                "reason": "same_contact_different_titles_not_merged",
            }
        )
    out.sort(key=lambda x: -x["n"])
    return out[:80]


def fetch_open_items(client: SupabaseRest, source_key: str | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    last_id = "00000000-0000-0000-0000-000000000000"
    while True:
        params: dict[str, str] = {
            "select": (
                "id,title,business_name,person_name,description,category,entity_type,"
                "target_collection,phone,whatsapp,instagram,website,email,telegram_username,"
                "photos_count,occurrence_count,source,source_posted_at,source_message_ids,"
                "review_status,duplicate_status,city,state,services,review_notes"
            ),
            "review_status": f"in.({','.join(sorted(OPEN_STATUSES))})",
            "published_entity_id": "is.null",
            "id": f"gt.{last_id}",
            "order": "id.asc",
            "limit": "500",
        }
        if source_key:
            params["source"] = f"eq.{source_key}"
        batch = client._request("GET", "/import_review_items", params=params) or []
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


def frequent_values(rows: list[dict[str, Any]], field: str, *, min_count: int = 2) -> list[str]:
    counts: dict[str, int] = defaultdict(int)
    originals: dict[str, str] = {}
    for r in rows:
        for raw in r.get(field) or []:
            v = str(raw).strip()
            if not v:
                continue
            key = v.lower()
            counts[key] += 1
            originals.setdefault(key, v)
    return [originals[k] for k, n in counts.items() if n >= min_count]


def merge_cluster(
    primary: dict[str, Any],
    secondaries: list[dict[str, Any]],
    *,
    kind: str,
) -> dict[str, Any]:
    all_rows = [primary, *secondaries]
    title = pick_best_title(all_rows) or primary.get("title")
    phones = union_lists(*[r.get("phone") for r in all_rows])
    igs = [
        x
        for x in union_lists(*[r.get("instagram") for r in all_rows])
        if normalize_instagram(x)
    ]
    primary_emails = [str(e).strip() for e in (primary.get("email") or []) if str(e).strip()]
    repeated_emails = frequent_values(all_rows, "email", min_count=2)
    emails = union_lists(primary_emails, repeated_emails)
    if any("pasportvisaservice" in e.lower() for e in emails):
        emails = [e for e in emails if "pasportvisaservice" in e.lower() or e in primary_emails]

    services = union_lists(*[r.get("services") for r in all_rows])
    if kind == "profile_multi_service":
        for r in all_rows:
            t = display_title(r)
            if t and not is_junk_title(t) and t.lower() not in {s.lower() for s in services}:
                if 3 <= len(t) <= 80 and t.lower() not in GENERIC_LISTING_TITLES:
                    services.append(t)

    entity_type, target = pick_entity_routing(all_rows)
    if all((display_title(r) or "").strip().lower() in GENERIC_LISTING_TITLES for r in all_rows):
        if any(r.get("entity_type") == "real_estate" for r in all_rows):
            entity_type, target = "real_estate", "real_estate"

    business_name = primary.get("business_name")
    person_name = primary.get("person_name")
    if entity_type == "business":
        business_name = title if isinstance(title, str) and not is_junk_title(title) else business_name
    elif entity_type == "private_specialist":
        person_name = (
            primary.get("person_name")
            or (title if isinstance(title, str) and not is_junk_title(title) else None)
        )

    dup_status = "exact_duplicate" if kind == "exact_duplicate" else "recurring_ad"
    patch = {
        "title": title,
        "business_name": business_name,
        "person_name": person_name,
        "description": pick_best_description(
            all_rows, title=title if isinstance(title, str) else None
        ),
        "phone": phones,
        "whatsapp": union_lists(*[r.get("whatsapp") for r in all_rows]),
        "instagram": igs,
        "website": union_lists(*[r.get("website") for r in all_rows]),
        "email": emails,
        "services": services,
        "photos_count": max(int(r.get("photos_count") or 0) for r in all_rows),
        "occurrence_count": sum(max(1, int(r.get("occurrence_count") or 1)) for r in all_rows),
        "duplicate_status": dup_status,
        "recurring_cluster_id": primary["id"],
        "entity_type": entity_type,
        "target_collection": target,
        "review_notes": (
            (primary.get("review_notes") or "")
            + f"\n[auto-merge:{kind}] объединено {len(secondaries)} дубл. "
            f"профиль={entity_type} услуг={len(services)} "
            f"{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
        ).strip(),
    }
    for field in ("city", "state", "category"):
        for r in all_rows:
            val = r.get(field)
            if val and str(val) != "требует_идентификации":
                patch[field] = val
                break
    msg_ids: list[int] = []
    seen: set[int] = set()
    for r in all_rows:
        for mid in r.get("source_message_ids") or []:
            try:
                i = int(mid)
            except (TypeError, ValueError):
                continue
            if i not in seen:
                seen.add(i)
                msg_ids.append(i)
    if msg_ids:
        patch["source_message_ids"] = msg_ids
    return patch


def write_audit(client: SupabaseRest, item_id: str, action: str, meta: dict[str, Any]) -> None:
    try:
        client.insert_many(
            "import_review_audit",
            [
                {
                    "item_id": item_id,
                    "action": action,
                    "from_status": meta.get("from_status"),
                    "to_status": meta.get("to_status"),
                    "payload": meta,
                    "note": meta.get("note"),
                }
            ],
        )
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Merge duplicate pending import cards")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--source-key", type=str, default=None)
    parser.add_argument("--min-size", type=int, default=2)
    parser.add_argument("--limit-clusters", type=int, default=None)
    parser.add_argument(
        "--include-doubtful",
        action="store_true",
        help="Also merge clusters flagged as doubtful (default: skip)",
    )
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    rows = fetch_open_items(client, args.source_key)
    print(f"Open queue items: {len(rows)}")
    clusters = [c for c in build_clusters(rows) if len(c) >= args.min_size]
    if args.limit_clusters:
        clusters = clusters[: args.limit_clusters]

    apply_clusters: list[dict[str, Any]] = []
    doubtful_clusters: list[dict[str, Any]] = []

    for cluster in clusters:
        ranked = sorted(cluster, key=completeness_score, reverse=True)
        primary = ranked[0]
        secondaries = ranked[1:]
        kind = cluster_kind(cluster)
        doubtful, reason = is_doubtful_cluster(cluster, kind)
        entity_type, target = pick_entity_routing(cluster)
        keys: set[str] = set()
        for r in cluster:
            keys |= all_contact_keys(r)
        entry = {
            "primary_id": primary["id"],
            "primary_title": display_title(primary),
            "size": len(cluster),
            "kind": kind,
            "entity_type": entity_type,
            "target_collection": target,
            "keys": sorted(keys)[:8],
            "secondary_ids": [s["id"] for s in secondaries],
            "secondary_titles": [display_title(s) for s in secondaries],
            "merged_title": pick_best_title(cluster),
            "services_union": union_lists(*[r.get("services") for r in cluster])[:20],
        }
        if doubtful and not args.include_doubtful:
            entry["doubt_reason"] = reason
            doubtful_clusters.append(entry)
            print(
                f"? SKIP ×{len(cluster)} {entry['merged_title']!r} "
                f"kind={kind} reason={reason}"
            )
            continue
        apply_clusters.append(entry)
        print(
            f"- ×{len(cluster)} {kind} → {entity_type} keep={entry['merged_title']!r} "
            f"keys={entry['keys'][:3]}"
        )

    merged_member_ids: set[str] = set()
    for e in apply_clusters:
        merged_member_ids.add(e["primary_id"])
        merged_member_ids.update(e["secondary_ids"])

    conflicts = find_unmerged_contact_conflicts(rows, merged_member_ids)

    out_dir = ROOT / "scripts" / "import-review" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "merge_pending_clusters_report.json"
    manual_path = out_dir / "merge_pending_manual_review.json"
    report_path.write_text(
        json.dumps(
            {
                "open_items": len(rows),
                "clusters_found": len(clusters),
                "clusters_to_apply": len(apply_clusters),
                "secondaries_to_hide": sum(e["size"] - 1 for e in apply_clusters),
                "exact_duplicate": sum(
                    1 for e in apply_clusters if e["kind"] == "exact_duplicate"
                ),
                "profile_multi_service": sum(
                    1 for e in apply_clusters if e["kind"] == "profile_multi_service"
                ),
                "items": apply_clusters,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    manual_path.write_text(
        json.dumps(
            {
                "doubtful_clusters_skipped": doubtful_clusters,
                "unmerged_same_contact_conflicts": conflicts,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {report_path}")
    print(f"Wrote {manual_path}")
    print(
        f"Apply candidates: {len(apply_clusters)} clusters, "
        f"hide {sum(e['size'] - 1 for e in apply_clusters)}; "
        f"doubtful skipped: {len(doubtful_clusters)}; "
        f"manual contact conflicts: {len(conflicts)}"
    )

    if args.dry_run:
        print("DRY-RUN complete. No writes.")
        return 0

    id_to_row = {r["id"]: r for r in rows}
    merged = 0
    marked = 0
    for entry in apply_clusters:
        cluster_rows = [
            id_to_row[entry["primary_id"]],
            *[id_to_row[i] for i in entry["secondary_ids"]],
        ]
        ranked = sorted(cluster_rows, key=completeness_score, reverse=True)
        primary = ranked[0]
        secondaries = ranked[1:]
        kind = entry["kind"]
        patch = merge_cluster(primary, secondaries, kind=kind)
        client.patch("import_review_items", {"id": f"eq.{primary['id']}"}, patch)
        write_audit(
            client,
            primary["id"],
            "auto_merge_primary",
            {
                "from_status": primary.get("review_status"),
                "to_status": primary.get("review_status"),
                "merged_from": [s["id"] for s in secondaries],
                "kind": kind,
                "entity_type": patch.get("entity_type"),
                "note": f"auto-merge cluster size {len(cluster_rows)} kind={kind}",
            },
        )
        merged += 1
        for sec in secondaries:
            client.patch(
                "import_review_items",
                {"id": f"eq.{sec['id']}"},
                {
                    "review_status": "duplicate",
                    "duplicate_of_item_id": primary["id"],
                    "duplicate_status": (
                        "exact_duplicate" if kind == "exact_duplicate" else "recurring_ad"
                    ),
                    "recurring_cluster_id": primary["id"],
                    "reviewed_at": datetime.now(timezone.utc).isoformat(),
                    "review_notes": (
                        (sec.get("review_notes") or "")
                        + f"\n[auto-merge:{kind}] дубликат → {primary['id']}"
                    ).strip(),
                },
            )
            write_audit(
                client,
                sec["id"],
                "marked_duplicate",
                {
                    "from_status": sec.get("review_status"),
                    "to_status": "duplicate",
                    "duplicate_of_item_id": primary["id"],
                    "kind": kind,
                    "note": "auto-merge pending cluster",
                },
            )
            marked += 1

    print(f"APPLY done. Primaries updated: {merged}. Marked duplicate: {marked}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
