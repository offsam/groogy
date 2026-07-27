/**
 * Registry of review_notes control tags — TS mirror of
 * scripts/import-review/review_tags.py (the canonical table lives there).
 * The DB publish gate keys on the exact spelling of the two *_CONFIRMED tags.
 */
export const TAG_NEEDS_MANUAL_TYPE = "[needs_manual_type]";
export const TAG_HUMAN_CONFIRMED = "[human_confirmed]";
export const TAG_EVENT_DATE_CONFIRMED = "[event_date_confirmed]";

export const ALL_REVIEW_TAGS = [
  TAG_NEEDS_MANUAL_TYPE,
  TAG_HUMAN_CONFIRMED,
  TAG_EVENT_DATE_CONFIRMED,
] as const;
