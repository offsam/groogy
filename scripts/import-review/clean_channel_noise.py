#!/usr/bin/env python3
"""Strip channel contacts and ad-manager footers from cards.

The advertiser keeps their own contacts; the group admin's handle, the
affiliate link and the «по вопросам рекламы» line come off. A contact stays
wherever it is the subject of the card itself.

Phones are reported but never stripped: ten-digit chat ids look like phone
numbers, so that decision stays with a human.

Usage:
  python3 scripts/import-review/clean_channel_noise.py --dry-run
  python3 scripts/import-review/clean_channel_noise.py --apply
  python3 scripts/import-review/clean_channel_noise.py --apply --scope queue
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit_glued_cards import domains, fetch_all, instagrams  # noqa: E402
from channel_noise import (  # noqa: E402
    ad_footer_lines,
    is_subject,
    load_noise,
    strip_ad_footer,
)
from common import SupabaseRest, load_env  # noqa: E402

OPEN_STATUSES = ("pending", "in_review", "ready_to_publish", "needs_more_info")


def noisy_value(
    value: str, kind: str, noise: dict[str, set[str]], names: tuple[str, ...]
) -> bool:
    if kind == "instagram":
        found = instagrams(value)
    else:
        found = domains(value)
    if not found:
        return False
    return all(
        v in noise[kind] and not is_subject(v, *names) for v in found
    )


def clean_list(
    values: Any, kind: str, noise: dict[str, set[str]], names: tuple[str, ...]
) -> tuple[list[str], list[str]]:
    kept: list[str] = []
    dropped: list[str] = []
    for raw in values or []:
        value = str(raw).strip()
        if not value:
            continue
        (dropped if noisy_value(value, kind, noise, names) else kept).append(value)
    return kept, dropped


def main() -> int:
    parser = argparse.ArgumentParser(description="Strip channel noise from cards")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--scope", choices=("all", "published", "queue"), default="all")
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    noise = load_noise()
    noise["phones"] = set()
    print(
        f"Noise list: {len(noise['instagram'])} instagram, {len(noise['domains'])} domains"
    )

    changes: list[dict[str, Any]] = []

    if args.scope in {"all", "queue"}:
        rows = fetch_all(
            client,
            "import_review_items",
            {
                "select": (
                    "id,title,business_name,person_name,description,website,instagram,"
                    "review_status"
                ),
                "review_status": f"in.({','.join(OPEN_STATUSES)})",
            },
            page=200,
        )
        for row in rows:
            names = (
                str(row.get("business_name") or ""),
                str(row.get("title") or ""),
                str(row.get("person_name") or ""),
            )
            patch: dict[str, Any] = {}
            dropped: dict[str, list[str]] = {}
            for field, kind in (("website", "domains"), ("instagram", "instagram")):
                kept, gone = clean_list(row.get(field), kind, noise, names)
                if gone:
                    patch[field] = kept
                    dropped[field] = gone
            description = row.get("description") or ""
            if ad_footer_lines(description):
                patch["description"] = strip_ad_footer(description)
                dropped["ad_footer"] = ad_footer_lines(description)
            if patch:
                changes.append(
                    {
                        "table": "import_review_items",
                        "id": row["id"],
                        "title": names[0] or names[1],
                        "dropped": dropped,
                        "patch": patch,
                    }
                )

    if args.scope in {"all", "published"}:
        for table, name_field, text_fields in (
            ("businesses", "name", ("description", "short_description")),
            ("professionals", "display_name", ("description", "short_description")),
        ):
            status = "approved"
            rows = fetch_all(
                client,
                table,
                {
                    "select": (
                        f"id,slug,{name_field},website,instagram_url,"
                        f"{','.join(text_fields)}"
                    ),
                    "status": f"eq.{status}",
                },
            )
            for row in rows:
                names = (str(row.get(name_field) or ""), str(row.get("slug") or ""))
                patch: dict[str, Any] = {}
                dropped: dict[str, list[str]] = {}
                for field, kind in (
                    ("website", "domains"),
                    ("instagram_url", "instagram"),
                ):
                    value = row.get(field)
                    if value and noisy_value(str(value), kind, noise, names):
                        patch[field] = None
                        dropped[field] = [str(value)]
                for field in text_fields:
                    text = row.get(field) or ""
                    if ad_footer_lines(text):
                        patch[field] = strip_ad_footer(text)
                        dropped.setdefault("ad_footer", []).extend(ad_footer_lines(text))
                if patch:
                    changes.append(
                        {
                            "table": table,
                            "id": row["id"],
                            "title": names[0],
                            "slug": row.get("slug"),
                            "dropped": dropped,
                            "patch": patch,
                        }
                    )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = ROOT / "docs" / "audits" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    mode = "apply" if args.apply else "dry"
    report = {
        "generated_at": stamp,
        "scope": args.scope,
        "cards_changed": len(changes),
        "by_table": {
            table: sum(1 for c in changes if c["table"] == table)
            for table in {c["table"] for c in changes}
        },
        "changes": changes,
    }
    (out_dir / f"channel_noise_clean_{mode}_{stamp}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / f"channel_noise_clean_{mode}_latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report["by_table"], ensure_ascii=False))
    for change in changes[:15]:
        print(f"- [{change['table']}] {str(change['title'])[:40]!r} {change['dropped']}")
    print(f"Cards to change: {len(changes)}")

    if not args.apply:
        print("DRY-RUN complete. No writes.")
        return 0

    for change in changes:
        client.patch(change["table"], {"id": f"eq.{change['id']}"}, change["patch"])
    print(f"Patched {len(changes)} cards")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
