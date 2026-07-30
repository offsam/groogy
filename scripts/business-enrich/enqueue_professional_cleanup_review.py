#!/usr/bin/env python3
"""Enqueue Phase-2 Manual Review professionals into Admin Import Review Center.

Idempotent via source_fingerprint = professional_cleanup_v1:{slug}.
Does NOT publish, does NOT modify professionals, does NOT delete.

Usage:
  python3 scripts/business-enrich/enqueue_professional_cleanup_review.py --dry-run
  python3 scripts/business-enrich/enqueue_professional_cleanup_review.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402
from sb_sql import sql as run_sql  # noqa: E402

SOURCE = "professional_cleanup_v1"
SOURCE_GROUP = "Professional Cleanup Phase 2"
PHASE2_REPORT = ROOT / "docs" / "audits" / "data" / "professional_cleanup_phase2_apply_latest.json"
OUT = ROOT / "docs" / "audits" / "data"
BATCH = "enqueue_professional_cleanup_review_v1"


def ig_handle(url: str | None) -> str | None:
    if not url or not str(url).strip():
        return None
    raw = str(url).strip()
    if "instagram.com/" in raw.lower():
        h = raw.split("instagram.com/")[-1].split("?")[0].strip("/").split("/")[0]
        return h.lstrip("@") or None
    return raw.lstrip("@") or None


def tg_username(url: str | None) -> str | None:
    if not url or not str(url).strip():
        return None
    raw = str(url).strip()
    m = re.search(r"(?:t\.me|telegram\.me)/([A-Za-z][A-Za-z0-9_]{3,31})", raw, re.I)
    if m:
        return m.group(1)
    if raw.startswith("@"):
        return raw[1:]
    return None


def problems_for(reason: str, pro: dict[str, Any]) -> list[str]:
    problems = []
    if reason == "still_pro_other":
        problems.append("ambiguous_classification")
        problems.append("multiple_possible_categories")
        problems.append("low_confidence")
    if reason == "no_contact":
        problems.append("insufficient_contacts")
        problems.append("missing_required_fields")
    if not (pro.get("category_slug") and pro.get("category_slug") != "pro_other"):
        if "ambiguous_classification" not in problems:
            problems.append("ambiguous_classification")
    if not (pro.get("image_url") or "").strip():
        problems.append("missing_required_fields")
    if not (pro.get("city") or "").strip() and not (pro.get("service_area_text") or "").strip():
        problems.append("missing_required_fields")
    # dedupe preserve order
    seen: set[str] = set()
    out = []
    for p in problems:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def confidence_for(reason: str) -> float:
    return 0.35 if reason == "no_contact" else 0.42


def suggested_entity(pro: dict[str, Any], reason: str) -> tuple[str, str]:
    """Return (entity_type, target_collection) suggestion — always low-confidence specialist default."""
    name = (pro.get("display_name") or "")
    blob = " ".join(
        filter(
            None,
            [
                name,
                pro.get("headline"),
                pro.get("description"),
                pro.get("short_description"),
            ],
        )
    )
    if re.search(r"\b(llc|inc\.?|medical\s+group|law\s+firm|agency|academy|school|resort|студия|салон)\b", name, re.I):
        return "business", "businesses"
    if re.search(r"сдам|аренда\s+(машин|квартир|комнат)|for\s+rent|room\s+for\s+rent", blob, re.I):
        return "marketplace_listing", "marketplace"
    if re.search(r"вакансия|ищем\s+мастера|hiring\b", blob, re.I):
        return "job", "jobs"
    return "private_specialist", "private_specialists"


def media_from_image(url: str | None) -> list[dict[str, Any]]:
    if not url or not str(url).strip() or "placeholder" in str(url).lower():
        return []
    return [
        {
            "media_type": "photo",
            "download_status": "downloaded",
            "storage_path": None,
            "original_filename": None,
            "external_url": str(url).strip(),
        }
    ]


def row_for(pro: dict[str, Any], reason: str) -> dict[str, Any]:
    slug = pro["slug"]
    name = (pro.get("display_name") or slug or "").strip()
    entity_type, target = suggested_entity(pro, reason)
    problems = problems_for(reason, pro)
    conf = confidence_for(reason)
    phone = [pro["phone"]] if pro.get("phone") else []
    email = [pro["email"]] if pro.get("email") else []
    website = [pro["website"]] if pro.get("website") else []
    ig = ig_handle(pro.get("instagram_url"))
    instagram = [ig] if ig else []
    tg = tg_username(pro.get("telegram_url"))
    desc = (pro.get("description") or pro.get("short_description") or pro.get("headline") or "").strip() or None
    preview = (pro.get("image_url") or "").strip() or None
    if preview and "placeholder" in preview.lower():
        preview = None

    ai_reason = (
        f"professional_cleanup_phase2:{reason}; problems={','.join(problems)}; "
        f"suggested={entity_type}; keep_in_admin_review=true"
    )

    raw_payload = {
        "origin": "professional_cleanup_phase2",
        "batch_id": BATCH,
        "enqueued_at": datetime.now(timezone.utc).isoformat(),
        "existing_professional_id": pro["id"],
        "existing_professional_slug": slug,
        "existing_professional_status": pro.get("status"),
        "cleanup_reason": reason,
        "suggested_entity_type": entity_type,
        "suggested_target_collection": target,
        "confidence": conf,
        "problems": problems,
        "analysis": {
            "phase": "professional_cleanup_phase2",
            "manual_review": True,
            "do_not_autopublish": True,
            "linked_entity": "professionals",
            "moderator_hint": (
                "Change target_collection then Approve to publish as that type "
                "(archives linked Professional unless keeping as specialist). "
                "Reject = Archive linked Professional. "
                "Duplicate = mark duplicate + archive linked Professional."
            ),
        },
        "snapshot": {
            "display_name": name,
            "headline": pro.get("headline"),
            "short_description": pro.get("short_description"),
            "description": pro.get("description"),
            "card_summary": pro.get("card_summary"),
            "category_slug": pro.get("category_slug"),
            "category_name": pro.get("category_name"),
            "phone": pro.get("phone"),
            "email": pro.get("email"),
            "website": pro.get("website"),
            "instagram_url": pro.get("instagram_url"),
            "telegram_url": pro.get("telegram_url"),
            "image_url": pro.get("image_url"),
            "city": pro.get("city"),
            "region": pro.get("region"),
            "state_code": pro.get("state_code"),
            "service_area_text": pro.get("service_area_text"),
            "source_type": pro.get("source_type"),
            "source_url": pro.get("source_url"),
            "import_batch_id": pro.get("import_batch_id"),
        },
    }

    return {
        "source": SOURCE,
        "source_group": SOURCE_GROUP,
        "source_chat_id": None,
        "source_message_ids": [],
        "source_fingerprint": f"{SOURCE}:{slug}",
        "source_author_id": None,
        "source_author_username": None,
        "source_author_display_name": name,
        "source_posted_at": pro.get("published_at") or pro.get("created_at"),
        "source_text": desc,
        "source_url": pro.get("source_url"),
        "source_media": media_from_image(preview),
        "ai_decision": "needs_review",
        "ai_confidence": conf,
        "ai_reason": ai_reason,
        "entity_type": entity_type,
        "target_collection": target,
        "category": pro.get("category_slug") or "pro_other",
        "subcategory": reason,
        "title": name[:200],
        "business_name": name[:200] if entity_type == "business" else None,
        "person_name": name[:200] if entity_type == "private_specialist" else name[:200],
        "description": desc,
        "services": [],
        "price": None,
        "currency": "USD",
        "city": pro.get("city"),
        "state": (pro.get("state_code") or pro.get("region") or "")[:40] or None,
        "phone": phone,
        "whatsapp": [],
        "telegram_username": tg,
        "telegram_user_id": None,
        "instagram": instagram,
        "website": website,
        "email": email,
        "photos_count": 1 if preview else 0,
        "preview_image_url": preview,
        "duplicate_status": "unique",
        "raw_payload": raw_payload,
        "review_status": "pending",
        "review_notes": (
            f"From Professional Cleanup Phase 2 Manual Review. Reason: {reason}. "
            f"Problems: {', '.join(problems)}."
        ),
    }


def load_still_review() -> list[dict[str, str]]:
    if not PHASE2_REPORT.exists():
        raise SystemExit(f"missing {PHASE2_REPORT}")
    data = json.loads(PHASE2_REPORT.read_text(encoding="utf-8"))
    still = data.get("review", {}).get("still_review") or []
    return still


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    apply = bool(args.apply) and not args.dry_run
    if not apply and not args.dry_run:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    still = load_still_review()
    print(f"phase2_still_review={len(still)}")
    reasons = Counter(x.get("reason") for x in still)
    print("reasons", dict(reasons))

    slugs = [x["slug"] for x in still]
    reason_by_slug = {x["slug"]: x.get("reason") or "ambiguous" for x in still}

    pros: dict[str, dict[str, Any]] = {}
    for i in range(0, len(slugs), 80):
        chunk = slugs[i : i + 80]
        inlist = ",".join("'" + s.replace("'", "''") + "'" for s in chunk)
        rows = run_sql(
            f"""
            SELECT p.id, p.slug, p.display_name, p.status, p.visibility,
                   p.headline, p.short_description, p.description, p.card_summary,
                   p.phone, p.email, p.website, p.instagram_url, p.telegram_url,
                   p.image_url, p.city, p.region, p.state_code, p.service_area_text,
                   p.source_type, p.source_url, p.import_batch_id,
                   p.published_at, p.created_at,
                   c.slug AS category_slug, c.name AS category_name
            FROM professionals p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.slug IN ({inlist})
            """
        )
        for r in rows or []:
            pros[r["slug"]] = r

    missing = [s for s in slugs if s not in pros]
    not_approved = [s for s, p in pros.items() if p.get("status") != "approved"]

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    fps = [f"{SOURCE}:{s}" for s in slugs]
    existing_fps: set[str] = set()
    for i in range(0, len(fps), 80):
        chunk = fps[i : i + 80]
        # PostgREST in filter
        in_expr = "(" + ",".join(json.dumps(x) for x in chunk) + ")"
        found = client._request(
            "GET",
            "/import_review_items",
            params={
                "select": "source_fingerprint,id,review_status",
                "source_fingerprint": f"in.{in_expr}",
                "limit": str(len(chunk)),
            },
        ) or []
        for row in found:
            existing_fps.add(row["source_fingerprint"])

    to_insert: list[dict[str, Any]] = []
    skipped_existing = []
    skipped_missing = []
    skipped_not_approved = []

    for slug in slugs:
        fp = f"{SOURCE}:{slug}"
        if fp in existing_fps:
            skipped_existing.append(slug)
            continue
        if slug in missing:
            skipped_missing.append(slug)
            continue
        if slug in not_approved:
            skipped_not_approved.append(slug)
            continue
        to_insert.append(row_for(pros[slug], reason_by_slug[slug]))

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if apply else "dry-run",
        "batch_id": BATCH,
        "source": SOURCE,
        "phase2_still_review_count": len(still),
        "reasons": dict(reasons),
        "to_insert": len(to_insert),
        "skipped_already_in_queue": len(skipped_existing),
        "skipped_missing_professional": skipped_missing,
        "skipped_not_approved": skipped_not_approved,
        "sample": [
            {
                "slug": r["raw_payload"]["existing_professional_slug"],
                "title": r["title"],
                "problems": r["raw_payload"]["problems"],
                "suggested": r["entity_type"],
                "confidence": r["ai_confidence"],
            }
            for r in to_insert[:10]
        ],
    }

    if apply and to_insert:
        inserted = 0
        for i in range(0, len(to_insert), 40):
            chunk = to_insert[i : i + 40]
            created = client.insert_many("import_review_items", chunk) or []
            inserted += len(created)
            print(f"inserted {inserted}/{len(to_insert)}", flush=True)
        report["inserted"] = inserted
    else:
        report["inserted"] = 0

    # verify
    verify = run_sql(
        f"""
        SELECT review_status::text, count(*)::int AS n
        FROM import_review_items
        WHERE source = '{SOURCE}'
        GROUP BY 1
        ORDER BY 1
        """
    )
    report["queue_by_status"] = {r["review_status"]: r["n"] for r in (verify or [])}
    report["queue_total"] = sum(report["queue_by_status"].values())

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"enqueue_professional_cleanup_review_{'apply' if apply else 'dry'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    latest = OUT / f"enqueue_professional_cleanup_review_{'apply' if apply else 'dry'}_latest.json"
    latest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"report={path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
