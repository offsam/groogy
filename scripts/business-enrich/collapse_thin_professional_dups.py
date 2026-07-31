#!/usr/bin/env python3
"""Collapse thin / visual-duplicate approved professionals.

Problem (OC catalog): cards like «Ілля / Уроки английского» ×2,
«Оля / Организация праздников» ×2, «Юля / Дом и ремонт» ×2 —
same weak name + same category pitch, often no real contact.

Policy:
  Cluster key = normalized display_name + category_id (or '_none_').
  Within a cluster of size >= 2:
    keeper = richest (real contact > image > description length > older)
    others → status=archived, import_batch_id=thin_pro_dup_v1

Also collapses exact-name groups where EVERY member lacks real contact
(even if category differs) — keep one.

Usage:
  python3 scripts/business-enrich/collapse_thin_professional_dups.py --region oc --dry-run
  python3 scripts/business-enrich/collapse_thin_professional_dups.py --region oc --apply
  python3 scripts/business-enrich/collapse_thin_professional_dups.py --all --apply
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
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

BATCH_ID = "thin_pro_dup_v1"
OUT = Path(__file__).resolve().parent / "data" / "thin_pro_dups"
OUT.mkdir(parents=True, exist_ok=True)

OC_TOKENS = (
    "orange county",
    "irvine",
    "anaheim",
    "santa ana",
    "costa mesa",
    "huntington",
    "newport",
    "fullerton",
    "garden grove",
    "tustin",
    "mission viejo",
    "laguna",
    "yorba",
    "brea",
    "placentia",
    "buena park",
    "cypress",
    "fountain valley",
    "westminster",
    "seal beach",
    "lake forest",
    "rancho santa margarita",
    "san clemente",
    "dana point",
    "aliso",
    "stanton",
    "la habra",
    "los alamitos",
)

WEAK_NAMES = {
    "юля",
    "юлия",
    "оля",
    "ольга",
    "ілля",
    "илля",
    "илья",
    "анна",
    "аня",
    "марина",
    "кристина",
    "сергей",
    "mila",
    "anna",
    "olya",
    "ilya",
    "usa",
    "reel",
}


def norm_name(raw: str | None) -> str:
    t = re.sub(r"[^\w\s]+", " ", (raw or "").lower(), flags=re.U)
    return re.sub(r"\s+", " ", t).strip()


def is_weak_name(raw: str | None) -> bool:
    n = norm_name(raw)
    if not n or len(n) < 3:
        return True
    parts = n.split()
    if len(parts) == 1 and (len(n) <= 8 or n in WEAK_NAMES):
        return True
    return n in WEAK_NAMES


def has_real_contact(p: dict[str, Any]) -> bool:
    for key in ("phone", "email", "website", "instagram_url"):
        if str(p.get(key) or "").strip():
            return True
    return False


def contact_fingerprint(p: dict[str, Any]) -> frozenset[str]:
    """Identity signals used to decide true twins vs different people."""
    out: set[str] = set()
    phone = re.sub(r"\D+", "", str(p.get("phone") or ""))
    if len(phone) >= 10:
        out.add(f"phone:{phone[-10:]}")
    email = str(p.get("email") or "").strip().lower()
    if email and "@" in email:
        out.add(f"email:{email}")
    for key in ("website", "instagram_url"):
        raw = str(p.get(key) or "").strip().lower()
        if not raw:
            continue
        if "://" not in raw:
            raw = "https://" + raw
        try:
            host = urlparse(raw).netloc.removeprefix("www.")
            path = urlparse(raw).path.strip("/").lower()
        except Exception:
            continue
        if host:
            out.add(f"{key}:{host}/{path}" if path else f"{key}:{host}")
    return frozenset(out)


def same_identity_contact(a: dict[str, Any], b: dict[str, Any]) -> bool:
    fa, fb = contact_fingerprint(a), contact_fingerprint(b)
    return bool(fa and fb and fa & fb)


def is_oc(p: dict[str, Any]) -> bool:
    city = (p.get("city") or "").lower()
    region = (p.get("region") or "").lower()
    blob = f"{city} {region}"
    if "orange county" in blob or city.strip() == "orange":
        return True
    return any(t in blob for t in OC_TOKENS)


def richness(p: dict[str, Any]) -> tuple:
    desc = (p.get("description") or p.get("short_description") or "") or ""
    # Ascending sort: more negative = better; older created_at first.
    return (
        -(1 if has_real_contact(p) else 0),
        -(1 if str(p.get("image_url") or "").strip() else 0),
        -len(desc.strip()),
        -(0 if is_weak_name(p.get("display_name")) else 1),
        p.get("created_at") or "9999-12-31",
    )


def fetch_all(client: SupabaseRest) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = client._request(
            "GET",
            "/professionals",
            params={
                "select": (
                    "id,display_name,slug,status,phone,email,website,instagram_url,"
                    "city,region,category_id,image_url,description,short_description,"
                    "card_summary,created_at,import_batch_id"
                ),
                "status": "eq.approved",
                "order": "created_at.asc",
                "limit": "1000",
                "offset": str(offset),
            },
        )
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def build_plans(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for p in rows:
        name = norm_name(p.get("display_name"))
        if len(name) < 2:
            continue
        cat = str(p.get("category_id") or "_none_")
        by_key[(name, cat)].append(p)

    plans: list[dict[str, Any]] = []
    seen_archive: set[str] = set()

    for (name, cat), members in by_key.items():
        if len(members) < 2:
            continue
        ranked = sorted(members, key=richness)
        keep = ranked[0]
        keep_contacted = has_real_contact(keep)
        drop = []
        for d in ranked[1:]:
            if d["id"] in seen_archive:
                continue
            # Contact-less clone of a same name+category card → archive.
            if not has_real_contact(d):
                drop.append(d)
                continue
            # Both have contacts: only archive true twins (shared identity signal).
            if keep_contacted and same_identity_contact(keep, d):
                drop.append(d)
        if not drop:
            continue
        for d in drop:
            seen_archive.add(d["id"])
        plans.append(
            {
                "reason": "name+category",
                "name": name,
                "category_id": cat,
                "keeper_id": keep["id"],
                "keeper_name": keep.get("display_name"),
                "keeper_slug": keep.get("slug"),
                "archive_ids": [d["id"] for d in drop],
                "archive_names": [d.get("display_name") for d in drop],
                "archive_slugs": [d.get("slug") for d in drop],
                "member_count": len(members),
            }
        )

    # Second pass: weak names with NO real contact, any category — one keep per name
    by_weak: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in rows:
        if p["id"] in seen_archive:
            continue
        if not is_weak_name(p.get("display_name")):
            continue
        if has_real_contact(p):
            continue
        by_weak[norm_name(p.get("display_name"))].append(p)

    for name, members in by_weak.items():
        if len(members) < 2:
            continue
        # Never collapse two cards that each have real (possibly different) contacts.
        if sum(1 for m in members if has_real_contact(m)) >= 2:
            continue
        ranked = sorted(members, key=richness)
        keep = ranked[0]
        drop = [
            m
            for m in ranked[1:]
            if not has_real_contact(m)  # only archive contact-less clones
        ]
        if not drop:
            continue
        for d in drop:
            seen_archive.add(d["id"])
        plans.append(
            {
                "reason": "weak_name_no_contact",
                "name": name,
                "category_id": None,
                "keeper_id": keep["id"],
                "keeper_name": keep.get("display_name"),
                "keeper_slug": keep.get("slug"),
                "archive_ids": [d["id"] for d in drop],
                "archive_names": [d.get("display_name") for d in drop],
                "archive_slugs": [d.get("slug") for d in drop],
                "member_count": len(members),
            }
        )

    plans.sort(key=lambda p: p["member_count"], reverse=True)
    return plans


def apply_plans(client: SupabaseRest, plans: list[dict[str, Any]]) -> dict[str, int]:
    archived = 0
    errors = 0
    now = datetime.now(timezone.utc).isoformat()
    for plan in plans:
        for aid in plan["archive_ids"]:
            try:
                client.patch(
                    "professionals",
                    {"id": f"eq.{aid}"},
                    {
                        "status": "archived",
                        "import_batch_id": BATCH_ID,
                        "updated_at": now,
                    },
                )
                archived += 1
            except Exception as exc:  # noqa: BLE001
                errors += 1
                print(f"archive fail {aid}: {exc}", file=sys.stderr)
    return {"archived": archived, "errors": errors}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", choices=("oc", "all"), default="oc")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true", default=True)
    args = parser.parse_args()
    if args.apply:
        args.dry_run = False

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    rows = fetch_all(client)
    if args.region == "oc":
        rows = [p for p in rows if is_oc(p)]

    plans = build_plans(rows)
    extra = sum(len(p["archive_ids"]) for p in plans)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "region": args.region,
        "batch_id": BATCH_ID,
        "pool": len(rows),
        "clusters": len(plans),
        "cards_to_archive": extra,
        "plans": plans[:200],
    }

    if args.apply:
        stats = apply_plans(client, plans)
        report["apply"] = stats

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{args.region}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    latest = OUT / f"{args.region}_latest.json"
    latest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"region={args.region} pool={len(rows)} clusters={len(plans)} "
        f"archive={extra} mode={'apply' if args.apply else 'dry-run'}"
    )
    for p in plans[:15]:
        print(
            f"  [{p['reason']}] n={p['member_count']} keep={p['keeper_name']!r} "
            f"drop={p['archive_names']}"
        )
    print(f"report={path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
