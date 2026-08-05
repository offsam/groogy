#!/usr/bin/env python3
"""Clean to4ka enrich pollution: ads / similarListings / page chrome.

Finds approved businesses that picked up Apteka03 / trucking / Bazar Club /
HTML chrome / shared junk emails from catalog page scrapes, restores listing
body from the to4ka API when possible, and clears polluted contact fields.

Usage:
  python3 scripts/business-enrich/clean_to4ka_enrich_pollution.py --dry-run
  python3 scripts/business-enrich/clean_to4ka_enrich_pollution.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SupabaseRest, load_env  # noqa: E402
from enrich_to4ka_directory import (  # noqa: E402
    enrich_to4ka_listing,
    is_to4ka_junk_website,
    listing_uuid_from_url,
)

OUT = Path(__file__).resolve().parent / "data" / "to4ka_enrich"
OUT.mkdir(parents=True, exist_ok=True)

DESC_POLLUTION_RE = re.compile(
    r"(?i)"
    r"(?:здесь\s+продвигают\s+бизнес|"
    r"www\.apteka03|apteka03\.online|"
    r"траковая\s+компания\s+в\s+чикаго|"
    r"owner\s+operators\s+for\s+step\s+deck|"
    r"приглашаем\s+(?:работников|монтажников)\s+на\s+работ|"
    r"более\s+десяти\s+лет\s+мы\s+осуществляем\s+доставку\s+нашей\s+продукции|"
    r"aria-haspopup|data-state\s*=|role\s*=\s*[\"']?combobox|"
    r"svg\]:px|благоустройству\s+территорий\s+в\s+германии)"
)

JUNK_CONTACT_RE = re.compile(
    r"(?i)(?:bazar\.club|bazarclub|bazar_club|apteka03|madbid\.com)"
)
JUNK_ADDRESS_RE = re.compile(r"(?i)90\s+state\s+st")
POLLUTED_EMAILS = frozenset({"cmi_detailing@yahoo.com"})

SELECT = (
    "id,slug,name,phone,email,website,instagram_url,telegram_url,"
    "address_line,city,description,short_description,contact_links,"
    "source_url,yelp_url,status"
)


def _blob(row: dict[str, Any]) -> str:
    return json.dumps(row, ensure_ascii=False).lower()


def is_polluted(row: dict[str, Any]) -> dict[str, bool]:
    desc = (row.get("description") or "") + "\n" + (row.get("short_description") or "")
    flags = {
        "desc_ad": bool(DESC_POLLUTION_RE.search(desc)),
        "junk_website": is_to4ka_junk_website(row.get("website")),
        "junk_ig": bool(JUNK_CONTACT_RE.search(row.get("instagram_url") or "")),
        "junk_tg": bool(JUNK_CONTACT_RE.search(row.get("telegram_url") or "")),
        "junk_address": bool(JUNK_ADDRESS_RE.search(row.get("address_line") or "")),
        "junk_email": (row.get("email") or "").strip().lower() in POLLUTED_EMAILS,
        "junk_links": False,
    }
    links = row.get("contact_links") or []
    if isinstance(links, list):
        for link in links:
            val = str((link or {}).get("value") or "")
            if JUNK_CONTACT_RE.search(val):
                flags["junk_links"] = True
                break
    # website empty → not junk_website for cleanup purposes
    if not (row.get("website") or "").strip():
        flags["junk_website"] = False
    return flags


def needs_clean(flags: dict[str, bool]) -> bool:
    return any(flags.values())


def filter_contact_links(links: Any) -> list[dict[str, Any]] | None:
    if not isinstance(links, list):
        return None
    kept: list[dict[str, Any]] = []
    changed = False
    for link in links:
        if not isinstance(link, dict):
            continue
        val = str(link.get("value") or "")
        if JUNK_CONTACT_RE.search(val):
            changed = True
            continue
        kept.append(link)
    return kept if changed else None


def build_patch(
    row: dict[str, Any],
    flags: dict[str, bool],
    *,
    fetch_api: bool,
) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    api: dict[str, Any] | None = None
    src = row.get("source_url") or ""
    need_api = fetch_api and listing_uuid_from_url(src) and (
        flags["junk_address"]
        or (flags["desc_ad"] and DESC_POLLUTION_RE.search(row.get("short_description") or ""))
        or (flags["desc_ad"] and len((row.get("short_description") or "").strip()) < 40)
        or flags["junk_website"]
    )
    if need_api:
        try:
            api = enrich_to4ka_listing(src)
            if api.get("_svoi_error"):
                api = None
        except Exception:  # noqa: BLE001
            api = None

    if flags["desc_ad"]:
        restored = (api or {}).get("description") if api else None
        short = (row.get("short_description") or "").strip()
        short_ok = bool(short) and not DESC_POLLUTION_RE.search(short) and len(short) >= 40
        if restored and not DESC_POLLUTION_RE.search(str(restored)):
            patch["description"] = str(restored)[:4000]
            if short and DESC_POLLUTION_RE.search(short):
                patch["short_description"] = str(restored)[:180]
        elif short_ok:
            patch["description"] = short[:4000]
        else:
            patch["description"] = None

    if flags["junk_website"]:
        api_web = ((api or {}).get("websites") or [None])[0] if api else None
        if api_web and not is_to4ka_junk_website(api_web):
            patch["website"] = str(api_web)[:300]
        else:
            patch["website"] = None

    if flags["junk_ig"]:
        patch["instagram_url"] = None
    if flags["junk_tg"]:
        patch["telegram_url"] = None
    if flags["junk_email"]:
        patch["email"] = None

    if flags["junk_address"]:
        api_addr = (api or {}).get("address_line") if api else None
        if api_addr and not JUNK_ADDRESS_RE.search(str(api_addr)):
            patch["address_line"] = str(api_addr)[:160]
            if (api or {}).get("city"):
                patch["city"] = str(api["city"])[:80]
        else:
            patch["address_line"] = None

    if flags["junk_links"]:
        filtered = filter_contact_links(row.get("contact_links"))
        if filtered is not None:
            patch["contact_links"] = filtered

    return patch


def fetch_candidates(client: SupabaseRest) -> list[dict[str, Any]]:
    """Approved businesses matching known pollution fingerprints."""
    seen: dict[str, dict[str, Any]] = {}
    filters = [
        # Description ads / HTML chrome
        {
            "or": (
                "(description.ilike.*apteka03*,description.ilike.*Здесь продвигают бизнес*,"
                "description.ilike.*Owner Operators*,description.ilike.*aria-haspopup*,"
                "description.ilike.*благоустройству территорий*)"
            )
        },
        {"website": "ilike.*bazar.club*"},
        {"instagram_url": "ilike.*bazarclub*"},
        {"telegram_url": "ilike.*bazar*"},
        {"address_line": "ilike.*90 State St*"},
        {"email": "ilike.*cmi_detailing*"},
        {"website": "ilike.*madbid.com*"},
        {"website": "ilike.*apteka03*"},
    ]
    for filt in filters:
        offset = 0
        while True:
            params = {
                "select": SELECT,
                "status": "eq.approved",
                "order": "id.asc",
                "offset": str(offset),
                "limit": "500",
                **filt,
            }
            batch = client._request("GET", "/businesses", params=params) or []
            for row in batch:
                seen[row["id"]] = row
            if len(batch) < 500:
                break
            offset += 500
        print(f"  filter {filt}: total unique {len(seen)}", flush=True)
    return list(seen.values())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    apply = bool(args.apply)
    if apply:
        args.dry_run = False

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    print("Scanning for polluted cards…", flush=True)
    rows = fetch_candidates(client)
    print(f"Candidates: {len(rows)}", flush=True)

    report: dict[str, Any] = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "apply": apply,
        "scanned": len(rows),
        "would_patch": 0,
        "patched": 0,
        "skipped": 0,
        "errors": [],
        "samples": [],
        "by_flag": {},
    }
    flag_counts: dict[str, int] = {}

    for i, row in enumerate(rows):
        if args.limit and i >= args.limit:
            break
        flags = is_polluted(row)
        if not needs_clean(flags):
            report["skipped"] += 1
            continue
        for k, v in flags.items():
            if v:
                flag_counts[k] = flag_counts.get(k, 0) + 1
        patch = build_patch(row, flags, fetch_api=apply)
        if not patch:
            report["skipped"] += 1
            continue
        report["would_patch"] += 1
        if len(report["samples"]) < 25:
            report["samples"].append(
                {
                    "id": row["id"],
                    "slug": row.get("slug"),
                    "name": row.get("name"),
                    "flags": {k: v for k, v in flags.items() if v},
                    "patch_keys": sorted(patch.keys()),
                    "patch": {
                        k: (v[:120] + "…" if isinstance(v, str) and len(v) > 120 else v)
                        for k, v in patch.items()
                    },
                }
            )
        if apply:
            try:
                client.patch("businesses", {"id": f"eq.{row['id']}"}, patch)
                report["patched"] += 1
            except Exception as exc:  # noqa: BLE001
                report["errors"].append({"id": row["id"], "error": str(exc)[:200]})
            if report["patched"] % 50 == 0:
                print(f"  patched {report['patched']}/{report['would_patch']}", flush=True)
            # Light throttle for API restores already done inside build_patch when needed.
            if report["patched"] % 20 == 0:
                time.sleep(0.15)

    report["by_flag"] = flag_counts
    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"pollution_clean_{'apply' if apply else 'dry'}_{stamp}.json"
    latest = OUT / f"pollution_clean_{'apply' if apply else 'dry'}_latest.json"
    text = json.dumps(report, ensure_ascii=False, indent=2)
    path.write_text(text, encoding="utf-8")
    latest.write_text(text, encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("scanned", "would_patch", "patched", "skipped", "by_flag", "apply")}, ensure_ascii=False, indent=2))
    print(f"wrote {path}")
    return 0 if not report["errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
