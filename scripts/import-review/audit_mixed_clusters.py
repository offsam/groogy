#!/usr/bin/env python3
"""Find and split queue clusters glued by the old name-only rules.

The legacy dedupe merged posts by sender name + category «other», so one
author's unrelated publications (a flower shop ad and a party invite) ended up
in one card: description from one post, contacts from another.

Rules applied here mirror the fixed clusterer:
- members of a cluster must share an entity family (profile / event / job / …);
- members must share a real contact (phone / IG / TG / own domain / email)
  or repeat the same ad body;
- events with conflicting dates are different events.

Usage:
  python3 scripts/import-review/audit_mixed_clusters.py --dry-run
  python3 scripts/import-review/audit_mixed_clusters.py --apply
  python3 scripts/import-review/audit_mixed_clusters.py --apply --cluster <id>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402
from description_merge import similarity  # noqa: E402
from eligibility import (  # noqa: E402
    normalize_instagram,
    normalize_phone,
    normalize_website,
)
from merge_pending_clusters import (  # noqa: E402
    PROFILE_TYPES,
    build_clusters,
    completeness_score,
    website_host_key,
)
from structure_event_from_text import event_day_keys  # noqa: E402

SELECT = (
    "id,title,business_name,person_name,description,category,subcategory,"
    "entity_type,target_collection,phone,whatsapp,instagram,website,email,telegram_username,"
    "services,occurrence_count,source_message_ids,review_status,review_notes,duplicate_status,"
    "duplicate_of_item_id,recurring_cluster_id,published_entity_id,published_entity_type,"
    "source,source_url,source_text,raw_payload"
)


def family(row: dict[str, Any]) -> str:
    kind = str(row.get("entity_type") or "").strip().lower()
    if not kind:
        return "unknown"
    return "profile" if kind in PROFILE_TYPES else kind


def own_text(row: dict[str, Any]) -> str:
    payload = row.get("raw_payload") or {}
    return str(payload.get("merged_text") or payload.get("text") or "").strip()


def own_entity(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("raw_payload") or {}
    entity = payload.get("extracted_entity")
    return entity if isinstance(entity, dict) else {}


def contact_keys(row: dict[str, Any]) -> set[str]:
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
        keys.add(f"tg:{tg}")
    for w in row.get("website") or []:
        host = website_host_key(str(w))
        if host:
            keys.add(f"web:{host}")
    for e in row.get("email") or []:
        v = str(e).strip().lower()
        if "@" in v:
            keys.add(f"email:{v}")
    return keys


def own_contact_keys(row: dict[str, Any]) -> set[str]:
    entity = own_entity(row)
    proxy = {
        "phone": entity.get("phone") or [],
        "instagram": entity.get("instagram") or [],
        "website": entity.get("website") or [],
        "email": entity.get("email") or [],
        "telegram_username": (entity.get("telegram") or [None])[0],
    }
    return contact_keys(proxy)


def analysis_view(row: dict[str, Any]) -> dict[str, Any]:
    """Row as its own post saw it — merged fields hide who the card really is."""
    view = dict(row)
    entity = own_entity(row)
    text = own_text(row)
    if text:
        view["description"] = text
        view["source_text"] = text
    if entity:
        for field, key in (
            ("phone", "phone"),
            ("whatsapp", "whatsapp"),
            ("instagram", "instagram"),
            ("website", "website"),
            ("email", "email"),
        ):
            value = entity.get(key)
            if isinstance(value, list):
                view[field] = value
        telegram = entity.get("telegram") or []
        view["telegram_username"] = telegram[0] if telegram else None
        if entity.get("entity_type"):
            view["entity_type"] = entity["entity_type"]
    return view


def regroup(rows: list[dict[str, Any]]) -> list[list[str]]:
    """Re-run the fixed clustering rules over one legacy cluster."""
    views = [analysis_view(r) for r in rows]
    groups = [[v["id"] for v in group] for group in build_clusters(views)]
    grouped = {rid for group in groups for rid in group}
    for row in rows:
        if row["id"] not in grouped:
            groups.append([row["id"]])
    groups.sort(key=len, reverse=True)
    return groups


def conservative_subgroups(rows: list[dict[str, Any]]) -> list[list[str]]:
    """Split a legacy cluster only where it is provably wrong.

    One author may sell flowers and throw parties: those are different cards.
    Two parties on different dates are different events. Everything else stays
    as it is, so fixing the data does not flood the moderation queue.
    """
    views = {r["id"]: analysis_view(r) for r in rows}
    known = [family(v) for v in views.values() if family(v) != "unknown"]
    dominant = max(set(known), key=known.count) if known else "unknown"

    buckets: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        view = views[row["id"]]
        fam = family(view)
        if fam == "unknown":
            fam = dominant
        if fam != "event":
            buckets[fam].append(row["id"])
            continue
        days = sorted(event_day_keys(view.get("description") or view.get("source_text")))
        buckets[f"event|{days[0] if days else ''}"].append(row["id"])

    groups = sorted(buckets.values(), key=len, reverse=True)
    return groups


def event_conflict(rows: list[dict[str, Any]]) -> bool:
    if not any(r.get("entity_type") == "event" for r in rows):
        return False
    day_sets = []
    for r in rows:
        days = set(event_day_keys(own_text(r) or r.get("source_text") or r.get("description")))
        if days:
            day_sets.append(days)
    for i, a in enumerate(day_sets):
        for b in day_sets[i + 1 :]:
            if not (a & b):
                return True
    return False


def bodies_repeat(rows: list[dict[str, Any]]) -> bool:
    texts = [own_text(r) or (r.get("source_text") or "") for r in rows]
    texts = [t for t in texts if len(t) >= 40]
    if len(texts) < 2:
        return False
    return all(similarity(texts[0], t) >= 0.72 for t in texts[1:])


def diagnose(rows: list[dict[str, Any]]) -> list[str]:
    """Why the fixed rules refuse to keep these posts in one cluster."""
    flags: list[str] = []
    known = {family(analysis_view(r)) for r in rows} - {"unknown"}
    if len(known) > 1:
        flags.append("mixed_family")

    key_count: dict[str, int] = defaultdict(int)
    for r in rows:
        for k in own_contact_keys(r) or contact_keys(r):
            key_count[k] += 1
    if not any(n >= 2 for n in key_count.values()):
        flags.append("no_shared_contact")

    if event_conflict(rows):
        flags.append("event_dates_conflict")

    return flags or ["rules_disagree"]


def primary_damage(primary: dict[str, Any], rows: list[dict[str, Any]]) -> list[str]:
    """Fields on the kept card that came from a different post."""
    damage: list[str] = []
    mine = own_text(primary)
    desc = (primary.get("description") or "").strip()
    if mine and desc and similarity(mine, desc) < 0.35:
        for other in rows:
            if other["id"] == primary["id"]:
                continue
            if similarity(own_text(other), desc) >= 0.6:
                damage.append("description_from_other_post")
                break
    stolen = contact_keys(primary) - own_contact_keys(primary)
    if stolen and own_contact_keys(primary):
        damage.append("contacts_from_other_post")
    return damage


def restore_patch(primary: dict[str, Any], *, kept: int) -> dict[str, Any]:
    """Rebuild the kept card from its own post."""
    entity = own_entity(primary)
    patch: dict[str, Any] = {
        "recurring_cluster_id": primary["id"] if kept > 1 else None,
        "duplicate_status": "recurring_ad" if kept > 1 else "unique",
        "duplicate_of_item_id": None,
        "occurrence_count": kept,
    }
    text = own_text(primary)
    if text:
        patch["description"] = text
        patch["source_text"] = text
    if entity:
        for field, key in (
            ("phone", "phone"),
            ("whatsapp", "whatsapp"),
            ("instagram", "instagram"),
            ("website", "website"),
            ("email", "email"),
        ):
            value = entity.get(key)
            if isinstance(value, list):
                patch[field] = [str(v).strip() for v in value if str(v).strip()]
        if entity.get("entity_type"):
            patch["entity_type"] = entity["entity_type"]
        if entity.get("target_collection"):
            patch["target_collection"] = entity["target_collection"]
        if entity.get("category"):
            patch["category"] = entity["category"]
    payload = primary.get("raw_payload") or {}
    own_ids = payload.get("source_message_ids") or (
        [payload["message_id"]] if payload.get("message_id") else None
    )
    if own_ids and kept <= 1:
        patch["source_message_ids"] = own_ids
    patch["review_notes"] = (
        (primary.get("review_notes") or "")
        + f"\n[unmerge] расклеено по аудиту {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    ).strip()
    return patch


def fetch_clustered(client: SupabaseRest, cluster: str | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    last_id = "00000000-0000-0000-0000-000000000000"
    page = 200
    while True:
        params = {
            "select": SELECT,
            "recurring_cluster_id": f"eq.{cluster}" if cluster else "not.is.null",
            "id": f"gt.{last_id}",
            "order": "id.asc",
            "limit": str(page),
        }
        try:
            batch = client._request("GET", "/import_review_items", params=params) or []
        except RuntimeError as exc:
            # raw_payload is heavy; a slow page just needs a smaller bite.
            if "57014" in str(exc) and page > 25:
                page //= 2
                continue
            raise
        if not batch:
            break
        rows.extend(batch)
        last_id = str(batch[-1]["id"])
        if len(batch) < page:
            break
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit and split legacy mixed clusters")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--cluster", type=str, default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--include-split-only",
        action="store_true",
        help="also split clusters whose kept card is fine (releases hidden duplicates)",
    )
    parser.add_argument(
        "--deep",
        action="store_true",
        help="split every publication into its own card (floods the queue)",
    )
    args = parser.parse_args()
    deep = args.deep
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    rows = fetch_clustered(client, args.cluster)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row["recurring_cluster_id"])].append(row)
    print(f"Clustered items: {len(rows)} in {len(groups)} clusters")

    bad: list[dict[str, Any]] = []
    for cluster_id, members in groups.items():
        if len(members) < 2:
            continue
        subgroups = regroup(members) if deep else conservative_subgroups(members)
        if len(subgroups) < 2:
            continue
        primary = next((m for m in members if m["id"] == cluster_id), None)
        by_id = {m["id"]: m for m in members}
        entry = {
            "cluster_id": cluster_id,
            "size": len(members),
            "flags": diagnose(members),
            "families": sorted({family(analysis_view(m)) for m in members}),
            "primary_id": primary["id"] if primary else None,
            "primary_title": (primary or {}).get("title"),
            "primary_damage": primary_damage(primary, members) if primary else [],
            "published": [m["id"] for m in members if m.get("published_entity_id")],
            "subgroups": [
                {
                    "size": len(ids),
                    "ids": ids,
                    "sample": (
                        own_text(by_id[ids[0]]) or by_id[ids[0]].get("description") or ""
                    )[:120],
                }
                for ids in subgroups
            ],
            "members": [
                {
                    "id": m["id"],
                    "entity_type": m.get("entity_type"),
                    "review_status": m.get("review_status"),
                    "published_entity_id": m.get("published_entity_id"),
                    "text": (own_text(m) or m.get("description") or "")[:120],
                }
                for m in members
            ],
        }
        # Damaged: the kept card itself mixes two different advertisers.
        # Split-only: the kept card is fine, siblings are just separate ads.
        entry["tier"] = (
            "damaged"
            if entry["primary_damage"]
            or "mixed_family" in entry["flags"]
            or "event_dates_conflict" in entry["flags"]
            else "split_only"
        )
        entry["hidden_members"] = sum(
            1 for m in members if m.get("review_status") == "duplicate"
        )
        bad.append(entry)

    bad.sort(key=lambda e: -e["size"])
    if args.limit:
        bad = bad[: args.limit]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = ROOT / "docs" / "audits" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": stamp,
        "clusters_scanned": len(groups),
        "clusters_flagged": len(bad),
        "items_affected": sum(e["size"] for e in bad),
        "by_flag": {
            flag: sum(1 for e in bad if flag in e["flags"])
            for flag in (
                "mixed_family",
                "no_shared_contact",
                "event_dates_conflict",
                "rules_disagree",
            )
        },
        "cards_after_split": sum(len(e["subgroups"]) for e in bad),
        "by_tier": {
            tier: {
                "clusters": sum(1 for e in bad if e["tier"] == tier),
                "items": sum(e["size"] for e in bad if e["tier"] == tier),
                "hidden_items": sum(
                    e["hidden_members"] for e in bad if e["tier"] == tier
                ),
                "cards_after_split": sum(
                    len(e["subgroups"]) for e in bad if e["tier"] == tier
                ),
            }
            for tier in ("damaged", "split_only")
        },
        "clusters": bad,
    }
    mode = "apply" if args.apply else "dry"
    (out_dir / f"mixed_clusters_{mode}_{stamp}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / f"mixed_clusters_{mode}_latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report["by_flag"], ensure_ascii=False))
    print(json.dumps(report["by_tier"], ensure_ascii=False, indent=2))
    print(f"Flagged {len(bad)} clusters, {report['items_affected']} items")
    for e in bad[:20]:
        print(
            f"- [{e['tier']}] ×{e['size']} → {len(e['subgroups'])} карточек | "
            f"{','.join(e['flags'])} families={e['families']} "
            f"{e['primary_title']!r} damage={e['primary_damage']}"
        )

    if not args.apply:
        print("DRY-RUN complete. No writes.")
        return 0

    if not args.include_split_only:
        bad = [e for e in bad if e["tier"] == "damaged"]
        print(f"Applying to {len(bad)} damaged clusters (split_only left for review)")

    released = 0
    restored = 0
    skipped_published = 0
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for entry in bad:
        members = {m["id"]: m for m in groups[entry["cluster_id"]]}
        old_primary_id = entry["cluster_id"]
        for subgroup in entry["subgroups"]:
            ids = [i for i in subgroup["ids"] if not members[i].get("published_entity_id")]
            skipped_published += subgroup["size"] - len(ids)
            if not ids:
                continue
            keeps_old_id = old_primary_id in ids
            new_primary = (
                old_primary_id
                if keeps_old_id
                else max(ids, key=lambda i: completeness_score(members[i]))
            )
            cluster_id = new_primary if len(ids) > 1 else None
            for item_id in ids:
                member = members[item_id]
                was_hidden = member.get("review_status") == "duplicate"
                if item_id == old_primary_id and entry["primary_damage"]:
                    patch = restore_patch(member, kept=len(ids))
                    restored += 1
                elif item_id == new_primary:
                    patch = {
                        "recurring_cluster_id": cluster_id,
                        "duplicate_of_item_id": None,
                        "occurrence_count": len(ids),
                    }
                    if was_hidden:
                        # Promoted to its own card: back into the queue.
                        patch["review_status"] = "pending"
                        patch["duplicate_status"] = "recurring_ad" if cluster_id else "unique"
                else:
                    patch = {"recurring_cluster_id": cluster_id}
                    if was_hidden:
                        patch["duplicate_of_item_id"] = new_primary
                if item_id != old_primary_id:
                    released += 1
                patch["review_notes"] = (
                    (member.get("review_notes") or "")
                    + f"\n[unmerge] расклеено по аудиту {today}"
                ).strip()
                client.patch("import_review_items", {"id": f"eq.{item_id}"}, patch)
    print(
        f"Unmerged: {restored} primaries restored, {released} members re-assigned, "
        f"{skipped_published} published members skipped"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
