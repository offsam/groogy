#!/usr/bin/env python3
"""LLM / heuristic card_summary for professional listing cards.

Writes a 1–2 line Russian pitch (what they offer) — not a raw post quote.

Usage:
  python3 scripts/business-enrich/summarize_professional_cards.py --dry-run --limit 20
  python3 scripts/business-enrich/summarize_professional_cards.py --apply
  python3 scripts/business-enrich/summarize_professional_cards.py --apply --force
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "professional_card_summaries"
OUT.mkdir(parents=True, exist_ok=True)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
# Cheap allowlist — same spirit as server search models
MODELS = [
    "openai/gpt-4.1-nano",
    "google/gemini-2.5-flash-lite",
    "amazon/nova-micro-v1",
]

SYSTEM = """Ты пишешь короткую презентацию услуги для карточки каталога КРУГИ.
Правила:
- 1 предложение, максимум 110 символов, на русском
- Скажи ЧТО предлагают (услуга / товар / акция), без приветствий
- Можно указать цену «от $N» или скидку «до N%», если они есть в тексте
- НЕ цитируй пост дословно и не копируй «всем привет»
- Не выдумывай услуги, которых нет в тексте
- Если это реклама вина со скидкой — напиши вроде «Вино со скидкой до 70%»
- Если это няня/садик — «Домашний детский сад» или «Няня»
- Если непонятно, что предлагают — верни пустую строку
Ответ: только текст презентации, без кавычек и пояснений."""


def empty(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def blob(pro: dict[str, Any]) -> str:
    return "\n".join(
        str(x)
        for x in (
            pro.get("display_name"),
            pro.get("headline"),
            pro.get("short_description"),
            pro.get("description"),
            pro.get("category_slug"),
        )
        if x
    ).strip()


def heuristic_summary(text: str) -> str | None:
    low = text.lower()
    # Wine promo
    if re.search(r"винн|вино|last\s*bottle|wine", low):
        nums = [int(x) for x in re.findall(r"(\d{1,2})\s*%", text)]
        if nums:
            return f"Вино со скидкой до {max(nums)}%"
        return "Вино со скидкой"
    # Massage + price
    if "массаж" in low:
        pm = re.search(r"\$\s*(\d{1,4})|(\d{1,4})\s*\$", text)
        if pm:
            return f"Массаж от ${pm.group(1) or pm.group(2)}"
        return "Массаж"
    if re.search(r"сброс\w*\s+.*вес|похуд", low):
        return "Помогу сбросить лишний вес"
    if re.search(r"домашн\w*\s+детск\w*\s+сад|свой\s+садик", low):
        return "Домашний детский сад"
    if re.search(r"маникюр", low):
        pm = re.search(r"\$\s*(\d{1,4})|(\d{1,4})\s*\$", text)
        if pm:
            return f"Маникюр от ${pm.group(1) or pm.group(2)}"
        return "Маникюр"
    if re.search(r"английск|инглиш|english", low):
        return "Уроки английского"
    if re.search(r"аренд\w*.{0,30}(авто|машин|prius|toyota|tesla)", low):
        return "Аренда авто"
    if re.search(r"беременн|newborn", low) and re.search(r"фото|съ[её]мк", low):
        pm = re.search(r"\$\s*(\d{1,4})|(\d{1,4})\s*\$", text)
        if pm:
            return f"Фотосъёмка беременности и newborn от ${pm.group(1) or pm.group(2)}"
        return "Фотосъёмка беременности и newborn"
    return None


def llm_summary(text: str, api_key: str) -> str | None:
    payload = {
        "model": MODELS[0],
        "temperature": 0.2,
        "max_tokens": 80,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": f"Текст объявления:\n{text[:2500]}",
            },
        ],
    }
    last_err: Exception | None = None
    for model in MODELS:
        payload["model"] = model
        req = urllib.request.Request(
            OPENROUTER_URL,
            method="POST",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://krugi.app",
                "X-Title": "KRUGI professional card summary",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            content = (
                ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
                or ""
            ).strip()
            content = content.strip(" «»\"'")
            content = re.sub(r"\s+", " ", content)
            if not content or content.lower() in {"пустая строка", "нет", "n/a", "-"}:
                return None
            if len(content) > 140:
                content = content[:137].rstrip(" ,.;:") + "…"
            # Reject greetings / raw dumps
            if re.match(r"^(всем\s+)?привет", content, re.I):
                return None
            return content
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            time.sleep(0.4)
            continue
    if last_err:
        print(f"llm_error: {type(last_err).__name__}", file=sys.stderr)
    return None


def needs_summary(pro: dict[str, Any], force: bool) -> bool:
    if force:
        return True
    cur = (pro.get("card_summary") or "").strip()
    if cur and len(cur) >= 8:
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--heuristic-only", action="store_true")
    args = parser.parse_args()
    apply = bool(args.apply) and not args.dry_run

    load_env()
    api_key = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if not args.heuristic_only and not api_key:
        print("OPENROUTER_API_KEY missing — falling back to heuristic-only", file=sys.stderr)
        args.heuristic_only = True

    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    pros: list[dict[str, Any]] = []
    last = None
    while True:
        params: dict[str, str] = {
            "select": (
                "id,slug,display_name,headline,short_description,description,"
                "card_summary,category_id,status"
            ),
            "status": "eq.approved",
            "order": "id.asc",
            "limit": "200",
        }
        if last:
            params["id"] = f"gt.{last}"
        batch = client._request("GET", "/professionals", params=params) or []
        if not batch:
            break
        pros.extend(batch)
        last = batch[-1]["id"]
        if args.limit and len(pros) >= args.limit:
            pros = pros[: args.limit]
            break
        if len(batch) < 200:
            break

    # category slug map
    cats = {
        r["id"]: r.get("slug")
        for r in (
            client._request(
                "GET",
                "/categories",
                params={"select": "id,slug", "limit": "200"},
            )
            or []
        )
    }
    for p in pros:
        p["category_slug"] = cats.get(p.get("category_id"))

    updated = 0
    samples: list[dict[str, Any]] = []
    for pro in pros:
        if not needs_summary(pro, args.force):
            continue
        text = blob(pro)
        if len(text) < 12:
            continue
        summary = heuristic_summary(text)
        source = "heuristic"
        if not summary and not args.heuristic_only:
            summary = llm_summary(text, api_key)
            source = "llm"
            time.sleep(0.15)
        if not summary:
            continue
        updated += 1
        if len(samples) < 30:
            samples.append(
                {
                    "slug": pro.get("slug"),
                    "name": pro.get("display_name"),
                    "summary": summary,
                    "source": source,
                }
            )
        if apply:
            client._request(
                "PATCH",
                f"/professionals?id=eq.{pro['id']}",
                body={"card_summary": summary},
            )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if apply else "dry-run",
        "scanned": len(pros),
        "updated": updated,
        "samples": samples,
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({**report, "report": str(path)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
