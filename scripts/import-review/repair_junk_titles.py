#!/usr/bin/env python3
"""Repair junk import-review titles (Messenger, gmail.com) from description text.

Usage:
  python3 scripts/import-review/repair_junk_titles.py --dry-run
  python3 scripts/import-review/repair_junk_titles.py --apply
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402

JUNK = {
    "messenger",
    "whatsapp",
    "telegram",
    "gmail.com",
    "yahoo.com",
    "mail.com",
    "instagram",
    "facebook",
    "unknown",
    "user",
}


def is_junk(title: str | None) -> bool:
    t = (title or "").strip().lower()
    if not t:
        return False
    if t in JUNK:
        return True
    if t.endswith((".com", ".net", ".org")) and " " not in t and "@" not in t:
        return True
    return False


def needs_title_repair(row: dict) -> bool:
    names = [row.get("title"), row.get("business_name"), row.get("person_name")]
    non_empty = [n for n in names if (n or "").strip()]
    if not non_empty:
        return True
    return all(is_junk(n) for n in non_empty)


def infer_name(description: str | None) -> str | None:
    text = re.sub(r"\s+", " ", (description or "")).strip()
    if not text:
        return None
    patterns = [
        r"([A-ZА-ЯЁ][\wА-Яа-яЁё.&'’-]{1,40}(?:\s+[A-ZА-ЯЁa-zа-яё][\wА-Яа-яЁё.&'’-]{0,40}){0,4})\s+(?:предоставляет|поможет|предлагает|offers|provides)",
        r"(?:компания|студия|салон|сервис|service)\s+[«\"]?([A-ZА-ЯЁ][\wА-Яа-яЁё.&'’\s-]{2,50})[»\"]?",
    ]
    for pat in patterns:
        m = re.search(pat, text, flags=re.I)
        if m:
            cand = m.group(1).strip()
            if cand and not is_junk(cand) and len(cand) >= 3:
                return cand[:80]
    return None


def sanitize_instagram(values: list | None) -> list[str]:
    out: list[str] = []
    for raw in values or []:
        v = str(raw).strip().lstrip("@").lower()
        if not v or "@" in v or v in JUNK:
            continue
        if v.endswith((".com", ".net", ".org", ".ru", ".io")):
            continue
        if v not in out:
            out.append(v)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=500)
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
            "/import_review_items",
            params={
                "select": "id,title,business_name,person_name,description,instagram,review_status,source",
                "published_entity_id": "is.null",
                "order": "updated_at.desc",
                "limit": str(args.limit),
            },
        )
        or []
    )

    repairs = []
    for r in rows:
        ig = r.get("instagram") or []
        cleaned_ig = sanitize_instagram(ig)
        ig_dirty = cleaned_ig != list(ig) and any(
            str(x).lower() in JUNK or str(x).lower().endswith((".com", ".net", ".org"))
            for x in ig
        )

        if needs_title_repair(r):
            inferred = infer_name(r.get("description"))
            if not inferred and cleaned_ig:
                inferred = cleaned_ig[0]
            # Last resort: keep a readable placeholder from description start
            if not inferred:
                desc = re.sub(r"\s+", " ", (r.get("description") or "")).strip()
                if desc:
                    inferred = desc[:60].rstrip(" ,.;") + ("…" if len(desc) > 60 else "")
            if inferred:
                repairs.append(
                    {
                        **r,
                        "_new_title": inferred,
                        "_new_ig": cleaned_ig if ig_dirty or cleaned_ig != list(ig) else None,
                        "_reason": "title",
                    }
                )
                continue
            if ig_dirty:
                repairs.append(
                    {
                        **r,
                        "_new_title": None,
                        "_new_ig": cleaned_ig,
                        "_reason": "ig_only",
                    }
                )
            continue

        if ig_dirty:
            repairs.append(
                {
                    **r,
                    "_new_title": None,
                    "_new_ig": cleaned_ig,
                    "_reason": "ig_only",
                }
            )

    print(f"Scanned {len(rows)}, repair candidates {len(repairs)}")
    for item in repairs[:30]:
        print(
            f"- {item['id'][:8]} [{item['_reason']}] "
            f"{item.get('title')!r} → {item.get('_new_title')!r} "
            f"ig={item.get('instagram')} → {item.get('_new_ig')}"
        )

    if args.dry_run:
        print("DRY-RUN only")
        return 0

    updated = 0
    for item in repairs:
        body: dict = {}
        if item.get("_new_title"):
            body["title"] = item["_new_title"]
            body["business_name"] = item["_new_title"]
            if is_junk(item.get("person_name")):
                body["person_name"] = None
        if item.get("_new_ig") is not None:
            body["instagram"] = item["_new_ig"]
        if not body:
            continue
        client.patch("import_review_items", {"id": f"eq.{item['id']}"}, body)
        updated += 1
    print(f"Updated {updated} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
