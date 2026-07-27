#!/usr/bin/env python3
"""Pull contacts out of business copy into structured fields, then strip them from text.

- phone / email / instagram_url / telegram_url / website / yelp_url
- only fills EMPTY structured fields (never overwrites existing)
- always removes phones, emails, socials, urls, contact footers from
  description + short_description when present

Usage:
  python3 scripts/business-enrich/migrate_contacts_from_copy.py
  python3 scripts/business-enrich/migrate_contacts_from_copy.py --apply
  python3 scripts/business-enrich/migrate_contacts_from_copy.py --apply --status all
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from contacts import (  # noqa: E402
    extract_emails,
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
    normalize_phone,
)

OUT = Path(__file__).resolve().parent / "data" / "migrate_contacts"
OUT.mkdir(parents=True, exist_ok=True)

SOURCE_FOOTER_RE = re.compile(
    r"(?im)^(?:источник|source|original post)\s*[:：].*$"
)
TG_META_RE = re.compile(
    r"(?im)^(?:контакты|telegram\s*id|тел|whatsapp|ig|instagram|email|сайт|facebook)\s*[:：].*$"
)
FB_ENTITY_DUMP_RE = re.compile(
    r"\n?---FB_ENTITY_[\w-]+---\s*\{[\s\S]*?\n\}",
    re.I,
)
FB_SOURCE_RE = re.compile(r"\n?---FACEBOOK_SOURCE---[\s\S]*$", re.I)

# Broad matcher aligned with telegram-collector/contacts.py (intl + US odd spacing)
PHONE_RE = re.compile(r"(?:\+?\d[\d\-\s().]{8,}\d)")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
HTTP_URL_RE = re.compile(r"https?://[^\s<>\"'）)\]]+", re.I)
WWW_URL_RE = re.compile(r"\bwww\.[^\s<>\"'）)\]]+", re.I)
IG_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?instagram\.com/[A-Za-z0-9._\-]+/?",
    re.I,
)
FB_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:facebook\.com|fb\.com)/[A-Za-z0-9._\-/]+",
    re.I,
)
TG_URL_RE = re.compile(
    r"https?://(?:t\.me|telegram\.me|telegram\.org)/[^\s<>\"'）)\]]+",
    re.I,
)
WA_URL_RE = re.compile(
    r"https?://(?:wa\.me|api\.whatsapp\.com)/[^\s<>\"'）)\]]+",
    re.I,
)
YELP_RE = re.compile(
    r"(?:https?://)?(?:www\.)?yelp\.com/[^\s<>\"']+",
    re.I,
)
LABELED_SOCIAL_RE = re.compile(
    r"(?:^|[\s(,])(?:instagram|инстаграм|whatsapp|telegram|телеграм(?:м)?|тг)"
    r"\s*[:：]?\s*@?[A-Za-z0-9._]+",
    re.I,
)
BARE_HANDLE_RE = re.compile(r"(?:^|[\s(,])@[A-Za-z0-9._]{3,30}\b")
CONTACT_LINE_RE = re.compile(
    r"^(?:тел(?:ефон)?|phone|call|звон(?:и|ить)?|whatsapp|telegram|тг|email|e-mail|"
    r"почта|instagram|инстаграм|facebook|fb|контакт|контакты)\s*[:：]?",
    re.I,
)
CTA_CONTACT_ONLY_RE = re.compile(
    r"^(?:📩|📞|📱|✉️)?\s*(?:пишите|напишите|звоните|call\s+me|dm\s+me|"
    r"в\s+личные|личные\s+сообщения).{0,80}$",
    re.I,
)
BARE_URL_LINE_RE = re.compile(r"^https?://\S+$", re.I)


def empty(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str):
        return not v.strip() or v.strip() == "/placeholder.svg"
    return False


def normalize_instagram_url(handle_or_url: str | None) -> str | None:
    if not handle_or_url:
        return None
    v = handle_or_url.strip()
    m = re.search(r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})", v, re.I)
    handle = (m.group(1) if m else v.lstrip("@")).strip().strip("/")
    handle = handle.split("?")[0].split("/")[0]
    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", handle or ""):
        return None
    if handle.lower() in {"reel", "p", "stories", "explore", "accounts"}:
        return None
    return f"https://www.instagram.com/{handle}"


def normalize_telegram_url(handle: str | None) -> str | None:
    if not handle:
        return None
    h = handle.strip().lstrip("@")
    if not re.fullmatch(r"[A-Za-z0-9_]{4,32}", h or ""):
        return None
    if h.isdigit() or h.lower() in {"c", "share", "joinchat"}:
        return None
    return f"https://t.me/{h}"


def normalize_website(url: str | None) -> str | None:
    if not url:
        return None
    v = url.strip().rstrip(".,);]")
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    lower = v.lower()
    if any(
        x in lower
        for x in (
            "instagram.com",
            "facebook.com",
            "fb.com",
            "t.me/",
            "telegram.me",
            "wa.me/",
            "yelp.com",
            "maps.google",
            "goo.gl/maps",
        )
    ):
        return None
    return v[:300]


def extract_telegram_labeled(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(
        r"(?i)(?:telegram|телеграм(?:м)?|тг)\s*[:：]\s*@?([A-Za-z0-9_]{4,32})\b",
        text or "",
    ):
        h = m.group(1).lower()
        if h.isdigit() or h in {"share", "joinchat", "c"}:
            continue
        if h not in seen:
            seen.add(h)
            found.append(h)
    # also t.me/username (not /c/ posts)
    for m in re.finditer(
        r"(?i)(?:t\.me|telegram\.me)/([A-Za-z0-9_]{4,32})\b",
        text or "",
    ):
        h = m.group(1).lower()
        if h.isdigit() or h in {"c", "share", "joinchat"}:
            continue
        if h not in seen:
            seen.add(h)
            found.append(h)
    return found


def extract_yelp(text: str) -> str | None:
    m = YELP_RE.search(text or "")
    if not m:
        return None
    url = m.group(0)
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    return url.split("?")[0][:300]


def _strip_inline(text: str) -> str:
    t = text
    t = EMAIL_RE.sub(" ", t)
    t = PHONE_RE.sub(" ", t)
    t = WA_URL_RE.sub(" ", t)
    t = TG_URL_RE.sub(" ", t)
    t = FB_URL_RE.sub(" ", t)
    t = IG_URL_RE.sub(" ", t)
    t = LABELED_SOCIAL_RE.sub(" ", t)
    t = HTTP_URL_RE.sub(" ", t)
    t = WWW_URL_RE.sub(" ", t)
    t = BARE_HANDLE_RE.sub(" ", t)
    # leftover labeled contacts ("Phone:", "Tel:") and orphan trailing labels
    t = re.sub(
        r"(?i)\b(?:phone|tel(?:ephone)?|телефон|whats?app|email|e-mail|почта|"
        r"instagram|инстаграм|telegram|телеграм(?:м)?|тг|contact|контакт)"
        r"\b\s*[:：]\s*",
        " ",
        t,
    )
    t = re.sub(
        r"(?i)\b(?:phone|tel(?:ephone)?|телефон|call|звоните|contact|контакт)\b\s*$",
        "",
        t,
    )
    t = re.sub(r"(?:^|[\s])по\s+ссылке\s*:?\s*$", " ", t, flags=re.I)
    t = re.sub(r"\s*[·|]\s*[·|]\s*", " · ", t)
    t = re.sub(r"(?:\s*[·|,;]){2,}", " · ", t)
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"\s+([,.;:!?)])", r"\1", t)
    t = re.sub(r"^[\s·|,;:\-–—]+|[\s·|,;:\-–—]+$", "", t)
    return t.strip()


def is_contact_only_line(line: str) -> bool:
    t = line.strip()
    if not t:
        return True
    if CONTACT_LINE_RE.match(t) or BARE_URL_LINE_RE.match(t):
        return True
    if CTA_CONTACT_ONLY_RE.match(t):
        return True
    cleaned = _strip_inline(t)
    letters = re.sub(r"[^\wа-яёА-ЯЁ]", "", cleaned, flags=re.U)
    if len(letters) < 8 and (
        PHONE_RE.search(t) or EMAIL_RE.search(t) or IG_URL_RE.search(t) or FB_URL_RE.search(t)
    ):
        return True
    if PHONE_RE.search(t) and len(cleaned.split()) <= 3:
        return True
    # "Contact: Mayan Hussien" / bare name after stripping contacts
    if re.match(r"(?i)^(?:contact|контакт)\s*[:：]", t) and len(cleaned.split()) <= 4:
        return True
    if len(letters) < 3:
        return True
    return False


def norm_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def redact_copy(text: str | None) -> str | None:
    if text is None:
        return None
    working = text
    working = FB_SOURCE_RE.sub(" ", working)
    working = FB_ENTITY_DUMP_RE.sub(" ", working)
    working = SOURCE_FOOTER_RE.sub("", working)
    working = TG_META_RE.sub("", working)
    lines: list[str] = []
    for line in working.split("\n"):
        line = line.strip()
        if not line:
            continue
        if is_contact_only_line(line):
            continue
        cleaned = _strip_inline(line)
        if len(cleaned) < 3:
            continue
        lines.append(cleaned)
    out = "\n".join(lines)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    # collapse duplicated paragraphs (common telegram import)
    parts = [p.strip() for p in re.split(r"\n{2,}", out) if p.strip()]
    deduped: list[str] = []
    seen: set[str] = set()
    for p in parts:
        key = re.sub(r"\s+", " ", p).lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(p)
    out = "\n\n".join(deduped).strip()
    return out or None


def mine_contacts(blob: str) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    phones = extract_phones(blob)
    for cand in phones:
        digits = re.sub(r"\D", "", cand or "")
        if len(digits) == 11 and digits.startswith("1"):
            patch["phone"] = cand
            break
        if 10 <= len(digits) <= 12:
            patch["phone"] = cand
            break
        # spaced RU/US style already normalized by extract_phones
        norm = normalize_phone(cand)
        if norm:
            patch["phone"] = norm
            break

    emails = extract_emails(blob)
    if emails:
        patch["email"] = emails[0]

    igs = extract_instagram(blob)
    ig = normalize_instagram_url(igs[0] if igs else None)
    if not ig:
        m = IG_URL_RE.search(blob)
        if m:
            ig = normalize_instagram_url(m.group(0))
    if ig:
        patch["instagram_url"] = ig

    tgs = extract_telegram_labeled(blob)
    if not tgs:
        tgs = extract_telegram(blob)
    tg = normalize_telegram_url(tgs[0] if tgs else None)
    if tg:
        patch["telegram_url"] = tg

    webs = extract_websites(blob)
    for candidate in webs:
        web = normalize_website(candidate)
        if web and len(web) > 12:
            host = re.sub(r"^https?://(?:www\.)?", "", web, flags=re.I).split("/")[0]
            if host.endswith(
                (".com", ".net", ".org", ".io", ".us", ".app", ".biz", ".coach", ".ca")
            ):
                patch["website"] = web
                break

    yelp = extract_yelp(blob)
    if yelp:
        patch["yelp_url"] = yelp

    return patch


def build_update(row: dict[str, Any]) -> dict[str, Any] | None:
    short = row.get("short_description")
    desc = row.get("description")
    blob = "\n".join(str(p) for p in (short, desc) if p and str(p).strip())

    patch: dict[str, Any] = {}
    mined = mine_contacts(blob) if blob else {}

    for key in (
        "phone",
        "email",
        "instagram_url",
        "telegram_url",
        "website",
        "yelp_url",
    ):
        if empty(row.get(key)) and mined.get(key):
            patch[key] = mined[key]

    # website field holding a social URL → move to proper column
    website_raw = (row.get("website") or "").strip()
    if website_raw:
        if "instagram.com" in website_raw.lower() and empty(row.get("instagram_url")):
            ig = normalize_instagram_url(website_raw)
            if ig:
                patch["instagram_url"] = ig
                patch["website"] = None
        elif re.search(r"t\.me/|telegram\.me", website_raw, re.I) and empty(
            row.get("telegram_url")
        ):
            tgs = extract_telegram(website_raw)
            tg = normalize_telegram_url(tgs[0] if tgs else None)
            if tg and "/c/" not in website_raw:
                patch["telegram_url"] = tg
                patch["website"] = None
        elif re.search(r"yelp\.com", website_raw, re.I) and empty(row.get("yelp_url")):
            yelp = extract_yelp(website_raw)
            if yelp:
                patch["yelp_url"] = yelp
                patch["website"] = None

    new_short = redact_copy(short if isinstance(short, str) else None)
    new_desc = redact_copy(desc if isinstance(desc, str) else None)

    if norm_text(short if isinstance(short, str) else None) != norm_text(new_short):
        patch["short_description"] = new_short
    if norm_text(desc if isinstance(desc, str) else None) != norm_text(new_desc):
        patch["description"] = new_desc

    if not patch:
        return None
    return patch


def fetch_all(
    client: SupabaseRest, statuses: list[str] | None
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page = 200
    offset = 0
    while True:
        params: dict[str, str] = {
            "select": (
                "id,slug,name,status,phone,email,website,instagram_url,telegram_url,"
                "yelp_url,short_description,description"
            ),
            "order": "id.asc",
            "limit": str(page),
            "offset": str(offset),
        }
        if statuses:
            params["status"] = f"in.({','.join(statuses)})"
        chunk = client._request("GET", "/businesses", params=params)
        if not isinstance(chunk, list) or not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--status",
        default="approved,pending",
        help="Comma statuses, or 'all'",
    )
    args = parser.parse_args()

    load_env()
    import os

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    statuses = None if args.status.strip().lower() == "all" else [
        s.strip() for s in args.status.split(",") if s.strip()
    ]
    businesses = fetch_all(client, statuses)

    planned: list[dict[str, Any]] = []
    field_hits: dict[str, int] = {}
    stripped = 0
    filled = 0

    for row in businesses:
        patch = build_update(row)
        if not patch:
            continue
        text_changed = "description" in patch or "short_description" in patch
        contact_keys = [
            k
            for k in patch
            if k
            not in {
                "description",
                "short_description",
            }
        ]
        if text_changed:
            stripped += 1
        if contact_keys:
            filled += 1
        for k in patch:
            field_hits[k] = field_hits.get(k, 0) + 1
        planned.append(
            {
                "id": row["id"],
                "slug": row.get("slug"),
                "name": row.get("name"),
                "status": row.get("status"),
                "patch": patch,
                "before_short": (row.get("short_description") or "")[:160],
                "after_short": (patch.get("short_description") or row.get("short_description") or "")[
                    :160
                ]
                if "short_description" in patch
                else None,
                "before_desc": (row.get("description") or "")[:200],
                "after_desc": (patch.get("description") or "")[:200]
                if "description" in patch
                else None,
            }
        )

    if args.apply:
        for item in planned:
            body = {
                **item["patch"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            client.patch("businesses", {"id": f"eq.{item['id']}"}, body)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "scanned": len(businesses),
        "updated": len(planned),
        "stripped_copy": stripped,
        "filled_contacts": filled,
        "field_hits": dict(sorted(field_hits.items(), key=lambda x: -x[1])),
        "sample": planned[:50],
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if args.apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    latest = OUT / ("apply_latest.json" if args.apply else "dry_run_latest.json")
    latest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "mode": report["mode"],
                "scanned": report["scanned"],
                "updated": report["updated"],
                "stripped_copy": stripped,
                "filled_contacts": filled,
                "field_hits": report["field_hits"],
                "report": str(path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
