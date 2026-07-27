#!/usr/bin/env python3
"""Move hiring text from business descriptions into public.jobs.

Usage:
  python3 scripts/jobs/backfill_business_jobs.py
  python3 scripts/jobs/backfill_business_jobs.py --apply
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import load_env  # noqa: E402

SOURCE_PREFIX = "backfill:description:"

JOB_RE = re.compile(
    r"(?:ваканси|recruitment|hiring|now\s+hiring|we(?:'re|\s+are)?\s+hiring|"
    r"job\s*listing|open\s+position|looking\s+for|"
    r"seeking\s+(?:a\s+)?(?:tech|specialist|master|employee)|"
    r"в\s+поисках|поиск\s+специалист|"
    r"ищ(?:у|ем|ут)\s+(?:опытн\w*\s+)?(?:мастер|сотрудник|работник|специалист|парикмахер|"
    r"маникюр|техник|декоратор|педагог|помощник|helper)|"
    r"требуется\s+(?:мастер|сотрудник|специалист)|"
    r"нуж(?:ен|ны)\s+(?:мастер|специалист|сотрудник)|"
    r"приглашаем\s+(?:мастер|специалист|эксперт|педагог|сотрудник)|"
    r"на\s+работу|compensation\s+package|"
    r"требования\s*:|requirements\s*:|доход\s+от\s*\$|position\s*:)",
    re.I,
)
STRONG_JOB_RE = re.compile(
    r"(?:ваканси|recruitment|hiring|now\s+hiring|job\s*listing|open\s+position|"
    r"looking\s+for|в\s+поисках|поиск\s+специалист|"
    r"ищ(?:у|ем|ут)\s+(?:опытн\w*\s+)?(?:мастер|сотрудник|работник|специалист|техник|"
    r"декоратор|педагог|помощник|helper)|"
    r"требуется\s+(?:мастер|сотрудник|специалист)|нуж(?:ен|ны)\s+(?:мастер|специалист)|"
    r"приглашаем\s+(?:мастер|специалист|эксперт|педагог|сотрудник)|position\s*:|"
    r"live-?in\s+caregiver|house\s+assistant|house\s+repair)",
    re.I,
)

PROMO_RE = re.compile(
    r"(?:скидк|акци[яи]|promo|discount|%\s*off|\$\s*\d+\s*off|"
    r"для\s+новых\s+клиент|first[- ]time\s+client)",
    re.I,
)
SOURCE_FOOTER_RE = re.compile(
    r"(?:^|\n)\s*(?:Источник|Source|Original post)\s*[:：].*$",
    re.I | re.M,
)
FB_ENTITY_MARKER_RE = re.compile(r"\n?---FB_ENTITY_[\w-]+---\s*", re.I)


def strip_fb_entity_dumps(text: str) -> str:
    """Remove ---FB_ENTITY_...--- JSON blobs without eating trailing copy."""
    out: list[str] = []
    i = 0
    while True:
        m = FB_ENTITY_MARKER_RE.search(text, i)
        if not m:
            out.append(text[i:])
            break
        out.append(text[i : m.start()])
        j = m.end()
        if j < len(text) and text[j] == "{":
            depth = 0
            k = j
            while k < len(text):
                ch = text[k]
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        k += 1
                        break
                k += 1
            i = k
        else:
            i = j
    return "".join(out)



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


def classify_block(block: str) -> str:
    t = block.strip()
    if not t:
        return "drop"
    if JOB_RE.search(t):
        return "jobs"
    if PROMO_RE.search(t) and len(t) < 600:
        return "promotions"
    return "about"


def extract_jobs_and_clean(
    description: str | None, short_description: str | None
) -> dict[str, str | None]:
    parts = [p for p in (description, short_description) if p and p.strip()]
    raw = "\n\n".join(parts)
    if not raw.strip():
        return {
            "jobs_text": None,
            "cleaned_description": (description or "").strip() or None,
            "cleaned_short": (short_description or "").strip() or None,
        }

    working = SOURCE_FOOTER_RE.sub("", raw).strip()
    marked_jobs: str | None = None
    marked_promos: str | None = None

    def jobs_repl(m: re.Match[str]) -> str:
        nonlocal marked_jobs
        marked_jobs = m.group(1).strip() or None
        return "\n\n"

    def promos_repl(m: re.Match[str]) -> str:
        nonlocal marked_promos
        marked_promos = m.group(1).strip() or None
        return "\n\n"

    working = re.sub(
        r"<<<JOBS>>>\s*([\s\S]*?)\s*<<<END>>>",
        jobs_repl,
        working,
        flags=re.I,
    )
    working = re.sub(
        r"<<<PROMOS>>>\s*([\s\S]*?)\s*<<<END>>>",
        promos_repl,
        working,
        flags=re.I,
    )
    # Drop embedded FB entity dumps from narrative (keep text after the JSON)
    working = strip_fb_entity_dumps(working).strip()
    working = re.sub(r"\n{3,}", "\n\n", working).strip()

    about_parts: list[str] = []
    job_parts: list[str] = []
    promo_parts: list[str] = []
    for block in [b.strip() for b in re.split(r"\n{2,}", working) if b.strip()]:
        about_lines: list[str] = []
        job_lines: list[str] = []
        for line in block.split("\n"):
            t = line.strip()
            if not t:
                continue
            if JOB_RE.search(t) or t.lower().startswith("recruitment"):
                job_lines.append(t)
            else:
                about_lines.append(t)

        if job_lines:
            job_parts.append("\n".join(job_lines))
        if about_lines:
            about_block = "\n".join(about_lines)
            kind = classify_block(about_block)
            if kind == "about":
                about_parts.append(about_block)
            elif kind == "jobs":
                job_parts.append(about_block)
            elif kind == "promotions":
                promo_parts.append(about_block)
        elif not job_lines:
            kind = classify_block(block)
            if kind == "about":
                about_parts.append(block)
            elif kind == "jobs":
                job_parts.append(block)
            elif kind == "promotions":
                promo_parts.append(block)

    if not about_parts and not job_parts and JOB_RE.search(working):
        job_parts.append(working)

    jobs_text = marked_jobs or ("\n\n".join(job_parts).strip() or None)
    about = "\n\n".join(about_parts).strip()
    promos = marked_promos or ("\n\n".join(promo_parts).strip() or None)

    cleaned_parts: list[str] = []
    if about:
        cleaned_parts.append(about)
    if promos:
        cleaned_parts.append(f"<<<PROMOS>>>\n{promos}\n<<<END>>>")
    cleaned = "\n\n".join(cleaned_parts).strip() or None
    cleaned_short = (about[:280].strip() if about else None) or None

    if not jobs_text:
        return {
            "jobs_text": None,
            "cleaned_description": (description or "").strip() or None,
            "cleaned_short": (short_description or "").strip() or None,
        }

    return {
        "jobs_text": jobs_text,
        "cleaned_description": cleaned,
        "cleaned_short": cleaned_short,
    }


def slugify(title: str) -> str:
    base = re.sub(r"[^\w\s-]", "", title.lower(), flags=re.U)
    base = re.sub(r"[\s_-]+", "-", base.strip())[:48].strip("-") or "job"
    stamp = hex(int(time.time() * 1000))[-4:]
    return f"{base}-{stamp}"


def title_from_jobs(jobs_text: str, business_name: str) -> str:
    weak = re.compile(r"^(requirements|требования)\s*:?\s*$", re.I)
    for line in jobs_text.splitlines():
        cleaned = re.sub(r"^[-–—*•\d.\s]+", "", line).strip()
        cleaned = re.sub(
            r"^(?:recruitment|hiring|job\s*listing|вакансия)\s*[:·\-—]\s*",
            "",
            cleaned,
            flags=re.I,
        )
        cleaned = re.sub(r"\s+", " ", cleaned)
        if weak.match(cleaned):
            continue
        if len(cleaned) >= 12:
            return cleaned[:100] if len(cleaned) <= 100 else cleaned[:97] + "…"
    return f"Вакансия — {business_name}"[:120]


def main() -> None:
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    load_env()

    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    businesses = rest(
        url,
        key,
        "/rest/v1/businesses?select=id,slug,name,description,short_description,city"
        "&status=eq.approved",
    )
    assert isinstance(businesses, list)

    candidates: list[dict[str, Any]] = []
    for biz in businesses:
        extracted = extract_jobs_and_clean(
            biz.get("description"), biz.get("short_description")
        )
        if not extracted["jobs_text"]:
            continue
        text = extracted["jobs_text"]
        # Only clear hiring ads — not generic "требования" / "работа" in service copy
        if not STRONG_JOB_RE.search(text):
            continue
        candidates.append(
            {
                "biz": biz,
                "title": title_from_jobs(extracted["jobs_text"], biz["name"]),
                **extracted,
            }
        )

    report = {
        "mode": "apply" if args.apply else "dry-run",
        "approved_businesses": len(businesses),
        "with_extracted_jobs": len(candidates),
        "sample": [
            {
                "slug": c["biz"]["slug"],
                "name": c["biz"]["name"],
                "title": c["title"],
                "jobs_chars": len(c["jobs_text"] or ""),
            }
            for c in candidates[:20]
        ],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not args.apply:
        print("Dry-run only. Re-run with --apply to write.")
        return

    created = skipped = cleaned = 0
    failures: list[dict[str, str]] = []

    for c in candidates:
        biz = c["biz"]
        source_id = f"{SOURCE_PREFIX}{biz['id']}"
        existing = rest(
            url,
            key,
            "/rest/v1/jobs?select=id&source_record_id=eq."
            + parse.quote(source_id, safe="")
            + "&limit=1",
        )
        if existing:
            skipped += 1
        else:
            payload = {
                "business_id": biz["id"],
                "created_by_profile_id": None,
                "owner_profile_id": None,
                "source_type": "IMPORT",
                "source_record_id": source_id,
                "title": c["title"],
                "slug": slugify(c["title"]),
                "description": c["jobs_text"],
                "city": biz.get("city"),
                "status": "published",
                "visibility": "public",
                "offer_kind": "hire",
            }
            try:
                rest(
                    url,
                    key,
                    "/rest/v1/jobs",
                    method="POST",
                    body=payload,
                    prefer="return=minimal",
                )
                created += 1
            except Exception as exc:  # noqa: BLE001
                failures.append({"slug": biz["slug"], "error": str(exc)})
                continue

        try:
            rest(
                url,
                key,
                f"/rest/v1/businesses?id=eq.{biz['id']}",
                method="PATCH",
                body={
                    "description": c["cleaned_description"],
                    "short_description": c["cleaned_short"],
                },
                prefer="return=minimal",
            )
            cleaned += 1
        except Exception as exc:  # noqa: BLE001
            failures.append({"slug": biz["slug"], "error": str(exc)})

    print(
        json.dumps(
            {
                "created": created,
                "skipped": skipped,
                "cleaned": cleaned,
                "failures": failures,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
