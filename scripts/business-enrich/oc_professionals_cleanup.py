#!/usr/bin/env python3
"""Orange County professionals: kill pro_other, fix domains, archive junk.

Uses existing category slugs (business + professional domains) from
lib/professional/categories.ts / backfill_professional_categories.py.

Usage:
  python3 scripts/business-enrich/oc_professionals_cleanup.py
  python3 scripts/business-enrich/oc_professionals_cleanup.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from backfill_professional_categories import infer_slug  # noqa: E402
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "oc_professionals_cleanup"
OUT.mkdir(parents=True, exist_ok=True)

OC_TOKENS = [
    "orange county",
    "оранж каунти",
    "irvine",
    "anaheim",
    "santa ana",
    "costa mesa",
    "huntington beach",
    "newport beach",
    "tustin",
    "orange",
    "fullerton",
    "garden grove",
    "westminster",
    "mission viejo",
    "laguna hills",
    "laguna niguel",
    "laguna beach",
    "lake forest",
    "fountain valley",
    "buena park",
    "yorba linda",
    "placentia",
    "brea",
    "cypress",
    "los alamitos",
    "seal beach",
    "san clemente",
    "san juan capistrano",
    "dana point",
    "aliso viejo",
    "rancho santa margarita",
    "villa park",
    "stanton",
    "la habra",
    "la palma",
    "corona del mar",
]
LA_TOKENS = [
    "los angeles",
    "лос-анджелес",
    "beverly hills",
    "glendale",
    "burbank",
    "pasadena",
    "santa monica",
    "venice",
    "hollywood",
    "west hollywood",
    "long beach",
    "torrance",
    "sherman oaks",
    "encino",
    "van nuys",
    "north hollywood",
]
OTHER_HUB = [
    "san diego",
    "sacramento",
    "san francisco",
    "oakland",
    "berkeley",
    "san jose",
]
WORD = re.compile(r"[\w]", re.UNICODE)

REC_RE = re.compile(
    r"(?i)(рекомендую|рекомендаци|советую|посоветовали|от\s+души\s+советую|"
    r"могу\s+посоветовать|кто\s+знает|подскажите|"
    r"ищу\s+(мастера|няню|репетитора)|нужен\s+мастер|looking\s+for)"
)
SELF_RE = re.compile(
    r"(?i)(я\s+(мастер|делаю|предлагаю|работаю)|записывайтесь|мои\s+услуги|"
    r"прайс|price\s*list|booking|запишитесь|принимаю\s+запис)"
)
THIRD_RE = re.compile(
    r"(?i)(она\s+делает|он\s+делает|у\s+неё|у\s+нее|у\s+него|"
    r"её\s+номер|ее\s+номер|его\s+номер|вот\s+контакт|пишу\s+про)"
)
EVENT_RE = re.compile(
    r"(?i)(мероприятие|концерт|фестиваль|мастер[- ]?класс|\bevent\b|ивент|"
    r"пикник|speed\s*dating)"
)
RENT_RE = re.compile(
    r"(?i)(сда[её]тся|сдаётся|сдается|аренда\s+(квартир|студ|комнат|кресл|кабинет)|"
    r"for\s+rent|сдаются\s+кабинет)"
)
CAR_SALE_RE = re.compile(
    r"(?i)(прода[юм]\s+(авто|машин)|for\s+sale.{0,20}(car|auto))"
)

# Extra weak signals for leftovers that infer_slug leaves as pro_other
WEAK_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("celebrations", re.compile(r"(?i)(bouquet|цветы|букет|шар|balloon|florist|праздник|тамада|ведущ)")),
    ("education", re.compile(r"(?i)(саксофон|кларнет|гитар|уроки|школ|урок|sax|music|англ|english)")),
    ("beauty", re.compile(r"(?i)(lash|brow|nail|маник|бров|ресниц|beauty|spa|волос)")),
    ("health", re.compile(r"(?i)(мед|doctor|doc\b|orthodont|braces|clinic)")),
    ("finance", re.compile(r"(?i)(credit|llc|tax|financ|страхов|insurance|ипотек)")),
    ("legal", re.compile(r"(?i)(legal|visa|документ|иммиграц|грин.?карт)")),
    ("photo_video", re.compile(r"(?i)(instagram\.com|@\w+|smm|таргет|реклам)")),
    ("creative", re.compile(r"(?i)(studio|дизайн|handmade|декор)")),
    ("home_services", re.compile(r"(?i)(услуг|service|help|помощ)")),
]


def empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def contains_token(hay: str, token: str) -> bool:
    hay_l = hay.lower()
    token_l = token.lower()
    start = 0
    while True:
        at = hay_l.find(token_l, start)
        if at < 0:
            return False
        before = hay_l[at - 1] if at > 0 else ""
        after = hay_l[at + len(token_l)] if at + len(token_l) < len(hay_l) else ""
        if (not before or not WORD.match(before)) and (
            not after or not WORD.match(after)
        ):
            return True
        start = at + 1


def is_oc(row: dict[str, Any]) -> bool:
    county = (row.get("county_geoid") or "").strip()
    if county == "06059":
        return True
    if county and county != "06059":
        return False
    lat, lng = row.get("latitude"), row.get("longitude")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        if 33.38 <= float(lat) <= 33.95 and -118.14 <= float(lng) <= -117.4:
            return True
    city = (row.get("city") or "").strip()
    all_tokens = OC_TOKENS + LA_TOKENS + OTHER_HUB
    if city:
        hits = [t for t in all_tokens if contains_token(city, t)]
        if hits:
            return any(contains_token(city, t) for t in OC_TOKENS)
    loc = f"{city} {row.get('region') or ''} {row.get('service_area_text') or ''}"
    return any(contains_token(loc, t) for t in OC_TOKENS)


def blob(row: dict[str, Any], services: str = "") -> str:
    return "\n".join(
        filter(
            None,
            [
                row.get("display_name") or "",
                row.get("headline") or "",
                row.get("short_description") or "",
                row.get("description") or "",
                row.get("card_summary") or "",
                services,
            ],
        )
    )


def has_contact(row: dict[str, Any]) -> bool:
    return any(
        not empty(row.get(k))
        for k in ("phone", "instagram_url", "website", "email", "telegram_url")
    )


def junk_reason(row: dict[str, Any], text: str) -> str | None:
    if RENT_RE.search(text):
        return "junk_rent"
    if CAR_SALE_RE.search(text):
        return "junk_car_sale"
    if EVENT_RE.search(text) and not SELF_RE.search(text) and not has_contact(row):
        return "junk_event"
    if REC_RE.search(text) and not SELF_RE.search(text):
        return "junk_recommendation"
    if THIRD_RE.search(text) and not SELF_RE.search(text) and not has_contact(row):
        return "junk_third_party"
    # Empty shell: no contact, almost no copy
    if not has_contact(row) and len(text.strip()) < 30:
        return "junk_empty"
    return None


def resolve_category(row: dict[str, Any], services: str, by_slug: dict[str, dict]) -> str:
    text = blob(row, services)
    slug = infer_slug(text)
    if slug != "pro_other" and slug in by_slug:
        return slug
    for weak_slug, pat in WEAK_RULES:
        if pat.search(text) and weak_slug in by_slug:
            return weak_slug
    # Last resort — never leave pro_other when there is any substance
    if has_contact(row) or len(text.strip()) >= 40:
        # Generic service-ish → home_services; else creative (makers / IG handles)
        if re.search(r"(?i)(услуг|service|help|звон|тел|phone|call)", text):
            return "home_services" if "home_services" in by_slug else "creative"
        if re.search(r"(?i)instagram\.com|@", text) or re.fullmatch(
            r"[A-Za-z0-9._]{3,30}", (row.get("display_name") or "").strip()
        ):
            return "creative" if "creative" in by_slug else "home_services"
        return "home_services" if "home_services" in by_slug else "creative"
    return "pro_other"


def load_professionals(client: SupabaseRest) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        rows = (
            client._request(
                "GET",
                "/professionals",
                params={
                    "select": (
                        "id,slug,display_name,status,city,region,state_code,county_geoid,"
                        "latitude,longitude,phone,email,website,instagram_url,telegram_url,"
                        "headline,short_description,description,card_summary,image_url,"
                        "service_area_text,category_id,import_batch_id,source_type"
                    ),
                    "status": "eq.approved",
                    "order": "id.asc",
                    "limit": "500",
                    "offset": str(offset),
                },
            )
            or []
        )
        if not rows:
            break
        out.extend(rows)
        if len(rows) < 500:
            break
        offset += len(rows)
    return out


def load_service_blobs(client: SupabaseRest) -> dict[str, str]:
    out: dict[str, str] = {}
    offset = 0
    while True:
        rows = (
            client._request(
                "GET",
                "/professional_services",
                params={
                    "select": "professional_id,title,description",
                    "is_active": "eq.true",
                    "limit": "1000",
                    "offset": str(offset),
                },
            )
            or []
        )
        if not rows:
            break
        for row in rows:
            pid = row["professional_id"]
            part = f"{row.get('title') or ''} {row.get('description') or ''}"
            out[pid] = (out.get(pid) or "") + " " + part
        if len(rows) < 1000:
            break
        offset += len(rows)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    apply = bool(args.apply)

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    cats = (
        client._request(
            "GET",
            "/categories",
            params={
                "select": "id,slug,name,domain",
                "is_active": "eq.true",
                "limit": "300",
            },
        )
        or []
    )
    by_slug = {c["slug"]: c for c in cats if isinstance(c, dict)}
    by_id = {c["id"]: c for c in cats if isinstance(c, dict)}

    all_pros = load_professionals(client)
    oc = [r for r in all_pros if is_oc(r)]
    services = load_service_blobs(client)

    results: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()

    for row in oc:
        cur = by_id.get(row.get("category_id") or "") or {}
        cur_slug = cur.get("slug") or "pro_other"
        text = blob(row, services.get(row["id"], ""))
        junk = junk_reason(row, text)
        item: dict[str, Any] = {
            "id": row["id"],
            "slug": row.get("slug"),
            "name": row.get("display_name"),
            "from": cur_slug,
        }

        if junk:
            item["action"] = "archive"
            item["reason"] = junk
            counts[junk] += 1
            if apply:
                try:
                    client.patch(
                        "professionals",
                        {"id": f"eq.{row['id']}"},
                        {
                            "status": "archived",
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        },
                    )
                    item["status"] = "archived"
                    counts["archived"] += 1
                except Exception as exc:  # noqa: BLE001
                    item["status"] = "error"
                    item["error"] = str(exc)[:300]
                    counts["errors"] += 1
            else:
                item["status"] = "dry_run"
            results.append(item)
            continue

        target = resolve_category(row, services.get(row["id"], ""), by_slug)
        item["to"] = target
        if target == cur_slug:
            item["action"] = "keep"
            item["status"] = "unchanged"
            counts["unchanged"] += 1
            results.append(item)
            continue

        item["action"] = "remap"
        counts[f"remap→{target}"] += 1
        cat = by_slug.get(target)
        if not cat:
            item["status"] = "missing_category"
            counts["missing_category"] += 1
            results.append(item)
            continue

        if apply:
            try:
                client.patch(
                    "professionals",
                    {"id": f"eq.{row['id']}"},
                    {
                        "category_id": cat["id"],
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                item["status"] = "remapped"
                counts["remapped"] += 1
            except Exception as exc:  # noqa: BLE001
                item["status"] = "error"
                item["error"] = str(exc)[:300]
                counts["errors"] += 1
        else:
            item["status"] = "dry_run"
        results.append(item)

    # Post-check preview of remaining pro_other among non-archived plans
    still_other = [
        r
        for r in results
        if r.get("action") != "archive"
        and (r.get("to") or r.get("from")) == "pro_other"
    ]
    # After remap, "to" is set; keep means from==to
    still_other = [
        r
        for r in results
        if r.get("action") != "archive"
        and (
            (r.get("action") == "keep" and r.get("from") == "pro_other")
            or r.get("to") == "pro_other"
        )
    ]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if apply else "dry_run"
    report = {
        "mode": mode,
        "oc_total": len(oc),
        "counts": dict(counts),
        "still_pro_other_planned": len(still_other),
        "still_pro_other_samples": still_other[:20],
        "results": results,
    }
    path = OUT / f"{mode}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"{mode}_latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "mode": mode,
                "oc_total": len(oc),
                "counts": dict(counts),
                "still_pro_other_planned": len(still_other),
                "report": str(path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
