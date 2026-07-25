#!/usr/bin/env python3
"""Reviewer v1 pipeline over existing 6-month outputs.

- LLM only for needs_review
- Deterministic rescue of marketplace/real_estate from rejected
- Recurring enrichment + entity normalization
- No Telegram reads, no run_full, no Supabase
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from config import SCRIPT_DIR, load_env
from cost import CostTracker, load_max_cost_usd
from entities import apply_global_deduplication, build_entities
from llm_client import LLMClient
from reviewer import (
    REVIEWER_VERSION,
    apply_reviewer_decision,
    as_list,
    attach_telegram_contact,
    extract_marketplace_fields,
    has_any_contact,
    infer_entity_type,
    infer_target_collection,
    normalize_entity,
    review_one_llm,
    utc_now,
)

FULL_DIR = SCRIPT_DIR / "data" / "full"
PARTIAL = FULL_DIR / "reviewer_v1.partial.jsonl"


def load_json(name: str) -> Any:
    return json.loads((FULL_DIR / name).read_text(encoding="utf-8"))


def save_json(name: str, data: Any) -> None:
    path = FULL_DIR / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {path}", flush=True)


def rescue_marketplace_from_rejected(rejected: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rescued: list[dict[str, Any]] = []
    kept: list[dict[str, Any]] = []
    for post in rejected:
        cls = post.get("classification")
        if cls not in {"marketplace_item", "real_estate_listing"}:
            kept.append(post)
            continue
        entity = normalize_entity(post)
        if cls == "real_estate_listing":
            entity["entity_type"] = "real_estate"
            target = "real_estate"
        else:
            entity["entity_type"] = "marketplace_listing"
            target = "marketplace"
        entity["target_collection"] = target
        entity["marketplace"] = extract_marketplace_fields(post, entity)
        entity = attach_telegram_contact(entity, post)
        out = dict(post)
        out["extracted_entity"] = entity
        if has_any_contact(entity, out):
            out["decision"] = "accepted"
            out["review_status"] = "ready_for_review"
            out["reviewer_action"] = "promote_to_accepted"
            out["reviewer_reason"] = "deterministic_marketplace_rescue_from_rejected"
        else:
            out["decision"] = "needs_review"
            out["review_status"] = "pending_manual_review"
            out["reviewer_action"] = "keep_review"
            out["reviewer_reason"] = "marketplace_without_contact"
        out["reviewer_version"] = REVIEWER_VERSION
        out["reviewed_at"] = utc_now()
        out["saved_via_telegram_user_id"] = bool(
            not any(as_list(entity.get(k)) for k in ("phone", "whatsapp", "instagram", "website", "email", "telegram"))
            and entity.get("telegram_user_id")
            and out["decision"] == "accepted"
        )
        rescued.append(out)
    return rescued, kept


def normalize_accepted(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for post in posts:
        p = dict(post)
        entity = normalize_entity(p)
        if entity.get("entity_type") not in {
            "business",
            "private_specialist",
            "marketplace_listing",
            "organization",
            "event",
            "job",
            "real_estate",
        }:
            entity["entity_type"] = infer_entity_type(p, entity)
        entity["target_collection"] = infer_target_collection(
            entity.get("entity_type"), entity.get("category"), p.get("classification")
        )
        if entity["entity_type"] in {"marketplace_listing", "real_estate"}:
            entity["marketplace"] = extract_marketplace_fields(p, entity)
        # demote if no contact after normalization
        if not has_any_contact(entity, p):
            p["decision"] = "needs_review"
            p["review_status"] = "pending_manual_review"
            p["reviewer_action"] = "keep_review"
            p["reviewer_reason"] = "accepted_demoted_missing_contact_after_normalization"
        else:
            p["decision"] = "accepted"
            p["review_status"] = "ready_for_review"
        p["extracted_entity"] = entity
        out.append(p)
    return out


def enrich_recurring_clusters(posts: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Merge contact/service fields from recurring satellites into unique primaries."""
    by_id = {p.get("internal_post_id"): p for p in posts if p.get("internal_post_id")}
    clusters: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in posts:
        status = p.get("duplicate_status") or "unique"
        if status == "unique":
            clusters[p["internal_post_id"]].append(p)
        else:
            primary = p.get("duplicate_of_internal_post_id")
            if primary and primary in by_id:
                clusters[primary].append(p)
            else:
                clusters[p["internal_post_id"]].append(p)

    merged_count = 0
    for primary_id, members in clusters.items():
        if len(members) <= 1:
            continue
        primary = by_id.get(primary_id)
        if not primary:
            continue
        entity = dict(primary.get("extracted_entity") or {})
        before = json.dumps(
            {k: entity.get(k) for k in ("phone", "instagram", "telegram", "whatsapp", "email", "website", "city", "services", "prices")},
            ensure_ascii=False,
            sort_keys=True,
        )
        for field in ("phone", "instagram", "telegram", "whatsapp", "email", "website", "services", "prices", "service_area"):
            vals: list[str] = []
            for m in members:
                vals.extend(as_list((m.get("extracted_entity") or {}).get(field)))
            entity[field] = list(dict.fromkeys(vals))
        cities = []
        for m in members:
            c = (m.get("extracted_entity") or {}).get("city")
            if c and c not in cities:
                cities.append(c)
        if cities and not entity.get("city"):
            entity["city"] = cities[0]
        if len(cities) > 1:
            warnings = list(primary.get("warnings") or [])
            warnings.append(f"conflicting_city:{cities}")
            primary["warnings"] = warnings
        dates = [m.get("message_date_start") for m in members if m.get("message_date_start")]
        primary["occurrence_count"] = len(members)
        primary["first_seen_at"] = min(dates) if dates else primary.get("first_seen_at")
        primary["last_seen_at"] = max(dates) if dates else primary.get("last_seen_at")
        primary["extracted_entity"] = attach_telegram_contact(entity, primary)
        after = json.dumps(
            {k: entity.get(k) for k in ("phone", "instagram", "telegram", "whatsapp", "email", "website", "city", "services", "prices")},
            ensure_ascii=False,
            sort_keys=True,
        )
        if before != after:
            merged_count += 1
            primary["recurring_enriched"] = True
    return posts, merged_count


