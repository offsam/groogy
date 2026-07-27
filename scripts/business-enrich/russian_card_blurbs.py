#!/usr/bin/env python3
"""Russian card blurbs + defer businesses with no Cyrillic copy.

Usage:
  python3 scripts/business-enrich/russian_card_blurbs.py --dry-run
  python3 scripts/business-enrich/russian_card_blurbs.py --apply
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

CYR = re.compile(r"[А-Яа-яЁё]")
EMOJI = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0000FE00-\U0000FE0F"
    "\U0000200D"
    "]+",
    flags=re.UNICODE,
)

CATEGORY_BLURB = {
    "restaurants": "Русский ресторан",
    "groceries": "Продукты",
    "beauty": "Салон красоты",
    "auto": "Автосервис",
    "medical": "Медицина",
    "legal": "Юридические услуги",
    "education": "Образование",
    "real_estate": "Недвижимость",
    "fitness": "Спорт и фитнес",
    "pets": "Животные",
    "finance": "Финансы и бухгалтерия",
    "insurance": "Страхование",
    "travel": "Путешествия",
    "events": "Мероприятия",
    "services": "Услуги и быт",
}

# English keyword → short Russian teaser (checked in order)
EN_HINTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"medical\s*spa|med\s*spa|aesthetic|filler|botox|prf", re.I), "Медицинский спа"),
    (re.compile(r"body\s*sculpt|massage|wrap", re.I), "Массаж и коррекция фигуры"),
    (re.compile(r"beauty\s*salon|hair\s*salon|manicure|nails|salon", re.I), "Салон красоты"),
    (re.compile(r"preschool|daycare|school|tutor|education|montessori", re.I), "Образование"),
    (re.compile(r"collision|auto\s*body|car\s*repair|appliance\s*repair|handyman|construction", re.I), "Ремонт и услуги"),
    (re.compile(r"golf\s*cart|auto\s*broker|lease|car\s*rental|ship\s*your\s*car|motors", re.I), "Авто"),
    (re.compile(r"tax|bookkeep|accounting", re.I), "Налоги и бухгалтерия"),
    (re.compile(r"for\s*rent|house\s*for\s*rent|home\s*for\s*rent|apartment|real\s*estate", re.I), "Недвижимость"),
    (re.compile(r"brew|food\s*truck|restaurant|cafe|bakery|sweets", re.I), "Еда и напитки"),
    (re.compile(r"psycholog|therap", re.I), "Психология"),
]


def has_cyr(text: str | None) -> bool:
    return bool(text and CYR.search(text))


def clean(text: str) -> str:
    t = EMOJI.sub(" ", text)
    t = re.sub(r"[*_#`|]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def cyr_ratio(text: str) -> float:
    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", text)
    if not letters:
        return 0.0
    cyr = sum(1 for ch in letters if CYR.match(ch))
    return cyr / len(letters)


def clip_ru(text: str, max_chars: int = 72) -> str | None:
    lines = []
    for part in text.split("\n"):
        line = clean(part)
        if not line or len(line) < 3:
            continue
        if re.match(
            r"^(?:тел|phone|call|whatsapp|telegram|тг|email|instagram|facebook|google|yelp)\b",
            line,
            re.I,
        ):
            continue
        if not has_cyr(line):
            continue
        if cyr_ratio(line) < 0.45:
            continue
        lines.append(line)
    if not lines:
        return None
    sentence = re.split(r"(?<=[.!?…])\s+", lines[0])[0]
    words = sentence.split()
    out = ""
    for w in words[:10]:
        nxt = f"{out} {w}".strip()
        if len(nxt) > max_chars:
            break
        out = nxt
        if len(out.split()) >= 8:
            break
    out = re.sub(r"[,:;·\-—–]+$", "", out).strip()
    if not has_cyr(out) or len(out) < 3 or cyr_ratio(out) < 0.45:
        return None
    return out


def blurb_from_english(blob: str, category_slug: str | None) -> str:
    for pat, label in EN_HINTS:
        if pat.search(blob):
            return label
    return CATEGORY_BLURB.get(category_slug or "", "Русскоязычный бизнес")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    apply = bool(args.apply)
    if not apply and not args.dry_run:
        args.dry_run = True

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    sb = SupabaseRest(url, key)

    rows = (
        sb._request(
            "GET",
            "/businesses",
            params={
                "select": "id,slug,name,short_description,description,status,category_id,categories(slug,name)",
                "status": "eq.approved",
                "limit": "2000",
            },
        )
        or []
    )

    report: dict[str, Any] = {
        "mode": "apply" if apply else "dry_run",
        "rewritten_short": [],
        "deferred_no_russian": [],
    }

    for r in rows:
        cat = r.get("categories") or {}
        cat_slug = cat.get("slug") if isinstance(cat, dict) else None
        cat_name = cat.get("name") if isinstance(cat, dict) else None
        name = r.get("name") or ""
        short = r.get("short_description") or ""
        desc = r.get("description") or ""
        has_ru = has_cyr(name) or has_cyr(short) or has_cyr(desc)

        if not has_ru:
            note = "нет кириллицы в name/short/description — перепроверить русскоязычность"
            item = {
                "id": r["id"],
                "slug": r["slug"],
                "name": name,
                "category": cat_name,
                "note": note,
            }
            report["deferred_no_russian"].append(item)
            print(f"DEFER {r['slug']}: {name[:50]}")
            if apply:
                sb.patch(
                    "businesses",
                    {"id": f"eq.{r['id']}"},
                    {"status": "deferred"},
                )
            continue

        # Already Russian short — keep DB copy; card UI clips for preview.
        if has_cyr(short):
            continue

        # English / empty short — build Russian blurb
        from_desc = clip_ru(desc)
        if from_desc:
            new_short = from_desc
            reason = "from RU description"
        else:
            blob = f"{name}\n{short}\n{desc}"
            new_short = blurb_from_english(blob, cat_slug)
            reason = "from category/EN hints"

        if new_short.strip() == short.strip():
            continue
        report["rewritten_short"].append(
            {
                "slug": r["slug"],
                "from": short[:120] or None,
                "to": new_short,
                "reason": reason,
            }
        )
        print(f"REWRITE {r['slug']}: {new_short!r} ({reason})")
        if apply:
            sb.patch(
                "businesses",
                {"id": f"eq.{r['id']}"},
                {"short_description": new_short},
            )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if apply else "dry_run"
    path = OUT / f"russian_blurbs_{mode}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"rewritten={len(report['rewritten_short'])} "
        f"deferred={len(report['deferred_no_russian'])} → {path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
