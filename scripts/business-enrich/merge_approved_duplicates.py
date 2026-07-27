#!/usr/bin/env python3
"""Merge confirmed approved business duplicates + backfill city/ZIP.

Usage:
  python3 scripts/business-enrich/merge_approved_duplicates.py --dry-run
  python3 scripts/business-enrich/merge_approved_duplicates.py --apply
  python3 scripts/business-enrich/merge_approved_duplicates.py --backfill-city-zip --apply
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

OUT = Path(__file__).resolve().parent / "data" / "dupe_audit"
OUT.mkdir(parents=True, exist_ok=True)

# Confirmed same-entity pairs: keep_slug → drop_slug
CONFIRMED_MERGES: list[tuple[str, str, str]] = [
    (
        "lana-cher-181512-6cf0",  # Home Kids Academy
        "lana-cher-205647-957a",  # Lana Cher (same academy / address)
        "same Home Kids Academy @ 56 Essex Ln Irvine",
    ),
    (
        "consolidated-stephen-law-pc",
        "fb-post-31-eugene-stephen-immigration-attorney",
        "same Stephen Law PC phone+address+website",
    ),
    (
        "consolidated-tenina-law-inc",
        "fb-post-28-tenina-law-inc",
        "exact Tenina Law duplicate",
    ),
    (
        "kai-t-234038",  # has phone + address
        "kai-t-205627-dea6",
        "duplicate Kai - T cards",
    ),
    (
        "ida-seidova-150707",  # Skinovation Clinic
        "dr-modarres-150637",  # same Newport Center suite / clinic
        "Skinovation Clinic @ 200 Newport Center — drop doctor alias card",
    ),
    (
        "wonderland-beauty-salon",  # has phone; other card has wrong YurMar text
        "wonderland-salon-205355-7c07",
        "Wonderland beauty salon duplicate (force keep phone card)",
    ),
    (
        "beauty-studio-by-veronika",
        "united-states-beauty-studio-180905",
        "same Veronika studio @ 230 E 17th St Ste 150 Costa Mesa",
    ),
    (
        "oksana-150709",  # STAIR Academy
        "stairedu-sergey-150606",
        "same STAIR / StairEdu brand @ Mission Viejo",
    ),
    (
        "oktel-205740-27a3",
        "oktel-181534-5dfb",
        "identical oktel rental spam cards",
    ),
    # 2026-07-27 re-audit: same phone + address
    (
        "fbpack-art-backyard-design-camp",
        "fbpack-katia-bulgakova-art-backyard",
        "Art Backyard same phone+address+website (pending duplicate)",
    ),
    (
        "batch2-good-food",
        "good-food-190808",
        "Good Food International Market same phone+address+website (pending дубль)",
    ),
    (
        "fbpack-vasiliki-cafe-bakery-laguna-niguel",
        "jane-oc-190806",
        "Vasilki Café Bakery same phone+address (pending дубль Jane OC)",
    ),
    (
        "tатьяна-032105",  # Ultima Studio @ 1175 Baker Ste E19
        "enriched-ivan-stypnik",
        "same barber suite 1175 Baker St Ste E19 Costa Mesa (Ultima vs Ivan)",
    ),
    # 2026-07-27 deep re-audit
    (
        "private-studio-181516-6fe2",  # Уютная private studio @ 13662 Newport Ave Tustin
        "business-biz-181517-806a",  # Татьяна — same nail studio / address / services
        "same Tustin nail studio 13662 Newport Ave (Уютная ↔ Татьяна)",
    ),
    (
        "chef-ramaz-kitchen",  # renamed from hashtag card @ 5800 Madison
        "moonhalal",
        "same kitchen 5800 Madison Ave Sacramento (Chef Ramaz Kitchen / MoonHalal)",
    ),
    (
        "bearchildrensacademyorg-031831",  # B.E.A.R. Children's Academy
        "mama-bear-kids-club",
        "same suite 23221 S Pointe Dr #103 Laguna Hills (Mama Bear ↔ BEAR Academy)",
    ),
]

# Do not richness-swap these keeps (drop may look "richer" but is wrong/junk).
FORCE_KEEP_SLUGS = {
    "wonderland-beauty-salon",
    "ida-seidova-150707",
    "beauty-studio-by-veronika",
    "oksana-150709",
    "fbpack-art-backyard-design-camp",
    "batch2-good-food",
    "fbpack-vasiliki-cafe-bakery-laguna-niguel",
    "tатьяна-032105",
    "private-studio-181516-6fe2",
    "chef-ramaz-kitchen",
    "bearchildrensacademyorg-031831",
}

FILL_FIELDS = [
    "phone",
    "email",
    "website",
    "instagram_url",
    "telegram_url",
    "yelp_url",
    "google_maps_url",
    "city",
    "region",
    "state_code",
    "postal_code",
    "address_line",
    "image_url",
    "category_id",
    "short_description",
    "description",
    "opening_hours",
    "source_url",
    "source_kind",
]

ZIP_RE = re.compile(
    r"\b(?:CA|California)\s+(\d{5})(?:-\d{4})?\b"
    r"|,\s*([A-Za-z .'-]+)\s*,\s*(?:CA|California)\s+(\d{5})\b"
    r"|,\s*([A-Za-z .'-]+)\s+(\d{5})\b",
    re.I,
)
CITY_STATE_ZIP = re.compile(
    r",\s*([A-Za-zА-Яа-яЁё .'-]+)\s*,\s*(CA|California)\s*(\d{5})(?:-\d{4})?\s*$",
    re.I,
)
CITY_ONLY_TAIL = re.compile(
    r",\s*([A-Za-zА-Яа-яЁё .'-]{2,40})\s*$",
    re.I,
)


def empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not str(v).strip())


def extract_city_zip(address_line: str | None, city: str | None, postal: str | None) -> tuple[str | None, str | None]:
    city_out = (city or "").strip() or None
    zip_out = (postal or "").strip() or None
    if zip_out:
        zip_out = re.sub(r"\D", "", zip_out)[:5] or None
    line = (address_line or "").strip()
    if not line:
        return city_out, zip_out

    m = CITY_STATE_ZIP.search(line)
    if m:
        if not city_out:
            city_out = m.group(1).strip()
        if not zip_out:
            zip_out = m.group(3)
        return city_out, zip_out

    # "Street, City 92620" or "… CA 92620"
    m2 = re.search(r"\bCA\s+(\d{5})\b", line, re.I)
    if m2 and not zip_out:
        zip_out = m2.group(1)
    m3 = re.search(r",\s*([A-Za-z .'-]+)\s+(\d{5})\s*$", line)
    if m3:
        if not city_out:
            city_out = m3.group(1).strip()
        if not zip_out:
            zip_out = m3.group(2)
        return city_out, zip_out

    # "56 Essex Ln, Irvine" → city
    if not city_out:
        m4 = CITY_ONLY_TAIL.search(line)
        if m4:
            cand = m4.group(1).strip()
            if cand.lower() not in {"ca", "california", "usa", "us"} and not re.search(
                r"\d", cand
            ):
                # don't treat suite fragments as city
                if not re.search(
                    r"(?i)\b(ste|suite|unit|apt|floor|#)\b", cand
                ):
                    city_out = cand
    return city_out, zip_out


def richness(row: dict[str, Any]) -> int:
    score = 0
    for f in FILL_FIELDS:
        if not empty(row.get(f)):
            score += 1
    if row.get("google_rating") is not None:
        score += 2
    if row.get("latitude") is not None:
        score += 1
    img = row.get("image_url") or ""
    if img and "placeholder" not in img:
        score += 2
    return score


def get_by_slug(client: SupabaseRest, slug: str) -> dict[str, Any] | None:
    rows = (
        client._request(
            "GET",
            "/businesses",
            params={"select": "*", "slug": f"eq.{slug}", "limit": "1"},
        )
        or []
    )
    return rows[0] if rows else None


def merge_pair(
    client: SupabaseRest,
    keep: dict[str, Any],
    drop: dict[str, Any],
    *,
    apply: bool,
    note: str,
) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    for f in FILL_FIELDS:
        if empty(keep.get(f)) and not empty(drop.get(f)):
            patch[f] = drop[f]
    if keep.get("latitude") is None and drop.get("latitude") is not None:
        patch["latitude"] = drop["latitude"]
        patch["longitude"] = drop.get("longitude")
        if empty(keep.get("location_precision")):
            patch["location_precision"] = drop.get("location_precision")
    if keep.get("google_rating") is None and drop.get("google_rating") is not None:
        patch["google_rating"] = drop["google_rating"]
        patch["google_reviews_count"] = drop.get("google_reviews_count") or 0
    if keep.get("yelp_rating") is None and drop.get("yelp_rating") is not None:
        patch["yelp_rating"] = drop["yelp_rating"]
        patch["yelp_reviews_count"] = drop.get("yelp_reviews_count") or 0

    # Only fill empty text — never overwrite keep copy with a longer drop
    # (drop cards are often wrong Telegram/FB posts glued onto a name).
    ks = keep.get("short_description") or ""
    ds = drop.get("short_description") or ""
    if empty(ks) and ds:
        patch["short_description"] = ds

    # City/ZIP from either address
    city, zipc = extract_city_zip(
        patch.get("address_line") or keep.get("address_line") or drop.get("address_line"),
        patch.get("city") or keep.get("city") or drop.get("city"),
        patch.get("postal_code") or keep.get("postal_code") or drop.get("postal_code"),
    )
    # Also scan short/desc for CA ZIP (Home Kids text)
    blob = " ".join(
        filter(
            None,
            [
                keep.get("short_description"),
                drop.get("short_description"),
                keep.get("description"),
                drop.get("description"),
            ],
        )
    )
    if not zipc:
        zm = re.search(r"\bCA\s+(\d{5})\b", blob, re.I)
        if zm:
            zipc = zm.group(1)
    if city and empty(keep.get("city")) and "city" not in patch:
        patch["city"] = city
    elif city and empty(patch.get("city")) and empty(keep.get("city")):
        patch["city"] = city
    if city and empty(keep.get("city")):
        patch["city"] = city
    if zipc and empty(keep.get("postal_code")):
        patch["postal_code"] = zipc

    report = {
        "keep_id": keep["id"],
        "keep_slug": keep["slug"],
        "keep_name": keep["name"],
        "drop_id": drop["id"],
        "drop_slug": drop["slug"],
        "drop_name": drop["name"],
        "note": note,
        "patch": patch,
        "keep_richness": richness(keep),
        "drop_richness": richness(drop),
    }

    if not apply:
        report["status"] = "dry_run"
        return report

    try:
        if patch:
            client.patch("businesses", {"id": f"eq.{keep['id']}"}, patch)

        # Re-parent offers (rename slug on conflict)
        drop_offers = (
            client._request(
                "GET",
                "/business_offers",
                params={
                    "select": "id,slug",
                    "business_id": f"eq.{drop['id']}",
                    "limit": "500",
                },
            )
            or []
        )
        keep_offers = (
            client._request(
                "GET",
                "/business_offers",
                params={
                    "select": "slug",
                    "business_id": f"eq.{keep['id']}",
                    "limit": "500",
                },
            )
            or []
        )
        keep_slugs = {o["slug"] for o in keep_offers}
        offers_moved = 0
        for o in drop_offers:
            slug = o["slug"]
            if slug in keep_slugs:
                slug = f"{slug}-merged-{drop['id'][:8]}"
                client.patch(
                    "business_offers",
                    {"id": f"eq.{o['id']}"},
                    {"slug": slug, "business_id": keep["id"]},
                )
            else:
                client.patch(
                    "business_offers",
                    {"id": f"eq.{o['id']}"},
                    {"business_id": keep["id"]},
                )
            offers_moved += 1

        # Reviews — best effort
        try:
            client.patch(
                "reviews",
                {"business_id": f"eq.{drop['id']}"},
                {"business_id": keep["id"]},
            )
        except Exception:
            pass

        # Locations
        try:
            client.patch(
                "business_locations",
                {"business_id": f"eq.{drop['id']}"},
                {"business_id": keep["id"]},
            )
        except Exception:
            pass

        client.patch(
            "businesses",
            {"id": f"eq.{drop['id']}"},
            {"status": "archived"},
        )
        report["status"] = "merged"
        report["offers_moved"] = offers_moved
    except Exception as exc:  # noqa: BLE001
        report["status"] = "error"
        report["error"] = str(exc)[:400]
    return report


def backfill_city_zip(client: SupabaseRest, *, apply: bool) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        chunk = (
            client._request(
                "GET",
                "/businesses",
                params={
                    "select": "id,slug,name,address_line,city,postal_code,short_description,description",
                    "status": "eq.approved",
                    "order": "id.asc",
                    "limit": "200",
                    "offset": str(offset),
                },
            )
            or []
        )
        rows.extend(chunk)
        if len(chunk) < 200:
            break
        offset += len(chunk)

    updates = []
    for r in rows:
        city, zipc = extract_city_zip(
            r.get("address_line"), r.get("city"), r.get("postal_code")
        )
        blob = " ".join(
            filter(None, [r.get("short_description"), r.get("description"), r.get("address_line")])
        )
        if not zipc:
            zm = re.search(r"\bCA\s+(\d{5})\b", blob or "", re.I)
            if zm:
                zipc = zm.group(1)
        patch: dict[str, Any] = {}
        if city and empty(r.get("city")):
            patch["city"] = city
        if zipc and empty(r.get("postal_code")):
            patch["postal_code"] = zipc
        if not patch:
            continue
        updates.append({"id": r["id"], "slug": r["slug"], "name": r["name"], "patch": patch})
        if apply:
            client.patch("businesses", {"id": f"eq.{r['id']}"}, patch)

    return {
        "scanned": len(rows),
        "updated": len(updates),
        "items": updates,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backfill-city-zip", action="store_true")
    parser.add_argument("--merge", action="store_true", help="Run confirmed merges")
    args = parser.parse_args()
    apply = bool(args.apply)
    # default: do both if neither flag
    do_merge = args.merge or not args.backfill_city_zip
    do_backfill = args.backfill_city_zip or not args.merge
    if args.merge and not args.backfill_city_zip:
        do_backfill = False
    if args.backfill_city_zip and not args.merge:
        do_merge = False
    # If user passes only --apply, do both
    if args.apply and not args.merge and not args.backfill_city_zip:
        do_merge = True
        do_backfill = True

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    summary: dict[str, Any] = {
        "mode": "apply" if apply else "dry_run",
        "merges": [],
        "backfill": None,
    }

    if do_merge:
        for keep_slug, drop_slug, note in CONFIRMED_MERGES:
            keep = get_by_slug(client, keep_slug)
            drop = get_by_slug(client, drop_slug)
            if not keep or not drop:
                summary["merges"].append(
                    {
                        "status": "missing",
                        "keep_slug": keep_slug,
                        "drop_slug": drop_slug,
                        "keep_found": bool(keep),
                        "drop_found": bool(drop),
                        "note": note,
                    }
                )
                print(f"MISSING {keep_slug} / {drop_slug}")
                continue
            if keep.get("status") != "approved":
                print(f"SKIP keep not approved {keep_slug} status={keep.get('status')}")
            if drop.get("status") == "archived":
                summary["merges"].append(
                    {
                        "status": "already_archived",
                        "keep_slug": keep_slug,
                        "drop_slug": drop_slug,
                    }
                )
                print(f"ALREADY archived drop {drop_slug}")
                continue
            # Prefer richer as keep if mis-ordered (unless force-keep)
            if (
                keep_slug not in FORCE_KEEP_SLUGS
                and richness(drop) > richness(keep) + 2
                and "Home Kids" not in (keep.get("name") or "")
            ):
                keep, drop = drop, keep
                print(f"SWAP keep/drop by richness → keep {keep['slug']}")
            # Always keep Home Kids Academy name over Lana Cher
            if "lana cher" in (keep.get("name") or "").lower() and "home kids" in (
                drop.get("name") or ""
            ).lower():
                keep, drop = drop, keep
            report = merge_pair(client, keep, drop, apply=apply, note=note)
            summary["merges"].append(report)
            print(
                f"{report['status']}: keep={report['keep_name']!r} ← drop={report['drop_name']!r} "
                f"patch_keys={list(report.get('patch', {}).keys())}"
            )

    if do_backfill:
        bf = backfill_city_zip(client, apply=apply)
        summary["backfill"] = {
            "scanned": bf["scanned"],
            "updated": bf["updated"],
            "items": bf["items"],
        }
        print(f"backfill city/zip: scanned={bf['scanned']} updated={bf['updated']}")
        for it in bf["items"][:25]:
            print(f"  {it['slug']}: {it['patch']}")
        if bf["updated"] > 25:
            print(f"  … +{bf['updated']-25} more")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if apply else "dry_run"
    path = OUT / f"merge_backfill_{mode}_{stamp}.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"merge_backfill_{mode}_latest.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