def load_partial() -> dict[str, dict[str, Any]]:
    done: dict[str, dict[str, Any]] = {}
    if PARTIAL.is_file():
        with PARTIAL.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                pid = row.get("internal_post_id")
                if pid:
                    done[pid] = row
    return done


def append_partial(row: dict[str, Any]) -> None:
    with PARTIAL.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def review_needs(needs: list[dict[str, Any]], workers: int = 4) -> tuple[list[dict[str, Any]], CostTracker]:
    load_env()
    os.environ.setdefault("TELEGRAM_LLM_PROVIDER", "openrouter")
    os.environ.setdefault("TELEGRAM_LLM_MODEL", "openai/gpt-4o-mini")
    max_cost = min(load_max_cost_usd(3.0), 3.0)
    tracker = CostTracker(model=os.environ["TELEGRAM_LLM_MODEL"], max_cost_usd=max_cost)
    client = LLMClient(tracker, request_delay_s=0.08, timeout_s=90)

    done = load_partial()
    print(f"Resuming reviewer partial: {len(done)} already saved", flush=True)
    pending = [p for p in needs if p.get("internal_post_id") not in done]
    results_map = dict(done)

    def _job(post: dict[str, Any]) -> dict[str, Any]:
        return review_one_llm(client, post)

    if pending:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = {pool.submit(_job, p): p.get("internal_post_id") for p in pending}
            finished = len(done)
            total = len(needs)
            for fut in as_completed(futs):
                pid = futs[fut]
                row = fut.result()
                results_map[pid] = row
                append_partial(row)
                finished += 1
                if finished % 25 == 0 or finished == total:
                    print(
                        f"reviewed {finished}/{total} cost=${tracker.cost_usd:.4f}",
                        flush=True,
                    )
                if tracker.would_exceed():
                    print("Cost limit reached during reviewer; stopping new LLM calls.", flush=True)
                    break

    # Keep original needs order; pending not reviewed stay as keep_review normalized
    out: list[dict[str, Any]] = []
    for p in needs:
        pid = p.get("internal_post_id")
        if pid in results_map:
            out.append(results_map[pid])
        else:
            # not reviewed due to cost stop — normalize and keep review
            base = dict(p)
            base["extracted_entity"] = normalize_entity(base)
            base = apply_reviewer_decision(
                base,
                {"action": "keep_review", "reason": "not_reviewed_cost_or_interrupt", "confidence": 0.5},
            )
            out.append(base)
    return out, tracker


