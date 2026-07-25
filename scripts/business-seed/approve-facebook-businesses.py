#!/usr/bin/env python3
"""
PACK 2.8 — Approve contactable Facebook businesses (explicit allowlist only).

Usage:
  python3 scripts/business-seed/approve-facebook-businesses.py
  python3 scripts/business-seed/approve-facebook-businesses.py --dry-run
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

spec = importlib.util.spec_from_file_location("sb_sql", ROOT / "scripts" / "sb_sql.py")
sb = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(sb)

# Explicit allowlist — do NOT broaden to "any row with phone".
APPROVED_SOURCE_POST_NUMBERS = [1, 3, 21, 23, 28, 31, 33, 39]

# Expected display names for operator confirmation (not used as match keys).
EXPECTED_NAMES = {
    1: "Den Mataev - Caviar & Seafood Delivery",
    3: "George Khazanovskiy - Real Estate Agent",
    21: "Zulya Alieva - Homemade Food Delivery",
    23: "Igor Green - Business Licensing Protection",
    28: "Tenina Law, Inc.",
    31: "Eugene Stephen - Immigration Attorney",
    33: "Ruzanna Melikyan - Cleaning Services",
    39: "Narek Mega Motors",
}

PHONE_OK_RE = re.compile(r"^\+?[\d\s\-().]{10,}$")


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def phone_is_valid(phone: str | None) -> bool:
    if not phone:
        return False
    text = phone.strip()
    if not text or "?" in text:
        return False
    digits = re.sub(r"\D", "", text)
    if len(digits) < 10:
        return False
    return bool(PHONE_OK_RE.match(text))


def source_post_number_from_row(row: dict) -> int | None:
    desc = row.get("description") or ""
    marker = "---FACEBOOK_SOURCE---"
    if marker in desc:
        raw = desc.split(marker, 1)[1].strip()
        try:
            payload = json.loads(raw)
            return int(payload.get("source_post_number"))
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    # Fallback: slug fb-post-{n}-...
    m = re.match(r"^fb-post-(\d+)-", row.get("slug") or "")
    if m:
        return int(m.group(1))
    return None


def find_candidates(post_number: int) -> list[dict]:
    like = f"fb-post-{post_number}-%"
    rows = sb.sql(
        f"""
        select id, slug, name, phone, status, description
        from public.businesses
        where slug like {sql_literal(like)}
           or description like {sql_literal(f'%"source_post_number": {post_number}%')}
           or description like {sql_literal(f'%"source_post_number":{post_number}%')}
        order by slug
        """
    )
    matched: list[dict] = []
    for row in rows or []:
        n = source_post_number_from_row(row)
        if n == post_number:
            matched.append(row)
    return matched


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    found = 0
    approved_now = 0
    already_approved = 0
    skipped = 0
    failed = 0

    print("Allowlist:", APPROVED_SOURCE_POST_NUMBERS)
    print("--- match preview ---")

    for post_number in APPROVED_SOURCE_POST_NUMBERS:
        candidates = find_candidates(post_number)
        if len(candidates) == 0:
            print(f"FAIL post={post_number}: not found")
            failed += 1
            continue
        if len(candidates) > 1:
            slugs = ", ".join(c["slug"] for c in candidates)
            print(f"FAIL post={post_number}: multiple matches ({slugs})")
            failed += 1
            continue

        row = candidates[0]
        found += 1
        print(f"FOUND post={post_number} slug={row['slug']} name={row['name']!r} status={row['status']} phone={row['phone']!r}")

        expected = EXPECTED_NAMES.get(post_number)
        if expected and row["name"] != expected:
            print(f"  WARN name mismatch expected={expected!r}")

        if not phone_is_valid(row.get("phone")):
            print(f"  SKIP post={post_number}: invalid phone {row.get('phone')!r}")
            skipped += 1
            continue

        status = row.get("status")
        if status == "approved":
            already_approved += 1
            continue
        if status != "pending":
            print(f"  SKIP post={post_number}: unexpected status {status!r}")
            skipped += 1
            continue

        if args.dry_run:
            print(f"  DRY-RUN would approve {row['slug']}")
            approved_now += 1
            continue

        result = sb.sql(
            f"""
            update public.businesses
            set status = 'approved', updated_at = now()
            where id = {sql_literal(row['id'])}
              and status = 'pending'
            returning slug, status
            """
        )
        if result and result[0].get("status") == "approved":
            approved_now += 1
            print(f"  APPROVED {row['slug']}")
        else:
            print(f"  FAIL post={post_number}: update returned no row")
            failed += 1

    print("--- summary ---")
    print(f"Found={found}")
    print(f"Approved now={approved_now}")
    print(f"Already approved={already_approved}")
    print(f"Skipped={skipped}")
    print(f"Failed={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
