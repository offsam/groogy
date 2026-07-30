"""Shared helpers for import-review scripts."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from group_location import merge_city_with_group

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REVIEWER_SOURCE = (
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
    "lechu_listing",
    "transfer_listing",
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
    "lechu",
    "transfers",
}

# Autopublish supports these public collections only.
SUPPORTED_AUTOPUBLISH_COLLECTIONS = {
    "businesses",
    "private_specialists",
    "services",
    "organizations",
    "marketplace",
    "real_estate",
}
# City is only required when there is no usable direct contact.
CITY_REQUIRED_WITHOUT_CONTACT = {
    "businesses",
    "private_specialists",
    "services",
    "organizations",
    "real_estate",
}

# Age matters only for time-sensitive offers (not evergreen businesses/specialists).
AGE_SENSITIVE_COLLECTIONS = {
    "marketplace",
    "real_estate",  # rentals / property listings
    "jobs",
    "events",
    "lechu",
}

HIGH_CONFIDENCE_MIN = 0.85
# Complete-card queue autopublish: phone + real description, allow needs_review.
COMPLETE_CARD_CONFIDENCE_MIN = 0.5
COMPLETE_CARD_DESCRIPTION_MIN = 60
MARKETPLACE_MAX_AGE_DAYS = 45
RENTAL_MAX_AGE_DAYS = 60
JOB_EVENT_MAX_AGE_DAYS = 30

PHONE_RE = re.compile(r"^\+?[1-9]\d{9,14}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
TG_USER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")
IG_USER_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
URL_RE = re.compile(r"^(https?://)?([A-Za-z0-9-]+\.)+[A-Za-z]{2,}(/.*)?$", re.I)

BAD_TITLE_RE = re.compile(
    r"^(всем\s+привет|привет|добрый\s+день|передзамовлення|~~~~|⛔️|\?+|none)$",
    re.I,
)
JUNK_CONTACT_TITLE_RE = re.compile(
    r"^(телефон|phone|whatsapp|instagram|tg|telegram|контакт|contacts?|"
    r"call\s*me|write\s*me|it.?s\s*me)$",
    re.I,
)
REQUEST_RE = re.compile(
    r"\b(ищу|ищем|подскажите|посоветуйте|кто\s+знает|нужен|нужна|looking\s+for|"
    r"need\s+a|recommend|поиск\s+работы|резюме)\b",
    re.I,
)
# Hiring / job-offer posts mis-tagged as business — leave for manual review.
HIRING_AD_RE = re.compile(
    r"("
    r"\b(hiring|wanted|vacancy|ваканси\w*)|"
    r"требуется\s+(водитель|сотрудник|работник)\w*|"
    r"ищем\s+(водител|сотрудник|специалист|работник|команду)\w*|"
    r"приглаша(ем|ет)\s+.{0,40}(на\s+работу|cdl|driver|водител\w*)|"
    r"otr\s+drivers?|cdl\s+driver|"
    r"нужен\s+(водитель|сотрудник|мастер)\w*"
    r")",
    re.I,
)
# Specialists / services publish as Profi.ru-style service listings.
SPECIALIST_AUTOPUBLISH_TARGETS = {
    "private_specialists",
    "services",
}


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
        return list(dict.fromkeys(out))
    s = str(value).strip()
    return [s] if s else []


def first_price(
    entity: dict[str, Any], marketplace: dict[str, Any] | None
) -> tuple[float | None, str | None]:
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
                return float(p0.get("amount")), (
                    str(p0.get("currency") or "USD").upper()
                )
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


def infer_source_key(post: dict[str, Any], *, explicit: str | None = None) -> str:
    """Stable source namespace per Telegram group. Never mix groups under plain 'telegram'."""
    if explicit:
        return explicit.strip()
    title = (post.get("chat_title") or post.get("source_group") or "").strip().lower()
    if "la_orangecounty" in title.replace(" ", "") or title == "la_orangecounty":
        return "telegram:la_orange_county"
    if "fun for mom" in title:
        return "telegram:fun_for_mom"
    chat = str(post.get("source_chat_id") or post.get("chat_id") or "")
    if chat == "-1001955320601":
        return "telegram:la_orange_county"
    if chat == "-1001333533747":
        return "telegram:fun_for_mom"
    return "telegram"


def map_post(
    post: dict[str, Any],
    *,
    review_status: str = "pending",
    source_key: str | None = None,
) -> dict[str, Any]:
    entity = post.get("extracted_entity") or {}
    marketplace = (
        entity.get("marketplace") if isinstance(entity.get("marketplace"), dict) else {}
    )
    message_ids = post.get("source_message_ids") or [
        post.get("primary_message_id") or post.get("message_id")
    ]
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

    resolved_source = infer_source_key(post, explicit=source_key)
    source_group = post.get("chat_title") or (
        "LA_OrangeCounty"
        if resolved_source.endswith("la_orange_county")
        else "Fun for Mom"
        if resolved_source.endswith("fun_for_mom")
        else None
    )

    location = merge_city_with_group(
        city=entity.get("city") or marketplace.get("city"),
        state=entity.get("state"),
        source_group=source_group,
        source=resolved_source,
        chat_title=post.get("chat_title"),
        chat_id=str(chat_id) if chat_id is not None else None,
        address_line=entity.get("address")
        or entity.get("address_line")
        or marketplace.get("address")
        or marketplace.get("address_line"),
        text=entity.get("description") or post.get("merged_text") or post.get("text"),
        postal_code=entity.get("postal_code") or marketplace.get("postal_code"),
    )

    return {
        "source": resolved_source,
        "source_group": source_group,
        "source_chat_id": str(chat_id) if chat_id is not None else None,
        "source_message_ids": message_ids,
        "source_fingerprint": source_fingerprint(resolved_source, chat_id, message_ids),
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
        or (
            post.get("missing_fields")
            and f"missing:{post.get('missing_fields')}"
        ),
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
        "city": location.get("city"),
        "state": location.get("state"),
        "county_geoid": location.get("county_geoid"),
        "postal_code": location.get("postal_code"),
        "location_source": location.get("location_source"),
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
        "review_status": review_status,
        "_raw_post": post,
    }


class SupabaseRest:
    def __init__(self, url: str, service_key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.rpc = url.rstrip("/") + "/rest/v1/rpc"
        self.key = service_key

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        body: Any = None,
        prefer: str | None = None,
        base: str | None = None,
    ) -> Any:
        root = base or self.base
        qs = f"?{urllib.parse.urlencode(params)}" if params else ""
        req = urllib.request.Request(
            f"{root}{path}{qs}",
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
        chunk_size = 80
        for i in range(0, len(fingerprints), chunk_size):
            chunk = fingerprints[i : i + chunk_size]
            values = ",".join(f'"{f}"' for f in chunk)
            rows = self._request(
                "GET",
                "/import_review_items",
                params={
                    "select": "id,source_fingerprint,review_status,published_entity_id,updated_at",
                    "source_fingerprint": f"in.({values})",
                },
            )
            for row in rows or []:
                out[row["source_fingerprint"]] = row
        return out

    def fetch_business_phones(self, phones: list[str]) -> set[str]:
        found: set[str] = set()
        chunk_size = 50
        for i in range(0, len(phones), chunk_size):
            chunk = phones[i : i + chunk_size]
            if not chunk:
                continue
            values = ",".join(f'"{p}"' for p in chunk)
            rows = self._request(
                "GET",
                "/businesses",
                params={"select": "id,phone", "phone": f"in.({values})"},
            )
            for row in rows or []:
                if row.get("phone"):
                    found.add(str(row["phone"]))
        return found

    def fetch_categories(self) -> list[dict[str, Any]]:
        rows = self._request(
            "GET",
            "/categories",
            params={
                "select": "id,slug,name,domain,is_active",
                "is_active": "eq.true",
                "order": "sort_order.asc",
            },
        )
        return rows or []

    def fetch_listing_categories(
        self, *, listing_type: str = "service"
    ) -> list[dict[str, Any]]:
        rows = self._request(
            "GET",
            "/listing_categories",
            params={
                "select": "id,slug,name_ru,name_en,listing_type,domain,is_active,sort_order",
                "listing_type": f"eq.{listing_type}",
                "is_active": "eq.true",
                "order": "sort_order.asc",
            },
        )
        return rows or []

    def fetch_all_business_phones(self) -> set[str]:
        found: set[str] = set()
        offset = 0
        while True:
            rows = self._request(
                "GET",
                "/businesses",
                params={
                    "select": "phone",
                    "phone": "not.is.null",
                    "offset": str(offset),
                    "limit": "1000",
                },
            ) or []
            if not rows:
                break
            for row in rows:
                phone = row.get("phone")
                if phone:
                    found.add(str(phone))
            if len(rows) < 1000:
                break
            offset += len(rows)
        return found

    def insert_many(self, table: str, rows: list[dict[str, Any]]) -> Any:
        return self._request(
            "POST",
            f"/{table}",
            body=rows,
            prefer="return=representation",
        )

    def patch(self, table: str, match: dict[str, str], body: dict[str, Any]) -> Any:
        return self._request(
            "PATCH",
            f"/{table}",
            params=match,
            body=body,
            prefer="return=representation",
        )

    def rpc_call(self, name: str, args: dict[str, Any]) -> Any:
        return self._request("POST", f"/{name}", body=args, base=self.rpc)
