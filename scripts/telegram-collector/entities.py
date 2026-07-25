"""Global deduplication and entity aggregation for full Telegram runs."""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
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


def _merge_unique(lists: list[list[Any]]) -> list[Any]:
    out: list[Any] = []
    seen: set[str] = set()
    for lst in lists:
        for item in lst or []:
            key = str(item).strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(item)
    return out


def apply_global_deduplication(posts: list[dict[str, Any]]) -> None:
    """Mutate posts with global duplicate_* fields. Preserve chronological first as primary."""
    ordered = sorted(
        enumerate(posts),
        key=lambda pair: (
            pair[1].get("message_date_start") or pair[1].get("analyzed_at") or "",
            pair[1].get("primary_message_id") or 0,
        ),
    )

    index_phone: dict[str, str] = {}
    index_ig: dict[str, str] = {}
    index_tg: dict[str, str] = {}
    index_web: dict[str, str] = {}
    index_email: dict[str, str] = {}
    index_name_cat: dict[str, str] = {}
    fingerprints: list[tuple[str, str]] = []
    occurrence: dict[str, int] = {}
    first_seen: dict[str, str] = {}
    last_seen: dict[str, str] = {}
    all_ids: dict[str, list[int]] = defaultdict(list)

    id_to_post = {p.get("internal_post_id"): p for _, p in ordered}

    for _, post in ordered:
        pid = post.get("internal_post_id")
        entity = post.get("extracted_entity") or {}
        post["duplicate_status"] = "unique"
        post["duplicate_of_internal_post_id"] = None
        post["duplicate_score"] = 0.0
        post["duplicate_reason"] = None
        post["occurrence_count"] = 1
        date = post.get("message_date_start") or post.get("message_date_end") or ""

        reasons: list[str] = []
        score = 0.0
        primary_id: str | None = None

        def hit(p: str, reason: str, sc: float) -> None:
            nonlocal primary_id, score
            if primary_id is None:
                primary_id = p
            reasons.append(reason)
            score = max(score, sc)

        for phone in entity.get("phone") or []:
            if phone in index_phone:
                hit(index_phone[phone], "same_phone", 0.98)
        for ig in entity.get("instagram") or []:
            key = str(ig).lower().lstrip("@")
            if key in index_ig:
                hit(index_ig[key], "same_instagram", 0.96)
        for tg in entity.get("telegram") or []:
            key = str(tg).lower().lstrip("@")
            if key in index_tg:
                hit(index_tg[key], "same_telegram", 0.96)
        for web in entity.get("website") or []:
            host = _domain(str(web))
            if host and host in index_web:
                hit(index_web[host], "same_website_domain", 0.94)
        for email in entity.get("email") or []:
            key = str(email).lower()
            if key in index_email:
                hit(index_email[key], "same_email", 0.97)
        name = _norm_name(entity.get("person_name") or entity.get("business_name"))
        cat = entity.get("category") or "other"
        if name and cat:
            key = f"{name}|{cat}"
            if key in index_name_cat:
                hit(index_name_cat[key], "same_name_category", 0.88)

        fp = text_fingerprint(post.get("merged_text") or "")
        if fp and len(fp) >= 40:
            for prev_id, prev_fp in fingerprints:
                sim = similarity_ratio(fp, prev_fp)
                if sim >= 0.92:
                    hit(prev_id, "high_text_similarity", sim)

        if primary_id and reasons:
            status = "exact_duplicate" if score >= 0.96 else "likely_duplicate"
            if any(r.startswith("same_") for r in reasons):
                status = "recurring_ad"
            post["duplicate_status"] = status
            post["duplicate_of_internal_post_id"] = primary_id
            post["duplicate_score"] = round(score, 3)
            post["duplicate_reason"] = ",".join(dict.fromkeys(reasons))
            occurrence[primary_id] = occurrence.get(primary_id, 1) + 1
            last_seen[primary_id] = max(last_seen.get(primary_id, ""), date)
            all_ids[primary_id].extend(post.get("source_message_ids") or [])
            if post.get("decision") == "accepted":
                post["decision"] = "needs_review"
                warnings = list(post.get("warnings") or [])
                warnings.append("duplicate_demoted_from_accepted")
                post["warnings"] = warnings
        else:
            # index as primary
            for phone in entity.get("phone") or []:
                index_phone.setdefault(phone, pid)
            for ig in entity.get("instagram") or []:
                index_ig.setdefault(str(ig).lower().lstrip("@"), pid)
            for tg in entity.get("telegram") or []:
                index_tg.setdefault(str(tg).lower().lstrip("@"), pid)
            for web in entity.get("website") or []:
                host = _domain(str(web))
                if host:
                    index_web.setdefault(host, pid)
            for email in entity.get("email") or []:
                index_email.setdefault(str(email).lower(), pid)
            if name and cat:
                index_name_cat.setdefault(f"{name}|{cat}", pid)
            if fp:
                fingerprints.append((pid, fp))
            occurrence[pid] = 1
            first_seen[pid] = date
            last_seen[pid] = date
            all_ids[pid].extend(post.get("source_message_ids") or [])

    for pid, post in id_to_post.items():
        if post.get("duplicate_status") == "unique":
            post["occurrence_count"] = occurrence.get(pid, 1)
            post["first_seen_at"] = first_seen.get(pid)
            post["last_seen_at"] = last_seen.get(pid)
            # unique keep own ids
        else:
            primary = post.get("duplicate_of_internal_post_id")
            if primary and primary in id_to_post:
                prim = id_to_post[primary]
                prim["occurrence_count"] = occurrence.get(primary, 1)
                prim["first_seen_at"] = first_seen.get(primary)
                prim["last_seen_at"] = last_seen.get(primary)
                merged_ids = sorted(set(all_ids.get(primary, [])))
                prim["aggregated_source_message_ids"] = merged_ids