def build_summary(
    before: dict[str, int],
    after_posts: list[dict[str, Any]],
    entities: list[dict[str, Any]],
    *,
    promoted: int,
    rejected_from_review: int,
    kept: int,
    marketplace_count: int,
    saved_via_tg: int,
    entity_type_fixed: int,
    recurring_merged: int,
    tracker: CostTracker,
) -> dict[str, Any]:
    accepted = [p for p in after_posts if p.get("decision") == "accepted"]
    needs = [p for p in after_posts if p.get("decision") == "needs_review"]
    rejected = [p for p in after_posts if p.get("decision") == "rejected"]

    def contact_count(field: str) -> int:
        return sum(1 for p in accepted if as_list((p.get("extracted_entity") or {}).get(field)) or (p.get("extracted_entity") or {}).get(field))

    tg_uid = sum(1 for p in accepted if (p.get("extracted_entity") or {}).get("telegram_user_id"))
    no_contact = sum(1 for p in accepted if not has_any_contact(p.get("extracted_entity") or {}, p))

    return {
        "reviewer_version": REVIEWER_VERSION,
        "before": before,
        "after": {
            "accepted": len(accepted),
            "needs_review": len(needs),
            "rejected": len(rejected),
        },
        "transitions": {
            "review_to_accepted": promoted,
            "review_to_rejected": rejected_from_review,
            "review_kept": kept,
        },
        "accepted_contacts": {
            "phone": contact_count("phone"),
            "instagram": contact_count("instagram"),
            "telegram": contact_count("telegram"),
            "telegram_user_id": tg_uid,
            "whatsapp": contact_count("whatsapp"),
            "website": contact_count("website"),
            "email": contact_count("email"),
            "no_direct_contact": no_contact,
        },
        "marketplace_listings": marketplace_count,
        "saved_via_telegram_user_id": saved_via_tg,
        "target_collection": dict(
            Counter((p.get("extracted_entity") or {}).get("target_collection") for p in after_posts)
        ),
        "entity_type": dict(
            Counter((p.get("extracted_entity") or {}).get("entity_type") for p in after_posts)
        ),
        "recurring_clusters_enriched": recurring_merged,
        "entity_type_fixed": entity_type_fixed,
        "entities_total": len(entities),
        "cost": tracker.as_dict(),
        "supabase_written": False,
        "telegram_reread": False,
        "run_full_used": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=None, help="Optional cap on needs_review for testing")
    args = parser.parse_args()

    load_env()
    accepted_before = load_json("fun_for_mom_accepted.json")["posts"]
    needs_before = load_json("fun_for_mom_needs_review.json")["posts"]
    rejected_before = load_json("fun_for_mom_rejected.json")["posts"]
    all_before = load_json("fun_for_mom_all_analyzed.json")["posts"]

    before_counts = {
        "accepted": len(accepted_before),
        "needs_review": len(needs_before),
        "rejected": len(rejected_before),
    }
    print("Before:", before_counts, flush=True)

    # 1) Deterministic marketplace rescue from rejected (no LLM)
    rescued, rejected_kept = rescue_marketplace_from_rejected(rejected_before)
    print(f"Rescued marketplace/realty from rejected: {len(rescued)}", flush=True)

    # 2) Normalize existing accepted (no LLM)
    accepted_norm = normalize_accepted(accepted_before)
    entity_type_fixed = sum(
        1
        for a, b in zip(accepted_before, accepted_norm)
        if (a.get("extracted_entity") or {}).get("entity_type")
        != (b.get("extracted_entity") or {}).get("entity_type")
    )

    # 3) LLM reviewer on needs_review only
    needs_input = needs_before[: args.limit] if args.limit else needs_before
    reviewed, tracker = review_needs(needs_input, workers=args.workers)
    if args.limit and len(needs_before) > args.limit:
        # remaining untouched needs stay needs_review normalized
        for p in needs_before[args.limit :]:
            base = dict(p)
            base["extracted_entity"] = normalize_entity(base)
            reviewed.append(
                apply_reviewer_decision(
                    base, {"action": "keep_review", "reason": "limit_skip", "confidence": 0.5}
                )
            )

    promoted = sum(1 for p in reviewed if p.get("reviewer_action") == "promote_to_accepted")
    rejected_from_review = sum(1 for p in reviewed if p.get("reviewer_action") == "reject")
    kept = sum(1 for p in reviewed if p.get("reviewer_action") == "keep_review")
    print(
        f"Reviewer transitions: promote={promoted} reject={rejected_from_review} keep={kept} "
        f"cost=${tracker.cost_usd:.4f}",
        flush=True,
    )

    # 4) Merge universe
    # Start from all_before map for duplicate metadata preservation
    by_id = {p.get("internal_post_id"): dict(p) for p in all_before}

    def upsert(rows: list[dict[str, Any]]) -> None:
        for r in rows:
            pid = r.get("internal_post_id")
            if not pid:
                continue
            base = by_id.get(pid, {})
            merged = dict(base)
            merged.update(r)
            by_id[pid] = merged

    upsert(accepted_norm)
    upsert(reviewed)
    upsert(rescued)
    upsert(rejected_kept)

    all_posts = list(by_id.values())
    # Ensure every post has normalized entity/target
    fixed_more = 0
    for i, p in enumerate(all_posts):
        ent = p.get("extracted_entity") or {}
        before_et = ent.get("entity_type")
        ent = normalize_entity(p)
        if ent.get("entity_type") not in {
            "business",
            "private_specialist",
            "marketplace_listing",
            "organization",
            "event",
            "job",
            "real_estate",
        }:
            ent["entity_type"] = infer_entity_type(p, ent)
        if not ent.get("target_collection"):
            ent["target_collection"] = infer_target_collection(
                ent.get("entity_type"), ent.get("category"), p.get("classification")
            )
        if before_et != ent.get("entity_type"):
            fixed_more += 1
        p["extracted_entity"] = ent
        all_posts[i] = p
    entity_type_fixed += fixed_more

    # 5) Recurring enrichment
    all_posts, recurring_merged = enrich_recurring_clusters(all_posts)
    apply_global_deduplication(all_posts)

    accepted = [p for p in all_posts if p.get("decision") == "accepted"]
    needs = [p for p in all_posts if p.get("decision") == "needs_review"]
    rejected = [p for p in all_posts if p.get("decision") == "rejected"]
    marketplace_posts = [
        p
        for p in all_posts
        if (p.get("extracted_entity") or {}).get("entity_type") in {"marketplace_listing", "real_estate"}
        or (p.get("extracted_entity") or {}).get("target_collection") in {"marketplace", "real_estate"}
    ]
    saved_via_tg = sum(1 for p in accepted if p.get("saved_via_telegram_user_id"))

    entities = build_entities(all_posts)
    # Ensure entities have target_collection / non-empty entity_type
    for e in entities:
        if not e.get("entity_type"):
            e["entity_type"] = "private_specialist"
        if not e.get("target_collection"):
            e["target_collection"] = infer_target_collection(
                e.get("entity_type"), e.get("category"), None
            )

    summary = build_summary(
        before_counts,
        all_posts,
        entities,
        promoted=promoted,
        rejected_from_review=rejected_from_review,
        kept=kept,
        marketplace_count=len(marketplace_posts),
        saved_via_tg=saved_via_tg,
        entity_type_fixed=entity_type_fixed,
        recurring_merged=recurring_merged,
        tracker=tracker,
    )

    # Top 50 new accepted = accepted that came from reviewer promote or marketplace rescue
    new_accepted = [
        p
        for p in accepted
        if p.get("reviewer_action") == "promote_to_accepted"
        or str(p.get("reviewer_reason") or "").startswith("deterministic_marketplace")
    ]
    # newest first
    new_accepted.sort(key=lambda p: p.get("message_date_start") or "", reverse=True)

    reviewer_payload = {
        "meta": summary,
        "posts": all_posts,
        "new_accepted_top50": new_accepted[:50],
        "marketplace_posts": marketplace_posts,
    }
    save_json("fun_for_mom_reviewer_v1.json", reviewer_payload)
    save_json("fun_for_mom_reviewer_summary.json", summary)
    # Also refresh queue snapshots used for next import prep (not overwriting analyzer originals? user asked create reviewer files; refreshing queues is useful)
    save_json(
        "fun_for_mom_reviewer_accepted.json",
        {"meta": summary, "posts": accepted},
    )
    save_json(
        "fun_for_mom_reviewer_needs_review.json",
        {"meta": summary, "posts": needs},
    )
    save_json(
        "fun_for_mom_reviewer_rejected.json",
        {"meta": summary, "posts": rejected},
    )
    save_json(
        "fun_for_mom_reviewer_entities.json",
        {"meta": summary, "entities": entities},
    )
    save_json(
        "fun_for_mom_reviewer_marketplace.json",
        {"meta": summary, "posts": marketplace_posts},
    )

    print("\n=== REVIEWER REPORT ===", flush=True)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    print("\nTOP-50 new accepted:", flush=True)
    for i, p in enumerate(new_accepted[:50], 1):
        e = p.get("extracted_entity") or {}
        name = e.get("business_name") or e.get("person_name") or e.get("telegram_display_name")
        print(
            f"{i}. {name} | {e.get('entity_type')} | {e.get('target_collection')} | "
            f"cat={e.get('category')} phone={e.get('phone')} ig={e.get('instagram')} "
            f"tg_uid={e.get('telegram_user_id')} reason={str(p.get('reviewer_reason'))[:80]}",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
