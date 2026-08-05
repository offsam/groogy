#!/usr/bin/env python3
"""
Enrich a queue card with the SAME crawl as published enrich
(enrich_one from enrich_published_businesses / enrich_professionals_card_first).

Writes fill-empty results back to import_comment_recommendations or
import_review_items — does not create a published row.

Usage:
  python3 scripts/business-enrich/enrich_queue_card.py \\
    --recommendation-id UUID --kind business --apply --ndjson
  python3 scripts/business-enrich/enrich_queue_card.py \\
    --import-review-id UUID --kind professional --apply --ndjson
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
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from enrich_published_businesses import enrich_one as enrich_business  # noqa: E402
from enrich_professionals_card_first import (  # noqa: E402
    build_patch as build_pro_patch,
    enrich_one as enrich_professional,
)


def emit(obj: dict[str, Any], ndjson: bool) -> None:
    if ndjson:
        print(json.dumps(obj, ensure_ascii=False), flush=True)


def first(values: list[Any] | None) -> str | None:
    for v in values or []:
        s = str(v or "").strip()
        if s:
            return s
    return None


def note_field(notes: str | None, key: str) -> str | None:
    if not notes:
        return None
    prefix = f"{key.lower()}:"
    for part in notes.split(";"):
        p = part.strip()
        if p.lower().startswith(prefix):
            return p[len(key) + 1 :].strip() or None
    return None


def set_note_field(notes: str | None, key: str, value: str) -> str:
    parts = [
        p.strip()
        for p in (notes or "").split(";")
        if p.strip() and not p.strip().lower().startswith(f"{key.lower()}:")
    ]
    parts.append(f"{key}: {value}")
    return "; ".join(parts)


def clear_note_field(notes: str | None, key: str) -> str | None:
    parts = [
        p.strip()
        for p in (notes or "").split(";")
        if p.strip() and not p.strip().lower().startswith(f"{key.lower()}:")
    ]
    return "; ".join(parts) if parts else None


def _is_social_host(url: str, hosts: tuple[str, ...]) -> bool:
    low = (url or "").lower()
    return any(h in low for h in hosts)


def upsert_website(
    sites: list[Any],
    url: str | None,
    *,
    replace_hosts: tuple[str, ...] = (),
) -> list[str] | None:
    """Prepend url; optionally drop existing links on the same hosts."""
    u = (url or "").strip()
    if not u:
        return None
    cur = [str(x).strip() for x in (sites or []) if str(x or "").strip()]
    if replace_hosts:
        cur = [x for x in cur if not _is_social_host(x, replace_hosts)]
    norm = u.rstrip("/").lower()
    cur = [x for x in cur if x.rstrip("/").lower() != norm]
    nxt = [u, *cur]
    prev = [str(x).strip() for x in (sites or []) if str(x or "").strip()]
    return nxt if nxt != prev else None


def contact_link_urls(patch: dict[str, Any]) -> dict[str, str]:
    """channel → url from patch.contact_links / dedicated social fields."""
    out: dict[str, str] = {}
    for row in patch.get("contact_links") or []:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        val = str(row.get("value") or "").strip()
        if ch and val and ch not in out:
            out[ch] = val
    for key, ch in (
        ("telegram_url", "telegram"),
        ("facebook_url", "facebook"),
        ("tiktok_url", "tiktok"),
        ("youtube_url", "youtube"),
        ("yelp_url", "yelp"),
    ):
        val = str(patch.get(key) or "").strip()
        if val and ch not in out:
            out[ch] = val
    return out


def _first_website_matching(websites: list[Any], *needles: str) -> str | None:
    for w in websites or []:
        s = str(w or "").strip()
        low = s.lower()
        if s and any(n in low for n in needles):
            return s
    return None


def rec_to_biz(rec: dict[str, Any]) -> dict[str, Any]:
    websites = rec.get("websites") or []
    phones = rec.get("phones") or []
    ig = rec.get("instagram") or []
    snippets = rec.get("request_snippets") or []
    comments = rec.get("comment_texts") or []
    desc = first(snippets) or first(comments) or rec.get("notes")
    email = note_field(rec.get("notes"), "emails")
    if email and "," in email:
        email = email.split(",")[0].strip()
    own_site = first(
        [
            w
            for w in websites
            if w
            and not _is_social_host(
                str(w),
                (
                    "instagram.com/",
                    "t.me/",
                    "telegram.me/",
                    "facebook.com/",
                    "fb.com/",
                    "youtube.com/",
                    "youtu.be/",
                    "tiktok.com/",
                    "yelp.com/",
                    "trustpilot.com/",
                ),
            )
        ]
    )
    tg = note_field(rec.get("notes"), "telegram") or _first_website_matching(
        websites, "t.me/", "telegram.me/"
    )
    fb = _first_website_matching(websites, "facebook.com/", "fb.com/")
    yt = _first_website_matching(websites, "youtube.com/", "youtu.be/")
    tt = _first_website_matching(websites, "tiktok.com/")
    yelp = _first_website_matching(websites, "yelp.com/")
    tp = _first_website_matching(websites, "trustpilot.com/")
    links: list[dict[str, Any]] = []
    for ch, val in (
        ("telegram", tg),
        ("facebook", fb),
        ("youtube", yt),
        ("tiktok", tt),
        ("yelp", yelp),
        ("trustpilot", tp),
    ):
        if val:
            links.append({"channel": ch, "value": val, "label": None})
    hours_raw = note_field(rec.get("notes"), "hours")
    opening_hours = None
    if hours_raw:
        try:
            opening_hours = json.loads(hours_raw)
        except Exception:
            opening_hours = None
    return {
        "id": rec["id"],
        "name": rec.get("display_name") or "—",
        "slug": str(rec.get("id")),
        "website": own_site or first(websites),
        "instagram_url": (
            f"https://www.instagram.com/{str(ig[0]).lstrip('@')}" if ig else None
        ),
        "yelp_url": yelp,
        "facebook_url": fb,
        "tiktok_url": tt,
        "telegram_url": tg,
        "phone": first(phones),
        "email": email,
        "city": rec.get("city"),
        "region": note_field(rec.get("notes"), "region"),
        "state_code": rec.get("state_code"),
        "address_line": rec.get("address_line")
        or note_field(rec.get("notes"), "address"),
        "postal_code": note_field(rec.get("notes"), "zip")
        or note_field(rec.get("notes"), "postal"),
        "description": desc,
        "short_description": None,
        "google_maps_url": None,
        "latitude": rec.get("latitude"),
        "longitude": rec.get("longitude"),
        "location_precision": None,
        "opening_hours": opening_hours,
        "image_url": rec.get("cover_image_url"),
        "booking_url": None,
        "source_url": first(rec.get("source_post_urls")),
        "payment_methods": rec.get("payment_methods") or [],
        "contact_links": links,
        "category_id": None,
        "status": "draft",
    }


def rec_to_pro(rec: dict[str, Any]) -> dict[str, Any]:
    biz = rec_to_biz(rec)
    return {
        "id": biz["id"],
        "display_name": biz["name"],
        "slug": biz["slug"],
        "website": biz["website"],
        "source_url": biz["source_url"],
        "instagram_url": biz["instagram_url"],
        "telegram_url": None,
        "booking_url": None,
        "phone": biz["phone"],
        "email": biz["email"],
        "city": biz["city"],
        "postal_code": None,
        "private_address_line": biz["address_line"],
        "state_code": biz["state_code"],
        "image_url": biz["image_url"],
        "description": biz["description"],
        "short_description": None,
        "payment_methods": [],
        "category_id": None,
    }


def import_to_biz(item: dict[str, Any]) -> dict[str, Any]:
    phones = item.get("phone") or []
    websites = item.get("website") or []
    ig = item.get("instagram") or []
    emails = item.get("email") or []
    return {
        "id": item["id"],
        "name": item.get("business_name")
        or item.get("title")
        or item.get("person_name")
        or "—",
        "slug": str(item.get("id")),
        "website": first(websites),
        "instagram_url": (
            f"https://www.instagram.com/{str(ig[0]).lstrip('@')}" if ig else None
        ),
        "yelp_url": None,
        "facebook_url": None,
        "tiktok_url": None,
        "phone": first(phones),
        "email": first(emails),
        "city": item.get("city"),
        "region": None,
        "state_code": item.get("state"),
        "address_line": item.get("address_line"),
        "postal_code": item.get("postal_code"),
        "description": item.get("description"),
        "short_description": None,
        "google_maps_url": None,
        "latitude": item.get("latitude"),
        "longitude": item.get("longitude"),
        "location_precision": None,
        "opening_hours": None,
        "image_url": item.get("preview_image_url"),
        "booking_url": None,
        "source_url": item.get("source_url"),
        "payment_methods": item.get("payment_methods") or [],
        "contact_links": [],
        "category_id": None,
        "status": "draft",
    }


def import_to_pro(item: dict[str, Any]) -> dict[str, Any]:
    biz = import_to_biz(item)
    return {
        "id": biz["id"],
        "display_name": item.get("person_name") or biz["name"],
        "slug": biz["slug"],
        "website": biz["website"],
        "source_url": biz["source_url"],
        "instagram_url": biz["instagram_url"],
        "telegram_url": (
            f"https://t.me/{item['telegram_username']}"
            if item.get("telegram_username")
            else None
        ),
        "booking_url": None,
        "phone": biz["phone"],
        "email": biz["email"],
        "city": biz["city"],
        "postal_code": biz["postal_code"],
        "private_address_line": biz["address_line"],
        "state_code": biz["state_code"],
        "image_url": biz["image_url"],
        "description": biz["description"],
        "short_description": None,
        "payment_methods": biz["payment_methods"],
        "category_id": None,
    }


def biz_patch_to_recommendation(
    patch: dict[str, Any],
    rec: dict[str, Any],
) -> dict[str, Any]:
    """Map published enrich patch → recommendation columns.

    Trust enrich_one: website street may replace telegram glue; geo follows.
    Socials land in websites + notes.
    """
    out: dict[str, Any] = {}
    notes = rec.get("notes")

    if patch.get("phone"):
        phones = list(rec.get("phones") or [])
        p = str(patch["phone"]).strip()
        if p and p not in phones:
            out["phones"] = [p, *[x for x in phones if x != p]]

    if patch.get("website"):
        sites = upsert_website(rec.get("websites") or [], str(patch["website"]).strip())
        if sites is not None:
            out["websites"] = sites

    if patch.get("instagram_url"):
        handle = str(patch["instagram_url"]).rstrip("/").split("/")[-1].lstrip("@")
        ig = list(rec.get("instagram") or [])
        if handle and handle.lower() not in {x.lower().lstrip("@") for x in ig}:
            out["instagram"] = [handle, *ig]

    if patch.get("image_url") and not (rec.get("cover_image_url") or "").strip():
        out["cover_image_url"] = patch["image_url"]

    # Address / geo — apply whenever enrich put them in the patch.
    if patch.get("address_line"):
        new_addr = str(patch["address_line"]).strip()
        cur_addr = (rec.get("address_line") or "").strip() or (
            note_field(notes, "address") or ""
        )
        if new_addr and new_addr != cur_addr:
            out["address_line"] = new_addr
            notes = clear_note_field(notes, "address")
            notes = set_note_field(notes, "address", new_addr)
    if patch.get("city"):
        new_city = str(patch["city"]).strip()
        if new_city and new_city != (rec.get("city") or "").strip():
            out["city"] = new_city
    if patch.get("state_code"):
        new_state = str(patch["state_code"]).strip()
        if new_state and new_state != (rec.get("state_code") or "").strip():
            out["state_code"] = new_state
    if patch.get("postal_code"):
        notes = set_note_field(notes, "zip", str(patch["postal_code"]).strip())
    if patch.get("latitude") is not None and patch.get("longitude") is not None:
        try:
            lat = float(patch["latitude"])
            lng = float(patch["longitude"])
        except (TypeError, ValueError):
            lat = lng = None  # type: ignore[assignment]
        if lat is not None and lng is not None:
            if rec.get("latitude") != lat or rec.get("longitude") != lng:
                out["latitude"] = lat
                out["longitude"] = lng

    if patch.get("email"):
        notes = set_note_field(notes, "emails", str(patch["email"]))

    socials = contact_link_urls(patch)
    sites_base = list(out.get("websites") or rec.get("websites") or [])
    sites_changed = False
    for ch, hosts in (
        ("telegram", ("t.me/", "telegram.me/", "telegram.dog/")),
        ("youtube", ("youtube.com/", "youtu.be/")),
        ("facebook", ("facebook.com/", "fb.com/", "fb.me/")),
        ("tiktok", ("tiktok.com/",)),
        ("yelp", ("yelp.com/",)),
        ("trustpilot", ("trustpilot.com/",)),
    ):
        url = socials.get(ch)
        if not url:
            continue
        nxt = upsert_website(sites_base, url, replace_hosts=hosts)
        if nxt is not None:
            sites_base = nxt
            sites_changed = True
        if ch == "telegram":
            notes = set_note_field(notes, "telegram", url)
    if sites_changed:
        out["websites"] = sites_base

    if patch.get("payment_methods") and not (rec.get("payment_methods") or []):
        out["payment_methods"] = patch["payment_methods"]

    if patch.get("opening_hours"):
        try:
            hours_s = json.dumps(patch["opening_hours"], ensure_ascii=False)[:500]
            notes = set_note_field(notes, "hours", hours_s)
        except Exception:
            pass

    # Filtered website courses / services (not vacancy slogans).
    offer_titles = [
        str(o.get("title") or "").strip()
        for o in (patch.get("_offers") or [])
        if isinstance(o, dict) and str(o.get("title") or "").strip()
    ]
    if offer_titles:
        # Cap note size; preview reads this list.
        joined = " | ".join(offer_titles[:12])[:800]
        notes = set_note_field(notes, "services", joined)

    # Professional enrich uses private_address_line.
    if patch.get("private_address_line") and "address_line" not in out:
        new_addr = str(patch["private_address_line"]).strip()
        cur_addr = (rec.get("address_line") or "").strip()
        if new_addr and new_addr != cur_addr:
            out["address_line"] = new_addr

    # Enrich already picked the richer about — always write it.
    if patch.get("description"):
        desc = str(patch["description"]).strip()
        snippets = list(rec.get("request_snippets") or [])
        if desc and (not snippets or snippets[0] != desc[:1200]):
            out["request_snippets"] = [desc[:1200], *snippets][:5]
    elif patch.get("short_description"):
        desc = str(patch["short_description"]).strip()
        snippets = list(rec.get("request_snippets") or [])
        existing = max((len(s or "") for s in snippets), default=0)
        if desc and len(desc) > existing + 40:
            out["request_snippets"] = [desc[:1200], *snippets][:5]

    if notes != rec.get("notes"):
        out["notes"] = notes

    return out


def biz_patch_to_import(
    patch: dict[str, Any],
    item: dict[str, Any],
) -> dict[str, Any]:
    """Map published enrich patch → import_review_items (same trust rules)."""
    out: dict[str, Any] = {}

    def fill_arr(
        key: str,
        value: str | None,
        *,
        replace_hosts: tuple[str, ...] = (),
    ) -> None:
        if not value:
            return
        cur = list(out.get(key) or item.get(key) or [])
        nxt = upsert_website(cur, value, replace_hosts=replace_hosts)
        if nxt is not None:
            out[key] = nxt

    if patch.get("phone"):
        fill_arr("phone", str(patch["phone"]).strip())
    if patch.get("website"):
        fill_arr("website", str(patch["website"]).strip())
    if patch.get("email"):
        fill_arr("email", str(patch["email"]).strip())
    if patch.get("instagram_url"):
        handle = str(patch["instagram_url"]).rstrip("/").split("/")[-1].lstrip("@")
        fill_arr("instagram", handle)

    if patch.get("image_url") and not (item.get("preview_image_url") or "").strip():
        out["preview_image_url"] = patch["image_url"]

    if patch.get("address_line"):
        new_addr = str(patch["address_line"]).strip()
        if new_addr and new_addr != (item.get("address_line") or "").strip():
            out["address_line"] = new_addr
    if patch.get("private_address_line") and "address_line" not in out:
        new_addr = str(patch["private_address_line"]).strip()
        if new_addr and new_addr != (item.get("address_line") or "").strip():
            out["address_line"] = new_addr
    if patch.get("city"):
        new_city = str(patch["city"]).strip()
        if new_city and new_city != (item.get("city") or "").strip():
            out["city"] = new_city
    if patch.get("state_code"):
        new_state = str(patch["state_code"]).strip()
        if new_state and new_state != (item.get("state") or "").strip():
            out["state"] = new_state
    if patch.get("postal_code"):
        new_zip = str(patch["postal_code"]).strip()
        if new_zip and new_zip != (item.get("postal_code") or "").strip():
            out["postal_code"] = new_zip

    socials = contact_link_urls(patch)
    if socials.get("telegram"):
        handle = socials["telegram"].rstrip("/").split("/")[-1].lstrip("@")
        if handle and handle != (item.get("telegram_username") or "").strip():
            out["telegram_username"] = handle
        fill_arr(
            "website",
            socials["telegram"],
            replace_hosts=("t.me/", "telegram.me/", "telegram.dog/"),
        )
    for ch, hosts in (
        ("youtube", ("youtube.com/", "youtu.be/")),
        ("facebook", ("facebook.com/", "fb.com/", "fb.me/")),
        ("tiktok", ("tiktok.com/",)),
        ("yelp", ("yelp.com/",)),
        ("trustpilot", ("trustpilot.com/",)),
    ):
        if socials.get(ch):
            fill_arr("website", socials[ch], replace_hosts=hosts)

    if patch.get("payment_methods") and not (item.get("payment_methods") or []):
        out["payment_methods"] = patch["payment_methods"]

    if patch.get("description"):
        desc = str(patch["description"]).strip()
        if desc and desc != (item.get("description") or "").strip():
            out["description"] = desc[:4000]
    elif patch.get("short_description"):
        desc = str(patch["short_description"]).strip()
        if desc and len(desc) > len(item.get("description") or "") + 40:
            out["description"] = desc[:4000]
    if patch.get("opening_hours") and not item.get("opening_hours"):
        out["opening_hours"] = patch["opening_hours"]

    offer_titles = [
        str(o.get("title") or "").strip()
        for o in (patch.get("_offers") or [])
        if isinstance(o, dict) and str(o.get("title") or "").strip()
    ]
    if offer_titles and not (item.get("services") or []):
        out["services"] = offer_titles[:20]

    return out


def resources_from_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for s in steps or []:
        out.append(
            {
                "url": s.get("url") or "",
                "kind": s.get("kind") or "website",
                "status": s.get("status") or "done",
                "outcome": s.get("outcome"),
                "fields": s.get("fields") or [],
                "error": s.get("error"),
            }
        )
    return out


def fetch_one(client: SupabaseRest, table: str, id_: str) -> dict[str, Any] | None:
    rows = client._request(
        "GET",
        f"/{table}",
        params={"id": f"eq.{id_}", "select": "*", "limit": "1"},
    )
    if not rows:
        return None
    return rows[0]


def apply_patch(client: SupabaseRest, table: str, id_: str, patch: dict[str, Any]) -> None:
    if not patch:
        return
    body = {
        **patch,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    client.patch(table, {"id": f"eq.{id_}"}, body)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--recommendation-id")
    ap.add_argument("--import-review-id")
    ap.add_argument(
        "--kind",
        default="business",
        choices=[
            "business",
            "professional",
            "event",
            "service",
            "job",
            "transfer",
            "marketplace",
            "lechu",
        ],
    )
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--ndjson", action="store_true")
    args = ap.parse_args()

    if not args.apply and not args.dry_run:
        print("Specify --apply or --dry-run", file=sys.stderr)
        return 2
    if bool(args.recommendation_id) == bool(args.import_review_id):
        print(
            "Need exactly one of --recommendation-id / --import-review-id",
            file=sys.stderr,
        )
        return 2

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    use_pro = args.kind == "professional"

    def on_event(ev: dict[str, Any]) -> None:
        emit(ev, args.ndjson)

    if args.recommendation_id:
        rec = fetch_one(client, "import_comment_recommendations", args.recommendation_id)
        if not rec:
            msg = f"Recommendation not found id={args.recommendation_id}"
            emit({"type": "error", "message": msg}, args.ndjson)
            return 1
        label = f"Обогащение «{rec.get('display_name') or rec['id']}»"
        emit(
            {
                "type": "started",
                "id": rec["id"],
                "label": label,
                "mode": "apply" if args.apply else "dry-run",
            },
            args.ndjson,
        )
        if use_pro:
            found, debug = enrich_professional(
                rec_to_pro(rec), client=client, on_event=on_event
            )
            raw_patch = build_pro_patch(rec_to_pro(rec), found)
            steps = debug.get("bfs_steps") or []
            skipped = None
            field_conflicts: list[Any] = []
        else:
            rep = enrich_business(rec_to_biz(rec), on_event=on_event, client=client)
            raw_patch = rep.get("patch") or {}
            if rep.get("offers"):
                raw_patch = {**raw_patch, "_offers": rep["offers"]}
            steps = rep.get("bfs_steps") or []
            skipped = rep.get("skipped")
            field_conflicts = list(rep.get("field_conflicts") or [])

        if skipped:
            emit(
                {
                    "type": "finished",
                    "result": {
                        "id": rec["id"],
                        "label": label,
                        "skipped": True,
                        "reason": f"Пропуск: {skipped}",
                        "patch": {},
                        "resources": resources_from_steps(steps),
                    },
                },
                args.ndjson,
            )
            return 0

        queue_patch = biz_patch_to_recommendation(raw_patch, rec)
        if args.apply and queue_patch:
            apply_patch(client, "import_comment_recommendations", rec["id"], queue_patch)

        ok_n = sum(1 for s in steps if s.get("outcome") == "ok")
        fail_n = sum(1 for s in steps if s.get("outcome") in ("empty", "error"))
        emit(
            {
                "type": "finished",
                "result": {
                    "id": rec["id"],
                    "label": label,
                    "skipped": not bool(queue_patch),
                    "reason": (
                        None
                        if queue_patch
                        else "Готово — новых полей не нашлось (fill-empty)."
                    ),
                    "patch": queue_patch,
                    "field_conflicts": field_conflicts,
                    "resources": resources_from_steps(steps),
                    "resources_ok": ok_n,
                    "resources_failed": fail_n,
                },
            },
            args.ndjson,
        )
        return 0

    item = fetch_one(client, "import_review_items", args.import_review_id)
    if not item:
        msg = f"Import review item not found id={args.import_review_id}"
        emit({"type": "error", "message": msg}, args.ndjson)
        return 1
    label = (
        f"Обогащение «{item.get('title') or item.get('business_name') or item['id']}»"
    )
    emit(
        {
            "type": "started",
            "id": item["id"],
            "label": label,
            "mode": "apply" if args.apply else "dry-run",
        },
        args.ndjson,
    )
    if use_pro:
        found, debug = enrich_professional(
            import_to_pro(item), client=client, on_event=on_event
        )
        raw_patch = build_pro_patch(import_to_pro(item), found)
        steps = debug.get("bfs_steps") or []
        skipped = None
        field_conflicts: list[Any] = []
    else:
        rep = enrich_business(import_to_biz(item), on_event=on_event, client=client)
        raw_patch = rep.get("patch") or {}
        if rep.get("offers"):
            raw_patch = {**raw_patch, "_offers": rep["offers"]}
        steps = rep.get("bfs_steps") or []
        skipped = rep.get("skipped")
        field_conflicts = list(rep.get("field_conflicts") or [])

    if skipped:
        emit(
            {
                "type": "finished",
                "result": {
                    "id": item["id"],
                    "label": label,
                    "skipped": True,
                    "reason": f"Пропуск: {skipped}",
                    "patch": {},
                    "resources": resources_from_steps(steps),
                },
            },
            args.ndjson,
        )
        return 0

    queue_patch = biz_patch_to_import(raw_patch, item)
    if args.apply and queue_patch:
        apply_patch(client, "import_review_items", item["id"], queue_patch)

    ok_n = sum(1 for s in steps if s.get("outcome") == "ok")
    fail_n = sum(1 for s in steps if s.get("outcome") in ("empty", "error"))
    emit(
        {
            "type": "finished",
            "result": {
                "id": item["id"],
                "label": label,
                "skipped": not bool(queue_patch),
                "reason": (
                    None
                    if queue_patch
                    else "Готово — новых полей не нашлось (fill-empty)."
                ),
                "patch": queue_patch,
                "field_conflicts": field_conflicts,
                "resources": resources_from_steps(steps),
                "resources_ok": ok_n,
                "resources_failed": fail_n,
            },
        },
        args.ndjson,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
