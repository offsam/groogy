#!/usr/bin/env python3
"""Merge pending third-party recommendations into live business/professional cards.

Mirrors admin confirmRecommendationMergeAction:
  - fill-empty contacts/location/source on the keep card
  - bump third_party / self_ad mention counts
  - insert community mention (source URL)
  - mark recommendation status=merged (queue card goes away)

Match rules (strict, no multi-phone dumps):
  1) Instagram handle exact
  2) Exact normalized name (len >= 8) — same threshold as findWeakByName
  3) Phone exact only when the rec has ≤2 phones

Usage:
  python3 scripts/business-enrich/merge_third_party_recs_into_live.py
  python3 scripts/business-enrich/merge_third_party_recs_into_live.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

GENERIC_NAMES = {
    "inna",
    "max",
    "anna",
    "anton",
    "olga",
    "yana",
    "marina",
    "mila",
    "alena",
    "сергей",
    "марина",
    "юля",
    "амина",
    "kim",
    "tt",
    "om",
    "om",
    "сша",
    "cell",
    "reel",
    "gallo",
    "elena",
    "aleksandr",
    "алекс",
    "виктория",
    "галина",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def fetch_all(
    c: SupabaseRest, path: str, select: str, extra: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    off = 0
    while True:
        params: dict[str, str] = {
            "select": select,
            "order": "id.asc",
            "limit": "1000",
            "offset": str(off),
        }
        if extra:
            params.update(extra)
        batch = c._request("GET", path, params=params) or []
        out.extend(batch)
        if len(batch) < 1000:
            break
        off += 1000
    return out


def norm_name(raw: str | None) -> str:
    s = unicodedata.normalize("NFKD", (raw or "").lower())
    return re.sub(r"[^\w]", "", s, flags=re.UNICODE)[:80]


def phone_digits(raw: str | None) -> str:
    d = re.sub(r"\D", "", raw or "")
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return d[-10:] if len(d) >= 10 else d


def ig_handle(raw: str | None) -> str | None:
    t = (raw or "").strip()
    if not t:
        return None
    m = re.search(r"instagram\.com/([^/?#]+)", t, re.I)
    if m:
        h = m.group(1).lower().lstrip("@")
    else:
        h = t.lstrip("@").rstrip("/").lower()
    if not re.match(r"^[a-z0-9._]{2,30}$", h):
        return None
    if h in {"p", "reel", "reels", "stories", "explore"}:
        return None
    return h


def website_host(raw: str | None) -> str | None:
    t = (raw or "").strip()
    if not t:
        return None
    try:
        if not re.match(r"^https?://", t, re.I):
            t = "https://" + t
        host = re.sub(r"^www\.", "", __import__("urllib.parse").urlparse(t).hostname or "")
        return host.lower() or None
    except Exception:
        return None


SHARED_HOSTS = {
    "instagram.com",
    "facebook.com",
    "fb.com",
    "t.me",
    "telegram.me",
    "wa.me",
    "api.whatsapp.com",
    "youtu.be",
    "youtube.com",
    "linktr.ee",
    "bit.ly",
    "forms.gle",
    "docs.google.com",
    "google.com",
    "yelp.com",
    "diasporanews.com",
    "healthforcalifornia.com",
}


def own_host(raw: str | None) -> str | None:
    h = website_host(raw)
    if not h or h in SHARED_HOSTS or any(h.endswith("." + s) for s in SHARED_HOSTS):
        return None
    return h


def third(r: dict[str, Any]) -> int:
    return max(0, int(r.get("third_party_mention_count") or 0))


def self_ad(r: dict[str, Any]) -> int:
    return max(0, int(r.get("self_ad_mention_count") or 0))


def first_phone(phones: list[str]) -> str | None:
    for p in phones:
        if len(phone_digits(p)) >= 10:
            return p.strip()
    return None


def ig_url(handles: list[str]) -> str | None:
    for h in handles:
        handle = ig_handle(h)
        if handle:
            return f"https://www.instagram.com/{handle}"
    return None


def plain_website(websites: list[str]) -> str | None:
    for w in websites:
        h = own_host(w)
        if h:
            return w if re.match(r"^https?://", w, re.I) else f"https://{w}"
    return None


def source_channel(item: dict[str, Any]) -> str:
    ch = (item.get("source_channel") or "").strip().lower()
    if ch in {"facebook", "telegram", "import", "admin", "other"}:
        return ch
    if item.get("directory_source"):
        return "import"
    return "other"


def snippet_from(item: dict[str, Any]) -> str:
    for t in item.get("comment_texts") or []:
        if isinstance(t, str) and len(t.strip()) >= 3:
            return t.strip()[:500]
    for t in item.get("request_snippets") or []:
        if isinstance(t, str) and len(t.strip()) >= 3:
            return t.strip()[:500]
    return "Рекомендация сообщества"


def build_indexes(biz: list[dict], pro: list[dict]):
    biz_by_ig: dict[str, dict] = {}
    pro_by_ig: dict[str, dict] = {}
    biz_by_name: dict[str, dict] = {}
    pro_by_name: dict[str, dict] = {}
    biz_by_phone: dict[str, dict] = {}
    pro_by_phone: dict[str, dict] = {}
    biz_by_host: dict[str, dict] = {}
    pro_by_host: dict[str, dict] = {}

    for b in biz:
        h = ig_handle(b.get("instagram_url"))
        if h:
            biz_by_ig[h] = b
        nk = norm_name(b.get("name"))
        if nk:
            biz_by_name[nk] = b
        d = phone_digits(b.get("phone"))
        if len(d) == 10:
            biz_by_phone[d] = b
        host = own_host(b.get("website"))
        if host:
            biz_by_host[host] = b

    for p in pro:
        h = ig_handle(p.get("instagram_url"))
        if h:
            pro_by_ig[h] = p
        # display_name that is itself a handle
        h2 = ig_handle(p.get("display_name"))
        if h2 and h2 not in pro_by_ig:
            pro_by_ig[h2] = p
        nk = norm_name(p.get("display_name"))
        if nk:
            pro_by_name[nk] = p
        d = phone_digits(p.get("phone"))
        if len(d) == 10:
            pro_by_phone[d] = p
        host = own_host(p.get("website"))
        if host:
            pro_by_host[host] = p

    return {
        "biz_by_ig": biz_by_ig,
        "pro_by_ig": pro_by_ig,
        "biz_by_name": biz_by_name,
        "pro_by_name": pro_by_name,
        "biz_by_phone": biz_by_phone,
        "pro_by_phone": pro_by_phone,
        "biz_by_host": biz_by_host,
        "pro_by_host": pro_by_host,
    }


def match_live(item: dict[str, Any], idx: dict) -> dict[str, Any] | None:
    """Return {type, id, slug, name, reason} or None."""
    # 1) Instagram
    ig_candidates: list[str] = []
    dn = item.get("display_name") or ""
    if dn.strip().startswith("@") or ig_handle(dn):
        ig_candidates.append(dn)
    for raw in item.get("instagram") or []:
        if isinstance(raw, str):
            ig_candidates.append(raw)
    for raw in ig_candidates:
        h = ig_handle(raw)
        if not h:
            continue
        if h in idx["pro_by_ig"]:
            p = idx["pro_by_ig"][h]
            return {
                "type": "professional",
                "id": p["id"],
                "slug": p["slug"],
                "name": p.get("display_name"),
                "reason": f"ig:{h}",
            }
        if h in idx["biz_by_ig"]:
            b = idx["biz_by_ig"][h]
            return {
                "type": "business",
                "id": b["id"],
                "slug": b["slug"],
                "name": b.get("name"),
                "reason": f"ig:{h}",
            }

    # 2) Own website host
    for w in item.get("websites") or []:
        host = own_host(w if isinstance(w, str) else None)
        if not host:
            continue
        if host in idx["pro_by_host"]:
            p = idx["pro_by_host"][host]
            return {
                "type": "professional",
                "id": p["id"],
                "slug": p["slug"],
                "name": p.get("display_name"),
                "reason": f"website:{host}",
            }
        if host in idx["biz_by_host"]:
            b = idx["biz_by_host"][host]
            return {
                "type": "business",
                "id": b["id"],
                "slug": b["slug"],
                "name": b.get("name"),
                "reason": f"website:{host}",
            }

    # 3) Phone — only when rec has ≤2 phones (avoid Medi-Cal dumps)
    phones = [p for p in (item.get("phones") or []) if isinstance(p, str)]
    if 1 <= len(phones) <= 2:
        for p in phones:
            d = phone_digits(p)
            if len(d) != 10:
                continue
            if d in idx["pro_by_phone"]:
                ent = idx["pro_by_phone"][d]
                return {
                    "type": "professional",
                    "id": ent["id"],
                    "slug": ent["slug"],
                    "name": ent.get("display_name"),
                    "reason": f"phone:{d}",
                }
            if d in idx["biz_by_phone"]:
                ent = idx["biz_by_phone"][d]
                return {
                    "type": "business",
                    "id": ent["id"],
                    "slug": ent["slug"],
                    "name": ent.get("name"),
                    "reason": f"phone:{d}",
                }

    # 4) Exact name (platform weak threshold: norm len >= 8), skip generics
    nk = norm_name(dn)
    if len(nk) >= 8 and nk not in GENERIC_NAMES:
        if nk in idx["pro_by_name"]:
            p = idx["pro_by_name"][nk]
            return {
                "type": "professional",
                "id": p["id"],
                "slug": p["slug"],
                "name": p.get("display_name"),
                "reason": f"name:{p.get('display_name')}",
            }
        if nk in idx["biz_by_name"]:
            b = idx["biz_by_name"][nk]
            return {
                "type": "business",
                "id": b["id"],
                "slug": b["slug"],
                "name": b.get("name"),
                "reason": f"name:{b.get('name')}",
            }

    return None


def fill_empty_professional(c: SupabaseRest, keep_id: str, item: dict[str, Any]) -> None:
    rows = (
        c._request(
            "GET",
            "/professionals",
            params={
                "select": "id,phone,email,website,instagram_url,city,private_address_line,postal_code,source_url",
                "id": f"eq.{keep_id}",
                "limit": "1",
            },
        )
        or []
    )
    if not rows:
        return
    cur = rows[0]
    phones = [p for p in (item.get("phones") or []) if isinstance(p, str)]
    igs = [x for x in (item.get("instagram") or []) if isinstance(x, str)]
    webs = [w for w in (item.get("websites") or []) if isinstance(w, str)]
    patch: dict[str, Any] = {"updated_at": now_iso()}
    phone = first_phone(phones)
    website = plain_website(webs)
    instagram = ig_url(igs)
    if not (cur.get("phone") or "").strip() and phone:
        patch["phone"] = phone
    if not (cur.get("website") or "").strip() and website:
        patch["website"] = website
    if not (cur.get("instagram_url") or "").strip() and instagram:
        patch["instagram_url"] = instagram
    if not (cur.get("city") or "").strip() and (item.get("city") or "").strip():
        patch["city"] = item["city"].strip()
    src = (item.get("source_post_urls") or [None])[0]
    if not (cur.get("source_url") or "").strip() and src:
        patch["source_url"] = src
    if len(patch) <= 1:
        return
    c.patch("professionals", {"id": f"eq.{keep_id}"}, patch)


def fill_empty_business(c: SupabaseRest, keep_id: str, item: dict[str, Any]) -> None:
    rows = (
        c._request(
            "GET",
            "/businesses",
            params={
                "select": "id,phone,website,instagram_url,city,address_line,source_url",
                "id": f"eq.{keep_id}",
                "limit": "1",
            },
        )
        or []
    )
    if not rows:
        return
    cur = rows[0]
    phones = [p for p in (item.get("phones") or []) if isinstance(p, str)]
    igs = [x for x in (item.get("instagram") or []) if isinstance(x, str)]
    webs = [w for w in (item.get("websites") or []) if isinstance(w, str)]
    patch: dict[str, Any] = {}
    phone = first_phone(phones)
    website = plain_website(webs)
    instagram = ig_url(igs)
    if not (cur.get("phone") or "").strip() and phone:
        patch["phone"] = phone
    if not (cur.get("website") or "").strip() and website:
        patch["website"] = website
    if not (cur.get("instagram_url") or "").strip() and instagram:
        patch["instagram_url"] = instagram
    if not (cur.get("city") or "").strip() and (item.get("city") or "").strip():
        patch["city"] = item["city"].strip()
    src = (item.get("source_post_urls") or [None])[0]
    if not (cur.get("source_url") or "").strip() and src:
        patch["source_url"] = src
    if not patch:
        return
    c.patch("businesses", {"id": f"eq.{keep_id}"}, patch)


def bump_counts(c: SupabaseRest, entity_type: str, keep_id: str, item: dict[str, Any]) -> None:
    table = "professionals" if entity_type == "professional" else "businesses"
    rows = (
        c._request(
            "GET",
            f"/{table}",
            params={
                "select": "id,third_party_mention_count,self_ad_mention_count",
                "id": f"eq.{keep_id}",
                "limit": "1",
            },
        )
        or []
    )
    if not rows:
        return
    cur = rows[0]
    add_third = third(item)
    add_self = self_ad(item)
    third_inc = add_third if add_third > 0 else (0 if add_self > 0 else 1)
    patch: dict[str, Any] = {
        "third_party_mention_count": max(0, int(cur.get("third_party_mention_count") or 0))
        + third_inc,
        "self_ad_mention_count": max(0, int(cur.get("self_ad_mention_count") or 0)) + add_self,
    }
    if entity_type == "professional":
        patch["updated_at"] = now_iso()
    c.patch(table, {"id": f"eq.{keep_id}"}, patch)


def insert_mention(c: SupabaseRest, entity_type: str, keep_id: str, item: dict[str, Any]) -> None:
    src = (item.get("source_post_urls") or [None])[0]
    src = src.strip() if isinstance(src, str) and src.strip() else None
    add_self = self_ad(item)
    add_third = third(item)
    kind = (
        "community_mention"
        if add_self > 0 and add_third <= 0
        else "third_party_recommendation"
    )
    label = None
    groups = item.get("source_groups") or []
    if groups and isinstance(groups[0], str):
        label = groups[0]
    elif item.get("directory_source"):
        label = item["directory_source"]

    if entity_type == "professional":
        existing = (
            c._request(
                "GET",
                "/professional_community_mentions",
                params={
                    "select": "id",
                    "professional_id": f"eq.{keep_id}",
                    "source_record_id": f"eq.{item['id']}",
                    "limit": "1",
                },
            )
            or []
        )
        if existing:
            return
        c._request(
            "POST",
            "/professional_community_mentions",
            body={
                "professional_id": keep_id,
                "kind": kind if kind != "community_mention" else "self_ad",
                "source_channel": source_channel(item),
                "source_label": label,
                "source_url": src,
                "source_record_id": item["id"],
                "status": "published",
                "published_at": now_iso(),
            },
            prefer="return=minimal",
        )
        return

    existing = (
        c._request(
            "GET",
            "/business_community_mentions",
            params={
                "select": "id",
                "business_id": f"eq.{keep_id}",
                "source_record_id": f"eq.{item['id']}",
                "limit": "1",
            },
        )
        or []
    )
    if existing:
        return
    authors = item.get("recommender_names") or []
    author = authors[0] if authors and isinstance(authors[0], str) else None
    c._request(
        "POST",
        "/business_community_mentions",
        body={
            "business_id": keep_id,
            "kind": kind,
            "source_channel": source_channel(item),
            "source_label": label,
            "source_url": src,
            "source_record_id": item["id"],
            "snippet": snippet_from(item),
            "author_label": author,
            "status": "published",
            "published_at": now_iso(),
        },
        prefer="return=minimal",
    )


def mark_merged(c: SupabaseRest, item: dict[str, Any], live: dict[str, Any]) -> None:
    c.patch(
        "import_comment_recommendations",
        {"id": f"eq.{item['id']}"},
        {
            "status": "merged",
            "published_entity_type": live["type"],
            "published_entity_id": live["id"],
            "duplicate_of_entity_type": live["type"],
            "duplicate_of_entity_id": live["id"],
            "duplicate_confidence": "confirmed",
            "duplicate_reason": (live["reason"] or f"merged_into:{live['slug']}")[:240],
        },
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    load_env()
    c = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    recs = fetch_all(
        c,
        "/import_comment_recommendations",
        "id,status,display_name,third_party_mention_count,self_ad_mention_count,"
        "phones,instagram,websites,city,source_channel,directory_source,"
        "source_groups,source_post_urls,comment_texts,request_snippets,recommender_names",
        {"status": "in.(pending,suspected_duplicate)"},
    )
    third_recs = [r for r in recs if third(r) > 0]
    biz = fetch_all(
        c,
        "/businesses",
        "id,slug,name,phone,instagram_url,website,third_party_mention_count",
        {"status": "eq.approved"},
    )
    pro = fetch_all(
        c,
        "/professionals",
        "id,slug,display_name,phone,instagram_url,website,third_party_mention_count",
        {"status": "eq.approved"},
    )
    idx = build_indexes(biz, pro)

    plan: list[tuple[dict, dict]] = []
    skipped = 0
    for r in third_recs:
        live = match_live(r, idx)
        if not live:
            skipped += 1
            continue
        plan.append((r, live))

    if args.limit > 0:
        plan = plan[: args.limit]

    by_target: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"units": 0, "cards": 0, "live": None, "recs": []}
    )
    for r, live in plan:
        key = f"{live['type']}/{live['slug']}"
        g = by_target[key]
        g["units"] += third(r)
        g["cards"] += 1
        g["live"] = live
        g["recs"].append(r["id"])

    print(
        f"third-party pending/suspected: {len(third_recs)}; "
        f"mergeable: {len(plan)}; no live match: {skipped}"
    )
    print(f"unique live targets: {len(by_target)}")
    for key, g in sorted(by_target.items(), key=lambda kv: (-kv[1]["units"], kv[0])):
        live = g["live"]
        print(
            f"  → /{key}  +{g['units']} rec  ({g['cards']} cards, via {live['reason']})"
        )

    out = {
        "mode": "apply" if args.apply else "dry_run",
        "mergeable_cards": len(plan),
        "targets": [
            {
                "path": key,
                "units": g["units"],
                "cards": g["cards"],
                "reason": g["live"]["reason"],
                "entity_id": g["live"]["id"],
                "rec_ids": g["recs"],
            }
            for key, g in sorted(
                by_target.items(), key=lambda kv: (-kv[1]["units"], kv[0])
            )
        ],
    }
    out_path = Path("docs/audits/data/merge_third_party_into_live_latest.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out_path}")

    if not args.apply:
        print("Dry-run only. Re-run with --apply to merge.")
        return 0

    ok = 0
    err = 0
    for r, live in plan:
        try:
            if live["type"] == "professional":
                fill_empty_professional(c, live["id"], r)
            else:
                fill_empty_business(c, live["id"], r)
            bump_counts(c, live["type"], live["id"], r)
            insert_mention(c, live["type"], live["id"], r)
            mark_merged(c, r, live)
            ok += 1
            print(
                f"MERGED {r['id'][:8]} «{r.get('display_name')}» "
                f"+{third(r)} → /{live['type']}/{live['slug']}"
            )
        except Exception as e:
            err += 1
            print(f"FAIL {r['id'][:8]} «{r.get('display_name')}»: {e}")

    print(f"Done. ok={ok} err={err}")
    return 0 if err == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
