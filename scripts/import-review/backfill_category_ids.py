#!/usr/bin/env python3
"""Backfill category_id for autopublished businesses (category_id only)."""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path

from category_map import resolve_category_id
from common import DEFAULT_REVIEWER_SOURCE, SupabaseRest, load_env

AUTO_NOTE = "Автоматическая публикация: accepted + прямой контакт"


def main() -> int:
    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1

    client = SupabaseRest(url, key)
    categories = client.fetch_categories()
    print("Platform categories:")
    for c in categories:
        print(f"  {c.get('slug'):12s}  {c.get('name')}")

    # --- Analysis: all accepted AI categories ---
    source = DEFAULT_REVIEWER_SOURCE
    posts = []
    if source.is_file():
        data = json.loads(source.read_text(encoding="utf-8"))
        posts = [p for p in data.get("posts") or [] if p.get("decision") == "accepted"]

    ai_counts: Counter[str] = Counter()
    for p in posts:
        entity = p.get("extracted_entity") or {}
        ai_counts[str(entity.get("category") or "(null)")] += 1

    print("\n=== Analysis: accepted AI categories → platform ===")
    analysis_rows = []
    for ai, n in ai_counts.most_common():
        match = resolve_category_id(None if ai == "(null)" else ai, categories)
        platform = match.get("name") or "— ручной выбор —"
        analysis_rows.append(
            {
                "ai_category": ai,
                "platform_category": platform,
                "platform_slug": match.get("slug"),
                "count_accepted": n,
                "needs_manual": match.get("needs_manual"),
            }
        )
        print(f"  {n:4d}  {ai:28s} → {platform}")

    # --- Backfill published autopublish businesses ---
    items = (
        client._request(
            "GET",
            "/import_review_items",
            params={
                "select": (
                    "id,title,category,review_status,review_notes,"
                    "published_entity_id,published_entity_type"
                ),
                "review_status": "eq.approved",
                "published_entity_id": "not.is.null",
                "order": "published_at.asc",
            },
        )
        or []
    )
    auto_items = [
        i
        for i in items
        if "Автоматическая публикация" in (i.get("review_notes") or "")
    ]

    mapped = 0
    cleared_manual = 0
    unchanged = 0
    manual: list[dict] = []
    mapped_rows: list[dict] = []
    published_ai_platform: Counter[tuple[str, str]] = Counter()

    for it in auto_items:
        if it.get("published_entity_type") not in {None, "business"}:
            continue
        eid = it.get("published_entity_id")
        if not eid:
            continue
        ai = it.get("category")
        match = resolve_category_id(ai, categories)
        platform_label = match.get("name") or "— ручной выбор —"
        published_ai_platform[(str(ai or "(null)"), platform_label)] += 1

        biz = client._request(
            "GET",
            "/businesses",
            params={"select": "id,category_id", "id": f"eq.{eid}"},
        ) or []
        current_id = biz[0].get("category_id") if biz else None
        new_id = match.get("category_id")

        detail = {
            "title": it.get("title"),
            "ai_category": ai,
            "platform_category": platform_label,
            "matched_via": match.get("matched_via"),
            "needs_manual": match.get("needs_manual"),
            "business_id": eid,
            "previous_category_id": current_id,
            "new_category_id": new_id,
        }

        if new_id == current_id:
            unchanged += 1
            if match.get("needs_manual"):
                manual.append(detail)
                note = (
                    f"{AUTO_NOTE}. Требуется ручной выбор категории "
                    f"(AI: {ai or '—'})"
                )
                client.patch(
                    "import_review_items",
                    {"id": f"eq.{it['id']}"},
                    {"review_notes": note},
                )
            mapped_rows.append(detail)
            continue

        # Update ONLY category_id on businesses
        client.patch(
            "businesses",
            {"id": f"eq.{eid}"},
            {"category_id": new_id},
        )

        if match.get("needs_manual") or not new_id:
            cleared_manual += 1
            manual.append(detail)
            note = (
                f"{AUTO_NOTE}. Требуется ручной выбор категории "
                f"(AI: {ai or '—'})"
            )
            client.patch(
                "import_review_items",
                {"id": f"eq.{it['id']}"},
                {"review_notes": note},
            )
            print(
                f"cleared→manual: {it.get('title')!r} AI={ai} "
                f"(was category_id={current_id})"
            )
        else:
            mapped += 1
            client.patch(
                "import_review_items",
                {"id": f"eq.{it['id']}"},
                {"review_notes": AUTO_NOTE},
            )
            print(
                f"mapped: {it.get('title')!r} AI={ai} → {match.get('name')} "
                f"({match.get('matched_via')})"
            )
        mapped_rows.append(detail)

    services_slug = "services"
    still_services = sum(
        1
        for d in mapped_rows
        if d.get("platform_category")
        and any(
            c.get("slug") == services_slug and c.get("name") == d["platform_category"]
            for c in categories
        )
    )
    # simpler count via match slug
    still_services = sum(
        1
        for it in auto_items
        if (resolve_category_id(it.get("category"), categories).get("slug") == "services")
    )

    unmapped_ai = sorted(
        {
            row["ai_category"]
            for row in analysis_rows
            if row["needs_manual"] and row["ai_category"] not in {None, "(null)"}
        }
    )

    print()
    print("=== Backfill summary ===")
    print(f"published autopublish cards: {len(auto_items)}")
    print(f"category_id updated (mapped): {mapped}")
    print(f"category_id cleared→manual:   {cleared_manual}")
    print(f"unchanged:                    {unchanged}")
    print(f"still in Услуги:              {still_services}")
    print(f"needs manual:                 {len(manual)}")
    print()
    print("Published cards by AI → platform:")
    for (ai, plat), n in sorted(
        published_ai_platform.items(), key=lambda kv: (-kv[1], kv[0][0])
    ):
        print(f"  {n:3d}  {ai:24s} → {plat}")

    print()
    print("Unmapped AI categories (accepted corpus):")
    for ai in unmapped_ai:
        print(f"  - {ai}")

    out = Path(__file__).resolve().parent / "data" / "category_backfill_report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "platform_categories": [
                    {"slug": c.get("slug"), "name": c.get("name")} for c in categories
                ],
                "analysis_accepted": analysis_rows,
                "distinct_ai_categories": len(ai_counts),
                "published_backfill": mapped_rows,
                "stats": {
                    "mapped_updates": mapped,
                    "cleared_manual": cleared_manual,
                    "unchanged": unchanged,
                    "still_services": still_services,
                    "needs_manual": len(manual),
                },
                "unmapped_ai_categories": unmapped_ai,
                "manual": manual,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
