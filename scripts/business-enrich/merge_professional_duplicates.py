#!/usr/bin/env python3
"""Merge duplicate professionals into one card + extract services from ad posts.

High-confidence clusters only:
  - same Instagram / phone / email
  - same long unique display_name + same city

Short first names without a shared contact are left alone.

Usage:
  python3 scripts/business-enrich/merge_professional_duplicates.py --dry-run
  python3 scripts/business-enrich/merge_professional_duplicates.py --apply
"""

from __future__ import annotations

import argparse
import json
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

OUT = Path(__file__).resolve().parent / "data" / "merge_professionals"
OUT.mkdir(parents=True, exist_ok=True)

BATCH_ID = "merge_professional_duplicates_v1"

SPECIALTY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"психолог|гипнотерапевт|телесно[- ]?ориентир", re.I), "Психолог"),
    (re.compile(r"массаж|spa|пилинг|ароматерап", re.I), "Массаж и SPA"),
    (re.compile(r"маникюр|педикюр|nails?", re.I), "Маникюр / педикюр"),
    (re.compile(r"брови|бров", re.I), "Брови"),
    (re.compile(r"ресниц|lash", re.I), "Ресницы"),
    (re.compile(r"парикмахер|стрижк|окрашив|hair", re.I), "Парикмахер"),
    (re.compile(r"визаж|makeup|макияж", re.I), "Визажист"),
    (re.compile(r"косметолог", re.I), "Косметолог"),
    (re.compile(r"репетитор|tutor", re.I), "Репетитор"),
    (re.compile(r"фотограф|photograph", re.I), "Фотограф"),
    (re.compile(r"няня|сиделк", re.I), "Няня / сиделка"),
    (re.compile(r"тренер|фитнес|yoga|йога", re.I), "Тренер"),
    (re.compile(r"риелтор|риэлтор|недвижим|realtor", re.I), "Риелтор"),
    (re.compile(r"юрист|адвокат|lawyer", re.I), "Юрист"),
    (re.compile(r"бухгалтер|accountant", re.I), "Бухгалтер"),
]

SERVICE_TITLE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"spa\s*уход|spa[- ]?процедур", re.I), "SPA-уход"),
    (re.compile(r"пилинг", re.I), "Пилинг тела"),
    (re.compile(r"антистресс", re.I), "Антистресс-массаж"),
    (re.compile(r"массаж", re.I), "Массаж"),
    (re.compile(r"маникюр", re.I), "Маникюр"),
    (re.compile(r"педикюр", re.I), "Педикюр"),
    (re.compile(r"ресниц|lash", re.I), "Ресницы"),
    (re.compile(r"брови", re.I), "Брови"),
    (re.compile(r"окрашив|колорир", re.I), "Окрашивание"),
    (re.compile(r"стрижк", re.I), "Стрижка"),
    (re.compile(r"макияж|makeup", re.I), "Макияж"),
    (re.compile(r"консультац", re.I), "Консультация"),
    (re.compile(r"сеанс|терапи", re.I), "Сеанс терапии"),
]

SOURCE_NOISE_RE = re.compile(
    r"(?:^|\n)\s*Источник\s*:\s*.+$"
    r"|(?:^|\n)\s*Контакты\s*:\s*.+$"
    r"|(?:^|\n)\s*Telegram\s*:\s*@\S+",
    re.I | re.M,
)
EMOJI_HEAVY_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002700-\U000027BF"
    "\U0001F1E0-\U0001F1FF"
    "]+",
)
PRICE_RE = re.compile(
    r"(?:от\s*)?\$?\s*(\d{2,4})\s*\$?"
    r"|\b(\d{2,4})\s*(?:\$|usd|доллар)",
    re.I,
)
FROM_PRICE_RE = re.compile(r"от\s*\$?\s*(\d{2,4})", re.I)
PROMO_LINE_RE = re.compile(
    r"окошко|ищу модель|сегодня после|завтра|скидк|приветствую|"
    r"девочки|друзья\s*,|пишите в личку|место на",
    re.I,
)


def norm_name(s: str | None) -> str:
    raw = (s or "").lower().replace("ё", "е")
    raw = re.sub(r"[^a-zа-я0-9]+", " ", raw, flags=re.I)
    return re.sub(r"\s+", " ", raw).strip()


