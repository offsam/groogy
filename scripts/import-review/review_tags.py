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
"""

from __future__ import annotations

TAG_NEEDS_MANUAL_TYPE = "[needs_manual_type]"
TAG_HUMAN_CONFIRMED = "[human_confirmed]"
TAG_EVENT_DATE_CONFIRMED = "[event_date_confirmed]"


def proposed_tag(entity_type: str, confidence: str = "medium") -> str:
    """MEDIUM-confidence classification proposal, attached after the park tag."""
    return f"[proposed:{entity_type}:{confidence}]"


# Every literal the SQL gate must contain verbatim (drift-checked in CI).
SQL_GATE_TAGS = (TAG_HUMAN_CONFIRMED, TAG_EVENT_DATE_CONFIRMED)

ALL_TAGS = (
    TAG_NEEDS_MANUAL_TYPE,
    TAG_HUMAN_CONFIRMED,
    TAG_EVENT_DATE_CONFIRMED,
)
