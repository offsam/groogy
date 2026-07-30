"""Registry of review_notes control tags — the single place these strings live.

These tags are load-bearing: the DB publish gate and the classification flow
key on their exact spelling. Python code MUST import from here; the SQL gate
(`import_review_publish_gate_errors` in supabase/migrations) cannot import,
so CI verifies the migration text contains the same literals (see
scripts/import-review/test_review_tags.py).

TS mirror: lib/import-review/review-tags.ts — keep both files in sync.

| Tag | Meaning | Written by | Checked by |
|-----|---------|-----------|------------|
| [needs_manual_type]     | untyped row parked for human classification | classify_null_queue.py | admin triage filters |
| [proposed:<type>:medium]| MEDIUM-confidence proposal attached to the park tag | classify_null_queue.py | human reviewer |
| [human_confirmed]       | human confirmed category='other' is genuinely right | admin (manually) | DB publish gate (specialists) |
| [event_date_confirmed]  | human verified the event date from the source post | admin (manually) | DB publish gate (events) |
| [enrich_p5a_done]       | P5A auto enrich completed with fills or nothing left | run_pre_publish_enrich.py | Review Workspace |
| [enrich_p5a_partial]    | P5A ran; some steps failed or skipped | run_pre_publish_enrich.py | Review Workspace |
| [enrich_p5a_failed]     | P5A could not run (unsupported type / error) | run_pre_publish_enrich.py | Review Workspace |
| [enrich_p5b_done]       | P5B AI signals present on queue row | run_pre_publish_enrich.py | Review Workspace |
| [enrich_p5b_skipped]    | P5B generative enrich not available pre-publish | run_pre_publish_enrich.py | Review Workspace |
| [enrich_p5b_failed]     | P5B unexpected failure | run_pre_publish_enrich.py | Review Workspace |
| [enrich_p5c_done]       | P5C completeness scored | run_pre_publish_enrich.py | Review Workspace |
| [ready_for_moderator]   | P5A–C finished (even partial) → P5D human | run_pre_publish_enrich.py | Review Workspace / inbox |
"""

from __future__ import annotations

TAG_NEEDS_MANUAL_TYPE = "[needs_manual_type]"
TAG_HUMAN_CONFIRMED = "[human_confirmed]"
TAG_EVENT_DATE_CONFIRMED = "[event_date_confirmed]"

TAG_ENRICH_P5A_DONE = "[enrich_p5a_done]"
TAG_ENRICH_P5A_PARTIAL = "[enrich_p5a_partial]"
TAG_ENRICH_P5A_FAILED = "[enrich_p5a_failed]"
TAG_ENRICH_P5B_DONE = "[enrich_p5b_done]"
TAG_ENRICH_P5B_SKIPPED = "[enrich_p5b_skipped]"
TAG_ENRICH_P5B_FAILED = "[enrich_p5b_failed]"
TAG_ENRICH_P5C_DONE = "[enrich_p5c_done]"
TAG_READY_FOR_MODERATOR = "[ready_for_moderator]"

ENRICH_STAGE_TAGS = (
    TAG_ENRICH_P5A_DONE,
    TAG_ENRICH_P5A_PARTIAL,
    TAG_ENRICH_P5A_FAILED,
    TAG_ENRICH_P5B_DONE,
    TAG_ENRICH_P5B_SKIPPED,
    TAG_ENRICH_P5B_FAILED,
    TAG_ENRICH_P5C_DONE,
    TAG_READY_FOR_MODERATOR,
)


def proposed_tag(entity_type: str, confidence: str = "medium") -> str:
    """MEDIUM-confidence classification proposal, attached after the park tag."""
    return f"[proposed:{entity_type}:{confidence}]"


# Every literal the SQL gate must contain verbatim (drift-checked in CI).
SQL_GATE_TAGS = (TAG_HUMAN_CONFIRMED, TAG_EVENT_DATE_CONFIRMED)

ALL_TAGS = (
    TAG_NEEDS_MANUAL_TYPE,
    TAG_HUMAN_CONFIRMED,
    TAG_EVENT_DATE_CONFIRMED,
    *ENRICH_STAGE_TAGS,
)


def merge_enrich_tags(notes: str | None, *new_tags: str) -> str:
    """Append enrich stage tags; replace prior enrich_* / ready_for_moderator tags."""
    text = (notes or "").strip()
    for tag in ENRICH_STAGE_TAGS:
        text = text.replace(tag, "")
    text = " ".join(text.split())
    extras = " ".join(t for t in new_tags if t)
    if text and extras:
        return f"{text} {extras}".strip()
    return (text or extras).strip()
