#!/usr/bin/env python3
"""Idempotent import of Reviewer v1 needs_review → import_review_items.

Usage:
  python scripts/import-review/import_needs_review.py --dry-run
  python scripts/import-review/import_needs_review.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = (
    ROOT
    / "scripts"
    / "telegram-collector"
    / "data"
    / "full"
    / "fun_for_mom_reviewer_v1.json"
)

ENTITY_TYPES = {
    "business",
    "private_specialist",
    "marketplace_listing",
    "organization",
    "event",
    "job",
    "real_estate",
}
TARGET_COLLECTIONS = {
    "businesses",
    "private_specialists",
    "services",
    "marketplace",
    "jobs",
    "events",
    "organizations",
    "real_estate",
}
LOCKED_STATUSES = {"approved", "rejected", "duplicate"}


def load_env() -> None:
    env_path = ROOT / ".env.local"
    if not env_path.is_file():
        return
    for line in env_path.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if item is None:
                continue
            s = str(item).strip()
            if s:
                out.append(s)
        return out
    s = str(value).strip()
    return [s] if s else []


def first_price(entity: dict[str, Any], marketplace: dict[str, Any] | None) -> tuple[float | None, str | None]:
    if marketplace:
        price = marketplace.get("price")
        currency = marketplace.get("currency")
        if price is not None:
            try:
                return float(price), (str(currency).upper() if currency else "USD")
            except (TypeError, ValueError):
                pass
    prices = entity.get("prices") or []
    if isinstance(prices, list) and prices:
        p0 = prices[0]
        if isinstance(p0, dict):
            try:
                return float(p0.get("amount")), (str(p0.get("currency") or "USD").upper())
            except (TypeError, ValueError):
                return None, None
        try:
            return float(p0), "USD"
        except (TypeError, ValueError):
            return None, None
    return None, None


def source_fingerprint(source: str, chat_id: Any, message_ids: list[Any]) -> str:
    ids = sorted({int(x) for x in message_ids if x is not None})
    chat = str(chat_id) if chat_id is not None else ""
    return f"{source}:{chat}:{','.join(str(i) for i in ids)}"


def map_post(post: dict[str, Any]) -> dict[str, Any]:
    entity = post.get("extracted_entity") or {}
    marketplace = entity.get("marketplace") if isinstance(entity.get("marketplace"), dict) else {}
    message_ids = post.get("source_message_ids") or [post.get("primary_message_id") or post.get("message_id")]
    message_ids = [int(x) for x in message_ids if x is not None]
    chat_id = post.get("source_chat_id") or post.get("chat_id")
    sender_id = entity.get("telegram_user_id") or post.get("sender_id")
    tg_list = as_list(entity.get("telegram"))
    username = None
    if tg_list:
        username = tg_list[0].lstrip("@")
    elif post.get("sender_username"):
        username = str(post["sender_username"]).lstrip("@")

    entity_type = entity.get("entity_type")
    if entity_type not in ENTITY_TYPES:
        entity_type = None
    target = entity.get("target_collection")
    if target not in TARGET_COLLECTIONS:
        target = None

    price, currency = first_price(entity, marketplace)
    title = (
        marketplace.get("title")
        or entity.get("business_name")
        or entity.get("person_name")
        or entity.get("telegram_display_name")
        or post.get("sender_name")
    )
    description = entity.get("description") or post.get("merged_text") or post.get("text")
    photos_count = int(post.get("media_count") or marketplace.get("photos_count") or 0)
    source_media: list[dict[str, Any]] = []
    if photos_count > 0 or post.get("has_media"):
        for mid in message_ids:
            source_media.append(
                {
                    "telegram_message_id": mid,
                    "media_type": post.get("media_type") or "unknown",
                    "original_filename": None,
                    "width": None,
                    "height": None,
                    "telegram_media_reference": None,
                    "download_status": "pending",
                    "storage_path": None,
                }
            )

    posted_at = (
        post.get("message_date_start")
        or post.get("message_date")
        or entity.get("source_date")
    )

    return {
        "source": "telegram",
        "source_group": post.get("chat_title") or "Fun for Mom",
        "source_chat_id": str(chat_id) if chat_id is not None else None,
        "source_message_ids": message_ids,
        "source_fingerprint": source_fingerprint("telegram", chat_id, message_ids),
        "source_author_id": str(sender_id) if sender_id is not None else None,
        "source_author_username": username,
        "source_author_display_name": entity.get("telegram_display_name")
        or post.get("sender_name"),
        "source_posted_at": posted_at,
        "source_text": post.get("merged_text") or post.get("text"),
        "source_url": post.get("telegram_message_link"),
        "source_media": source_media,
        "ai_decision": post.get("decision") or post.get("reviewer_action"),
        "ai_confidence": post.get("confidence") or post.get("reviewer_confidence"),
        "ai_reason": post.get("reviewer_reason")
        or post.get("decision_reason")
        or post.get("missing_fields") and f"missing:{post.get('missing_fields')}",
        "entity_type": entity_type,
        "target_collection": target,
        "category": entity.get("category"),
        "subcategory": entity.get("subcategory"),
        "title": title,
        "business_name": entity.get("business_name"),
        "person_name": entity.get("person_name"),
        "description": description,
        "services": as_list(entity.get("services")),
        "price": price,
        "currency": currency,
        "city": entity.get("city") or marketplace.get("city"),
        "state": entity.get("state"),
        "phone": as_list(entity.get("phone")),
        "whatsapp": as_list(entity.get("whatsapp")),
        "telegram_username": username,
        "telegram_user_id": str(sender_id) if sender_id is not None else None,
        "instagram": as_list(entity.get("instagram")),
        "website": as_list(entity.get("website")),
        "email": as_list(entity.get("email")),
        "photos_count": photos_count,
        "duplicate_status": post.get("duplicate_status"),
        "recurring_cluster_id": post.get("duplicate_of_internal_post_id")
        or post.get("internal_post_id"),
        "occurrence_count": post.get("occurrence_count"),
        "first_seen": post.get("first_seen_at"),
        "last_seen": post.get("last_seen_at"),
        "raw_payload": post,
        "review_status": "pending",
    }


class SupabaseRest:
    def __init__(self, url: str, service_key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.key = service_key

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        body: Any = None,
        prefer: str | None = None,
    ) -> Any:
        qs = f"?{urllib.parse.urlencode(params)}" if params else ""
        req = urllib.request.Request(
            f"{self.base}{path}{qs}",
            method=method,
            data=None if body is None else json.dumps(body).encode("utf-8"),
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                **({"Prefer": prefer} if prefer else {}),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
            raise RuntimeError(f"HTTP {exc.code} {path}: {detail}") from exc

    def fetch_existing(self, fingerprints: list[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        # chunk to avoid long URLs
        chunk_size = 80
        for i in range(0, len(fingerprints), chunk_size):
            chunk = fingerprints[i : i + chunk_size]
            # PostgREST: in.(a,b,c)
            quoted = ",".join(urllib.parse.quote(f, safe="") for f in chunk)
            # Use filter via params — fingerprints may contain commas already encoded in value
            # Better: use or / filter with quoted values
            values = ",".join(f'"{f}"' for f in chunk)
            rows = self._request(
                "GET",
                "/import_review_items",
                params={
                    "select": "id,source_fingerprint,review_status,updated_at",
                    "source_fingerprint": f"in.({values})",
                },
            )
            for row in rows or []:
                out[row["source_fingerprint"]] = row
        return out

    def insert_many(self, rows: list[dict[str, Any]], *, attempts: int = 4) -> int:
        if not rows:
            return 0
        last_exc: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                self._request(
                    "POST",
                    "/import_review_items",
                    body=rows,
                    prefer="return=minimal",
                )
                return len(rows)
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt == attempts:
                    break
                import time

                time.sleep(1.5 * attempt)
        assert last_exc is not None
        raise last_exc

    def update_pending(self, item_id: str, row: dict[str, Any]) -> None:
        payload = {k: v for k, v in row.items() if k != "raw_payload"}
        # Keep raw_payload immutable on updates of already-imported pending rows:
        # only refresh editable/source fields for pending/in_review/needs_more_info.
        self._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{item_id}"},
            body=payload,
            prefer="return=minimal",
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--refresh-pending",
        action="store_true",
        help="Also PATCH existing pending/in_review/needs_more_info rows",
    )
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    if args.dry_run and args.apply:
        print("Use only one of --dry-run / --apply", file=sys.stderr)
        return 2

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    data = json.loads(args.source.read_text(encoding="utf-8"))
    posts = [p for p in data.get("posts") or [] if p.get("decision") == "needs_review"]
    if args.limit:
        posts = posts[: args.limit]

    rows = [map_post(p) for p in posts]
    fingerprints = [r["source_fingerprint"] for r in rows]
    # detect mapping errors
    errors: list[str] = []
    for r in rows:
        if not r["source_message_ids"]:
            errors.append(f"missing message ids: {r.get('title')}")
        if not r["source_fingerprint"]:
            errors.append("empty fingerprint")

    client = SupabaseRest(url, key)
    existing = client.fetch_existing(fingerprints) if rows else {}

    to_insert: list[dict[str, Any]] = []
    to_update: list[tuple[str, dict[str, Any]]] = []
    skipped_locked = 0
    skipped_same = 0

    for row in rows:
        fp = row["source_fingerprint"]
        prev = existing.get(fp)
        if not prev:
            to_insert.append(row)
            continue
        status = prev.get("review_status")
        if status in LOCKED_STATUSES:
            skipped_locked += 1
            continue
        if not args.refresh_pending:
            skipped_same += 1
            continue
        # Safe refresh for pending / in_review / needs_more_info — no raw_payload overwrite
        update_row = dict(row)
        update_row.pop("raw_payload", None)
        update_row.pop("review_status", None)  # do not reset manual status
        update_row.pop("source_fingerprint", None)
        to_update.append((prev["id"], update_row))

    already = len(existing)
    print("=== Import Review dry-run ===" if args.dry_run else "=== Import Review apply ===")
    print(f"source: {args.source}")
    print(f"needs_review found: {len(posts)}")
    print(f"already existing: {already}")
    print(f"new: {len(to_insert)}")
    print(f"updatable (pending/in_review/needs_more_info): {len(to_update)}")
    print(f"skipped unchanged existing: {skipped_same}")
    print(f"skipped locked (approved/rejected/duplicate): {skipped_locked}")
    print(f"errors: {len(errors)}")
    for e in errors[:10]:
        print(f"  error: {e}")

    if args.dry_run:
        return 0 if not errors else 1

    # apply
    inserted = 0
    updated = 0
    batch = 100
    for i in range(0, len(to_insert), batch):
        chunk = to_insert[i : i + batch]
        client.insert_many(chunk)
        inserted += len(chunk)
        print(f"inserted {inserted}/{len(to_insert)}", flush=True)

    for item_id, payload in to_update:
        client.update_pending(item_id, payload)
        updated += 1
        if updated % 100 == 0:
            print(f"updated {updated}/{len(to_update)}", flush=True)

    print(f"done: inserted={inserted} updated={updated} skipped_locked={skipped_locked}")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
