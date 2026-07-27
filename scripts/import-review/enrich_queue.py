#!/usr/bin/env python3
"""Enrich open import-review queue cards from linked resources.

Sources (fill-empty only, never overwrite):
  - Telegram sender profile (name / @username) via source message
  - Website / Instagram public pages when URL present
  - Phone / email / city heuristics from source_text

Usage:
  python3 scripts/import-review/enrich_queue.py --dry-run --limit 30
  python3 scripts/import-review/enrich_queue.py --apply --limit 200
  python3 scripts/import-review/enrich_queue.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "media-pipeline"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from eligibility import (  # noqa: E402
    extract_direct_contacts,
    normalize_email,
    normalize_instagram,
    normalize_phone,
    normalize_website,
)

QUEUE_STATUSES = ("pending", "in_review", "needs_more_info", "ready_to_publish")
ALLOWED_CHATS = {-1001333533747, -1001955320601}

CITY_RE = re.compile(
    r"\b("
    r"Irvine|Anaheim|Santa\s+Ana|Orange|Tustin|Costa\s+Mesa|Newport\s+Beach|"
    r"Huntington\s+Beach|Garden\s+Grove|Fullerton|Yorba\s+Linda|Brea|"
    r"Laguna\s+Niguel|Laguna\s+Hills|Mission\s+Viejo|Lake\s+Forest|"
    r"Fountain\s+Valley|Westminster|Buena\s+Park|Placentia|Cypress|"
    r"Long\s+Beach|Torrance|Glendale|Pasadena|Burbank|Los\s+Angeles|"
    r"San\s+Diego|Los\s+Alamitos|Seal\s+Beach|Stanton|La\s+Habra|"
    r"Orange\s+County|\bOC\b"
    r")\b",
    re.I,
)
PHONE_IN_TEXT_RE = re.compile(
    r"(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?)\d{3}[\s\-.]?\d{4}"
)
EMAIL_IN_TEXT_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
SELECT = (
    "id,title,person_name,business_name,description,source_text,category,"
    "entity_type,target_collection,city,phone,whatsapp,instagram,website,email,"
    "telegram_username,telegram_user_id,source_chat_id,source_message_ids,"
    "source_author_username,source_author_id,review_status,ai_decision"
)


def _as_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    s = str(value).strip()
    return [s] if s else []


def _merge_unique(existing: list[str], extras: list[str]) -> list[str] | None:
    out = list(existing)
    changed = False
    for x in extras:
        if x and x not in out:
            out.append(x)
            changed = True
    return out if changed else None


def detect_city(text: str) -> str | None:
    m = CITY_RE.search(text or "")
    if not m:
        return None
    raw = re.sub(r"\s+", " ", m.group(1)).strip()
    if raw.upper() == "OC":
        return "Orange County"
    return raw.title() if raw.lower() != "orange county" else "Orange County"


def text_contacts(text: str) -> dict[str, list[str]]:
    phones: list[str] = []
    emails: list[str] = []
    for m in PHONE_IN_TEXT_RE.finditer(text or ""):
        n = normalize_phone(m.group(0))
        if n and n not in phones:
            phones.append(n)
    for m in EMAIL_IN_TEXT_RE.finditer(text or ""):
        n = normalize_email(m.group(0))
        if n and n not in emails:
            emails.append(n)
    return {"phone": phones[:3], "email": emails[:2]}


def build_text_patch(row: dict[str, Any]) -> dict[str, Any]:
    """Fill empty contact/city fields from source text."""
    patch: dict[str, Any] = {}
    text = f"{row.get('description') or ''}\n{row.get('source_text') or ''}"
    contacts = extract_direct_contacts(row)
    found = text_contacts(text)

    if not contacts.get("phone") and found["phone"]:
        patch["phone"] = found["phone"]
    if not contacts.get("email") and found["email"]:
        patch["email"] = found["email"]
    if not (row.get("city") or "").strip():
        city = detect_city(text)
        if city:
            patch["city"] = city

    author = (row.get("source_author_username") or "").strip().lstrip("@")
    if author and not (row.get("telegram_username") or "").strip():
        patch["telegram_username"] = author
    author_id = str(row.get("source_author_id") or "").strip()
    if author_id and not str(row.get("telegram_user_id") or "").strip():
        patch["telegram_user_id"] = author_id
    return patch


def build_web_patch(row: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Website / Instagram enrichment → fill-empty patch."""
    notes: list[str] = []
    patch: dict[str, Any] = {}
    try:
        from web_enrichment import (  # type: ignore
            extract_instagram_profile,
            extract_website_profile,
            merge_website_profiles,
            website_fetch_candidates,
        )
    except Exception as exc:  # noqa: BLE001
        return {}, [f"web_import_error:{exc}"]

    websites = _as_str_list(row.get("website"))
    instagrams = _as_str_list(row.get("instagram"))
    # also hunt URLs in text
    text = f"{row.get('description') or ''}\n{row.get('source_text') or ''}"
    for m in re.finditer(
        r"https?://(?:www\.)?instagram\.com/([A-Za-z0-9._]{2,30})", text, re.I
    ):
        handle = m.group(1)
        if handle.lower() not in {"p", "reel", "reels", "stories"}:
            if handle not in instagrams:
                instagrams.append(handle)
    for m in re.finditer(r"https?://[^\s<>\"']+", text, re.I):
        url = m.group(0).rstrip(").,;\"'")
        low = url.lower()
        if "instagram.com" in low or "t.me/" in low or "wa.me/" in low:
            continue
        if "facebook.com" in low or "fb.com" in low:
            continue
        if url not in websites and len(websites) < 2:
            websites.append(url)

    web_data = None
    for w in websites[:2]:
        page_data = None
        for candidate in website_fetch_candidates(str(w)):
            fetched = extract_website_profile(candidate)
            if fetched.get("status") == "ok":
                page_data = merge_website_profiles(page_data, fetched)
        if page_data and page_data.get("status") == "ok":
            web_data = page_data
            notes.append(f"website_ok:{w[:40]}")
            break
        notes.append(f"website_fail:{w[:40]}")

    ig_data = None
    for ig in instagrams[:2]:
        fetched = extract_instagram_profile(ig)
        if fetched.get("status") == "ok":
            ig_data = fetched
            notes.append(f"ig_ok:{ig}")
            break
        notes.append(f"ig_fail:{ig}")

    existing_phones = _as_str_list(row.get("phone"))
    existing_emails = _as_str_list(row.get("email"))
    existing_websites = _as_str_list(row.get("website"))
    existing_igs = _as_str_list(row.get("instagram"))

    if web_data:
        phones = [
            normalize_phone(p)
            for p in (web_data.get("phone") or [])
            if normalize_phone(p)
        ]
        emails = [
            normalize_email(e)
            for e in (web_data.get("email") or [])
            if normalize_email(e)
        ]
        merged_p = _merge_unique(existing_phones, [p for p in phones if p])
        if merged_p is not None and not existing_phones:
            patch["phone"] = merged_p
        merged_e = _merge_unique(existing_emails, [e for e in emails if e])
        if merged_e is not None and not existing_emails:
            patch["email"] = merged_e
        if not existing_websites:
            href = normalize_website(str(web_data.get("url") or websites[0]))
            # skip map short-links / app deep links as "website"
            if href and not re.search(
                r"(maps\.apple|goo\.gl/maps|maps\.app\.goo|wa\.me|t\.me/)",
                href,
                re.I,
            ):
                patch["website"] = [href]
        if not (row.get("city") or "").strip() and web_data.get("address"):
            city = detect_city(str(web_data.get("address")))
            if city:
                patch["city"] = city
        # social from site
        for link in web_data.get("social_links") or []:
            ig = normalize_instagram(str(link))
            if ig and not existing_igs:
                patch["instagram"] = [ig]
                existing_igs = [ig]
                break

    if ig_data:
        if not existing_igs and ig_data.get("username"):
            patch["instagram"] = [str(ig_data["username"])]
        bio = (ig_data.get("biography") or ig_data.get("bio") or "")[:500]
        if bio:
            found = text_contacts(bio)
            if not existing_phones and found["phone"] and "phone" not in patch:
                patch["phone"] = found["phone"]
            if not existing_emails and found["email"] and "email" not in patch:
                patch["email"] = found["email"]
        if not existing_websites and ig_data.get("website"):
            href = normalize_website(str(ig_data["website"]))
            if href:
                patch["website"] = [href]
        if (
            not (row.get("person_name") or "").strip()
            and not (row.get("business_name") or "").strip()
            and ig_data.get("full_name")
        ):
            name = str(ig_data["full_name"]).strip()
            if len(name) >= 2:
                patch["person_name"] = name[:120]

    return patch, notes


