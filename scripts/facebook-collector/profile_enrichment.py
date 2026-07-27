"""Facebook profile/page enrichment (supplement-only).

Discovers author/business Facebook profile URLs from post text or Actor user
payload, optionally scrapes public page details via a configurable Apify Actor,
then fills EMPTY entity fields only. Never overwrites post-derived data.

All applied fields are tagged source=facebook_profile.
Failures never abort the import.
"""

from __future__ import annotations

import os
import re
from typing import Any
from urllib.parse import urlparse

from normalize_facebook import normalize_facebook_url

SOURCE_TAG = "facebook_profile"

# Paths that are not profile/page About targets
_SKIP_PATH_PREFIXES = (
    "/groups/",
    "/posts/",
    "/permalink/",
    "/photo",
    "/watch/",
    "/reel/",
    "/stories/",
    "/share/",
    "/events/",
    "/marketplace/",
    "/story.php",
)

_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.|m\.)?(?:facebook\.com|fb\.com)/[^\s<>\"')]+",
    re.I,
)


def discover_profile_urls(
    *,
    text: str | None,
    author_id: str | None = None,
    author_profile_url: str | None = None,
    extra_urls: list[str] | None = None,
) -> list[str]:
    """Return de-duplicated candidate Facebook profile/page URLs."""
    found: list[str] = []

    def add(url: str | None) -> None:
        cleaned = _normalize_profile_candidate(url)
        if cleaned and cleaned not in found:
            found.append(cleaned)

    add(author_profile_url)
    for url in extra_urls or []:
        add(url)
    for match in _URL_RE.findall(text or ""):
        add(match)

    # Numeric profile.php id from Actor (skip opaque pfbid)
    if author_id and str(author_id).isdigit() and len(str(author_id)) >= 5:
        add(f"https://www.facebook.com/profile.php?id={author_id}")

    return found


def _normalize_profile_candidate(url: str | None) -> str | None:
    if not url:
        return None
    raw = url.strip().rstrip(".,;")
    if not raw:
        return None
    if "://" not in raw:
        raw = "https://" + raw
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    host = (parsed.netloc or "").lower().removeprefix("www.")
    if host not in {"facebook.com", "fb.com", "m.facebook.com"}:
        return None
    path = parsed.path or "/"
    lower = path.lower()
    if any(lower.startswith(p) or p in lower for p in _SKIP_PATH_PREFIXES):
        return None
    if lower in {"/", ""}:
        return None
    # Keep profile.php?id=
    if "profile.php" in lower:
        return normalize_facebook_url(raw) or raw.split("#")[0]
    # Username pages: /PageName or /people/...
    return normalize_facebook_url(raw) or f"https://facebook.com{path.rstrip('/')}"


def profile_from_actor_user(user: dict[str, Any] | None) -> dict[str, Any]:
    """Minimal profile snapshot already present on the group-post Actor row."""
    if not isinstance(user, dict):
        return {}
    data: dict[str, Any] = {"source": SOURCE_TAG}
    name = user.get("name")
    if name:
        data["name"] = str(name).strip()
    pic = user.get("profilePic") or user.get("profile_pic") or user.get("profilePicture")
    if pic:
        data["photos"] = [{"type": "image", "url": str(pic), "kind": "profile_pic"}]
    uid = user.get("id")
    if uid and str(uid).isdigit():
        data["profile_url"] = f"https://www.facebook.com/profile.php?id={uid}"
        data["facebook_user_id"] = str(uid)
    elif uid:
        data["facebook_user_id"] = str(uid)
    return data


def normalize_page_actor_row(row: dict[str, Any]) -> dict[str, Any]:
    """Map common Apify Facebook Pages scraper fields → enrichment dict."""
    if not isinstance(row, dict):
        return {}

    websites = _as_str_list(
        row.get("websites")
        or row.get("website")
        or row.get("external_url")
        or row.get("externalUrls")
    )
    phones = _as_str_list(row.get("phone") or row.get("phones") or row.get("phoneNumber"))
    emails = _as_str_list(row.get("email") or row.get("emails"))
    categories = _as_str_list(row.get("categories") or row.get("category"))
    links = _as_str_list(
        row.get("socialLinks")
        or row.get("links")
        or row.get("additionalLinks")
        or row.get("instagram")
    )
    photos: list[dict[str, Any]] = []
    for key, kind in (
        ("profileImageUrl", "profile_pic"),
        ("profilePicture", "profile_pic"),
        ("image", "profile_pic"),
        ("coverPhotoUrl", "cover"),
        ("cover_image", "cover"),
    ):
        val = row.get(key)
        if isinstance(val, str) and val.startswith("http"):
            photos.append({"type": "image", "url": val, "kind": kind})

    hours = (
        row.get("hours")
        or row.get("openingHours")
        or row.get("business_hours")
        or row.get("opening_hours")
    )
    address = first_nonempty(
        row.get("address"),
        row.get("fullAddress"),
        row.get("location"),
    )
    description = first_nonempty(
        row.get("intro"),
        row.get("bio"),
        row.get("about"),
        row.get("description"),
        row.get("info"),
    )
    if isinstance(description, list):
        description = " ".join(str(x) for x in description if x)

    name = first_nonempty(
        row.get("title"),
        row.get("pageName"),
        row.get("name"),
        row.get("page_name"),
    )
    profile_url = first_nonempty(
        row.get("pageUrl"),
        row.get("facebookUrl"),
        row.get("url"),
        row.get("page_url"),
    )

    return {
        "source": SOURCE_TAG,
        "profile_url": normalize_facebook_url(str(profile_url)) if profile_url else None,
        "name": name,
        "description": str(description).strip() if description else None,
        "phone": phones,
        "website": websites,
        "email": emails,
        "address": address,
        "hours": hours,
        "photos": photos,
        "categories": categories,
        "links": links,
        "raw_page_keys": sorted(row.keys())[:40],
    }


