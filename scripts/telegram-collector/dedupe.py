"""Deduplication for logical Telegram business posts."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from contacts import similarity_ratio, text_fingerprint

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "import-review"))

from channel_noise import load_noise  # noqa: E402
from structure_event_from_text import event_day_keys  # noqa: E402

# Contacts the channel puts on every post it publishes — see channel_noise.py.
CHANNEL_NOISE = load_noise()

# One contact key can front several primaries (recurring event series by date).
MAX_PRIMARIES_PER_KEY = 12

# A person can run a shop and throw parties: same author is not same card.
PROFILE_TYPES = {"business", "private_specialist", "organization"}
# «other» is the dumping ground of the classifier — it proves nothing.
GENERIC_CATEGORIES = {"", "other", "другое", "прочее", "unknown", "none"}
# Identity lives in the path on these hosts, not in the domain.
SHARED_WEB_HOSTS = {
    "instagram.com",
    "facebook.com",
    "fb.watch",
    "m.facebook.com",
    "t.me",
    "telegram.me",
    "wa.me",
    "wa.link",
    "api.whatsapp.com",
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "linktr.ee",
    "bit.ly",
    "t.co",
    "goo.gl",
    "google.com",
    "maps.google.com",
    "maps.app.goo.gl",
    "docs.google.com",
    "forms.gle",
    "eventbrite.com",
    "booksy.com",
    "square.site",
    "squareup.com",
    "book.squareup.com",
    "yelp.com",
    "craigslist.org",
    "airbnb.com",
    "zillow.com",
}


def _domain(url: str) -> str | None:
    try:
        raw = url if "://" in url else "https://" + url
        host = urlparse(raw).netloc.lower().removeprefix("www.")
        return host or None
    except Exception:
        return None


def _identity_domain(url: str) -> str | None:
    """Domain that identifies one advertiser (skip social / directory hosts)."""
    host = _domain(url)
    if not host or host in SHARED_WEB_HOSTS:
        return None
    if any(host.endswith("." + shared) for shared in SHARED_WEB_HOSTS):
        return None
    base = ".".join(host.split(".")[-2:])
    if host in CHANNEL_NOISE["domains"] or base in CHANNEL_NOISE["domains"]:
        return None
    return host


def _norm_name(value: str | None) -> str | None:
    if not value:
        return None
    return re.sub(r"\s+", " ", value.strip().lower())


def _post_text(post: dict[str, Any]) -> str:
    return str(post.get("merged_text") or post.get("text") or "")


def _is_event(post: dict[str, Any]) -> bool:
    entity = post.get("extracted_entity") or {}
    return entity.get("entity_type") == "event"


def _family(post: dict[str, Any]) -> str:
    entity = post.get("extracted_entity") or {}
    kind = str(entity.get("entity_type") or "").strip().lower()
    if not kind:
        return "unknown"
    return "profile" if kind in PROFILE_TYPES else kind


def _families_compatible(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """A flower shop ad and a party invite never belong to one card."""
    fa, fb = _family(a), _family(b)
    if "unknown" in (fa, fb):
        return True
    return fa == fb


def _near_identical(a: dict[str, Any], b: dict[str, Any]) -> bool:
    fa = text_fingerprint(_post_text(a))
    fb = text_fingerprint(_post_text(b))
    if len(fa) < 40 or len(fb) < 40:
        return False
    return similarity_ratio(fa, fb) >= 0.9


def _event_dates_compatible(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Events on different dates are different events, even from one organizer."""
    if not (_is_event(a) or _is_event(b)):
        return True
    days_a = set(event_day_keys(_post_text(a)))
    days_b = set(event_day_keys(_post_text(b)))
    if days_a and days_b:
        return bool(days_a & days_b)
    # Date unreadable on one side: only a repeat of the very same ad may merge.
    return _near_identical(a, b)


