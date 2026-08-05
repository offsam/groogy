#!/usr/bin/env python3
"""Match yellow_pages directory queue rows against published catalog.

Read-only by default. Compares import_comment_recommendations
(directory_source=…) to approved businesses + professionals by phone,
website host, Instagram, street+ZIP, then weak name.

Usage:
  python3 scripts/business-enrich/match_directory_against_published.py --directory-source to4ka
  python3 scripts/business-enrich/match_directory_against_published.py --directory-source to4ka --dry-run
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

SKIP_HOSTS = {
    "instagram.com",
    "facebook.com",
    "fb.com",
    "fb.me",
    "t.me",
    "telegram.me",
    "tiktok.com",
    "yelp.com",
    "youtube.com",
    "youtu.be",
    "twitter.com",
    "x.com",
    "linkedin.com",
    "wa.me",
    "whatsapp.com",
    "vk.com",
    "linktr.ee",
    "taplink.cc",
    "bit.ly",
    "goo.gl",
    "maps.app.goo.gl",
    "maps.apple.com",
    "eventbrite.com",
    "svoi.us",
    "to4ka.us",
    "api.to4ka.us",
    "russianorangepages.com",
    "bostonrussianpages.com",
    "yellowpages.com",
    "health.usnews.com",
    "usnews.com",
    "mygnp.com",
    "zocdoc.com",
    "healthgrades.com",
    "vitals.com",
    "webmd.com",
    "uhhospitals.org",
}

ADDRESS_NOTE_RE = re.compile(r"(?:^|;\s*)address:([^;]+)", re.I)
ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")


def fetch_all(
    client: SupabaseRest, path: str, params: dict[str, str]
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                path,
                params={**params, "limit": "1000", "offset": str(offset)},
            )
            or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def norm_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) >= 10:
        return digits[-10:]
    return None


def website_host(url: str | None) -> str | None:
    if not url:
        return None
    u = str(url).strip()
    if not u:
        return None
    if "://" not in u:
        u = "https://" + u
    try:
        host = (urlparse(u).hostname or "").lower().removeprefix("www.")
    except Exception:
        return None
    if not host:
        return None
    if any(host == h or host.endswith("." + h) for h in SKIP_HOSTS):
        return None
    if host.startswith("maps."):
        return None
    return host


def instagram_handle(raw: str | None) -> str | None:
    if not raw:
        return None
    s = str(raw).strip()
    m = re.search(r"instagram\.com/([A-Za-z0-9._]+)", s, re.I)
    if m:
        return m.group(1).lower()
    if re.fullmatch(r"@?[A-Za-z0-9._]{2,30}", s):
        return s.lstrip("@").lower()
    return None


def street_zip_key(
    address: str | None, city: str | None = None, postal: str | None = None
) -> str | None:
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
    ]:
        s = re.sub(pat, repl, s)
    s = re.sub(r"\b(ste|suite|unit|apt|apartment)\s*[\w-]+", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    m = re.match(r"^(\d+)\s+(.+)$", s)
    if not m:
        return None
    num, rest = m.group(1), m.group(2)
    toks = rest.split()[:3]
    z = re.sub(r"\D", "", postal or "")[:5]
    if len(z) != 5:
        zm = ZIP_RE.search(address)
        z = zm.group(1) if zm else ""
    if z:
        return f"{num} {' '.join(toks)}|{z}"
    c = (city or "").lower().strip()
    if not c:
        return None
    return f"{num} {' '.join(toks)}|{c}"


def norm_name(raw: str | None) -> str:
    s = (raw or "").lower().replace("ё", "е")
    s = re.sub(r"[^a-zа-я0-9]+", "", s, flags=re.I)
    return s[:80]


def address_from_notes(notes: str | None) -> str | None:
    if not notes:
        return None
    m = ADDRESS_NOTE_RE.search(notes)
    return m.group(1).strip() if m else None


def zip_from_text(*parts: str | None) -> str | None:
    for p in parts:
        if not p:
            continue
        m = ZIP_RE.search(p)
        if m:
            return m.group(1)
    return None


def pub_ref(entity_type: str, row: dict[str, Any]) -> dict[str, Any]:
    name = row.get("name") or row.get("display_name")
    return {
        "entity_type": entity_type,
        "id": row["id"],
        "slug": row.get("slug"),
        "name": name,
        "city": row.get("city"),
        "phone": row.get("phone"),
        "website": row.get("website"),
    }


def index_published(
    businesses: list[dict[str, Any]], professionals: list[dict[str, Any]]
) -> dict[str, dict[str, list[dict[str, Any]]]]:
    idx: dict[str, dict[str, list[dict[str, Any]]]] = {
        "phone": defaultdict(list),
        "web": defaultdict(list),
        "ig": defaultdict(list),
        "street": defaultdict(list),
        "name": defaultdict(list),
    }

    def add(entity_type: str, row: dict[str, Any]) -> None:
        ref = pub_ref(entity_type, row)
        ph = norm_phone(row.get("phone"))
        if ph:
            idx["phone"][ph].append(ref)
        host = website_host(row.get("website"))
        if host:
            idx["web"][host].append(ref)
        ig = instagram_handle(row.get("instagram_url"))
        if ig:
            idx["ig"][ig].append(ref)
        sk = street_zip_key(
            row.get("address_line"),
            row.get("city"),
            row.get("postal_code"),
        )
        if sk:
            idx["street"][sk].append(ref)
        nk = norm_name(row.get("name") or row.get("display_name"))
        if len(nk) >= 12:
            idx["name"][nk].append(ref)

    for b in businesses:
        add("business", b)
    for p in professionals:
        add("professional", p)
    return idx


def first_unique(
    hits: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for h in hits:
        key = f"{h['entity_type']}:{h['id']}"
        if key in seen:
            continue
        seen.add(key)
        out.append(h)
    return out


def match_row(
    row: dict[str, Any], idx: dict[str, dict[str, list[dict[str, Any]]]]
) -> dict[str, Any]:
    exact: list[dict[str, Any]] = []
    reasons: list[str] = []

    phones = [norm_phone(p) for p in (row.get("phones") or [])]
    phones = [p for p in phones if p]
    for ph in phones:
        hits = idx["phone"].get(ph) or []
        if hits:
            exact.extend(hits)
            reasons.append(f"phone:{ph}")

    for w in row.get("websites") or []:
        host = website_host(w)
        if not host:
            continue
        hits = idx["web"].get(host) or []
        if hits:
            exact.extend(hits)
            reasons.append(f"website:{host}")

    for ig_raw in row.get("instagram") or []:
        ig = instagram_handle(ig_raw)
        if not ig:
            continue
        hits = idx["ig"].get(ig) or []
        if hits:
            exact.extend(hits)
            reasons.append(f"instagram:{ig}")

    addr = address_from_notes(row.get("notes"))
    z = zip_from_text(addr, row.get("city"), row.get("notes"))
    sk = street_zip_key(addr, row.get("city"), z)
    if sk:
        hits = idx["street"].get(sk) or []
        if hits:
            exact.extend(hits)
            reasons.append(f"address:{sk}")

    exact_u = first_unique(exact)
    weak: list[dict[str, Any]] = []
    weak_reason: str | None = None
    if not exact_u:
        nk = norm_name(row.get("display_name"))
        if len(nk) >= 12:
            hits = idx["name"].get(nk) or []
            weak = first_unique(hits)
            if weak:
                weak_reason = f"name:{nk}"

    already = bool(row.get("duplicate_of_entity_id"))
    return {
        "id": row.get("id"),
        "cluster_key": row.get("cluster_key"),
        "display_name": row.get("display_name"),
        "city": row.get("city"),
        "status": row.get("status"),
        "phones": row.get("phones") or [],
        "websites": row.get("websites") or [],
        "already_linked": already,
        "duplicate_of_entity_id": row.get("duplicate_of_entity_id"),
        "duplicate_of_entity_type": row.get("duplicate_of_entity_type"),
        "exact": exact_u,
        "exact_reasons": sorted(set(reasons)),
        "weak": weak,
        "weak_reason": weak_reason,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--directory-source", default="to4ka")
    ap.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Report only (default). No DB writes.",
    )
    ap.add_argument(
        "--status",
        default="pending,suspected_duplicate",
        help="Comma statuses to include (default pending,suspected_duplicate).",
    )
    args = ap.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    statuses = [s.strip() for s in args.status.split(",") if s.strip()]
    status_filter = f"in.({','.join(statuses)})" if len(statuses) > 1 else f"eq.{statuses[0]}"

    queue = fetch_all(
        client,
        "/import_comment_recommendations",
        {
            "select": (
                "id,cluster_key,display_name,phones,instagram,websites,city,notes,"
                "status,directory_source,target_bucket,duplicate_of_entity_id,"
                "duplicate_of_entity_type,duplicate_reason,source_post_urls"
            ),
            "directory_source": f"eq.{args.directory_source}",
            "status": status_filter,
            "order": "id.asc",
        },
    )

    businesses = fetch_all(
        client,
        "/businesses",
        {
            "select": (
                "id,slug,name,phone,website,instagram_url,address_line,"
                "city,postal_code,status"
            ),
            "status": "eq.approved",
            "order": "id.asc",
        },
    )
    professionals = fetch_all(
        client,
        "/professionals",
        {
            "select": (
                "id,slug,display_name,phone,website,instagram_url,"
                "city,postal_code,status"
            ),
            "status": "eq.approved",
            "order": "id.asc",
        },
    )

    idx = index_published(businesses, professionals)

    exact_hits: list[dict[str, Any]] = []
    weak_hits: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    already_linked = 0

    for row in queue:
        m = match_row(row, idx)
        if m["already_linked"]:
            already_linked += 1
        if m["exact"]:
            exact_hits.append(m)
        elif m["weak"]:
            weak_hits.append(m)
        else:
            unmatched.append(
                {
                    "id": m["id"],
                    "cluster_key": m["cluster_key"],
                    "display_name": m["display_name"],
                    "city": m["city"],
                    "status": m["status"],
                    "phones": m["phones"],
                    "websites": m["websites"],
                }
            )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "dry_run",
        "directory_source": args.directory_source,
        "statuses": statuses,
        "queue_count": len(queue),
        "published_businesses": len(businesses),
        "published_professionals": len(professionals),
        "summary": {
            "exact": len(exact_hits),
            "weak": len(weak_hits),
            "unmatched": len(unmatched),
            "already_linked": already_linked,
        },
        "exact_hits": exact_hits,
        "weak_hits": weak_hits,
        "unmatched_sample": unmatched[:100],
        "unmatched_total": len(unmatched),
    }

    path = OUT / f"{args.directory_source}_vs_published_{stamp}.json"
    latest = OUT / f"{args.directory_source}_vs_published_latest.json"
    text = json.dumps(report, ensure_ascii=False, indent=2)
    path.write_text(text, encoding="utf-8")
    latest.write_text(text, encoding="utf-8")

    print(
        json.dumps(
            {
                "directory_source": args.directory_source,
                "queue": len(queue),
                "published_businesses": len(businesses),
                "published_professionals": len(professionals),
                "exact": len(exact_hits),
                "weak": len(weak_hits),
                "unmatched": len(unmatched),
                "already_linked": already_linked,
                "report": str(path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print("\nEXACT (sample):")
    for h in exact_hits[:25]:
        pub = h["exact"][0]
        print(
            f"  {h['display_name']!r} → {pub['entity_type']}:{pub['slug']} "
            f"({', '.join(h['exact_reasons'][:3])})"
        )
    if len(exact_hits) > 25:
        print(f"  … +{len(exact_hits) - 25} more")
    print("\nWEAK name (sample):")
    for h in weak_hits[:15]:
        pub = h["weak"][0]
        print(
            f"  {h['display_name']!r} → {pub['entity_type']}:{pub['slug']} "
            f"({h['weak_reason']})"
        )
    if len(weak_hits) > 15:
        print(f"  … +{len(weak_hits) - 15} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