def norm_phone(s: str | None) -> str | None:
    digits = re.sub(r"\D", "", s or "")
    if len(digits) >= 10:
        return digits[-10:]
    return digits if len(digits) >= 7 else None


def norm_email(s: str | None) -> str | None:
    v = (s or "").strip().lower()
    return v or None


def norm_url(s: str | None) -> str | None:
    if not s or not str(s).strip():
        return None
    raw = str(s).strip()
    try:
        if "://" not in raw:
            raw = "https://" + raw
        u = urlparse(raw)
        host = (u.hostname or "").lower().removeprefix("www.")
        path = (u.path or "").rstrip("/")
        key = f"{host}{path}".lower()
        return key or None
    except Exception:
        return raw.lower().strip() or None


def is_ugly_slug(slug: str) -> bool:
    return bool(re.match(r"^business-biz-", slug or "")) or bool(
        re.match(r"^pro-[a-f0-9]{8,}$", slug or "")
    )


def name_token_count(name: str) -> int:
    return len([t for t in norm_name(name).split() if t])


def is_long_unique_name(name: str) -> bool:
    """Long specialty-style names (Диана Калифорнийская …) vs short first names."""
    tokens = name_token_count(name)
    if tokens >= 3:
        return True
    n = norm_name(name)
    # Two-word full names: Anna Ahmatova, Yana Shvedova, Ирина Кундухова
    if tokens == 2 and len(n) >= 10:
        return True
    if pick_specialty(name) and tokens >= 2:
        return True
    return False


def clean_ad_text(text: str | None) -> str:
    if not text:
        return ""
    t = SOURCE_NOISE_RE.sub("", text)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t


def pick_specialty(*texts: str | None) -> str | None:
    blob = " ".join(t for t in texts if t)
    for pat, label in SPECIALTY_PATTERNS:
        if pat.search(blob):
            return label
    return None


def extract_price(text: str) -> tuple[str, float | None, float | None, float | None]:
    """Return price_mode, amount, min, max."""
    if not text:
        return "contact", None, None, None
    m_from = FROM_PRICE_RE.search(text)
    if m_from:
        return "from", float(m_from.group(1)), None, None
    amounts: list[float] = []
    for m in PRICE_RE.finditer(text):
        g = m.group(1) or m.group(2)
        if g:
            n = float(g)
            if 15 <= n <= 2000:
                amounts.append(n)
    if not amounts:
        return "contact", None, None, None
    if len(amounts) >= 2 and abs(amounts[0] - amounts[1]) > 1:
        lo, hi = sorted(amounts[:2])
        return "range", None, lo, hi
    return "fixed", amounts[0], None, None


def service_title_from_text(text: str, fallback_name: str) -> str:
    for pat, label in SERVICE_TITLE_PATTERNS:
        if pat.search(text):
            return label
    # First non-promo line
    for line in text.splitlines():
        line = EMOJI_HEAVY_RE.sub("", line).strip(" .,-—•*")
        if len(line) < 8:
            continue
        if PROMO_LINE_RE.search(line):
            continue
        if re.fullmatch(r"[\W\d]+", line):
            continue
        return line[:60]
    # Fallback: specialty or short name
    spec = pick_specialty(text, fallback_name)
    if spec:
        return spec
    return (fallback_name or "Услуга")[:60]