def first_nonempty(*values: Any) -> Any:
    for v in values:
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        if isinstance(v, (list, dict)) and not v:
            continue
        return v
    return None


def _as_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        s = value.strip()
        return [s] if s else []
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if item is None:
                continue
            if isinstance(item, dict):
                u = item.get("url") or item.get("href") or item.get("value")
                if u:
                    out.append(str(u).strip())
            else:
                s = str(item).strip()
                if s:
                    out.append(s)
        return list(dict.fromkeys(out))
    return [str(value).strip()] if str(value).strip() else []


def merge_profile_into_entity(
    entity: dict[str, Any],
    profile: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """Fill empty entity fields from profile. Returns (entity, fields_applied)."""
    applied: list[str] = []
    sources = dict(entity.get("field_sources") or {})

    def fill_list(field: str, values: list[str]) -> None:
        current = entity.get(field) or []
        if isinstance(current, str):
            current = [current] if current.strip() else []
        if current:
            return
        clean = [v for v in values if v]
        if not clean:
            return
        entity[field] = clean
        sources[field] = SOURCE_TAG
        applied.append(field)

    def fill_scalar(field: str, value: Any) -> None:
        if entity.get(field):
            return
        if value is None or (isinstance(value, str) and not value.strip()):
            return
        entity[field] = value if not isinstance(value, str) else value.strip()
        sources[field] = SOURCE_TAG
        applied.append(field)

    fill_list("phone", _as_str_list(profile.get("phone")))
    fill_list("website", _as_str_list(profile.get("website")))
    fill_list("email", _as_str_list(profile.get("email")))
    fill_list("instagram", _instagram_from_links(profile.get("links")))

    if not entity.get("business_name") and profile.get("name"):
        # Only set business_name when entity looks like a business
        if entity.get("entity_type") in {"business", "organization", None}:
            if entity.get("entity_type") == "business" or not entity.get("person_name"):
                fill_scalar("business_name", profile.get("name"))

    if not entity.get("description") and profile.get("description"):
        fill_scalar("description", profile.get("description"))

    if not entity.get("address") and profile.get("address"):
        fill_scalar("address", profile.get("address"))

    if not entity.get("hours") and profile.get("hours"):
        fill_scalar("hours", profile.get("hours"))

    if profile.get("categories") and (
        not entity.get("category") or entity.get("category") == "other"
    ):
        cats = _as_str_list(profile.get("categories"))
        if cats:
            # Keep platform category taxonomy intact — store FB cats separately
            entity["facebook_profile_categories"] = cats
            sources["facebook_profile_categories"] = SOURCE_TAG
            applied.append("facebook_profile_categories")

    if profile.get("photos"):
        entity.setdefault("facebook_profile_photos", profile["photos"])
        sources["facebook_profile_photos"] = SOURCE_TAG
        if "facebook_profile_photos" not in applied:
            applied.append("facebook_profile_photos")

    if profile.get("links"):
        entity.setdefault("facebook_profile_links", _as_str_list(profile.get("links")))
        sources["facebook_profile_links"] = SOURCE_TAG
        applied.append("facebook_profile_links")

    if sources:
        entity["field_sources"] = sources
    return entity, applied


def _instagram_from_links(links: Any) -> list[str]:
    out: list[str] = []
    for link in _as_str_list(links):
        if "instagram.com" in link.lower():
            out.append(link)
    return out


def fetch_profiles_via_apify(
    profile_urls: list[str],
    *,
    actor_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Batch-fetch public page details. Returns map url → normalized profile.

    On any failure returns {} (caller continues without enrichment error).
    """
    if not profile_urls:
        return {}
    actor = (
        actor_id
        or os.environ.get("FACEBOOK_PROFILE_ACTOR_ID")
        or "apify~facebook-pages-scraper"
    ).strip()
    if not actor:
        return {}
    if not (os.environ.get("APIFY_TOKEN") or "").strip():
        return {}

    try:
        from fetch_apify_dataset import run_actor_with_input
    except Exception:
        return {}

    actor_inputs = [
        {"startUrls": [{"url": u} for u in profile_urls], "resultsLimit": len(profile_urls)},
        {"facebookUrls": [{"url": u} for u in profile_urls]},
        {"pages": profile_urls},
        {"urls": profile_urls},
    ]
    items: list[dict[str, Any]] = []
    last_exc: Exception | None = None
    for actor_input in actor_inputs:
        try:
            items, _meta = run_actor_with_input(
                actor_id=actor,
                actor_input=actor_input,
                limit=len(profile_urls),
            )
            if items:
                break
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            items = []
    if not items:
        return {}
    _ = last_exc

    out: dict[str, dict[str, Any]] = {}
    for row in items or []:
        if not isinstance(row, dict):
            continue
        # Skip error rows
        status = str(row.get("status") or "").lower()
        if status.startswith("error"):
            continue
        prof = normalize_page_actor_row(row)
        key = prof.get("profile_url")
        if key:
            out[key] = prof
        # Also index by input URL variants
        for cand in (
            row.get("facebookUrl"),
            row.get("pageUrl"),
            row.get("url"),
            row.get("inputUrl"),
        ):
            n = normalize_facebook_url(str(cand)) if cand else None
            if n:
                out[n] = prof
    return out


def enrich_analyzed_posts(
    posts: list[dict[str, Any]],
    *,
    enabled: bool = True,
    fetch_remote: bool = True,
) -> dict[str, Any]:
    """Apply profile enrichment to analyzed logical posts. Never raises."""
    stats = {
        "enabled": enabled,
        "posts": len(posts),
        "candidates": 0,
        "remote_fetched": 0,
        "enriched": 0,
        "fields_applied_total": 0,
        "unavailable": 0,
        "errors": 0,
    }
    if not enabled:
        return stats

    # Collect candidate URLs per post
    per_post_urls: list[list[str]] = []
    all_urls: list[str] = []
    for post in posts:
        raw = post.get("adapter_raw_slim") or {}
        user = raw.get("user") if isinstance(raw, dict) else None
        author_id = None
        author_profile_url = None
        if isinstance(user, dict):
            author_id = user.get("id")
            author_profile_url = (
                user.get("profileUrl")
                or user.get("url")
                or user.get("profile_url")
            )
        urls = discover_profile_urls(
            text=post.get("merged_text") or post.get("text"),
            author_id=str(author_id) if author_id else None,
            author_profile_url=author_profile_url,
        )
        per_post_urls.append(urls)
        for u in urls:
            if u not in all_urls:
                all_urls.append(u)
    stats["candidates"] = len(all_urls)

    remote_map: dict[str, dict[str, Any]] = {}
    if fetch_remote and all_urls:
        try:
            remote_map = fetch_profiles_via_apify(all_urls)
            stats["remote_fetched"] = len(remote_map)
        except Exception:
            stats["errors"] += 1
            remote_map = {}

    for post, urls in zip(posts, per_post_urls):
        try:
            raw = post.get("adapter_raw_slim") or {}
            user = raw.get("user") if isinstance(raw, dict) else None
            local = profile_from_actor_user(user if isinstance(user, dict) else None)

            remote: dict[str, Any] = {}
            chosen_url = None
            for u in urls:
                if u in remote_map:
                    remote = remote_map[u]
                    chosen_url = u
                    break
            if not remote and not local and not urls:
                continue

            profile = {**local, **remote, "source": SOURCE_TAG}
            if chosen_url:
                profile.setdefault("profile_url", chosen_url)
            elif urls:
                profile.setdefault("profile_url", urls[0])

            if not any(
                profile.get(k)
                for k in (
                    "name",
                    "phone",
                    "website",
                    "email",
                    "description",
                    "address",
                    "photos",
                    "profile_url",
                )
            ):
                stats["unavailable"] += 1
                post.setdefault("enrichments", []).append(
                    {
                        "source": SOURCE_TAG,
                        "status": "unavailable",
                        "profile_url": profile.get("profile_url") or (urls[0] if urls else None),
                    }
                )
                continue

            entity = post.get("extracted_entity") or {}
            if not isinstance(entity, dict):
                entity = {}
            entity, applied = merge_profile_into_entity(entity, profile)
            post["extracted_entity"] = entity

            enrichment_record = {
                "source": SOURCE_TAG,
                "status": "ok" if applied or remote or local else "unavailable",
                "profile_url": profile.get("profile_url"),
                "data": {
                    k: profile.get(k)
                    for k in (
                        "name",
                        "description",
                        "phone",
                        "website",
                        "email",
                        "address",
                        "hours",
                        "photos",
                        "categories",
                        "links",
                    )
                    if profile.get(k) not in (None, [], "")
                },
                "fields_applied": applied,
            }
            post.setdefault("enrichments", []).append(enrichment_record)
            if applied:
                stats["enriched"] += 1
                stats["fields_applied_total"] += len(applied)
            elif not remote and local:
                # Still record local author snapshot
                stats["enriched"] += 1
        except Exception:
            stats["errors"] += 1
            post.setdefault("enrichments", []).append(
                {"source": SOURCE_TAG, "status": "error"}
            )
    return stats
