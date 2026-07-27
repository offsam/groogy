#!/usr/bin/env python3
"""Find business duplicates by phone, street address, website, Instagram.

Usage:
  python3 scripts/business-enrich/find_business_duplicates.py
  python3 scripts/business-enrich/find_business_duplicates.py --json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "dupe_audit"
OUT.mkdir(parents=True, exist_ok=True)

PHONE_RE = re.compile(r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}")
SKIP_HOSTS = {
    "instagram.com",
    "facebook.com",
    "fb.com",
    "t.me",
    "telegram.me",
    "linktr.ee",
    "maps.apple",
    "maps.app.goo.gl",
    "youtu.be",
    "youtube.com",
    "eventbrite.com",
    "bit.ly",
}


def fetch_businesses(client: SupabaseRest) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/businesses",
                params={
                    "select": (
                        "id,slug,name,phone,address_line,city,postal_code,"
                        "website,instagram_url,status,description,short_description"
                    ),
                    "status": "in.(approved,pending,deferred)",
                    "order": "id.asc",
                    "offset": str(offset),
                    "limit": "1000",
                },
            )
            or []
        )
        out.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return out


def norm_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) >= 10:
        return digits[-10:]
    return None


def phones_from_row(row: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    p = norm_phone(row.get("phone"))
    if p:
        found.add(p)
    blob = f"{row.get('description') or ''}\n{row.get('short_description') or ''}"
    for m in PHONE_RE.findall(blob):
        n = norm_phone(m)
        if n:
            found.add(n)
    return found


def street_key(address: str | None, city: str | None) -> str | None:
    if not address:
        return None
    s = address.lower().strip()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s)
    for pat, repl in [
        (r"\bstreet\b", "st"),
        (r"\bavenue\b", "ave"),
        (r"\bboulevard\b", "blvd"),
        (r"\bdrive\b", "dr"),
        (r"\broad\b", "rd"),
        (r"\blane\b", "ln"),
        (r"\bcourt\b", "ct"),
        (r"\bsouth\b", "s"),
        (r"\bnorth\b", "n"),
        (r"\beast\b", "e"),
        (r"\bwest\b", "w"),
    ]:
        s = re.sub(pat, repl, s)
    s = re.sub(r"\b(ste|suite|unit|apt|apartment)\s*[\w-]+", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    m = re.match(r"^(\d+)\s+(.+)$", s)
    if not m:
        return None
    num, rest = m.group(1), m.group(2)
    toks = rest.split()[:3]
    c = (city or "").lower().strip()
    return f"{num} {' '.join(toks)}|{c}"


def website_host(url: str | None) -> str | None:
    if not url:
        return None
    try:
        host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    except Exception:
        return None
    if not host or any(host == h or host.endswith("." + h) for h in SKIP_HOSTS):
        return None
    # maps.apple shared links
    if host.startswith("maps."):
        return None
    return host


def instagram_handle(url: str | None) -> str | None:
    if not url:
        return None
    m = re.search(r"instagram\.com/([A-Za-z0-9._]+)", url, re.I)
    return m.group(1).lower() if m else None


def uniq_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        out.append(r)
    return out


def brief(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "slug": r["slug"],
        "name": r["name"],
        "status": r["status"],
        "phone": r.get("phone"),
        "address_line": r.get("address_line"),
        "city": r.get("city"),
        "website": r.get("website"),
        "instagram_url": r.get("instagram_url"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)
    rows = fetch_businesses(client)

    by_phone: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_street: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_web: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_ig: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for r in rows:
        for ph in phones_from_row(r):
            by_phone[ph].append(r)
        sk = street_key(r.get("address_line"), r.get("city"))
        if sk:
            by_street[sk].append(r)
        host = website_host(r.get("website"))
        if host:
            by_web[host].append(r)
        ig = instagram_handle(r.get("instagram_url"))
        if ig:
            by_ig[ig].append(r)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scanned": len(rows),
        "phone_groups": [
            {"key": k, "members": [brief(x) for x in uniq_rows(v)]}
            for k, v in sorted(by_phone.items())
            if len(uniq_rows(v)) > 1
        ],
        "street_groups": [
            {"key": k, "members": [brief(x) for x in uniq_rows(v)]}
            for k, v in sorted(by_street.items())
            if len(uniq_rows(v)) > 1
        ],
        "website_groups": [
            {"key": k, "members": [brief(x) for x in uniq_rows(v)]}
            for k, v in sorted(by_web.items())
            if len(uniq_rows(v)) > 1
        ],
        "instagram_groups": [
            {"key": k, "members": [brief(x) for x in uniq_rows(v)]}
            for k, v in sorted(by_ig.items())
            if len(uniq_rows(v)) > 1
        ],
    }

    # High-confidence: same phone AND same street
    high: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for g in report["phone_groups"]:
        members = g["members"]
        for i, a in enumerate(members):
            for b in members[i + 1 :]:
                sa = street_key(a.get("address_line"), a.get("city"))
                sb = street_key(b.get("address_line"), b.get("city"))
                if sa and sb and sa == sb:
                    pair = tuple(sorted([a["id"], b["id"]]))
                    if pair in seen_pairs:
                        continue
                    seen_pairs.add(pair)
                    high.append(
                        {
                            "reason": "same_phone_and_street",
                            "phone": g["key"],
                            "street": sa,
                            "a": a,
                            "b": b,
                        }
                    )
    report["high_confidence"] = high

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"find_duplicates_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "find_duplicates_latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(
            json.dumps(
                {
                    "scanned": report["scanned"],
                    "phone_groups": len(report["phone_groups"]),
                    "street_groups": len(report["street_groups"]),
                    "website_groups": len(report["website_groups"]),
                    "instagram_groups": len(report["instagram_groups"]),
                    "high_confidence": len(high),
                },
                indent=2,
            )
        )
        print("\nHIGH CONFIDENCE (phone + street):")
        for h in high:
            print(
                f"  {h['a']['name']!r} [{h['a']['status']}] ↔ "
                f"{h['b']['name']!r} [{h['b']['status']}]"
            )
            print(f"    phone={h['phone']} street={h['street']}")
            print(f"    keep? {h['a']['slug']}  drop? {h['b']['slug']}")
        print("\nSTREET ONLY (review — may be shared building):")
        for g in report["street_groups"]:
            ids = {m["id"] for m in g["members"]}
            # skip if already in high
            if any(
                {h["a"]["id"], h["b"]["id"]} <= ids
                for h in high
            ):
                continue
            print(f"  {g['key']}")
            for m in g["members"]:
                print(f"    [{m['status']}] {m['name']!r} phone={m['phone']} {m['slug']}")
        print("report", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
