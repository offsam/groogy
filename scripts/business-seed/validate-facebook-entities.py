#!/usr/bin/env python3
"""
Validate Facebook entity import + PACK 2.8 publish allowlist.

Usage:
  python3 scripts/business-seed/validate-facebook-entities.py
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = Path(__file__).resolve().parent / "data" / "facebook_entities_posts_1_41.json"

spec = importlib.util.spec_from_file_location("sb_sql", ROOT / "scripts" / "sb_sql.py")
sb = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(sb)

APPROVED_SOURCE_POST_NUMBERS = [1, 3, 21, 23, 28, 31, 33, 39]
MUST_STAY_PENDING = [2, 24, 27]


def source_post_number(row: dict) -> int | None:
    desc = row.get("description") or ""
    marker = "---FACEBOOK_SOURCE---"
    if marker in desc:
        raw = desc.split(marker, 1)[1].strip()
        try:
            return int(json.loads(raw).get("source_post_number"))
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    m = re.match(r"^fb-post-(\d+)-", row.get("slug") or "")
    return int(m.group(1)) if m else None


def phone_ok(phone: str | None) -> bool:
    if not phone or "?" in phone:
        return False
    digits = re.sub(r"\D", "", phone)
    return len(digits) >= 10


def main() -> None:
    payload = json.loads(SEED.read_text(encoding="utf-8"))
    errors: list[str] = []

    summary = sb.sql(
        """
        select
          count(*)::int as facebook_rows,
          count(*) filter (where status = 'pending')::int as pending,
          count(*) filter (where status = 'approved')::int as approved,
          count(*) filter (where description like '%---FACEBOOK_SOURCE---%')::int as with_source,
          count(*) filter (where category_id is null)::int as missing_category
        from public.businesses
        where slug like 'fb-post-%'
        """
    )[0]

    totals = sb.sql(
        """
        select
          count(*)::int as total,
          count(*) filter (where slug like 'fb-post-%')::int as facebook,
          count(*) filter (where slug not like 'fb-post-%')::int as non_facebook
        from public.businesses
        """
    )[0]

    rows = sb.sql(
        """
        select slug, name, phone, status, description
        from public.businesses
        where slug like 'fb-post-%'
        order by slug
        """
    )

    by_post: dict[int, list[dict]] = {}
    for row in rows or []:
        n = source_post_number(row)
        if n is None:
            errors.append(f"unparseable source_post_number for {row['slug']}")
            continue
        by_post.setdefault(n, []).append(row)

    print("facebook_seed_file", len(payload))
    print("facebook_rows", summary)
    print("totals", totals)

    if totals["non_facebook"] > 0:
        errors.append(f"unexpected non-facebook rows: {totals['non_facebook']}")
    if summary["facebook_rows"] != 37:
        errors.append(f"expected 37 facebook rows, got {summary['facebook_rows']}")
    if summary["facebook_rows"] != len(payload):
        errors.append(
            f"JSON/DB count mismatch: json={len(payload)} db={summary['facebook_rows']}"
        )
    if summary["with_source"] != summary["facebook_rows"]:
        errors.append("some rows missing FACEBOOK_SOURCE block")
    if summary["approved"] != 8:
        errors.append(f"expected approved=8, got {summary['approved']}")
    if summary["pending"] != 29:
        errors.append(f"expected pending=29, got {summary['pending']}")

    for post_number in APPROVED_SOURCE_POST_NUMBERS:
        matches = by_post.get(post_number, [])
        if len(matches) != 1:
            errors.append(
                f"allowlist post {post_number}: expected 1 row, got {len(matches)}"
            )
            continue
        row = matches[0]
        if row["status"] != "approved":
            errors.append(
                f"allowlist post {post_number} ({row['slug']}) status={row['status']}"
            )
        if not phone_ok(row.get("phone")):
            errors.append(
                f"allowlist post {post_number} ({row['slug']}) invalid phone={row.get('phone')!r}"
            )

    for post_number in MUST_STAY_PENDING:
        matches = by_post.get(post_number, [])
        if len(matches) != 1:
            errors.append(
                f"must-pending post {post_number}: expected 1 row, got {len(matches)}"
            )
            continue
        row = matches[0]
        if row["status"] != "pending":
            errors.append(
                f"must-pending post {post_number} ({row['slug']}) status={row['status']}"
            )

    # No non-allowlist approvals.
    for post_number, matches in sorted(by_post.items()):
        if post_number in APPROVED_SOURCE_POST_NUMBERS:
            continue
        for row in matches:
            if row["status"] == "approved":
                errors.append(
                    f"unexpected approved post {post_number} ({row['slug']})"
                )

    # Post 2 phone must remain null / invalid (not a publishable number).
    post2 = by_post.get(2, [])
    if len(post2) == 1 and phone_ok(post2[0].get("phone")):
        errors.append(f"post 2 unexpectedly has valid phone={post2[0].get('phone')!r}")

    if errors:
        for err in errors:
            print("FAIL:", err)
        raise SystemExit(1)

    print("allowlist_approved", APPROVED_SOURCE_POST_NUMBERS)
    print("must_stay_pending", MUST_STAY_PENDING)
    print("OK")


if __name__ == "__main__":
    main()