def fetch_queue(
    client: SupabaseRest, *, limit: int | None, only_with_links: bool
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": SELECT,
                    "review_status": f"in.({','.join(QUEUE_STATUSES)})",
                    "order": "updated_at.desc",
                    "offset": str(offset),
                    "limit": "500",
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if limit is not None and len(rows) >= limit * 3:
            # fetch extra then filter
            break
        if len(batch) < 500:
            break
    if only_with_links:
        filtered = []
        for r in rows:
            if r.get("website") or r.get("instagram"):
                filtered.append(r)
                continue
            text = f"{r.get('description') or ''}\n{r.get('source_text') or ''}"
            if "http://" in text or "https://" in text or "instagram.com" in text.lower():
                filtered.append(r)
        rows = filtered
    if limit is not None:
        rows = rows[:limit]
    return rows


def resolve_telegram_senders(
    items: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """item_id → {telegram_username, person_name, telegram_user_id} from message sender."""
    from telegram_photos import TelegramPhotoClient

    by_chat: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in items:
        try:
            chat = int(row.get("source_chat_id"))
        except (TypeError, ValueError):
            continue
        if chat not in ALLOWED_CHATS:
            continue
        mids = []
        for x in row.get("source_message_ids") or []:
            try:
                mids.append(int(x))
            except (TypeError, ValueError):
                continue
        if not mids:
            continue
        by_chat[chat].append({"row": row, "mid": mids[0]})

    out: dict[str, dict[str, Any]] = {}
    if not by_chat:
        return out

    tg = TelegramPhotoClient()
    tg.connect()
    try:
        client = tg._client
        loop = tg._loop
        assert client is not None and loop is not None
        total_msgs = sum(len({e["mid"] for e in v}) for v in by_chat.values())
        print(f"telegram: {total_msgs} unique messages across {len(by_chat)} chats")

        for chat_id, entries in by_chat.items():
            id_to_entries: dict[int, list[dict[str, Any]]] = defaultdict(list)
            for e in entries:
                id_to_entries[e["mid"]].append(e)
            mids = list(id_to_entries.keys())
            for i in range(0, len(mids), 50):
                chunk = mids[i : i + 50]
                print(
                    f"  chat {chat_id}: messages {i + 1}-{i + len(chunk)}/{len(mids)}",
                    flush=True,
                )

                async def _fetch(cids: list[int] = chunk, cid: int = chat_id):
                    return await client.get_messages(cid, ids=cids)

                try:
                    messages = loop.run_until_complete(_fetch())
                except Exception as exc:  # noqa: BLE001
                    print(f"warn: get_messages {chat_id}: {exc}", file=sys.stderr)
                    continue
                if not isinstance(messages, list):
                    messages = [messages]
                for msg in messages:
                    if msg is None:
                        continue
                    sender = getattr(msg, "sender", None)
                    if sender is None and getattr(msg, "sender_id", None) is not None:
                        try:

                            async def _ent(m=msg):
                                return await client.get_entity(m.sender_id)

                            sender = loop.run_until_complete(
                                asyncio.wait_for(_ent(), timeout=8)
                            )
                        except Exception:  # noqa: BLE001
                            sender = None
                    if sender is None:
                        continue
                    username = getattr(sender, "username", None)
                    first = (getattr(sender, "first_name", None) or "").strip()
                    last = (getattr(sender, "last_name", None) or "").strip()
                    display = f"{first} {last}".strip() or None
                    uid = getattr(sender, "id", None) or getattr(msg, "sender_id", None)
                    if hasattr(uid, "user_id"):
                        uid = uid.user_id
                    payload = {
                        "telegram_username": username,
                        "person_name": display,
                        "telegram_user_id": str(uid) if uid else None,
                    }
                    for e in id_to_entries.get(int(msg.id), []):
                        out[e["row"]["id"]] = payload
    finally:
        tg.close()
    return out


BOT_USERNAME_RE = re.compile(r"(?:_bot|bot)$", re.I)
KNOWN_SOURCE_BOTS = {
    "orangecountyla_bot",
    "funformom",
    "ffm_bot",
}


def _is_bot_username(username: str | None) -> bool:
    if not username:
        return False
    u = username.strip().lstrip("@").lower()
    return u in KNOWN_SOURCE_BOTS or bool(BOT_USERNAME_RE.search(u))


def merge_tg_patch(row: dict[str, Any], resolved: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    username = resolved.get("telegram_username")
    if username and _is_bot_username(str(username)):
        username = None
    if username and not (row.get("telegram_username") or "").strip():
        patch["telegram_username"] = str(username).lstrip("@")
    if resolved.get("telegram_user_id") and not str(row.get("telegram_user_id") or "").strip():
        patch["telegram_user_id"] = str(resolved["telegram_user_id"])
    # Skip display names that clearly belong to channel bots
    display = (resolved.get("person_name") or "").strip()
    if display and _is_bot_username(display.replace(" ", "")):
        display = ""
    if display and not (row.get("person_name") or "").strip():
        title = (row.get("title") or "").strip()
        if not title or title.startswith("@") or len(title) < 3:
            patch["person_name"] = display[:120]
        else:
            patch["person_name"] = display[:120]
    return patch


def apply_patch(client: SupabaseRest, item_id: str, patch: dict[str, Any]) -> None:
    if not patch:
        return
    client.patch("import_review_items", {"id": f"eq.{item_id}"}, patch)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--skip-telegram",
        action="store_true",
        help="Skip Telethon sender resolve",
    )
    parser.add_argument(
        "--skip-web",
        action="store_true",
        help="Skip website/Instagram fetch",
    )
    parser.add_argument(
        "--links-only",
        action="store_true",
        help="Only rows that already have website/IG/URL in text",
    )
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1

    client = SupabaseRest(url, key)
    rows = fetch_queue(client, limit=args.limit, only_with_links=args.links_only)
    print(f"loaded {len(rows)} queue rows")

    tg_map: dict[str, dict[str, Any]] = {}
    if not args.skip_telegram:
        print("resolving Telegram senders…")
        try:
            tg_map = resolve_telegram_senders(rows)
            print(f"telegram resolved {len(tg_map)} messages")
        except Exception as exc:  # noqa: BLE001
            print(f"warn: telegram resolve failed: {exc}", file=sys.stderr)

    stats = Counter()
    field_fills = Counter()
    samples: list[dict[str, Any]] = []

    for idx, row in enumerate(rows, 1):
        patch: dict[str, Any] = {}
        notes: list[str] = []

        text_patch = build_text_patch(row)
        patch.update(text_patch)
        if text_patch:
            notes.append("text")

        if row["id"] in tg_map:
            tg_patch = merge_tg_patch(row, tg_map[row["id"]])
            for k, v in tg_patch.items():
                if k not in patch:
                    patch[k] = v
            if tg_patch:
                notes.append("telegram")

        # Web only when links exist (or discovered in text)
        needs_web = bool(row.get("website") or row.get("instagram"))
        blob = f"{row.get('description') or ''}\n{row.get('source_text') or ''}"
        if "http" in blob.lower() or "instagram.com" in blob.lower():
            needs_web = True
        if needs_web and not args.skip_web:
            web_patch, web_notes = build_web_patch(row)
            for k, v in web_patch.items():
                # don't overwrite earlier fills in this same patch unless empty in row
                if k not in patch:
                    patch[k] = v
                elif k in ("phone", "email", "website", "instagram") and isinstance(
                    v, list
                ):
                    merged = _merge_unique(
                        _as_str_list(patch.get(k)), _as_str_list(v)
                    )
                    if merged is not None:
                        patch[k] = merged
            notes.extend(web_notes)
            if web_patch:
                notes.append("web")

        if not patch:
            stats["unchanged"] += 1
            continue

        stats["patched"] += 1
        for k in patch:
            field_fills[k] += 1
        if len(samples) < 25:
            samples.append(
                {
                    "id": row["id"][:8],
                    "title": (row.get("title") or row.get("person_name") or "")[:40],
                    "patch": patch,
                    "notes": notes[:6],
                }
            )

        if args.apply:
            try:
                apply_patch(client, row["id"], patch)
                stats["applied"] += 1
            except Exception as exc:  # noqa: BLE001
                stats["errors"] += 1
                print(f"ERROR {row['id']}: {exc}", file=sys.stderr)

        if idx % 100 == 0:
            print(f"… {idx}/{len(rows)} patched={stats['patched']}")

    report = {
        "mode": "apply" if args.apply else "dry_run",
        "loaded": len(rows),
        "stats": dict(stats),
        "fields_filled": dict(field_fills),
        "telegram_resolved": len(tg_map),
        "samples": samples,
    }
    out = ROOT / "scripts/import-review/data/enrich_queue_report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"Wrote {out}")
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
