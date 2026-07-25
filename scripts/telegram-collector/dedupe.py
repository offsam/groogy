"""Deduplication for logical Telegram business posts."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from contacts import similarity_ratio, text_fingerprint


def _domain(url: str) -> str | None:
    try:
        raw = url if "://" in url else "https://" + url
        host = urlparse(raw).netloc.lower().removeprefix("www.")
        return host or None
    except Exception:
        return None


def _norm_name(value: str | None) -> str | None:
    if not value:
        return None
    return re.sub(r"\s+", " ", value.strip().lower())


def apply_deduplication(posts: list[dict[str, Any]]) -> None:
    """Mutate analyzed posts with duplicate_* fields. First occurrence is primary."""
    index_phone: dict[str, int] = {}
    index_ig: dict[str, int] = {}
    index_tg: dict[str, int] = {}
    index_web: dict[str, int] = {}
    index_name_cat: dict[str, int] = {}
    fingerprints: list[tuple[int, str]] = []
    occurrence: dict[int, int] = {}

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

        def hit(idx: int, reason: str, sc: float) -> None:
            nonlocal primary_idx, score
            if primary_idx is None:
                primary_idx = idx
            reasons.append(reason)
            score = max(score, sc)

        for phone in entity.get("phone") or []:
            if phone in index_phone:
                hit(index_phone[phone], "same_phone", 0.98)

        for ig in entity.get("instagram") or []:
            key = ig.lower().lstrip("@")
            if key in index_ig:
                hit(index_ig[key], "same_instagram", 0.96)

        for tg in entity.get("telegram") or []:
            key = tg.lower().lstrip("@")
            if key in index_tg:
                hit(index_tg[key], "same_telegram", 0.96)

        for web in entity.get("website") or []:
            host = _domain(web)
            if host and host in index_web:
                hit(index_web[host], "same_website_domain", 0.94)

        name = _norm_name(entity.get("person_name") or entity.get("business_name"))
        cat = entity.get("category") or "other"
        if name and cat:
            key = f"{name}|{cat}"
            if key in index_name_cat:
                hit(index_name_cat[key], "same_name_category", 0.88)

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
                index_phone.setdefault(phone, i)
            for ig in entity.get("instagram") or []:
                index_ig.setdefault(ig.lower().lstrip("@"), i)
            for tg in entity.get("telegram") or []:
                index_tg.setdefault(tg.lower().lstrip("@"), i)
            for web in entity.get("website") or []:
                host = _domain(web)
                if host:
                    index_web.setdefault(host, i)
            if name and cat:
                index_name_cat.setdefault(f"{name}|{cat}", i)
            if fp:
                fingerprints.append((i, fp))
        else:
            if fp:
                fingerprints.append((i, fp))
