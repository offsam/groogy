#!/usr/bin/env python3
"""Enrich businesses from their Telegram source_url (t.me/c/... posts).

Pipeline per card:
  1. Fetch original Telegram post + media (Telethon session)
  2. Extract contacts from caption text
  3. Gemini vision OCR on first image (flyer/photo)
  4. Fill ONLY empty business fields
  5. Upload cover image if missing
  6. Clean description (drop contact/source footers)

Usage:
  python3 scripts/business-enrich/enrich_from_telegram_source.py --dry-run --limit 5
  python3 scripts/business-enrich/enrich_from_telegram_source.py --apply --limit 30
  python3 scripts/business-enrich/enrich_from_telegram_source.py --apply --limit 50 --offset 30
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
TG_DIR = ROOT / "scripts" / "telegram-collector"
IR_DIR = ROOT / "scripts" / "import-review"
ENRICH_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(IR_DIR))
sys.path.insert(0, str(TG_DIR))
sys.path.insert(0, str(ENRICH_DIR))

from common import SupabaseRest, load_env  # noqa: E402
from contacts import (  # noqa: E402
    extract_emails,
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
)
from enrich_published_businesses import parse_hours_to_weekly  # noqa: E402

OUT_DIR = ENRICH_DIR / "data" / "tg_source_enrich"
MEDIA_DIR = OUT_DIR / "media"

TME_C_RE = re.compile(
    r"(?:https?://)?t\.me/c/(\d+)/(\d+)",
    re.IGNORECASE,
)
FOOTER_LINE_RE = re.compile(
    r"(?im)^(?:контакты:|источник:|telegram\s*id:|тел:|whatsapp:|ig:|instagram:|email:|сайт:).*$"
)
CONTACT_INLINE_RE = re.compile(
    r"(?i)\b(?:тел(?:ефон)?|phone|whats?app|instagram|инста(?:грам)?|email|e-mail|"
    r"telegram|телеграм)\s*[:：].+$",
)


def parse_tme_c(url: str) -> tuple[int, int] | None:
    m = TME_C_RE.search(url or "")
    if not m:
        return None
    internal = int(m.group(1))
    msg_id = int(m.group(2))
    # Private/supergroup: t.me/c/<internal_id>/<msg> → peer -100<internal_id>
    chat_id = int(f"-100{internal}")
    return chat_id, msg_id


def needs_enrichment(row: dict[str, Any]) -> bool:
    phone_empty = not (row.get("phone") or "").strip()
    ig_empty = not (row.get("instagram_url") or "").strip()
    web_empty = not (row.get("website") or "").strip()
    hours_empty = row.get("opening_hours") is None
    addr_empty = not (row.get("address_line") or "").strip()
    img = (row.get("image_url") or "").strip()
    img_empty = (not img) or "placeholder" in img or img.endswith(".svg")
    desc = (row.get("description") or "").strip()
    thin_desc = len(desc) < 80 or "источник:" in desc.lower()
    return (
        phone_empty
        or ig_empty
        or web_empty
        or hours_empty
        or img_empty
        or addr_empty
        or thin_desc
    )


def gemini_key() -> str | None:
    return (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip() or None


def gemini_vision(image_path: Path, caption: str) -> dict[str, Any] | None:
    key = gemini_key()
    if not key:
        return None
    raw = image_path.read_bytes()
    if len(raw) < 200:
        return None
    suffix = image_path.suffix.lower()
    mime = "image/jpeg"
    if suffix == ".png":
        mime = "image/png"
    elif suffix == ".webp":
        mime = "image/webp"
    b64 = base64.b64encode(raw).decode("ascii")
    prompt = (
        "You extract business contact info from a flyer/photo (Russian or English). "
        "Return ONLY a JSON object with keys: "
        "business_name (string|null), phone (E.164 or US local|null), email (null|string), "
        "instagram (handle without @ or full URL|null), website (http URL|null), "
        "telegram (username without @|null), address (string|null), "
        "hours_text (human readable hours|null), "
        "services (string array), "
        "cleaned_description (2-5 sentence public description WITHOUT phones/emails/handles/urls), "
        "confidence (0-1). "
        "If a field is missing use null / []. "
        f"Caption from Telegram post (may help):\n{(caption or '')[:1500]}"
    )
    models = [
        "gemini-2.5-flash",
        "gemini-flash-latest",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash-001",
    ]
    for model in models:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={key}"
        )
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": mime, "data": b64}},
                    ]
                }
            ],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            text = (
                body.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
            if not text:
                continue
            # strip fences if any
            text = text.strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"\s*```$", "", text)
            data = json.loads(text)
            if isinstance(data, dict):
                data["_model"] = model
                return data
        except Exception as exc:  # noqa: BLE001
            last = str(exc)[:200]
            continue
    return None


def normalize_instagram(raw: str | None) -> str | None:
    if not raw:
        return None
    v = raw.strip()
    if not v:
        return None
    m = re.search(r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})", v, re.I)
    if m:
        handle = m.group(1)
    else:
        handle = v.lstrip("@").split("/")[0].split("?")[0]
    handle = re.sub(r"[^A-Za-z0-9._]", "", handle)
    if len(handle) < 2:
        return None
    return f"https://www.instagram.com/{handle}"


def normalize_website(raw: str | None) -> str | None:
    if not raw:
        return None
    v = raw.strip()
    if not v:
        return None
    if re.search(r"t\.me/|telegram\.me|instagram\.com|facebook\.com|fb\.com|wa\.me", v, re.I):
        return None
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    return v


def clean_description(text: str, fallback: str | None = None) -> str | None:
    src = (text or "").strip() or (fallback or "").strip()
    if not src:
        return None
    lines = []
    for line in src.splitlines():
        if FOOTER_LINE_RE.match(line.strip()):
            continue
        if CONTACT_INLINE_RE.match(line.strip()):
            continue
        lines.append(line)
    out = "\n".join(lines).strip()
    out = re.sub(r"\n{3,}", "\n\n", out)
    # Drop leftover phones/emails lightly for public copy
    out = re.sub(r"(?:\+?\d[\d\-\s().]{8,}\d)", "", out)
    out = re.sub(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", "", out)
    out = re.sub(r"@([A-Za-z0-9._]{3,30})", "", out)
    out = re.sub(r"https?://\S+", "", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out or None


def parse_hours_ru(text: str | None) -> dict[str, Any] | None:
    """Parse simple Russian ranges like 'пн–пт с 9:00 до 17:00'."""
    if not text:
        return None
    m = re.search(
        r"(пн|пон|пнд).{0,8}?(вт|ср|чт|пт|сб|вс).{0,40}?"
        r"(?:с|from)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:до|-|–|—)\s*(\d{1,2})(?::(\d{2}))?",
        text,
        re.I,
    )
    if not m:
        m2 = re.search(
            r"(пн|пон).{0,12}?(пт).{0,40}?"
            r"(?:с|from)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:до|-|–|—)\s*(\d{1,2})(?::(\d{2}))?",
            text,
            re.I,
        )
        if not m2:
            return None
        m = m2
    op = f"{int(m.group(3)):02d}:{int(m.group(4) or 0):02d}"
    cl = f"{int(m.group(5)):02d}:{int(m.group(6) or 0):02d}"
    weekly = []
    for d in range(7):
        if 1 <= d <= 5:
            weekly.append({"day": d, "closed": False, "open": op, "close": cl})
        else:
            weekly.append({"day": d, "closed": True, "open": None, "close": None})
    return {"timezone": "America/Los_Angeles", "weekly": weekly}


def merge_extracted(
    caption: str,
    ocr: dict[str, Any] | None,
) -> dict[str, Any]:
    blob = caption or ""
    if ocr:
        # fold OCR text-ish fields into extractors too
        extra_bits = [
            ocr.get("phone") or "",
            ocr.get("email") or "",
            ocr.get("instagram") or "",
            ocr.get("website") or "",
            ocr.get("telegram") or "",
            ocr.get("hours_text") or "",
            ocr.get("address") or "",
            " ".join(ocr.get("services") or []),
        ]
        blob = blob + "\n" + "\n".join(str(x) for x in extra_bits if x)

    phones = extract_phones(blob)
    emails = extract_emails(blob)
    igs = extract_instagram(blob)
    webs = extract_websites(blob)
    tgs = extract_telegram(blob)

    phone = phones[0] if phones else None
    if ocr and ocr.get("phone") and not phone:
        from contacts import normalize_phone

        phone = normalize_phone(str(ocr["phone"]))

    ig = normalize_instagram(igs[0] if igs else None)
    if not ig and ocr:
        ig = normalize_instagram(ocr.get("instagram"))

    website = webs[0] if webs else None
    if not website and ocr:
        website = normalize_website(ocr.get("website"))
    else:
        website = normalize_website(website)

    email = emails[0] if emails else None
    if not email and ocr and ocr.get("email"):
        email = str(ocr["email"]).strip().lower()

    tg_user = tgs[0] if tgs else None
    if not tg_user and ocr and ocr.get("telegram"):
        tg_user = str(ocr["telegram"]).lstrip("@").strip()

    hours_text = (ocr or {}).get("hours_text") if ocr else None
    if not hours_text:
        for line in (caption or "").splitlines():
            if re.search(
                r"(?:\bopen\b|\bhours\b|час[ыов]|пн[\s\-–—]|пн-|mon(?:day)?\b|"
                r"\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2})",
                line,
                re.I,
            ):
                hours_text = line.strip()
                break
    hours = parse_hours_to_weekly(hours_text) if hours_text else None
    if not hours and hours_text:
        hours = parse_hours_ru(hours_text)
    if not hours and caption:
        hours = parse_hours_ru(caption) or parse_hours_to_weekly(caption)

    cleaned = None
    if ocr and ocr.get("cleaned_description"):
        cleaned = clean_description(str(ocr["cleaned_description"]))
    if not cleaned:
        cleaned = clean_description(caption)

    name = None
    if ocr and ocr.get("business_name"):
        name = str(ocr["business_name"]).strip() or None

    services = []
    if ocr and isinstance(ocr.get("services"), list):
        services = [str(s).strip() for s in ocr["services"] if str(s).strip()]

    address = None
    if ocr and ocr.get("address"):
        address = str(ocr["address"]).strip() or None

    return {
        "phone": phone,
        "email": email,
        "instagram_url": ig,
        "website": website,
        "telegram_username": tg_user,
        "opening_hours": hours,
        "hours_text": hours_text,
        "cleaned_description": cleaned,
        "business_name": name,
        "services": services,
        "address": address,
    }


def empty(val: Any) -> bool:
    if val is None:
        return True
    if isinstance(val, str) and not val.strip():
        return True
    return False


def build_patch(row: dict[str, Any], extracted: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if empty(row.get("phone")) and extracted.get("phone"):
        patch["phone"] = extracted["phone"]
    if empty(row.get("email")) and extracted.get("email"):
        patch["email"] = extracted["email"]
    if empty(row.get("instagram_url")) and extracted.get("instagram_url"):
        patch["instagram_url"] = extracted["instagram_url"]
    if empty(row.get("website")) and extracted.get("website"):
        patch["website"] = extracted["website"]
    if empty(row.get("telegram_url")) and extracted.get("telegram_username"):
        patch["telegram_url"] = f"https://t.me/{extracted['telegram_username']}"
    if row.get("opening_hours") is None and extracted.get("opening_hours"):
        patch["opening_hours"] = extracted["opening_hours"]

    # Description: replace if thin or contains source/contact footers
    desc = (row.get("description") or "").strip()
    cleaned = extracted.get("cleaned_description")
    if cleaned and (
        len(desc) < 80
        or "источник:" in desc.lower()
        or "контакты:" in desc.lower()
        or "telegram id" in desc.lower()
    ):
        if extracted.get("services"):
            svc = "Услуги: " + ", ".join(extracted["services"][:8])
            if svc.lower() not in cleaned.lower():
                cleaned = f"{cleaned}\n\n{svc}"
        patch["description"] = cleaned
        if empty(row.get("short_description")):
            patch["short_description"] = cleaned[:240]

    # Name only if current looks like a person-from-post placeholder AND OCR has business name
    # Conservative: skip auto-rename in batch (was manual for Lana Cher).

    # Address fill if missing
    if empty(row.get("address_line")) and extracted.get("address"):
        patch["address_line"] = extracted["address"]

    return patch


def upload_cover(
    supabase_url: str,
    service_key: str,
    biz_id: str,
    msg_id: int,
    image_path: Path,
) -> str | None:
    data = image_path.read_bytes()
    if len(data) < 200:
        return None
    suffix = image_path.suffix.lower() or ".jpg"
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"
    object_path = f"business-covers/{biz_id}/cover-tg-{msg_id}{suffix}"
    content_type = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }[suffix]
    for bucket in ("business-images", "businesses"):
        url = f"{supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{object_path}"
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                if 200 <= resp.status < 300:
                    return (
                        f"{supabase_url.rstrip('/')}/storage/v1/object/public/"
                        f"{bucket}/{object_path}"
                    )
        except urllib.error.HTTPError:
            continue
        except Exception:
            continue
    return None


async def fetch_post(
    client: Any,
    chat_id: int,
    msg_id: int,
    dest: Path,
) -> dict[str, Any]:
    dest.mkdir(parents=True, exist_ok=True)
    msg = await client.get_messages(chat_id, ids=msg_id)
    if not msg:
        return {"ok": False, "error": "message_not_found"}
    caption = (msg.message or msg.text or "") or ""
    media_path = None
    if msg.media:
        try:
            path = await client.download_media(msg, file=str(dest / f"msg_{msg_id}"))
            if path:
                media_path = str(path)
        except Exception as exc:  # noqa: BLE001
            media_path = None
            media_error = str(exc)[:200]
        else:
            media_error = None
    else:
        media_error = None
    return {
        "ok": True,
        "caption": caption,
        "media_path": media_path,
        "media_error": media_error,
        "date": msg.date.isoformat() if msg.date else None,
    }


def fetch_candidates(client: SupabaseRest, limit: int, offset: int) -> list[dict[str, Any]]:
    # Prefer thin contact cards first (no phone), then the rest.
    select = (
        "id,slug,name,phone,email,website,instagram_url,telegram_url,"
        "source_url,source_kind,description,short_description,image_url,"
        "address_line,city,opening_hours,status,updated_at"
    )
    batches: list[dict[str, Any]] = []
    for phone_filter in ("is.null", "not.is.null"):
        rows = (
            client._request(
                "GET",
                "/businesses",
                params={
                    "select": select,
                    "source_kind": "eq.telegram",
                    "status": "eq.approved",
                    "source_url": "not.is.null",
                    "phone": phone_filter,
                    "order": "updated_at.asc",
                    "limit": str(max(limit * 2, 40)),
                    "offset": str(offset if phone_filter == "is.null" else 0),
                },
            )
            or []
        )
        for row in rows:
            if not (row.get("source_url") or "").strip():
                continue
            if not parse_tme_c(row["source_url"]):
                continue
            if needs_enrichment(row):
                batches.append(row)
            if len(batches) >= limit:
                return batches
    return batches[:limit]


async def run_batch(args: argparse.Namespace) -> int:
    load_env()
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = SupabaseRest(url, key)

    from telethon import TelegramClient
    from config import SESSION_NAME, get_credentials

    api_id, api_hash, _phone = get_credentials()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)

    candidates = fetch_candidates(sb, args.limit, args.offset)
    report: dict[str, Any] = {
        "mode": "apply" if args.apply else "dry-run",
        "limit": args.limit,
        "offset": args.offset,
        "candidates": len(candidates),
        "results": [],
    }
    print(f"candidates={len(candidates)} mode={'apply' if args.apply else 'dry-run'}")

    tg = TelegramClient(SESSION_NAME, api_id, api_hash)
    await tg.connect()
    if not await tg.is_user_authorized():
        print("Telegram session not authorized — run scripts/telegram-collector/auth.py")
        return 2

    for i, row in enumerate(candidates, 1):
        item: dict[str, Any] = {
            "id": row["id"],
            "slug": row["slug"],
            "name": row["name"],
            "source_url": row["source_url"],
        }
        parsed = parse_tme_c(row["source_url"])
        if not parsed:
            item["status"] = "skip_bad_source"
            report["results"].append(item)
            continue
        chat_id, msg_id = parsed
        dest = MEDIA_DIR / row["id"]
        try:
            post = await fetch_post(tg, chat_id, msg_id, dest)
        except Exception as exc:  # noqa: BLE001
            item["status"] = "tg_error"
            item["error"] = str(exc)[:300]
            report["results"].append(item)
            print(f"[{i}/{len(candidates)}] FAIL tg {row['slug']}: {item['error']}")
            continue

        if not post.get("ok"):
            item["status"] = "tg_missing"
            item["error"] = post.get("error")
            report["results"].append(item)
            print(f"[{i}/{len(candidates)}] MISS {row['slug']}")
            continue

        caption = post.get("caption") or ""
        media_path = post.get("media_path")
        ocr = None
        if media_path and Path(media_path).is_file():
            # Only run vision if we still need contacts / hours / address / better desc
            img = (row.get("image_url") or "").strip()
            img_empty = (not img) or "placeholder" in img or img.endswith(".svg")
            if (
                empty(row.get("phone"))
                or empty(row.get("instagram_url"))
                or empty(row.get("website"))
                or empty(row.get("address_line"))
                or row.get("opening_hours") is None
                or img_empty
                or len((row.get("description") or "")) < 80
            ):
                ocr = gemini_vision(Path(media_path), caption)
                item["ocr_model"] = (ocr or {}).get("_model")
                time.sleep(0.4)  # gentle rate limit

        extracted = merge_extracted(caption, ocr)
        patch = build_patch(row, extracted)

        img = (row.get("image_url") or "").strip()
        img_empty = (not img) or "placeholder" in img
        if img_empty and media_path and Path(media_path).is_file():
            if args.apply:
                public = upload_cover(url, key, row["id"], msg_id, Path(media_path))
                if public:
                    patch["image_url"] = public
                    item["image_uploaded"] = True
            else:
                item["image_would_upload"] = True

        item["extracted"] = {
            k: extracted.get(k)
            for k in (
                "phone",
                "email",
                "instagram_url",
                "website",
                "telegram_username",
                "hours_text",
                "business_name",
                "address",
            )
        }
        item["patch"] = patch
        item["caption_len"] = len(caption)
        item["has_media"] = bool(media_path)

        if not patch:
            item["status"] = "noop"
            report["results"].append(item)
            print(f"[{i}/{len(candidates)}] NOOP {row['slug']}")
            continue

        if args.apply:
            try:
                sb.patch("businesses", {"id": f"eq.{row['id']}"}, patch)
                item["status"] = "updated"
            except Exception as exc:  # noqa: BLE001
                item["status"] = "patch_error"
                item["error"] = str(exc)[:300]
        else:
            item["status"] = "dry_run"

        report["results"].append(item)
        keys = ",".join(sorted(patch.keys()))
        print(f"[{i}/{len(candidates)}] {item['status']} {row['slug']} → {keys}")

    await tg.disconnect()

    summary = {
        "updated": sum(1 for r in report["results"] if r.get("status") == "updated"),
        "dry_run": sum(1 for r in report["results"] if r.get("status") == "dry_run"),
        "noop": sum(1 for r in report["results"] if r.get("status") == "noop"),
        "tg_error": sum(1 for r in report["results"] if r.get("status") == "tg_error"),
        "tg_missing": sum(1 for r in report["results"] if r.get("status") == "tg_missing"),
        "patch_error": sum(1 for r in report["results"] if r.get("status") == "patch_error"),
    }
    report["summary"] = summary
    out_path = OUT_DIR / f"report_{'apply' if args.apply else 'dry'}_{int(time.time())}.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    latest = OUT_DIR / "latest_report.json"
    latest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    print(f"report={out_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--offset", type=int, default=0)
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    if args.dry_run and args.apply:
        print("Use only one of --dry-run / --apply", file=sys.stderr)
        return 2
    return asyncio.run(run_batch(args))


if __name__ == "__main__":
    raise SystemExit(main())