def is_promo_heavy(text: str) -> bool:
    if not text:
        return True
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return True
    promo = sum(1 for ln in lines if PROMO_LINE_RE.search(ln))
    return promo >= max(1, len(lines) // 2)


def pick_bio(rows: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """Pick short_description + description that look least like a one-day promo."""
    candidates: list[tuple[int, str, str]] = []
    for r in rows:
        desc = clean_ad_text(r.get("description") or r.get("short_description") or "")
        short = clean_ad_text(r.get("short_description") or "")
        if not desc and not short:
            continue
        body = desc or short
        score = len(body)
        if is_promo_heavy(body):
            score -= 400
        if pick_specialty(body):
            score += 80
        if r.get("phone") or r.get("instagram_url"):
            score += 40
        candidates.append((score, short[:280] if short else body[:280], body[:8000]))
    if not candidates:
        return None, None
    candidates.sort(key=lambda x: x[0], reverse=True)
    _, short, desc = candidates[0]
    # If bio is still promo-heavy, keep a tighter short blurb
    if is_promo_heavy(desc):
        spec = pick_specialty(*(r.get("display_name") for r in rows), desc)
        short = spec or short[:120]
    return short or None, desc or None


def richness_score(row: dict[str, Any]) -> int:
    score = 0
    for key in ("phone", "email", "website", "instagram_url", "image_url"):
        if row.get(key) and str(row[key]).strip() and str(row[key]) != "/placeholder.svg":
            score += 10
    for key in ("description", "short_description", "headline"):
        score += min(len(str(row.get(key) or "")), 500) // 20
    slug = row.get("slug") or ""
    if is_ugly_slug(slug):
        score -= 40
    else:
        score += 30
    if row.get("published_at"):
        score += 2
    return score


def choose_keeper(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return max(
        rows,
        key=lambda r: (
            richness_score(r),
            0 if is_ugly_slug(r.get("slug") or "") else 1,
            len(str(r.get("description") or "")),
        ),
    )


def merge_contact_fields(rows: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in (
        "phone",
        "email",
        "website",
        "instagram_url",
        "image_url",
        "city",
        "region",
        "state_code",
        "service_area_text",
        "private_address_line",
        "source_url",
    ):
        for r in rows:
            v = r.get(key)
            if v is None:
                continue
            if isinstance(v, str) and (not v.strip() or v == "/placeholder.svg"):
                continue
            out[key] = v
            break
    return out


def service_dedupe_key(title: str, mode: str, amount: float | None) -> str:
    t = norm_name(title)
    return f"{t}|{mode}"


def build_services_from_rows(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    services: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in rows:
        raw = clean_ad_text(
            r.get("description") or r.get("short_description") or r.get("headline") or ""
        )
        if len(raw) < 20:
            continue
        title = service_title_from_text(raw, r.get("display_name") or "Услуга")
        mode, amount, pmin, pmax = extract_price(raw)
        key = service_dedupe_key(title, mode, amount if mode == "fixed" else pmin)
        if key in seen:
            continue
        seen.add(key)
        services.append(
            {
                "title": title,
                "description": raw[:2000],
                "offer_kind": "service",
                "price_mode": mode,
                "price_amount": amount,
                "price_min": pmin,
                "price_max": pmax,
                "currency": "USD",
                "is_active": True,
            }
        )
    return services


def fetch_all_professionals(client: SupabaseRest) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    page = 500
    while True:
        chunk = client._request(
            "GET",
            "/professionals",
            params={
                "select": (
                    "id,slug,display_name,headline,short_description,description,"
                    "image_url,phone,email,website,instagram_url,city,region,state_code,"
                    "service_area_text,private_address_line,source_url,status,visibility,"
                    "published_at,created_at,import_batch_id"
                ),
                "status": "eq.approved",
                "visibility": "eq.public",
                "order": "created_at.asc",
                "limit": str(page),
                "offset": str(offset),
            },
        )
        if not isinstance(chunk, list) or not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def union_find_clusters(n: int, edges: list[tuple[int, int]]) -> list[list[int]]:
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for a, b in edges:
        union(a, b)

    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(i)
    return [g for g in groups.values() if len(g) > 1]


def build_clusters(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    n = len(rows)
    edges: list[tuple[int, int]] = []

    def add_group(indices: list[int]) -> None:
        if len(indices) < 2:
            return
        root = indices[0]
        for i in indices[1:]:
            edges.append((root, i))

    by_phone: dict[str, list[int]] = defaultdict(list)
    by_email: dict[str, list[int]] = defaultdict(list)
    by_ig: dict[str, list[int]] = defaultdict(list)
    by_name_city: dict[str, list[int]] = defaultdict(list)
    by_name_strong: dict[str, list[int]] = defaultdict(list)

    for i, r in enumerate(rows):
        ph = norm_phone(r.get("phone"))
        if ph:
            by_phone[ph].append(i)
        em = norm_email(r.get("email"))
        if em:
            by_email[em].append(i)
        ig = norm_url(r.get("instagram_url"))
        if ig:
            by_ig[ig].append(i)
        name = r.get("display_name") or ""
        nkey = norm_name(name)
        if is_long_unique_name(name):
            city = norm_name(r.get("city"))
            by_name_city[f"{nkey}@@{city}"].append(i)
            # Very distinctive names (3+ tokens or specialty in name): merge across cities
            if name_token_count(name) >= 3 or pick_specialty(name):
                by_name_strong[nkey].append(i)

    for mapping in (by_phone, by_email, by_ig, by_name_city, by_name_strong):
        for idxs in mapping.values():
            add_group(idxs)

    clusters_idx = union_find_clusters(n, edges)
    return [[rows[i] for i in idxs] for idxs in clusters_idx]


def plan_cluster(members: list[dict[str, Any]]) -> dict[str, Any]:
    keeper = choose_keeper(members)
    siblings = [m for m in members if m["id"] != keeper["id"]]
    contacts = merge_contact_fields(members)
    short, desc = pick_bio(members)
    services = build_services_from_rows(members)
    specialty = pick_specialty(
        *(m.get("description") for m in members),
        *(m.get("short_description") for m in members),
        *(m.get("headline") for m in members),
        keeper.get("display_name"),
        *(m.get("display_name") for m in members),
    )
    # Prefer specialty implied by extracted services over name-dump keywords
    service_blob = " ".join(
        s["title"] + " " + (s.get("description") or "") for s in services
    )
    service_specialty = pick_specialty(service_blob)
    if service_specialty:
        specialty = service_specialty
    patch = {
        **contacts,
        "headline": specialty or (keeper.get("headline") or "")[:160] or None,
        "short_description": short,
        "description": desc,
        "import_batch_id": BATCH_ID,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Prefer a cleaner display_name: shortest among long unique ones that share norm
    names = sorted(
        {m.get("display_name") or "" for m in members if m.get("display_name")},
        key=lambda s: (len(s), s),
    )
    if names:
        cleaned = [re.split(r"\s*\|\s*", n)[0].strip() or n for n in names]
        display = min(cleaned, key=lambda s: (len(s), s))
        patch["display_name"] = display[:200]

    return {
        "keeper_id": keeper["id"],
        "keeper_slug": keeper["slug"],
        "keeper_name": keeper.get("display_name"),
        "reason": "high_confidence_duplicate",
        "member_count": len(members),
        "archive_ids": [s["id"] for s in siblings],
        "archive_slugs": [s["slug"] for s in siblings],
        "patch": patch,
        "services": services,
        "members": [
            {
                "id": m["id"],
                "slug": m["slug"],
                "display_name": m.get("display_name"),
                "city": m.get("city"),
                "score": richness_score(m),
            }
            for m in sorted(members, key=richness_score, reverse=True)
        ],
    }


def apply_plan(client: SupabaseRest, plan: dict[str, Any]) -> dict[str, Any]:
    kid = plan["keeper_id"]
    patch = {k: v for k, v in plan["patch"].items() if v is not None}
    client.patch("professionals", {"id": f"eq.{kid}"}, patch)

    # Replace active services on keeper with merged set
    existing = client._request(
        "GET",
        "/professional_services",
        params={
            "select": "id",
            "professional_id": f"eq.{kid}",
            "is_active": "eq.true",
            "limit": "500",
        },
    )
    if isinstance(existing, list) and existing:
        for row in existing:
            client.patch(
                "professional_services",
                {"id": f"eq.{row['id']}"},
                {"is_active": False},
            )

    created = 0
    for i, svc in enumerate(plan["services"]):
        body = {
            **svc,
            "professional_id": kid,
            "sort_order": i,
        }
        client.insert_many("professional_services", [body])
        created += 1

    archived = 0
    for sid in plan["archive_ids"]:
        client.patch(
            "professionals",
            {"id": f"eq.{sid}"},
            {
                "status": "archived",
                "visibility": "private",
                "archived_at": datetime.now(timezone.utc).isoformat(),
                "import_batch_id": BATCH_ID,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        archived += 1

    return {
        "keeper_id": kid,
        "services_created": created,
        "archived": archived,
    }


def also_backfill_singles(
    client: SupabaseRest,
    rows: list[dict[str, Any]],
    clustered_ids: set[str],
    *,
    apply: bool,
) -> list[dict[str, Any]]:
    """For non-duplicated pros with empty services, extract one service from own ad text."""
    report: list[dict[str, Any]] = []
    # Which already have services?
    existing_pro_ids: set[str] = set()
    offset = 0
    while True:
        chunk = client._request(
            "GET",
            "/professional_services",
            params={
                "select": "professional_id",
                "is_active": "eq.true",
                "limit": "1000",
                "offset": str(offset),
            },
        )
        if not isinstance(chunk, list) or not chunk:
            break
        for row in chunk:
            existing_pro_ids.add(row["professional_id"])
        if len(chunk) < 1000:
            break
        offset += 1000

    for r in rows:
        if r["id"] in clustered_ids or r["id"] in existing_pro_ids:
            continue
        services = build_services_from_rows([r])
        if not services:
            continue
        # Only backfill when text looks like an offer (has price or service keyword)
        raw = clean_ad_text(r.get("description") or r.get("short_description") or "")
        has_signal = bool(PRICE_RE.search(raw)) or any(
            p.search(raw) for p, _ in SERVICE_TITLE_PATTERNS
        )
        if not has_signal:
            continue
        item = {
            "id": r["id"],
            "slug": r["slug"],
            "services": services[:5],
        }
        report.append(item)
        if apply:
            specialty = pick_specialty(
                r.get("display_name"), r.get("headline"), r.get("description")
            )
            patch: dict[str, Any] = {"import_batch_id": BATCH_ID}
            if specialty and (
                not r.get("headline")
                or len(str(r.get("headline") or "")) > 80
                or is_promo_heavy(str(r.get("headline") or ""))
            ):
                patch["headline"] = specialty
            if patch:
                client.patch("professionals", {"id": f"eq.{r['id']}"}, patch)
            for i, svc in enumerate(services[:5]):
                client.insert_many(
                    "professional_services",
                    [{**svc, "professional_id": r["id"], "sort_order": i}],
                )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--skip-singles", action="store_true")
    args = parser.parse_args()
    apply = bool(args.apply)
    if apply:
        args.dry_run = False

    load_env()
    import os

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    rows = fetch_all_professionals(client)
    clusters = build_clusters(rows)
    plans = [plan_cluster(c) for c in clusters]
    plans.sort(key=lambda p: p["member_count"], reverse=True)

    clustered_ids: set[str] = set()
    for p in plans:
        clustered_ids.add(p["keeper_id"])
        clustered_ids.update(p["archive_ids"])

    apply_results = []
    if apply:
        for p in plans:
            apply_results.append(apply_plan(client, p))

    singles: list[dict[str, Any]] = []
    if not args.skip_singles:
        singles = also_backfill_singles(
            client, rows, clustered_ids, apply=apply
        )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if apply else "dry-run",
        "batch_id": BATCH_ID,
        "total_approved": len(rows),
        "cluster_count": len(plans),
        "rows_to_archive": sum(len(p["archive_ids"]) for p in plans),
        "services_from_merges": sum(len(p["services"]) for p in plans),
        "singles_backfill": len(singles),
        "clusters": plans,
        "singles": singles,
        "apply_results": apply_results,
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = OUT / f"{'apply' if apply else 'dry_run'}_{stamp}.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    latest = OUT / ("apply_latest.json" if apply else "dry_run_latest.json")
    latest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "mode": report["mode"],
                "total_approved": report["total_approved"],
                "cluster_count": report["cluster_count"],
                "rows_to_archive": report["rows_to_archive"],
                "services_from_merges": report["services_from_merges"],
                "singles_backfill": report["singles_backfill"],
                "report": str(out_path),
                "top": [
                    {
                        "name": p["keeper_name"],
                        "slug": p["keeper_slug"],
                        "members": p["member_count"],
                        "services": len(p["services"]),
                        "archive": len(p["archive_ids"]),
                    }
                    for p in plans[:15]
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
