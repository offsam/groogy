"""Media Pipeline v1 core: resolve and optionally apply images for published cards."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field, asdict
from typing import Any
from urllib.parse import urlparse

from fetch_instagram import fetch_instagram_image_bytes, normalize_username
from fetch_website import discover_website_images, download_image
from storage_client import MediaSupabase
from telegram_photos import TelegramPhotoClient
from validate import (
    category_default_path,
    make_category_placeholder,
    reencode_webp,
    validate_image_bytes,
)

SOURCES = ("telegram", "telegram:la_orange_county")
BUSINESS_BUCKET = "business-images"
LISTING_BUCKET = "listing-images"


@dataclass
class CandidatePlan:
    review_item_id: str
    title: str
    entity_type: str  # business | listing
    entity_id: str
    published_entity_type: str
    source: str
    category: str | None
    chat_id: str | None
    message_ids: list[int]
    photos_count: int
    instagram: list[str]
    websites: list[str]
    already_has_image: bool
    skip_reason: str | None = None
    chosen_source: str | None = None
    chosen_url: str | None = None
    estimated_bytes: int = 0
    notes: list[str] = field(default_factory=list)
    unavailable: list[str] = field(default_factory=list)
    duplicate: bool = False
    apply_status: str | None = None
    public_url: str | None = None
    storage_path: str | None = None
    sha256: str | None = None


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x) for x in value if x]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _message_ids(value: Any) -> list[int]:
    out: list[int] = []
    if not value:
        return out
    for x in value:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def fetch_published_items(client: MediaSupabase) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for source in SOURCES:
        offset = 0
        while True:
            batch = (
                client.rest_request(
                    "GET",
                    "/import_review_items",
                    params={
                        "select": (
                            "id,title,entity_type,category,source,source_chat_id,"
                            "source_message_ids,photos_count,instagram,website,phone,"
                            "published_entity_id,published_entity_type,published_at"
                        ),
                        "source": f"eq.{source}",
                        "review_status": "eq.approved",
                        "published_entity_id": "not.is.null",
                        "order": "published_at.asc",
                        "offset": str(offset),
                        "limit": "100",
                    },
                )
                or []
            )
            rows.extend(batch)
            if len(batch) < 100:
                break
            offset += 100
    return rows


def load_existing_images(
    client: MediaSupabase, items: list[dict[str, Any]]
) -> dict[str, bool]:
    """entity_id → has real image already."""
    has: dict[str, bool] = {}
    biz_ids = [
        r["published_entity_id"]
        for r in items
        if r.get("published_entity_type") == "business"
    ]
    listing_ids = [
        r["published_entity_id"]
        for r in items
        if r.get("published_entity_type") == "listing"
    ]
    for i in range(0, len(biz_ids), 50):
        chunk = biz_ids[i : i + 50]
        if not chunk:
            continue
        brows = (
            client.rest_request(
                "GET",
                "/businesses",
                params={
                    "select": "id,image_url",
                    "id": f"in.({','.join(chunk)})",
                },
            )
            or []
        )
        for b in brows:
            url = (b.get("image_url") or "").strip()
            # Any existing image_url (including category default) → do not re-import.
            has[b["id"]] = bool(url)
    for lid in listing_ids:
        try:
            media = (
                client.rest_request(
                    "GET",
                    "/listing_media",
                    params={
                        "select": "id",
                        "listing_id": f"eq.{lid}",
                        "limit": "1",
                    },
                )
                or []
            )
            has[lid] = bool(media)
        except Exception:
            has[lid] = False
    return has


def load_listing_owners(client: MediaSupabase, listing_ids: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(listing_ids), 50):
        chunk = listing_ids[i : i + 50]
        if not chunk:
            continue
        rows = (
            client.rest_request(
                "GET",
                "/listings",
                params={"select": "id,owner_id", "id": f"in.({','.join(chunk)})"},
            )
            or []
        )
        for r in rows:
            out[r["id"]] = r["owner_id"]
    return out


def existing_sha_for_entity(
    client: MediaSupabase, entity_type: str, entity_id: str, sha: str
) -> bool:
    rows = (
        client.rest_request(
            "GET",
            "/media_assets",
            params={
                "select": "id",
                "entity_type": f"eq.{entity_type}",
                "entity_id": f"eq.{entity_id}",
                "sha256": f"eq.{sha}",
                "status": "eq.active",
                "limit": "1",
            },
        )
        or []
    )
    return bool(rows)


def resolve_candidate(
    item: dict[str, Any],
    *,
    already_has_image: bool,
    tg: TelegramPhotoClient | None,
    probe_remote: bool,
    download_telegram: bool = False,
) -> CandidatePlan:
    entity_type = "listing" if item.get("published_entity_type") == "listing" else "business"
    plan = CandidatePlan(
        review_item_id=item["id"],
        title=(item.get("title") or "")[:120],
        entity_type=entity_type,
        entity_id=item["published_entity_id"],
        published_entity_type=item.get("published_entity_type") or entity_type,
        source=item.get("source") or "",
        category=item.get("category"),
        chat_id=str(item.get("source_chat_id") or "") or None,
        message_ids=_message_ids(item.get("source_message_ids")),
        photos_count=int(item.get("photos_count") or 0),
        instagram=_as_list(item.get("instagram")),
        websites=_as_list(item.get("website")),
        already_has_image=already_has_image,
    )
    if already_has_image:
        plan.skip_reason = "already_has_manual_or_real_image"
        return plan

    max_photos = 3 if entity_type == "listing" else 1

    # 1) Telegram
    if plan.photos_count > 0 and plan.chat_id and plan.message_ids and tg is not None:
        try:
            result = tg.fetch_photos(
                plan.chat_id,
                plan.message_ids,
                max_photos=max_photos,
                dry_run=not download_telegram,
            )
            if result.photos:
                if download_telegram:
                    for raw in result.photos:
                        valid, reason = validate_image_bytes(raw)
                        if valid:
                            plan.chosen_source = "telegram_post"
                            plan.estimated_bytes = len(valid.data)
                            plan.sha256 = valid.sha256
                            plan.notes.append(f"telegram_ok:{valid.width}x{valid.height}")
                            plan._bytes = valid.data  # type: ignore[attr-defined]
                            plan._valid = valid  # type: ignore[attr-defined]
                            break
                        plan.notes.append(f"telegram_reject:{reason}")
                    if plan.chosen_source:
                        return plan
                else:
                    plan.chosen_source = "telegram_post"
                    plan.estimated_bytes = 180_000 * min(len(result.photos), max_photos)
                    plan.notes.append(f"telegram_available_count={len(result.photos)}")
                    return plan
            elif result.error:
                plan.unavailable.append(f"telegram:{result.error}")
        except Exception as exc:
            plan.unavailable.append(f"telegram:{type(exc).__name__}")

    if not probe_remote:
        if plan.instagram:
            plan.chosen_source = "instagram_profile"
            plan.estimated_bytes = 40_000
            plan.notes.append("instagram_dry_assumed")
            return plan
        if plan.websites:
            plan.chosen_source = "website_og"
            plan.estimated_bytes = 80_000
            plan.notes.append("website_dry_assumed")
            return plan
        plan.chosen_source = "category_default"
        plan.estimated_bytes = 8_000
        plan.chosen_url = category_default_path(plan.category)
        return plan

    # 2) Instagram
    for ig in plan.instagram[:2]:
        data, disc = fetch_instagram_image_bytes(ig)
        if data:
            valid, reason = validate_image_bytes(data)
            if valid:
                plan.chosen_source = "instagram_profile"
                plan.estimated_bytes = len(valid.data)
                plan.sha256 = valid.sha256
                plan.chosen_url = disc.profile_image_url
                plan._bytes = valid.data  # type: ignore[attr-defined]
                plan._valid = valid  # type: ignore[attr-defined]
                return plan
            plan.notes.append(f"instagram_reject:{reason}")
        else:
            plan.unavailable.append(f"instagram:{disc.error or 'unavailable'}")

    # 3) Website
    for web in plan.websites[:1]:
        disc = discover_website_images(web)
        if disc.error:
            plan.unavailable.append(f"website:{disc.domain}:{disc.error}")
        candidates = [
            ("website_og", disc.og_image),
            ("website_logo", disc.logo),
            ("favicon", disc.favicon),
        ]
        for source_type, url in candidates:
            if not url:
                continue
            data, err = download_image(url)
            if err or not data:
                plan.unavailable.append(f"{source_type}:{err or 'empty'}")
                continue
            valid, reason = validate_image_bytes(data)
            if not valid:
                # favicon often small — skip
                plan.notes.append(f"{source_type}_reject:{reason}")
                continue
            plan.chosen_source = source_type
            plan.estimated_bytes = len(valid.data)
            plan.sha256 = valid.sha256
            plan.chosen_url = url
            plan._bytes = valid.data  # type: ignore[attr-defined]
            plan._valid = valid  # type: ignore[attr-defined]
            return plan

    # 4) category default
    plan.chosen_source = "category_default"
    plan.chosen_url = category_default_path(plan.category)
    plan.estimated_bytes = 8_000
    return plan


def apply_plan(
    client: MediaSupabase,
    plan: CandidatePlan,
    *,
    listing_owners: dict[str, str],
) -> CandidatePlan:
    if plan.skip_reason:
        plan.apply_status = "skipped"
        return plan
    if not plan.chosen_source:
        plan.apply_status = "no_source"
        return plan

    # category default for business: set static path, no upload
    if plan.chosen_source == "category_default" and plan.entity_type == "business":
        url = plan.chosen_url or category_default_path(plan.category)
        ok = client.rpc(
            "service_set_business_auto_image",
            {
                "p_business_id": plan.entity_id,
                "p_image_url": url,
                "p_only_if_empty": True,
            },
        )
        existing = (
            client.rest_request(
                "GET",
                "/media_assets",
                params={
                    "select": "id",
                    "entity_type": "eq.business",
                    "entity_id": f"eq.{plan.entity_id}",
                    "is_primary": "eq.true",
                    "status": "eq.active",
                    "limit": "1",
                },
            )
            or []
        )
        if not existing:
            client.rest_request(
                "POST",
                "/media_assets",
                body={
                    "entity_type": "business",
                    "entity_id": plan.entity_id,
                    "public_url": url,
                    "source_type": "category_default",
                    "source_url": url,
                    "mime_type": "image/svg+xml",
                    "is_primary": True,
                    "status": "active",
                    "import_review_item_id": plan.review_item_id,
                },
                prefer="return=minimal",
            )
        plan.public_url = url
        plan.apply_status = "applied_category_default" if ok else "skipped_not_empty"
        return plan

    raw = getattr(plan, "_bytes", None)
    valid = getattr(plan, "_valid", None)

    if plan.chosen_source == "category_default" and plan.entity_type == "listing":
        # Generate landscape placeholder and upload
        label = (plan.category or "Объявление").replace("_", " ")
        valid = make_category_placeholder(label=label, landscape=True)
        raw = valid.data
        plan.sha256 = valid.sha256

    if not raw or not valid:
        # Need to fetch again for telegram dry→apply path shouldn't happen if probe_remote
        plan.apply_status = "missing_bytes"
        return plan

    # Dedup
    try:
        if existing_sha_for_entity(client, plan.entity_type, plan.entity_id, valid.sha256):
            plan.duplicate = True
            plan.apply_status = "duplicate_skipped"
            return plan
    except Exception as exc:
        plan.notes.append(f"dedup_check_error:{type(exc).__name__}")

    encoded = reencode_webp(raw)
    plan.sha256 = encoded.sha256
    plan.estimated_bytes = len(encoded.data)

    if plan.entity_type == "business":
        path = f"business/{plan.entity_id}/{encoded.sha256}.webp"
        client.upload(
            BUSINESS_BUCKET,
            path,
            encoded.data,
            content_type="image/webp",
            upsert=True,
        )
        public_url = client.public_url(BUSINESS_BUCKET, path)
        client.rpc(
            "service_set_business_auto_image",
            {
                "p_business_id": plan.entity_id,
                "p_image_url": public_url,
                "p_only_if_empty": True,
            },
        )
        client.rest_request(
            "POST",
            "/media_assets",
            body={
                "entity_type": "business",
                "entity_id": plan.entity_id,
                "storage_bucket": BUSINESS_BUCKET,
                "storage_path": path,
                "public_url": public_url,
                "source_type": plan.chosen_source,
                "source_url": plan.chosen_url,
                "mime_type": encoded.mime_type,
                "width": encoded.width,
                "height": encoded.height,
                "file_size": len(encoded.data),
                "sha256": encoded.sha256,
                "is_primary": True,
                "status": "active",
                "import_review_item_id": plan.review_item_id,
            },
            prefer="return=minimal",
        )
        plan.storage_path = path
        plan.public_url = public_url
        plan.apply_status = "applied"
        return plan

    # listing
    owner = listing_owners.get(plan.entity_id)
    if not owner:
        plan.apply_status = "missing_owner"
        return plan
    path = f"listings/{owner}/{plan.entity_id}/{encoded.sha256}.webp"
    client.upload(
        LISTING_BUCKET,
        path,
        encoded.data,
        content_type="image/webp",
        upsert=True,
    )
    client.rpc(
        "service_attach_listing_media",
        {
            "p_listing_id": plan.entity_id,
            "p_storage_path": path,
            "p_sort_order": 0,
            "p_width": encoded.width,
            "p_height": encoded.height,
        },
    )
    signed = client.create_signed_url(LISTING_BUCKET, path)
    client.rest_request(
        "POST",
        "/media_assets",
        body={
            "entity_type": "listing",
            "entity_id": plan.entity_id,
            "storage_bucket": LISTING_BUCKET,
            "storage_path": path,
            "public_url": signed,
            "source_type": plan.chosen_source,
            "source_url": plan.chosen_url,
            "mime_type": encoded.mime_type,
            "width": encoded.width,
            "height": encoded.height,
            "file_size": len(encoded.data),
            "sha256": encoded.sha256,
            "is_primary": True,
            "status": "active",
            "import_review_item_id": plan.review_item_id,
        },
        prefer="return=minimal",
    )
    plan.storage_path = path
    plan.public_url = signed
    plan.apply_status = "applied"
    return plan


def summarize(plans: list[CandidatePlan]) -> dict[str, Any]:
    by_entity = Counter(p.entity_type for p in plans)
    already = sum(1 for p in plans if p.already_has_image)
    sources = Counter(p.chosen_source for p in plans if p.chosen_source and not p.skip_reason)
    skipped = sum(1 for p in plans if p.skip_reason)
    unavailable = sum(len(p.unavailable) for p in plans)
    dups = sum(1 for p in plans if p.duplicate)
    bytes_total = sum(p.estimated_bytes for p in plans if not p.skip_reason)
    return {
        "total": len(plans),
        "businesses": by_entity.get("business", 0),
        "listings": by_entity.get("listing", 0),
        "already_has_image": already,
        "skipped": skipped,
        "by_source": dict(sources),
        "unavailable_signals": unavailable,
        "duplicates": dups,
        "estimated_upload_mb": round(bytes_total / (1024 * 1024), 2),
        "without_real_photo": sum(
            1
            for p in plans
            if not p.already_has_image
            and p.chosen_source in {None, "category_default"}
        ),
        "apply_status": dict(Counter(p.apply_status for p in plans if p.apply_status)),
    }


def pick_control_ten(plans: list[CandidatePlan]) -> list[CandidatePlan]:
    """Diverse mix for control apply."""
    eligible = [p for p in plans if not p.skip_reason and p.chosen_source]
    buckets: dict[str, list[CandidatePlan]] = {
        "business_tg": [],
        "specialist_ig": [],
        "listing_tg": [],
        "real_estate": [],
        "website": [],
        "other": [],
    }
    for p in eligible:
        et = p.published_entity_type
        # We don't have original entity_type on plan for specialist — use title heuristics via source
        if p.entity_type == "listing":
            if "real" in (p.category or "") or "комнат" in p.title.lower() or "сда" in p.title.lower():
                buckets["real_estate"].append(p)
            else:
                buckets["listing_tg"].append(p)
        elif p.chosen_source == "telegram_post":
            buckets["business_tg"].append(p)
        elif p.chosen_source == "instagram_profile":
            buckets["specialist_ig"].append(p)
        elif p.chosen_source and p.chosen_source.startswith("website"):
            buckets["website"].append(p)
        else:
            buckets["other"].append(p)

    order = [
        "business_tg",
        "specialist_ig",
        "listing_tg",
        "real_estate",
        "website",
        "other",
        "business_tg",
        "specialist_ig",
        "other",
        "website",
    ]
    picked: list[CandidatePlan] = []
    used: set[str] = set()
    for key in order:
        for p in buckets.get(key, []):
            if p.entity_id in used:
                continue
            picked.append(p)
            used.add(p.entity_id)
            break
        if len(picked) >= 10:
            break
    if len(picked) < 10:
        for p in eligible:
            if p.entity_id in used:
                continue
            picked.append(p)
            used.add(p.entity_id)
            if len(picked) >= 10:
                break
    return picked[:10]


def plan_to_dict(p: CandidatePlan) -> dict[str, Any]:
    d = asdict(p)
    return d
