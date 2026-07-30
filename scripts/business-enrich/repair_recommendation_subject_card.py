#!/usr/bin/env python3
"""Repair lyubov-nikonova card using recommendation_subject rules.

Turns the broken "recommender as title" professional into Aiman Zeitun with
Mercedes-Benz of Anaheim as an external workplace (no catalog business card).

Usage:
  python3 scripts/business-enrich/repair_recommendation_subject_card.py --dry-run
  python3 scripts/business-enrich/repair_recommendation_subject_card.py --apply
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
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from recommendation_subject import (  # noqa: E402
    clean_public_description,
    extract_employer,
    is_corporate_instagram,
    recommended_subject_name,
    short_teaser,
)
from web_enrichment import is_plausible_service_title  # noqa: E402

SLUG = "lyubov-nikonova-190932"
OUT = Path(__file__).resolve().parent / "data" / "recommendation_subject_repair"
OUT.mkdir(parents=True, exist_ok=True)


def find_auto_category(client: SupabaseRest) -> str | None:
    for slug in ("auto", "pro_other"):
        rows = (
            client._request(
                "GET",
                "/categories",
                params={
                    "select": "id,slug",
                    "slug": f"eq.{slug}",
                    "limit": "1",
                },
            )
            or []
        )
        if rows:
            return rows[0]["id"]
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--slug", default=SLUG)
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    rows = (
        client._request(
            "GET",
            "/professionals",
            params={"select": "*", "slug": f"eq.{args.slug}", "limit": "1"},
        )
        or []
    )
    if not rows:
        print(f"Professional not found: {args.slug}", file=sys.stderr)
        return 1
    pro = rows[0]
    blob = str(pro.get("description") or "")
    if not blob.strip():
        blob = "\n\n".join(
            str(pro.get(k) or "")
            for k in ("headline", "short_description", "card_summary")
            if pro.get(k)
        )
    subject = recommended_subject_name(blob) or "Айман Зейтун"
    employer = extract_employer(blob) or {
        "employer_name": "Mercedes-Benz of Anaheim",
        "employer_role": "Менеджер по продажам / лизинг",
        "is_russian_catalog": False,
    }
    description = clean_public_description(blob)
    # Prefer narrative without seasonal promo leftovers.
    if description:
        keep: list[str] = []
        for p in description.split("\n\n"):
            low = p.lower()
            if any(
                x in low
                for x in (
                    "праздник",
                    "4 июля",
                    "всем привет",
                    "0% годовых",
                    "самое время",
                )
            ):
                continue
            if len(p.strip()) < 8:
                continue
            keep.append(p.strip())
        if keep:
            description = "\n\n".join(keep)
    short = short_teaser(description)
    category_id = find_auto_category(client) or pro.get("category_id")

    website = pro.get("website")
    if website and "mercedesbenzofanaheim" in str(website).lower():
        website = None
    ig = pro.get("instagram_url")
    if is_corporate_instagram(ig):
        ig = None

    patch = {
        "display_name": subject[:120],
        "headline": (short or "Менеджер по продажам автомобилей")[:160],
        "short_description": short,
        "description": description,
        "card_summary": short,
        "employer_name": employer.get("employer_name"),
        "employer_role": employer.get("employer_role"),
        "employer_business_id": None,
        "website": website,
        "instagram_url": ig,
        "category_id": category_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    services = (
        client._request(
            "GET",
            "/professional_services",
            params={
                "select": "id,title,is_active",
                "professional_id": f"eq.{pro['id']}",
                "is_active": "eq.true",
                "limit": "50",
            },
        )
        or []
    )
    deactivate = [
        s
        for s in services
        if not is_plausible_service_title(str(s.get("title") or ""))
    ]

    report = {
        "slug": args.slug,
        "id": pro["id"],
        "subject": subject,
        "employer": employer,
        "patch": patch,
        "deactivate_services": [
            {"id": s["id"], "title": s.get("title")} for s in deactivate
        ],
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if args.apply else "dry"
    (OUT / f"{mode}_{stamp}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / f"{mode}_latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({
        "subject": subject,
        "employer": employer.get("employer_name"),
        "deactivate": len(deactivate),
        "description_preview": (description or "")[:180],
    }, ensure_ascii=False, indent=2))

    if not args.apply:
        print("DRY-RUN complete.")
        return 0

    client._request(
        "PATCH",
        "/professionals",
        params={"id": f"eq.{pro['id']}"},
        body=patch,
        prefer="return=minimal",
    )
    for s in deactivate:
        client._request(
            "PATCH",
            "/professional_services",
            params={"id": f"eq.{s['id']}"},
            body={"is_active": False},
            prefer="return=minimal",
        )
    print(f"Patched professional {pro['id']}; deactivated {len(deactivate)} services")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
