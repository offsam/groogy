#!/usr/bin/env python3
"""Attach comment/provider recommendations onto real business cards.

Parses demand-lead style copy:
  Potential providers found in comments:
  - CaliBuilders — 949-345-1118
  - Russ Flooring — russflooring.net

Creates public.business_community_mentions rows (fill / dedupe by source_record_id).

Usage:
  python3 scripts/business-enrich/backfill_community_mentions.py
  python3 scripts/business-enrich/backfill_community_mentions.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import load_env  # noqa: E402

PROVIDERS_BLOCK_RE = re.compile(
    r"(?:potential\s+providers\s+found\s+in\s+comments|providers\s+found\s+in\s+comments|"
    r"рекомендаци[яи]\s+в\s+комментари|в\s+комментариях\s+рекоменд)\s*:?\s*",
    re.I,
)
PROVIDER_LINE_RE = re.compile(
    r"^[-–—*•]\s*(.+?)(?:\s*[—–\-·|]\s*(.+))?$"
)
PHONE_RE = re.compile(r"(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})")
HOST_RE = re.compile(
    r"(?:https?://)?(?:www\.)?([a-z0-9][a-z0-9.-]+\.[a-z]{2,})(?:/\S*)?",
    re.I,
)


def rest(
    base: str,
    key: str,
    path: str,
    *,
    method: str = "GET",
    body: dict | list | None = None,
    prefer: str | None = None,
) -> Any:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if prefer:
        headers["Prefer"] = prefer
    req = request.Request(
        f"{base.rstrip('/')}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path}: {exc.code} {detail}") from exc


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return f"+{digits}" if digits else raw


def normalize_host(raw: str) -> str | None:
    m = HOST_RE.search(raw)
    if not m:
        return None
    return m.group(1).lower().removeprefix("www.")


def parse_provider_lines(text: str) -> list[dict[str, str | None]]:
    m = PROVIDERS_BLOCK_RE.search(text)
    if not m:
        return []
    tail = text[m.end() :]
    # stop at next blank section header-ish
    chunk = re.split(r"\n{2,}(?=[A-ZА-Я]|---)", tail, maxsplit=1)[0]
    out: list[dict[str, str | None]] = []
    for line in chunk.splitlines():
        line = line.strip()
        if not line:
            continue
        pm = PROVIDER_LINE_RE.match(line)
        if not pm:
            continue
        name = pm.group(1).strip()
        detail = (pm.group(2) or "").strip() or None
        phone = None
        website_host = None
        if detail:
            ph = PHONE_RE.search(detail)
            if ph:
                phone = normalize_phone(ph.group(0))
            website_host = normalize_host(detail)
        out.append(
            {
                "name": name,
                "detail": detail,
                "phone": phone,
                "website_host": website_host,
                "raw_line": line.lstrip("-–—*• ").strip(),
            }
        )
    return out


def match_business(
    businesses: list[dict[str, Any]], provider: dict[str, str | None]
) -> dict[str, Any] | None:
    name = (provider.get("name") or "").strip().lower()
    phone = provider.get("phone")
    host = provider.get("website_host")

    if phone:
        for b in businesses:
            bp = re.sub(r"\D", "", b.get("phone") or "")
            if bp and bp == re.sub(r"\D", "", phone):
                return b
    if host:
        for b in businesses:
            wh = normalize_host(b.get("website") or "")
            if wh and (wh == host or host in wh or wh in host):
                return b
    if name:
        for b in businesses:
            bn = (b.get("name") or "").strip().lower()
            if not bn:
                continue
            if bn == name or name in bn or bn in name:
                return b
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    load_env()

    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    # Fetch candidates client-side (PostgREST unicode filters are brittle here).
    all_biz = rest(
        url,
        key,
        "/rest/v1/businesses?select=id,slug,name,status,description,short_description,phone,website"
        "&limit=1000",
    )
    assert isinstance(all_biz, list)

    sources = []
    for row in all_biz:
        text = "\n".join(
            p for p in (row.get("description"), row.get("short_description")) if p
        )
        if PROVIDERS_BLOCK_RE.search(text) or row.get("slug") == (
            "fbpack-service-demand-flooring-painting-drywall"
        ):
            sources.append(row)

    targets = [b for b in all_biz if b.get("status") == "approved"]

    planned: list[dict[str, Any]] = []
    for src in sources:
        text = "\n\n".join(
            p for p in (src.get("description"), src.get("short_description")) if p
        )
        providers = parse_provider_lines(text)
        if not providers:
            continue
        for p in providers:
            matched = match_business(targets, p)
            if not matched:
                planned.append(
                    {
                        "source_slug": src["slug"],
                        "provider": p["name"],
                        "matched": None,
                        "skip": "no_match",
                    }
                )
                continue
            if matched["id"] == src["id"]:
                planned.append(
                    {
                        "source_slug": src["slug"],
                        "provider": p["name"],
                        "matched": matched["slug"],
                        "skip": "self",
                    }
                )
                continue
            source_record_id = f"comment-providers:{src['id']}:{matched['id']}"
            snippet = (
                f"Рекомендовали в комментариях к запросу услуг: {p['raw_line']}."
            )
            planned.append(
                {
                    "source_slug": src["slug"],
                    "provider": p["name"],
                    "matched": matched["slug"],
                    "matched_id": matched["id"],
                    "source_record_id": source_record_id,
                    "snippet": snippet,
                    "skip": None,
                }
            )

    report = {
        "mode": "apply" if args.apply else "dry-run",
        "source_cards": len(sources),
        "planned": len([x for x in planned if not x.get("skip")]),
        "unmatched": [x for x in planned if x.get("skip") == "no_match"],
        "sample": [x for x in planned if not x.get("skip")][:20],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not args.apply:
        print("Dry-run only. Re-run with --apply to write.")
        return

    created = skipped = 0
    failures: list[dict[str, str]] = []
    for item in planned:
        if item.get("skip"):
            continue
        existing = rest(
            url,
            key,
            "/rest/v1/business_community_mentions?select=id&source_record_id=eq."
            + parse.quote(item["source_record_id"], safe="")
            + "&limit=1",
        )
        if existing:
            skipped += 1
            continue
        payload = {
            "business_id": item["matched_id"],
            "kind": "comment_recommendation",
            "source_channel": "facebook",
            "source_label": "Рекомендация в комментариях",
            "source_record_id": item["source_record_id"],
            "snippet": item["snippet"],
            "status": "published",
        }
        try:
            rest(
                url,
                key,
                "/rest/v1/business_community_mentions",
                method="POST",
                body=payload,
                prefer="return=minimal",
            )
            created += 1
        except Exception as exc:  # noqa: BLE001
            failures.append({"slug": item["matched"], "error": str(exc)})

    print(
        json.dumps(
            {"created": created, "skipped": skipped, "failures": failures},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
