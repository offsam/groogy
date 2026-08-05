#!/usr/bin/env python3
"""Enrich published churches from their own website (fill-empty).

Same scrape stack as businesses, without offers / Yelp ratings / categories.
Fills contacts, image, description, address/geo, opening_hours, schedule_text,
and ministries (non-priced programs).

Usage:
  python3 scripts/business-enrich/enrich_published_churches.py --dry-run --limit 3
  python3 scripts/business-enrich/enrich_published_churches.py --apply --slug rop-forward-church
  python3 scripts/business-enrich/enrich_published_churches.py --apply --id <uuid> --ndjson
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from common import SupabaseRest, load_env  # noqa: E402
from address_geo import resolve_address_geo, scrub_directory_glue  # noqa: E402
from completeness_score import (  # noqa: E402
    is_weak_description,
    pick_richest_description,
)
from enrich_published_businesses import (  # noqa: E402
    city_is_bogus,
    host_of,
    http_get,
    is_junk_email,
    is_junk_website,
    looks_like_street,
    normalize_website,
    parse_address_parts,
    parse_hours_spec_blob,
    parse_hours_to_weekly,
    scraped_address,
)
from shared_hosts import is_shared_non_identity_host  # noqa: E402
from web_enrichment import (  # noqa: E402
    extract_instagram_profile,
    extract_website_profile,
    extract_website_profile_deep,
)

MINISTRY_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"kids?|children|детск|малыш|toddler", re.I), "Детская программа"),
    (
        re.compile(r"watch\s*online|live[\s\-]?stream|онлайн[\s\-]?трансляц|livestream", re.I),
        "Онлайн-трансляция",
    ),
    (re.compile(r"podcast|проповед|sermon", re.I), "Подкасты / проповеди"),
    (
        re.compile(r"giv(e|ing)|tithe|donat|пожертвован|десятин|offering", re.I),
        "Пожертвования",
    ),
    (re.compile(r"youth|молодёж|молодеж|teen", re.I), "Молодёжное служение"),
    (
        re.compile(r"small\s*group|домашн\w*\s*групп|life\s*group", re.I),
        "Малые группы",
    ),
    (re.compile(r"discover|ученичеств|discipleship", re.I), "Ученичество"),
]

SCHEDULE_RE = re.compile(
    r"(?:"
    r"(?:every\s+)?sunday[^\n.]{0,100}?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?"
    r"|"
    r"кажд\w*\s+воскресен\w*[^\n.]{0,100}?\d{1,2}(?::\d{2})?"
    r"|"
    r"воскресен\w*[^\n.]{0,80}?\d{1,2}(?::\d{2})?\s*(?:am|pm|утра|дня)?"
    r")",
    re.I,
)

SERVICE_PATHS = (
    "",
    "/about",
    "/about-us",
    "/visit",
    "/new",
    "/new-here",
    "/times",
    "/service-times",
    "/schedule",
    "/ministries",
    "/ministry",
    "/connect",
    "/give",
    "/contact",
)


def empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not str(v).strip()) or v == [] or v == {}


def strip_tags(html: str) -> str:
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def extract_schedule_text(blob: str) -> str | None:
    if not blob:
        return None
    m = SCHEDULE_RE.search(blob)
    if not m:
        return None
    snip = re.sub(r"\s+", " ", m.group(0)).strip(" . mon,")
    if len(snip) < 8 or len(snip) > 160:
        return None
    return snip


def extract_ministries(html: str, base_url: str) -> list[dict[str, Any]]:
    if not html:
        return []
    found: dict[str, dict[str, Any]] = {}
    # Anchor texts / hrefs
    for m in re.finditer(
        r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
        html,
        re.I | re.S,
    ):
        href = m.group(1).strip()
        label = strip_tags(m.group(2))
        hay = f"{label} {href}"
        for pat, title in MINISTRY_RULES:
            if not pat.search(hay):
                continue
            if title in found:
                continue
            url = None
            if href.startswith("http") or href.startswith("/"):
                try:
                    url = urljoin(base_url, href)
                    if urlparse(url).scheme not in ("http", "https"):
                        url = None
                except Exception:
                    url = None
            found[title] = {"title": title, "detail": label[:160] if label else None, "url": url}
    # Headings / body fallback
    text = strip_tags(html)
    for pat, title in MINISTRY_RULES:
        if title in found:
            continue
        if pat.search(text):
            found[title] = {"title": title, "detail": None, "url": None}
    return list(found.values())[:12]


def merge_ministries(
    existing: list[dict[str, Any]], incoming: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    by_title: dict[str, dict[str, Any]] = {}
    for item in existing + incoming:
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        key = title.lower()
        prev = by_title.get(key)
        if not prev:
            by_title[key] = {
                "title": title[:160],
                "detail": (str(item.get("detail") or "").strip() or None),
                "url": (str(item.get("url") or "").strip() or None),
            }
            continue
        if empty(prev.get("detail")) and item.get("detail"):
            prev["detail"] = str(item["detail"]).strip()[:160]
        if empty(prev.get("url")) and item.get("url"):
            prev["url"] = str(item["url"]).strip()
    return list(by_title.values())[:12]


def fill_empty_patch(
    row: dict[str, Any], field: str, value: Any, patch: dict[str, Any], sources: dict[str, str]
) -> None:
    if empty(value):
        return
    if not empty(row.get(field)) or field in patch:
        return
    patch[field] = value
    sources[field] = sources.get(field) or "website"


def enrich_one(row: dict[str, Any], *, on_event: Any = None) -> dict[str, Any]:
    report: dict[str, Any] = {
        "id": row["id"],
        "name": row.get("name"),
        "slug": row.get("slug"),
        "website": row.get("website"),
        "patch": {},
        "sources": {},
        "notes": [],
        "skipped": None,
        "bfs_steps": [],
    }
    patch: dict[str, Any] = report["patch"]
    sources: dict[str, str] = report["sources"]

    website = normalize_website(row.get("website"))
    if website and is_shared_non_identity_host(website):
        report["notes"].append(f"website_is_platform host={host_of(website)}")
        website = None
    if website and is_junk_website(website):
        report["notes"].append("junk_website")
        website = None
    if not website:
        report["skipped"] = "no_website"
        report["notes"].append("Нет своего сайта на карточке")
        return report

    if on_event:
        try:
            on_event(
                {
                    "type": "resource",
                    "url": website,
                    "kind": "website",
                    "status": "running",
                    "detail": "сайт церкви",
                }
            )
        except Exception:
            pass

    profile = extract_website_profile(website) or {}
    try:
        deep = extract_website_profile_deep(website, max_pages=6) or {}
        for k, v in deep.items():
            if empty(profile.get(k)) and not empty(v):
                profile[k] = v
    except Exception as exc:  # noqa: BLE001
        report["notes"].append(f"deep_failed:{exc}"[:120])

    html_blob = ""
    ministries: list[dict[str, Any]] = []
    for path in SERVICE_PATHS:
        url = website.rstrip("/") + path if path else website
        html = http_get(url)
        if not html:
            continue
        html_blob += "\n" + strip_tags(html)
        ministries = merge_ministries(ministries, extract_ministries(html, website))
        time.sleep(0.12)
        if len(ministries) >= 8 and len(html_blob) > 4000:
            break

    report["bfs_steps"].append(
        {
            "url": website,
            "kind": "website",
            "status": "ok",
            "outcome": "ok" if profile or html_blob else "empty",
            "fields": [k for k, v in profile.items() if not empty(v)][:20],
        }
    )
    if on_event:
        try:
            on_event(
                {
                    "type": "resource",
                    "url": website,
                    "kind": "website",
                    "status": "done",
                    "outcome": "ok" if profile or html_blob else "empty",
                    "fields": report["bfs_steps"][-1]["fields"],
                }
            )
        except Exception:
            pass

    # Contacts
    phones = profile.get("phones") or profile.get("phone")
    if isinstance(phones, list) and phones:
        fill_empty_patch(row, "phone", str(phones[0]).strip(), patch, sources)
    elif isinstance(phones, str):
        fill_empty_patch(row, "phone", phones.strip(), patch, sources)

    emails = profile.get("emails") or profile.get("email")
    if isinstance(emails, list):
        for e in emails:
            if e and not is_junk_email(str(e)):
                fill_empty_patch(row, "email", str(e).strip(), patch, sources)
                break
    elif isinstance(emails, str) and not is_junk_email(emails):
        fill_empty_patch(row, "email", emails.strip(), patch, sources)

    ig = profile.get("instagram") or profile.get("instagram_url")
    if ig:
        fill_empty_patch(row, "instagram_url", str(ig).strip(), patch, sources)
    elif row.get("instagram_url"):
        pass
    else:
        # try IG from site links already in ministries html
        pass

    if empty(row.get("instagram_url")) and "instagram_url" not in patch:
        try:
            ig_prof = extract_instagram_profile(website)
            if ig_prof and ig_prof.get("url"):
                fill_empty_patch(
                    row, "instagram_url", str(ig_prof["url"]).strip(), patch, sources
                )
        except Exception:
            pass

    # Description
    desc = profile.get("description") or profile.get("about")
    if isinstance(desc, str) and desc.strip():
        current = row.get("description")
        if is_weak_description(current):
            richer, _src = pick_richest_description(
                [(current, "card"), (desc.strip(), "website")]
            )
            if richer and richer != current:
                patch["description"] = richer[:4000]
                sources["description"] = "website"

    # Image
    image = profile.get("image") or profile.get("image_url") or profile.get("og_image")
    if image and empty(row.get("image_url")):
        fill_empty_patch(row, "image_url", str(image).strip(), patch, sources)

    # Address
    street_line, parts = scraped_address(profile.get("address") or profile.get("street"))
    if street_line and looks_like_street(street_line):
        existing = row.get("address_line")
        if empty(existing) or not looks_like_street(str(existing)):
            fill_empty_patch(row, "address_line", street_line, patch, sources)
            sources["address_line"] = "website"
        if parts.get("city") and (
            empty(row.get("city")) or city_is_bogus(row.get("city"))
        ):
            fill_empty_patch(row, "city", parts["city"], patch, sources)
        if parts.get("state_code") and empty(row.get("state_code")):
            fill_empty_patch(row, "state_code", parts["state_code"], patch, sources)
        if parts.get("postal_code") and empty(row.get("postal_code")):
            fill_empty_patch(row, "postal_code", parts["postal_code"], patch, sources)
        if parts.get("region") and empty(row.get("region")):
            fill_empty_patch(row, "region", parts["region"], patch, sources)

    # Hours + schedule text
    if empty(row.get("opening_hours")):
        weekly = parse_hours_spec_blob(profile.get("hours")) or parse_hours_to_weekly(
            profile.get("hours")
        )
        if weekly:
            patch["opening_hours"] = weekly
            sources["opening_hours"] = "website"

    if empty(row.get("schedule_text")):
        schedule = extract_schedule_text(
            "\n".join(
                str(x)
                for x in (
                    profile.get("hours"),
                    profile.get("description"),
                    html_blob[:8000],
                    row.get("description"),
                )
                if x
            )
        )
        if schedule:
            patch["schedule_text"] = schedule
            sources["schedule_text"] = "website"

    # Ministries fill-empty (merge into empty list only, or append missing titles)
    existing_mins = row.get("ministries") if isinstance(row.get("ministries"), list) else []
    if not existing_mins and ministries:
        patch["ministries"] = ministries
        sources["ministries"] = f"website:{len(ministries)}"
    elif existing_mins and ministries:
        merged = merge_ministries(existing_mins, ministries)
        if len(merged) > len(existing_mins):
            patch["ministries"] = merged
            sources["ministries"] = f"website:+{len(merged) - len(existing_mins)}"

    # Also pick ministry titles from profile.services without prices
    for title in profile.get("services") or []:
        t = str(title).strip()
        if len(t) < 4 or len(t) > 80:
            continue
        if re.search(r"\$|\d{2,}\s*(usd|руб)", t, re.I):
            continue
        # Skip page chrome / site name leftovers from CMS menus
        if re.search(
            r"(?i)^(home|главн|st\s*barbara|forward\s*church|new\s*creation|"
            r"contact|about|menu|nav|page\b)",
            t,
        ):
            continue
        if not any(pat.search(t) for pat, _ in MINISTRY_RULES):
            # Only keep free-text services that look like church programs
            if not re.search(
                r"(?i)kids|teen|youth|give|donat|podcast|sermon|stream|"
                r"online|group|ministry|служен|детск|молодёж|молодеж|"
                r"пожертвован|проповед|онлайн|ученич",
                t,
            ):
                continue
        ministries = merge_ministries(
            ministries if "ministries" not in patch else patch["ministries"],
            [{"title": t, "detail": None, "url": None}],
        )
        if empty(existing_mins) and ministries:
            patch["ministries"] = ministries
            sources["ministries"] = sources.get("ministries") or "website:services"

    # Geo from address (same contract as import / publish — pin at write time)
    addr_line = patch.get("address_line") or row.get("address_line")
    city = patch.get("city") or row.get("city")
    state = patch.get("state_code") or row.get("state_code")
    postal = patch.get("postal_code") or row.get("postal_code")
    if addr_line and (empty(row.get("latitude")) or empty(row.get("google_maps_url"))):
        try:
            cleaned = scrub_directory_glue(str(addr_line))
            if cleaned and cleaned != str(addr_line).strip():
                patch["address_line"] = cleaned
                sources["address_line"] = "scrub_directory_glue"
            geo = resolve_address_geo(
                address_line=cleaned or str(addr_line),
                city=str(city) if city else None,
                state_code=str(state) if state else None,
                postal_code=str(postal or "") or None,
            )
            for key, value in (geo.patch or {}).items():
                if key in ("latitude", "longitude", "google_maps_url", "location_precision"):
                    if empty(row.get(key)) and key not in patch and value is not None:
                        patch[key] = value
                        sources[key] = "geocode"
        except Exception as exc:  # noqa: BLE001
            report["notes"].append(f"geocode_failed:{exc}"[:120])

    if not patch:
        report["notes"].append("nothing_new")
    return report


def fetch_targets(
    client: SupabaseRest,
    *,
    limit: int | None,
    slug: str | None,
    id_: str | None,
) -> list[dict[str, Any]]:
    select = (
        "id,name,slug,website,instagram_url,phone,email,city,region,state_code,"
        "address_line,postal_code,description,google_maps_url,latitude,longitude,"
        "location_precision,opening_hours,schedule_text,ministries,image_url,"
        "source_url,status"
    )
    if id_ or slug:
        params: dict[str, str] = {"select": select, "limit": "1"}
        if id_:
            params["id"] = f"eq.{id_}"
        else:
            params["slug"] = f"eq.{slug}"
        return client._request("GET", "/churches", params=params) or []

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/churches",
                params={
                    "select": select,
                    "status": "eq.approved",
                    "website": "not.is.null",
                    "order": "updated_at.asc",
                    "offset": str(offset),
                    "limit": "100",
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < 100:
            break
    rows = [r for r in rows if not is_junk_website(r.get("website"))]
    if limit is not None:
        rows = rows[:limit]
    return rows


def apply_report(client: SupabaseRest, report: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"church_ok": False, "errors": []}
    patch = dict(report.get("patch") or {})
    if patch:
        patch["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        try:
            client._request(
                "PATCH",
                "/churches",
                params={"id": f"eq.{report['id']}"},
                body=patch,
                prefer="return=minimal",
            )
            out["church_ok"] = True
        except Exception as exc:  # noqa: BLE001
            out["errors"].append(str(exc)[:300])
    else:
        out["church_ok"] = True
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich published churches from website")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--slug", type=str, default=None)
    parser.add_argument("--id", type=str, default=None)
    parser.add_argument("--ndjson", action="store_true")
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    if args.ndjson and not (args.id or args.slug):
        print("--ndjson requires --id or --slug", file=sys.stderr)
        return 2

    def emit(obj: dict[str, Any]) -> None:
        if args.ndjson:
            print(json.dumps(obj, ensure_ascii=False), flush=True)

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    targets = fetch_targets(
        client,
        limit=None if (args.slug or args.id) else args.limit,
        slug=args.slug,
        id_=args.id,
    )
    if (args.slug or args.id) and not targets:
        msg = f"Church not found id={args.id!r} slug={args.slug!r}"
        if args.ndjson:
            emit({"type": "error", "message": msg})
        else:
            print(msg, file=sys.stderr)
        return 1

    if not args.ndjson:
        print(
            json.dumps(
                {
                    "targets": len(targets),
                    "mode": "dry_run" if args.dry_run else "apply",
                },
                ensure_ascii=False,
            )
        )

    for church in targets:
        label = f"Обогащение церкви «{church.get('slug') or church.get('id')}»"
        if args.ndjson:
            emit(
                {
                    "type": "started",
                    "id": church.get("id"),
                    "label": label,
                    "mode": "apply" if args.apply else "dry-run",
                }
            )
        else:
            print(f"… {church.get('name')} ({church.get('website')})", flush=True)

        def on_event(ev: dict[str, Any]) -> None:
            if args.ndjson:
                emit(ev)

        rep = enrich_one(church, on_event=on_event)
        if args.apply and not rep.get("skipped"):
            rep["apply_result"] = apply_report(client, rep)

        if args.ndjson:
            emit(
                {
                    "type": "finished",
                    "result": {
                        "id": church.get("id"),
                        "label": label,
                        "skipped": bool(rep.get("skipped")),
                        "reason": (
                            f"Пропуск: {rep.get('skipped')}"
                            if rep.get("skipped")
                            else (
                                None
                                if rep.get("patch")
                                else "Новых полей нет"
                            )
                        ),
                        "fields": list((rep.get("sources") or {}).keys()),
                        "patch": rep.get("patch") or {},
                        "sources": rep.get("sources") or {},
                        "notes": rep.get("notes") or [],
                        "apply_result": rep.get("apply_result"),
                    },
                }
            )
        else:
            print(
                json.dumps(
                    {
                        "slug": church.get("slug"),
                        "skipped": rep.get("skipped"),
                        "sources": rep.get("sources"),
                        "patch_keys": list((rep.get("patch") or {}).keys()),
                        "notes": rep.get("notes"),
                        "apply": rep.get("apply_result"),
                    },
                    ensure_ascii=False,
                )
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