def build_entities(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse unique/recurring primaries into entity records."""
    by_id = {p["internal_post_id"]: p for p in posts if p.get("internal_post_id")}
    clusters: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for post in posts:
        status = post.get("duplicate_status") or "unique"
        if status == "unique":
            clusters[post["internal_post_id"]].append(post)
        else:
            primary = post.get("duplicate_of_internal_post_id")
            if primary and primary in by_id:
                clusters[primary].append(post)
            else:
                clusters[post["internal_post_id"]].append(post)

    entities: list[dict[str, Any]] = []
    for primary_id, members in clusters.items():
        members_sorted = sorted(
            members,
            key=lambda p: p.get("message_date_start") or "",
        )
        primary = by_id.get(primary_id) or members_sorted[0]
        # Prefer strongest decision among members for entity review_status.
        decisions = {m.get("decision") for m in members_sorted}
        if "accepted" in decisions and primary.get("duplicate_status") == "unique":
            # If primary itself accepted, or any unique accepted in cluster
            best_decision = "accepted"
        elif any(m.get("decision") == "accepted" for m in members_sorted):
            best_decision = "needs_review"  # accepted demoted somehow
        elif "needs_review" in decisions:
            best_decision = "needs_review"
        else:
            best_decision = "rejected"

        # If cluster is only duplicates of a rejected primary with no commercial value
        if (
            primary.get("duplicate_status") != "unique"
            and all(m.get("decision") == "rejected" for m in members_sorted)
        ):
            review_status = "duplicate_only"
        elif best_decision == "accepted":
            review_status = "ready_for_review"
        elif best_decision == "needs_review":
            review_status = "pending_manual_review"
        elif all(m.get("duplicate_status") != "unique" for m in members_sorted):
            review_status = "duplicate_only"
        else:
            review_status = "rejected"

        # Skip creating separate entities for pure duplicate_only satellites:
        # only emit entity for cluster primary key.
        if primary_id not in by_id:
            continue
        if (
            primary.get("duplicate_status") not in {None, "unique"}
            and primary.get("duplicate_of_internal_post_id")
        ):
            # satellite — skip; represented under primary cluster
            continue

        entities_list = [m.get("extracted_entity") or {} for m in members_sorted]
        warnings: list[str] = []
        for m in members_sorted:
            warnings.extend(m.get("warnings") or [])

        def pick_field(field: str) -> Any:
            values = [e.get(field) for e in entities_list if e.get(field) not in (None, "", [])]
            if not values:
                return None if field not in {
                    "services", "prices", "phone", "email", "website", "instagram",
                    "facebook", "telegram", "whatsapp", "service_area", "languages",
                } else []
            if isinstance(values[0], list):
                return _merge_unique(values)  # type: ignore[arg-type]
            uniq = []
            for v in values:
                if v not in uniq:
                    uniq.append(v)
            if len(uniq) > 1:
                warnings.append(f"conflicting_{field}:{uniq}")
            return uniq[0]

        services = _merge_unique([e.get("services") or [] for e in entities_list])
        phones = _merge_unique([e.get("phone") or [] for e in entities_list])
        emails = _merge_unique([e.get("email") or [] for e in entities_list])
        websites = _merge_unique([e.get("website") or [] for e in entities_list])
        instagrams = _merge_unique([e.get("instagram") or [] for e in entities_list])
        telegrams = _merge_unique([e.get("telegram") or [] for e in entities_list])
        whatsapps = _merge_unique([e.get("whatsapp") or [] for e in entities_list])
        facebooks = _merge_unique([e.get("facebook") or [] for e in entities_list])
        prices = _merge_unique([e.get("prices") or [] for e in entities_list])
        areas = _merge_unique([e.get("service_area") or [] for e in entities_list])
        languages = _merge_unique([e.get("languages") or [] for e in entities_list])

        source_message_ids = sorted(
            {
                mid
                for m in members_sorted
                for mid in (m.get("source_message_ids") or [])
            }
        )
        evidence = {
            "business_evidence": _merge_unique(
                [(m.get("evidence") or {}).get("business_evidence") or [] for m in members_sorted]
            ),
            "contact_evidence": _merge_unique(
                [(m.get("evidence") or {}).get("contact_evidence") or [] for m in members_sorted]
            ),
            "location_evidence": _merge_unique(
                [(m.get("evidence") or {}).get("location_evidence") or [] for m in members_sorted]
            ),
            "service_evidence": _merge_unique(
                [(m.get("evidence") or {}).get("service_evidence") or [] for m in members_sorted]
            ),
        }

        confidences = [float(m.get("confidence") or 0) for m in members_sorted]
        entity_id = "ent_" + hashlib.sha1(primary_id.encode("utf-8")).hexdigest()[:12]

        # Pure duplicate-only clusters where primary is rejected and all are duplicates
        dup_statuses = {m.get("duplicate_status") for m in members_sorted}
        if review_status == "rejected" and dup_statuses <= {"exact_duplicate", "likely_duplicate", "recurring_ad"}:
            review_status = "duplicate_only"

        entities.append(
            {
                "entity_id": entity_id,
                "entity_type": pick_field("entity_type"),
                "business_name": pick_field("business_name"),
                "person_name": pick_field("person_name"),
                "category": pick_field("category") or "other",
                "subcategory": pick_field("subcategory"),
                "description": pick_field("description"),
                "services": services,
                "prices": prices,
                "phone": phones,
                "email": emails,
                "website": websites,
                "instagram": instagrams,
                "facebook": facebooks,
                "telegram": telegrams,
                "whatsapp": whatsapps,
                "address": pick_field("address"),
                "city": pick_field("city"),
                "state": pick_field("state"),
                "service_area": areas,
                "languages": languages,
                "booking_url": pick_field("booking_url"),
                "decision": best_decision,
                "confidence": max(confidences) if confidences else 0.0,
                "review_status": review_status,
                "duplicate_status": primary.get("duplicate_status") or "unique",
                "occurrence_count": len(members_sorted),
                "first_seen_at": members_sorted[0].get("message_date_start"),
                "last_seen_at": members_sorted[-1].get("message_date_end")
                or members_sorted[-1].get("message_date_start"),
                "source_message_ids": source_message_ids,
                "source_posts": [
                    {
                        "internal_post_id": m.get("internal_post_id"),
                        "primary_message_id": m.get("primary_message_id"),
                        "decision": m.get("decision"),
                        "classification": m.get("classification"),
                        "message_date_start": m.get("message_date_start"),
                    }
                    for m in members_sorted
                ],
                "evidence": evidence,
                "warnings": list(dict.fromkeys(warnings)),
                "created_from_chat_id": primary.get("source_chat_id") or primary.get("chat_id"),
                "analyzer_version": primary.get("analyzer_version") or "llm_v1",
            }
        )

    # Filter: only one entity per cluster primary; satellites already skipped.
    # Additionally mark entities that are only rejected duplicates with no contacts as duplicate_only already handled.
    entities.sort(key=lambda e: e.get("last_seen_at") or "", reverse=True)
    return entities