def apply_deduplication(posts: list[dict[str, Any]]) -> None:
    """Mutate analyzed posts with duplicate_* fields. First occurrence is primary."""
    # Lists, not single ids: an event ad on a new date becomes its own primary,
    # so one contact key can hold several primaries (one per date).
    index_phone: dict[str, list[int]] = {}
    index_ig: dict[str, list[int]] = {}
    index_tg: dict[str, list[int]] = {}
    index_web: dict[str, list[int]] = {}
    index_name_cat: dict[str, list[int]] = {}
    fingerprints: list[tuple[int, str]] = []
    occurrence: dict[int, int] = {}

    def remember(index: dict[str, list[int]], key: str, idx: int) -> None:
        bucket = index.setdefault(key, [])
        if idx not in bucket and len(bucket) < MAX_PRIMARIES_PER_KEY:
            bucket.append(idx)

    for i, post in enumerate(posts):
        entity = post.get("extracted_entity") or {}
        post.setdefault("duplicate_status", "unique")
        post.setdefault("duplicate_of_primary_message_id", None)
        post.setdefault("duplicate_score", 0.0)
        post.setdefault("duplicate_reason", None)
        post.setdefault("occurrence_count", 1)
        post.setdefault("latest_source_date", entity.get("source_date") or post.get("message_date_end"))

        reasons: list[str] = []
        score = 0.0
        primary_idx: int | None = None

        def hit(idx: int, reason: str, sc: float) -> bool:
            nonlocal primary_idx, score
            if not _families_compatible(post, posts[idx]):
                return False
            if not _event_dates_compatible(post, posts[idx]):
                return False
            if primary_idx is None:
                primary_idx = idx
            reasons.append(reason)
            score = max(score, sc)
            return True

        def hit_first(candidates: list[int], reason: str, sc: float) -> None:
            for idx in candidates:
                if hit(idx, reason, sc):
                    return

        for phone in entity.get("phone") or []:
            hit_first(index_phone.get(phone, []), "same_phone", 0.98)

        for ig in entity.get("instagram") or []:
            handle = ig.lower().lstrip("@")
            if handle in CHANNEL_NOISE["instagram"]:
                continue
            hit_first(index_ig.get(handle, []), "same_instagram", 0.96)

        for tg in entity.get("telegram") or []:
            hit_first(index_tg.get(tg.lower().lstrip("@"), []), "same_telegram", 0.96)

        for web in entity.get("website") or []:
            host = _identity_domain(web)
            if host:
                hit_first(index_web.get(host, []), "same_website_domain", 0.94)

        name = _norm_name(entity.get("person_name") or entity.get("business_name"))
        cat = str(entity.get("category") or "").strip().lower()
        name_cat_key = f"{name}|{cat}" if name and cat not in GENERIC_CATEGORIES else None
        if name_cat_key:
            hit_first(index_name_cat.get(name_cat_key, []), "same_name_category", 0.88)

        fp = text_fingerprint(post.get("merged_text") or post.get("text") or "")
        if fp and len(fp) >= 40:
            for prev_i, prev_fp in fingerprints:
                sim = similarity_ratio(fp, prev_fp)
                if sim >= 0.92:
                    hit(prev_i, "high_text_similarity", sim)

        if primary_idx is not None and reasons:
            primary = posts[primary_idx]
            primary_id = primary.get("primary_message_id") or primary.get("message_id")
            status = "exact_duplicate" if score >= 0.96 else "likely_duplicate"
            # Recurring ad: same business contact, not near-identical text-only
            if any(r.startswith("same_") for r in reasons) and "high_text_similarity" not in reasons:
                status = "recurring_ad"
            elif any(r.startswith("same_") for r in reasons) and score >= 0.9:
                status = "recurring_ad"

            post["duplicate_status"] = status
            post["duplicate_of_primary_message_id"] = primary_id
            post["duplicate_score"] = round(score, 3)
            post["duplicate_reason"] = ",".join(dict.fromkeys(reasons))
            occurrence[primary_idx] = occurrence.get(primary_idx, 1) + 1
            primary["occurrence_count"] = occurrence[primary_idx]
            primary["latest_source_date"] = max(
                str(primary.get("latest_source_date") or ""),
                str(post.get("message_date_end") or post.get("message_date") or ""),
            ) or primary.get("latest_source_date")

            # Force needs_review for duplicates of accepted/review ads
            if post.get("decision") == "accepted":
                post["decision"] = "needs_review"
                warnings = list(post.get("warnings") or [])
                warnings.append("duplicate_demoted_from_accepted")
                post["warnings"] = warnings
                post["decision_reason"] = (
                    (post.get("decision_reason") or "")
                    + f" | duplicate of {primary_id}"
                ).strip(" |")

        # Index current as primary candidate only if unique-ish
        if post.get("duplicate_status") == "unique":
            for phone in entity.get("phone") or []:
                remember(index_phone, phone, i)
            for ig in entity.get("instagram") or []:
                handle = ig.lower().lstrip("@")
                if handle in CHANNEL_NOISE["instagram"]:
                    continue
                remember(index_ig, handle, i)
            for tg in entity.get("telegram") or []:
                remember(index_tg, tg.lower().lstrip("@"), i)
            for web in entity.get("website") or []:
                host = _identity_domain(web)
                if host:
                    remember(index_web, host, i)
            if name_cat_key:
                remember(index_name_cat, name_cat_key, i)
            if fp:
                fingerprints.append((i, fp))
        else:
            if fp:
                fingerprints.append((i, fp))
