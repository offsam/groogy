#!/usr/bin/env python3
"""Enrich Facebook recommendation events in the pending queue (NO auto-publish).

Affiche Phase 1: candidates stay in import_comment_recommendations until
Admin Inbox → Events → Approve.

Usage:
  python3 scripts/facebook-collector/publish_recommendation_events.py
  python3 scripts/facebook-collector/publish_recommendation_events.py --apply
      # enrich covers / reject junk on pending rows only

  python3 scripts/facebook-collector/publish_recommendation_events.py --force-publish --apply
      # LEGACY emergency: write directly to public.events (discouraged)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "media-pipeline"))

from common import SupabaseRest, load_env  # noqa: E402
from storage_client import MediaSupabase  # noqa: E402

RAW_GLOBS = [
    ROOT / "scripts/facebook-collector/data/poc/multi_group_6m" / "*_raw.json",
    ROOT / "scripts/facebook-collector/data/poc" / "*_raw.json",
]

MONTHS_RU = {
    "январ": 1,
    "феврал": 2,
    "март": 3,
    "апрел": 4,
    "ма": 5,
    "июн": 6,
    "июл": 7,
    "август": 8,
    "сентябр": 9,
    "октябр": 10,
    "ноябр": 11,
    "декабр": 12,
}
MONTHS_EN = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}

JUNK_TITLE_RE = re.compile(
    r"("
    r"какое\s+мероприятие\s+больше|"
    r"куда\s+собираетесь\s+пойти|"
    r"что\s+будете\s+делать\s+на\s+выходн|"
    r"опрос\b|голосуй|проголосуй"
    r")",
    re.I,
)
NOT_EVENT_RE = re.compile(
    r"("
    r"ищу\s+работ|ищем\s+(сотрудник|ассистент|повар|фотограф|артист|оператор)|"
    r"нанима|ваканси|hiring|looking\s+for\s+(a\s+)?(job|chef|photographer)|"
    r"приглаша(ет|ем|ю)\s+в\s+команд|растём\s+и\s+ищем|"
    r"сдам\s+(зал|земл|квартир|студи|апартамент)|"
    r"сда[её]тся|аренда\s+\$|\$\d+\s*/\s*мес|арендная\s+плат|"
    r"ищу\s+подработ|ищу\s+работ|"
    r"на\s+заказ[!]?|"
    r"прода[её]м|куплю\s|"
    r"финансовая\s+ошибка|"
    r"кандидат\s+for|city\s+council|"
    r"фотосессия|photoshoot|"
    r"ищу\s+проверенную\s+доставк|"
    r"ищете\s+ведущего|"
    r"не\s+забудьте\s+про\s+свою\s+красоту|"
    r"подарить\s+себе|что\s+подарить"
    r")",
    re.I,
)
STRONG_EVENT_RE = re.compile(
    r"("
    r"эфир|вебинар|workshop|воркшоп|meetup|митап|конференц|"
    r"мероприят|регистрац|билет|tickets?|"
    r"приглаша(ю|ем|ет)|присоединя|"
    r"speed\s*dating|retreat|open\s+decks|"
    r"мастер[\s-]?класс|фестиваль|квиз|quiz|"
    r"tonight|tomorrow|уже\s+завтра|сегодня\s+в\s+\d|"
    r"\b\d{1,2}\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\w*"
    r"|"
    r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}"
    r")",
    re.I,
)
ONLINE_RE = re.compile(
    r"эфир|вебинар|zoom|youtube|стрим|online|онлайн|lu\.ma|eventbrite",
    re.I,
)


_TRANSLIT = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "е": "e",
    "ё": "e",
    "ж": "zh",
    "з": "z",
    "и": "i",
    "й": "i",
    "к": "k",
    "л": "l",
    "м": "m",
    "н": "n",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "у": "u",
    "ф": "f",
    "х": "h",
    "ц": "c",
    "ч": "ch",
    "ш": "sh",
    "щ": "sch",
    "ъ": "",
    "ы": "y",
    "ь": "",
    "э": "e",
    "ю": "yu",
    "я": "ya",
}


def slugify(title: str) -> str:
    """ASCII-only slug — Cyrillic paths 404 in Next for some long URLs."""
    out: list[str] = []
    for ch in (title or "").lower():
        if ch in _TRANSLIT:
            out.append(_TRANSLIT[ch])
        elif ("a" <= ch <= "z") or ("0" <= ch <= "9"):
            out.append(ch)
        elif ch.isspace() or ch in "-_":
            out.append("-")
    base = re.sub(r"-+", "-", "".join(out)).strip("-")[:48] or "event"
    stamp = hashlib.sha1(title.encode("utf-8")).hexdigest()[:6]
    return f"{base}-{stamp}"


def post_url(post: dict[str, Any]) -> str | None:
    for key in ("url", "postUrl", "facebookUrl", "topLevelUrl", "link"):
        val = post.get(key)
        if isinstance(val, str) and val.startswith("http"):
            return val.split("?")[0]
    return None


def attachment_image_url(att: dict[str, Any]) -> str | None:
    for key in ("photo_image", "image", "large_share_image", "flexible_height_share_image"):
        node = att.get(key)
        if isinstance(node, dict):
            uri = node.get("uri") or node.get("url")
            if isinstance(uri, str) and uri.startswith("http") and (
                "fbcdn" in uri or "scontent" in uri
            ):
                return uri
        if isinstance(node, str) and node.startswith("http") and (
            "fbcdn" in node or "scontent" in node
        ):
            return node
    thumb = att.get("thumbnail")
    if isinstance(thumb, str) and thumb.startswith("http") and (
        "fbcdn" in thumb or "scontent" in thumb
    ):
        # Prefer real photo CDN over external link previews when possible
        if "scontent" in thumb or "/t39." in thumb or "/t15." in thumb:
            return thumb
        if "external-" in thumb and "zoom" in thumb:
            return None
        return thumb
    return None


def build_post_image_index() -> dict[str, str]:
    index: dict[str, str] = {}
    files: list[Path] = []
    for pattern in RAW_GLOBS:
        files.extend(sorted(pattern.parent.glob(pattern.name)))
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        posts = data if isinstance(data, list) else (
            data.get("posts") or data.get("items") or data.get("data") or []
        )
        for post in posts:
            if not isinstance(post, dict):
                continue
            url = post_url(post)
            if not url or url in index:
                continue
            for att in post.get("attachments") or []:
                if not isinstance(att, dict):
                    continue
                img = attachment_image_url(att)
                if img:
                    index[url] = img
                    break
    return index


def og_image_from_url(page_url: str) -> str | None:
    try:
        req = urllib.request.Request(
            page_url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; KrugiBot/1.0)"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read(180_000).decode("utf-8", errors="ignore")
    except Exception:  # noqa: BLE001
        return None
    m = re.search(
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        html,
        re.I,
    )
    if not m:
        m = re.search(
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
            html,
            re.I,
        )
    if not m:
        return None
    return m.group(1).strip()


def download_bytes(url: str) -> tuple[bytes, str] | None:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; KrugiBot/1.0)"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = resp.read()
            ctype = (resp.headers.get("Content-Type") or "image/jpeg").split(";")[0].strip()
        if len(data) < 1200:
            return None
        if "image" not in ctype and not url.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            ctype = "image/jpeg"
        return data, ctype
    except Exception:  # noqa: BLE001
        return None


def parse_starts_at(label: str | None, posted_iso: str | None) -> str | None:
    """Infer event start from a date label, anchored to when the post was written."""
    text = (label or "").strip().lower()
    # Prefer explicit year in label/text
    year_m = re.search(r"\b(20\d{2})\b", text)
    explicit_year = int(year_m.group(1)) if year_m else None

    posted: datetime | None = None
    if posted_iso:
        try:
            posted = datetime.fromisoformat(posted_iso.replace("Z", "+00:00"))
        except ValueError:
            posted = None

    anchor = posted or datetime.now(timezone.utc)

    def build(year: int, month: int, day: int) -> str | None:
        try:
            return datetime(year, month, day, 17, 0, tzinfo=timezone.utc).isoformat()
        except ValueError:
            return None

    def resolve_ymd(month: int, day: int) -> str | None:
        if explicit_year:
            return build(explicit_year, month, day)
        # Same calendar year as the post first
        candidate = build(anchor.year, month, day)
        if not candidate:
            return None
        cand_dt = datetime.fromisoformat(candidate)
        # If "March 5" appears in a post from March 20 → likely next year
        if cand_dt.date() < (anchor.date() - timedelta(days=14)):
            return build(anchor.year + 1, month, day)
        return candidate

    # ranges like 7–9 августа → use first day
    m = re.search(
        r"(\d{1,2})\s*[–—\-]\s*(\d{1,2})\s+([а-яё]+)",
        text,
        re.I,
    )
    if m:
        day = int(m.group(1))
        mon_raw = m.group(3)
        month = next((v for k, v in MONTHS_RU.items() if mon_raw.startswith(k)), None)
        if month:
            out = resolve_ymd(month, day)
            if out:
                return out

    m = re.search(r"(\d{1,2})\s+([а-яё]+)", text, re.I)
    if m:
        day = int(m.group(1))
        mon_raw = m.group(2)
        month = next((v for k, v in MONTHS_RU.items() if mon_raw.startswith(k)), None)
        if month:
            out = resolve_ymd(month, day)
            if out:
                return out

    m = re.search(
        r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})",
        text,
        re.I,
    )
    if m:
        month = MONTHS_EN[m.group(1).lower()]
        day = int(m.group(2))
        out = resolve_ymd(month, day)
        if out:
            return out

    m = re.search(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", text)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if m.group(3):
            y = int(m.group(3))
            if y < 100:
                y += 2000
            month, day = a, b
            if month > 12:
                day, month = a, b
            return build(y, month, day)
        month, day = a, b
        if month > 12:
            day, month = a, b
        return resolve_ymd(month, day)

    return posted_iso


def guess_format(text: str, websites: list[str]) -> str:
    blob = f"{text} {' '.join(websites)}"
    if ONLINE_RE.search(blob):
        return "online"
    return "unknown"


def is_junk(item: dict[str, Any]) -> bool:
    title = item.get("display_name") or ""
    if JUNK_TITLE_RE.search(title):
        return True
    if len(title.strip()) < 12:
        return True
    return False


def is_publishable_event(item: dict[str, Any]) -> bool:
    """Keep real meetups/webinars; drop jobs, rentals, product ads."""
    blob = " ".join(
        [
            item.get("display_name") or "",
            " ".join(item.get("request_snippets") or []),
            " ".join(item.get("websites") or []),
            item.get("event_at") or "",
        ]
    )
    if NOT_EVENT_RE.search(blob):
        return False
    if STRONG_EVENT_RE.search(blob):
        return True
    # Series cards with websites + event_at still ok
    if item.get("event_at") and (item.get("websites") or item.get("source_post_urls")):
        return True
    return False


def clean_title(title: str) -> str:
    t = re.sub(r"\s+", " ", title or "").strip()
    t = re.sub(r"^[🔴📢🔥✅\s]+", "", t)
    return t[:140] or "Событие"


def resolve_cover_source(
    item: dict[str, Any], post_images: dict[str, str]
) -> str | None:
    for url in item.get("source_post_urls") or []:
        key = str(url).split("?")[0]
        if key in post_images:
            return post_images[key]
        # fuzzy: permalink match without domain variants
        for k, img in post_images.items():
            if key.rstrip("/") in k or k.rstrip("/") in key:
                return img
    for site in item.get("websites") or []:
        if not isinstance(site, str) or not site.startswith("http"):
            continue
        og = og_image_from_url(site)
        if og:
            return og
    return None


def upload_cover(
    storage: MediaSupabase, event_id: str, source_url: str
) -> str | None:
    downloaded = download_bytes(source_url)
    if not downloaded:
        return None
    data, ctype = downloaded
    ext = "jpg"
    if "png" in ctype:
        ext = "png"
    elif "webp" in ctype:
        ext = "webp"
    path = f"covers/{event_id}/cover.{ext}"
    try:
        storage.upload(
            "event-images",
            path,
            data,
            content_type=ctype if ctype.startswith("image/") else f"image/{ext}",
            upsert=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"  cover upload failed: {exc}")
        return None
    return storage.public_url("event-images", path)


def fetch_pending_events(client: SupabaseRest) -> list[dict[str, Any]]:
    rows = client._request(
        "GET",
        "/import_comment_recommendations",
        params={
            "select": "*",
            "kind": "eq.event",
            "status": "eq.pending",
            "order": "mention_count.desc",
            "limit": "500",
        },
    )
    return list(rows or [])


def publish_one(
    client: SupabaseRest,
    storage: MediaSupabase,
    item: dict[str, Any],
    post_images: dict[str, str],
    *,
    apply: bool,
    force_publish: bool,
) -> dict[str, Any]:
    title = clean_title(item.get("display_name") or "Событие")
    if is_junk(item) or not is_publishable_event(item):
        reason = (
            "Авто: опрос / не событие"
            if is_junk(item)
            else "Авто: не похоже на мероприятие (вакансия/аренда/услуга)"
        )
        if apply:
            client._request(
                "PATCH",
                "/import_comment_recommendations",
                params={"id": f"eq.{item['id']}"},
                body={"status": "rejected", "notes": reason},
                prefer="return=minimal",
            )
        return {"id": item["id"], "action": "skip_junk", "title": title}

    description_parts = []
    for snip in (item.get("request_snippets") or [])[:2]:
        if snip and snip not in description_parts:
            description_parts.append(snip)
    description = "\n\n".join(description_parts)[:4000] or None
    websites = [w for w in (item.get("websites") or []) if isinstance(w, str)]
    registration = websites[0] if websites else None
    source = (item.get("source_post_urls") or [None])[0]
    city = item.get("city")
    posted = item.get("last_posted_at")
    starts_at = parse_starts_at(item.get("event_at"), posted)
    fmt = guess_format(
        f"{title} {description or ''}",
        websites,
    )
    cover_src = item.get("cover_image_url") or resolve_cover_source(item, post_images)

    result = {
        "id": item["id"],
        "title": title,
        "city": city,
        "cover_src": bool(cover_src),
        "action": "dry_run",
    }
    if not apply:
        return result

    # Default path: enrich pending row only (no public.events insert).
    if not force_publish:
        cover_url = None
        if cover_src and not item.get("cover_image_url"):
            cover_url = upload_cover(storage, str(item["id"]), cover_src)
        patch: dict[str, Any] = {
            "external_source": item.get("external_source") or "facebook",
            "source_language": item.get("source_language") or "ru",
        }
        if starts_at:
            patch["starts_at"] = starts_at
        if registration:
            patch["registration_url"] = registration
        if cover_url or cover_src:
            patch["cover_image_url"] = cover_url or cover_src
        client._request(
            "PATCH",
            "/import_comment_recommendations",
            params={"id": f"eq.{item['id']}"},
            body=patch,
            prefer="return=minimal",
        )
        result["action"] = "enriched_pending"
        result["cover"] = bool(cover_url or cover_src or item.get("cover_image_url"))
        return result

    # LEGACY --force-publish: write directly to public.events
    event_id = str(__import__("uuid").uuid4())
    cover_url = None
    if cover_src:
        cover_url = upload_cover(storage, event_id, cover_src)
        client._request(
            "PATCH",
            "/import_comment_recommendations",
            params={"id": f"eq.{item['id']}"},
            body={"cover_image_url": cover_url or cover_src},
            prefer="return=minimal",
        )

    slug = slugify(title)
    existing = client._request(
        "GET",
        "/events",
        params={"select": "id", "slug": f"eq.{slug}", "limit": "1"},
    )
    if existing:
        slug = f"{slug}-{int(time.time()) % 10000}"

    body_text = None
    for snip in item.get("request_snippets") or []:
        if snip and (not body_text or len(snip) > len(body_text)):
            body_text = snip
    if description and (not body_text or len(description) > len(body_text)):
        body_text = description

    row = {
        "id": event_id,
        "title": title,
        "slug": slug,
        "description": description,
        "status": "published",
        "starts_at": starts_at,
        "event_at_label": item.get("event_at"),
        "city": city,
        "cover_image_url": cover_url,
        "registration_url": registration,
        "source_url": source,
        "source_posted_at": posted,
        "source_body": body_text,
        "source_channel": item.get("source_channel") or "facebook",
        "format": fmt,
        "external_source": "facebook",
        "source_language": "ru",
    }
    client._request(
        "POST",
        "/events",
        body=row,
        prefer="return=minimal",
    )
    client._request(
        "PATCH",
        "/import_comment_recommendations",
        params={"id": f"eq.{item['id']}"},
        body={
            "status": "approved",
            "published_entity_type": "event",
            "published_entity_id": event_id,
            "cover_image_url": cover_url or item.get("cover_image_url"),
        },
        prefer="return=minimal",
    )
    result["action"] = "published"
    result["event_id"] = event_id
    result["slug"] = slug
    result["cover"] = bool(cover_url)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes (default enrich pending only)",
    )
    parser.add_argument(
        "--force-publish",
        action="store_true",
        help="LEGACY: insert into public.events (prefer Admin Approve)",
    )
    args = parser.parse_args()

    if args.force_publish:
        print(
            "WARNING: --force-publish bypasses Admin Inbox. "
            "Prefer Approve in Review Center → Events.",
            file=sys.stderr,
        )

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1

    print("Indexing FB post images…")
    post_images = build_post_image_index()
    print(f"  post image index: {len(post_images)}")

    client = SupabaseRest(url, key)
    storage = MediaSupabase(url, key)
    items = fetch_pending_events(client)
    print(f"pending event recommendations: {len(items)}")
    if not args.force_publish:
        print("Mode: enrich pending only (no auto-publish).")

    stats = {
        "published": 0,
        "skip_junk": 0,
        "dry_run": 0,
        "enriched_pending": 0,
        "with_cover": 0,
    }
    for item in items:
        res = publish_one(
            client,
            storage,
            item,
            post_images,
            apply=args.apply,
            force_publish=args.force_publish,
        )
        action = res["action"]
        stats[action] = stats.get(action, 0) + 1
        if res.get("cover") or (action == "dry_run" and res.get("cover_src")):
            stats["with_cover"] += 1
        print(
            f"  [{action}] {(res.get('title') or '')[:70]} "
            f"city={res.get('city')} cover={res.get('cover') or res.get('cover_src')}"
        )

    print("stats:", json.dumps(stats, ensure_ascii=False))
    if not args.apply:
        print("dry-run only; pass --apply to write DB + storage")
    if not args.force_publish:
        print(
            "Review pending in Admin → Inbox → Events — ждут выкладки.",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
