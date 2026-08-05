#!/usr/bin/env python3
"""Move church-named published cards into public.churches and archive sources.

Targets approved businesses (and optionally professionals) whose *name* clearly
is a church / parish / temple — not «христианский магазин/радио/академия».

Usage:
  python3 scripts/business-enrich/move_churches_to_section.py --dry-run
  python3 scripts/business-enrich/move_churches_to_section.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "move_churches"
OUT.mkdir(parents=True, exist_ok=True)
BATCH = "move_churches_to_section_v1"

STRONG_NAME_RE = re.compile(
    r"(?i)("
    r"\bцерк(овь|ви)\b|"
    r"церкви\b|"
    r"\bхрам\b|"
    r"\bприход\b|"
    r"\bсобор\b|"
    r"\bchurch\b|"
    r"\bchapel\b|"
    r"\bparish\b|"
    r"\bmosque\b|"
    r"\bмечеть\b|"
    r"\bsynagogue\b|"
    r"синагог|"
    r"russian\s+orthodox|"
    r"православн\w*\s+(церк|храм|собор|приход)|"
    r"(церк|храм|собор|приход)\w*\s+православ"
    r")"
)
EXCLUDE_NAME_RE = re.compile(
    r"(?i)(радио|radio|магазин|shop|store|книжн|book|академи|academy|"
    r"школ|school|university|универс|college|лагер|camp\b|"
    r"churchville)"
)


def empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not str(v).strip())


def slugify(name: str) -> str:
    import hashlib
    import unicodedata

    raw = (name or "").strip().lower()
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", raw):
        return raw[:60]
    norm = unicodedata.normalize("NFKD", raw)
    ascii_only = "".join(ch for ch in norm if not unicodedata.combining(ch))
    s = re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")
    if len(s) >= 3 and re.search(r"[a-z]", s):
        return s[:60]
    digest = hashlib.md5(raw.encode("utf-8")).hexdigest()[:10]
    return f"church-{digest}"


def unique_slug(client: SupabaseRest, base: str) -> str:
    candidate = base
    n = 0
    while True:
        rows = (
            client._request(
                "GET",
                "/churches",
                params={"select": "id", "slug": f"eq.{candidate}", "limit": "1"},
            )
            or []
        )
        if not rows:
            return candidate
        n += 1
        candidate = f"{base}-{n}"


def church_source_kind(source_kind: str | None, source_url: str | None) -> str:
    kind = (source_kind or "").strip().lower()
    if kind in {"telegram", "facebook", "directory", "platform"}:
        return kind
    if source_url and source_url.strip():
        return "directory"
    return "platform"


def is_church_name(name: str) -> bool:
    n = (name or "").strip()
    if not n:
        return False
    if EXCLUDE_NAME_RE.search(n):
        return False
    return bool(STRONG_NAME_RE.search(n))


def fetch_approved_businesses(client: SupabaseRest) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        rows = (
            client._request(
                "GET",
                "/businesses",
                params={
                    "select": (
                        "id,slug,name,status,phone,email,website,instagram_url,"
                        "telegram_url,source_url,source_kind,description,short_description,"
                        "image_url,address_line,city,region,state_code,postal_code,"
                        "county_geoid,latitude,longitude,location_precision,"
                        "google_maps_url,contact_links,reviews_count"
                    ),
                    "status": "eq.approved",
                    "order": "name.asc",
                    "limit": "500",
                    "offset": str(offset),
                },
            )
            or []
        )
        if not rows:
            break
        out.extend(rows)
        if len(rows) < 500:
            break
        offset += len(rows)
    return out


def fetch_approved_professionals(client: SupabaseRest) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        rows = (
            client._request(
                "GET",
                "/professionals",
                params={
                    "select": (
                        "id,slug,display_name,status,phone,email,website,instagram_url,"
                        "telegram_url,source_url,source_type,description,short_description,"
                        "image_url,private_address_line,city,region,state_code,postal_code,"
                        "county_geoid,latitude,longitude,location_precision"
                    ),
                    "status": "eq.approved",
                    "order": "display_name.asc",
                    "limit": "500",
                    "offset": str(offset),
                },
            )
            or []
        )
        if not rows:
            break
        out.extend(rows)
        if len(rows) < 500:
            break
        offset += len(rows)
    return out


def payload_from_business(row: dict[str, Any], slug: str) -> dict[str, Any]:
    return {
        "name": (row.get("name") or "").strip()[:200],
        "slug": slug,
        "description": row.get("description") or row.get("short_description"),
        "image_url": row.get("image_url"),
        "status": "approved",
        "address_line": row.get("address_line"),
        "city": row.get("city"),
        "state_code": row.get("state_code"),
        "postal_code": row.get("postal_code"),
        "region": row.get("region"),
        "county_geoid": row.get("county_geoid"),
        "latitude": row.get("latitude"),
        "longitude": row.get("longitude"),
        "location_precision": row.get("location_precision"),
        "phone": row.get("phone"),
        "email": row.get("email"),
        "website": row.get("website"),
        "instagram_url": row.get("instagram_url"),
        "telegram_url": row.get("telegram_url"),
        "google_maps_url": row.get("google_maps_url"),
        "contact_links": row.get("contact_links") or [],
        "source_url": row.get("source_url"),
        "source_kind": church_source_kind(row.get("source_kind"), row.get("source_url")),
        "published_at": datetime.now(timezone.utc).isoformat(),
    }


def payload_from_professional(row: dict[str, Any], slug: str) -> dict[str, Any]:
    return {
        "name": (row.get("display_name") or "").strip()[:200],
        "slug": slug,
        "description": row.get("description") or row.get("short_description"),
        "image_url": row.get("image_url"),
        "status": "approved",
        "address_line": row.get("private_address_line"),
        "city": row.get("city"),
        "state_code": row.get("state_code"),
        "postal_code": row.get("postal_code"),
        "region": row.get("region"),
        "county_geoid": row.get("county_geoid"),
        "latitude": row.get("latitude"),
        "longitude": row.get("longitude"),
        "location_precision": row.get("location_precision"),
        "phone": row.get("phone"),
        "email": row.get("email"),
        "website": row.get("website"),
        "instagram_url": row.get("instagram_url"),
        "telegram_url": row.get("telegram_url"),
        "google_maps_url": None,
        "contact_links": [],
        "source_url": row.get("source_url"),
        "source_kind": church_source_kind(row.get("source_type"), row.get("source_url")),
        "published_at": datetime.now(timezone.utc).isoformat(),
    }


def archive_business(client: SupabaseRest, business_id: str) -> None:
    client._request(
        "PATCH",
        "/businesses",
        params={"id": f"eq.{business_id}"},
        body={
            "status": "archived",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        prefer="return=minimal",
    )


def archive_professional(client: SupabaseRest, professional_id: str) -> None:
    client._request(
        "PATCH",
        "/professionals",
        params={"id": f"eq.{professional_id}"},
        body={"status": "archived", "updated_at": datetime.now(timezone.utc).isoformat()},
        prefer="return=minimal",
    )


def insert_entity_move(
    client: SupabaseRest,
    *,
    from_type: str,
    from_id: str,
    from_slug: str,
    from_path: str,
    to_id: str,
    to_slug: str,
) -> None:
    try:
        client._request(
            "POST",
            "/entity_moves",
            body={
                "from_type": from_type,
                "from_id": from_id,
                "from_slug": from_slug,
                "from_path": from_path,
                "to_type": "church",
                "to_id": to_id,
                "to_slug": to_slug,
                "to_path": f"/churches/{to_slug}",
                "reason": f"batch:{BATCH}",
            },
            prefer="return=minimal",
        )
    except Exception as exc:  # noqa: BLE001
        print(f"  warn entity_moves: {exc}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--include-professionals", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    apply = bool(args.apply)
    if apply:
        args.dry_run = False

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    candidates: list[dict[str, Any]] = []
    for row in fetch_approved_businesses(client):
        name = row.get("name") or ""
        if not is_church_name(name):
            continue
        if int(row.get("reviews_count") or 0) > 0:
            candidates.append(
                {
                    "skip": True,
                    "reason": "has_reviews",
                    "from": "business",
                    "id": row["id"],
                    "name": name,
                    "slug": row.get("slug"),
                }
            )
            continue
        candidates.append({"from": "business", "row": row, "name": name})

    if args.include_professionals:
        for row in fetch_approved_professionals(client):
            name = row.get("display_name") or ""
            if not is_church_name(name):
                continue
            candidates.append({"from": "professional", "row": row, "name": name})

    if args.limit > 0:
        candidates = candidates[: args.limit]

    report: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "batch": BATCH,
        "apply": apply,
        "moved": [],
        "skipped": [],
        "errors": [],
    }

    print(f"candidates={len(candidates)} apply={apply}")
    for item in candidates:
        if item.get("skip"):
            print(f"SKIP {item['name']}: {item['reason']}")
            report["skipped"].append(item)
            continue
        row = item["row"]
        name = item["name"]
        source = item["from"]
        print(f"{'MOVE' if apply else 'DRY'} [{source}] {name}")
        # Idempotent: skip if church with same slug already exists
        existing_slug = row.get("slug")
        if existing_slug:
            already = (
                client._request(
                    "GET",
                    "/churches",
                    params={
                        "select": "id,slug,status",
                        "slug": f"eq.{existing_slug}",
                        "limit": "1",
                    },
                )
                or []
            )
            if already and already[0].get("status") == "approved":
                print(f"  already in churches: {existing_slug}")
                report["skipped"].append(
                    {
                        "reason": "already_moved",
                        "from": source,
                        "id": row["id"],
                        "name": name,
                        "slug": existing_slug,
                        "church_id": already[0]["id"],
                    }
                )
                continue
        if not apply:
            report["moved"].append(
                {
                    "dry_run": True,
                    "from": source,
                    "id": row["id"],
                    "name": name,
                    "slug": row.get("slug"),
                }
            )
            continue
        try:
            base = slugify(row.get("slug") or name)
            slug = unique_slug(client, base)
            payload = (
                payload_from_business(row, slug)
                if source == "business"
                else payload_from_professional(row, slug)
            )
            created = (
                client._request(
                    "POST",
                    "/churches",
                    body=payload,
                    prefer="return=representation",
                )
                or []
            )
            if isinstance(created, list):
                created = created[0] if created else None
            if not created or not created.get("id"):
                raise RuntimeError("insert returned empty")
            to_id = created["id"]
            to_slug = created["slug"]
            if source == "business":
                archive_business(client, row["id"])
                from_path = f"/business/{row.get('slug')}"
            else:
                archive_professional(client, row["id"])
                from_path = f"/professional/{row.get('slug')}"
            insert_entity_move(
                client,
                from_type=source,
                from_id=row["id"],
                from_slug=row.get("slug") or "",
                from_path=from_path,
                to_id=to_id,
                to_slug=to_slug,
            )
            report["moved"].append(
                {
                    "from": source,
                    "from_id": row["id"],
                    "from_slug": row.get("slug"),
                    "to_id": to_id,
                    "to_slug": to_slug,
                    "name": name,
                }
            )
            print(f"  -> /churches/{to_slug}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ERROR {exc}", file=sys.stderr)
            report["errors"].append(
                {"from": source, "id": row.get("id"), "name": name, "error": str(exc)}
            )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = OUT / f"move_churches_{'apply' if apply else 'dry'}_{stamp}.json"
    latest = OUT / "move_churches_latest.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    latest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out_path}")
    print(
        f"moved={len(report['moved'])} skipped={len(report['skipped'])} errors={len(report['errors'])}"
    )
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
