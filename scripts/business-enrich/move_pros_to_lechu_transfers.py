#!/usr/bin/env python3
"""Move misclassified professionals into lechu / transfers listings.

Apply path uses linked SQL (trusted listing write) because PostgREST
cannot insert listings without private.enable_trusted_listing_write().

Usage:
  python3 scripts/business-enrich/move_pros_to_lechu_transfers.py --dry-run
  python3 scripts/business-enrich/move_pros_to_lechu_transfers.py --apply
    # runs: npx supabase db query --linked -f .../move_pros_to_lechu_transfers.sql
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

OUT = Path(__file__).resolve().parent / "data"
OUT.mkdir(parents=True, exist_ok=True)

# Explicit moves from specialists → proper sections
MOVES: list[dict[str, Any]] = [
    {
        "slug": "fb-post-37-kristina-immerman-moscow-to-usa-courier",
        "kind": "lechu",
        "category_slug": "lechu-ru-us",
        "departure_country": "RU",
        "destination_country": "US",
        "carry_types": ["parcels", "documents", "medicine"],
        "reward_type": "negotiable",
        "title": "Лечу из Москвы в США — посылки, документы, лекарства",
    },
    {
        "slug": "jane-oc",
        "kind": "lechu",
        "category_slug": "lechu-other",
        "departure_country": "US",
        "destination_country": "Other",
        "carry_types": ["parcels", "documents"],
        "reward_type": "negotiable",
        "title": "Таня летит — могу взять посылку",
    },
    {
        "slug": "lana-205640-2183",
        "kind": "transfer",
        "category_slug": "transfer-us-ru",
        "from_country": "US",
        "to_country": "RU",
        "transfer_method": "other",
        "title": "Оплата покупок и услуг рублями (Zelle / ЦБ)",
    },
    {
        "slug": "irinka-milovskaia",
        "kind": "transfer",
        "category_slug": "transfer-us-ru",
        "from_country": "US",
        "to_country": "RU",
        "transfer_method": "cash",
        "title": "Обмен рублей на доллары (Zelle)",
    },
]


def source_kind(pro: dict[str, Any]) -> str:
    st = (pro.get("source_type") or "").lower()
    url = (pro.get("source_url") or "").lower()
    if "facebook" in st or "facebook.com" in url:
        return "facebook"
    if "telegram" in st or "t.me" in url:
        return "telegram"
    return "platform"


def build_description(pro: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("description", "short_description", "headline"):
        val = (pro.get(key) or "").strip()
        if val and val not in parts:
            parts.append(val)
    contacts: list[str] = []
    if pro.get("phone"):
        contacts.append(f"Телефон: {pro['phone']}")
    if pro.get("telegram_url"):
        contacts.append(f"Telegram: {pro['telegram_url']}")
    if pro.get("instagram_url"):
        contacts.append(f"Instagram: {pro['instagram_url']}")
    if pro.get("email"):
        contacts.append(f"Email: {pro['email']}")
    if contacts:
        parts.append("Контакты:\n" + "\n".join(contacts))
    text = "\n\n".join(parts).strip()
    if len(text) < 10:
        text = f"{pro.get('display_name') or 'Объявление'}. Свяжитесь по контактам."
    return text[:8000]


def build_title(move: dict[str, Any], pro: dict[str, Any]) -> str:
    title = (move.get("title") or pro.get("card_summary") or pro.get("display_name") or "Объявление").strip()
    title = re.sub(r"\s+", " ", title)
    return title[:120]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    apply = bool(args.apply) and not args.dry_run

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    admins = client._request(
        "GET",
        "/profiles",
        params={"select": "id", "role": "eq.admin", "limit": "1"},
    )
    if not admins:
        raise RuntimeError("No admin profile to own migrated listings")
    owner_id = admins[0]["id"]

    cats = client._request(
        "GET",
        "/listing_categories",
        params={
            "select": "id,slug,listing_type,domain,is_active",
            "is_active": "eq.true",
        },
    ) or []
    cat_by_slug = {c["slug"]: c for c in cats}

    results: list[dict[str, Any]] = []

    if apply:
        import subprocess

        sql_path = Path(__file__).resolve().parent / "data" / "move_pros_to_lechu_transfers.sql"
        proc = subprocess.run(
            ["npx", "supabase", "db", "query", "--linked", "-f", str(sql_path)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            print(proc.stdout)
            print(proc.stderr, file=sys.stderr)
            return proc.returncode

        # Re-read outcomes
        for move in MOVES:
            slug = move["slug"]
            pros = client._request(
                "GET",
                "/professionals",
                params={"select": "id,slug,status", "slug": f"eq.{slug}", "limit": "1"},
            ) or []
            listing_type = "transport_carry" if move["kind"] == "lechu" else "transfer"
            listings = client._request(
                "GET",
                "/listings",
                params={
                    "select": "id,title,status",
                    "listing_type": f"eq.{listing_type}",
                    "title": f"eq.{move['title']}",
                    "limit": "1",
                },
            ) or []
            results.append(
                {
                    "slug": slug,
                    "kind": move["kind"],
                    "status": "moved"
                    if pros and pros[0].get("status") == "archived" and listings
                    else "check",
                    "pro_status": (pros[0].get("status") if pros else None),
                    "listing_id": listings[0]["id"] if listings else None,
                    "title": move["title"],
                }
            )
    else:
        for move in MOVES:
            slug = move["slug"]
            pros = client._request(
                "GET",
                "/professionals",
                params={"select": "*", "slug": f"eq.{slug}", "limit": "1"},
            ) or []
            if not pros:
                results.append({"slug": slug, "status": "missing_professional"})
                continue
            pro = pros[0]
            if (pro.get("status") or "").lower() == "archived":
                results.append({"slug": slug, "status": "already_archived", "pro_id": pro["id"]})
                continue
            cat = cat_by_slug.get(move["category_slug"])
            if not cat:
                results.append({"slug": slug, "status": "missing_category", "category": move["category_slug"]})
                continue
            results.append(
                {
                    "slug": slug,
                    "kind": move["kind"],
                    "status": "dry-run",
                    "pro_id": pro["id"],
                    "title": build_title(move, pro),
                    "category": move["category_slug"],
                }
            )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if apply else "dry-run",
        "owner_id": owner_id,
        "results": results,
        "moved": sum(1 for r in results if r.get("status") == "moved"),
        "dry_run": sum(1 for r in results if r.get("status") == "dry-run"),
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"move_pros_to_lechu_transfers_{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "mode": report["mode"],
                "moved": report["moved"],
                "dry_run": report["dry_run"],
                "report": str(path),
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
