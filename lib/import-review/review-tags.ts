/**
 * Registry of review_notes control tags — TS mirror of
 * scripts/import-review/review_tags.py (the canonical table lives there).
 * The DB publish gate keys on the exact spelling of the two *_CONFIRMED tags.
 */
export const TAG_NEEDS_MANUAL_TYPE = "[needs_manual_type]";
export const TAG_HUMAN_CONFIRMED = "[human_confirmed]";
export const TAG_EVENT_DATE_CONFIRMED = "[event_date_confirmed]";

export const TAG_ENRICH_P5A_DONE = "[enrich_p5a_done]";
export const TAG_ENRICH_P5A_PARTIAL = "[enrich_p5a_partial]";
export const TAG_ENRICH_P5A_FAILED = "[enrich_p5a_failed]";
export const TAG_ENRICH_P5B_DONE = "[enrich_p5b_done]";
export const TAG_ENRICH_P5B_SKIPPED = "[enrich_p5b_skipped]";
export const TAG_ENRICH_P5B_FAILED = "[enrich_p5b_failed]";
export const TAG_ENRICH_P5C_DONE = "[enrich_p5c_done]";
export const TAG_READY_FOR_MODERATOR = "[ready_for_moderator]";

export const ENRICH_STAGE_TAGS = [
  TAG_ENRICH_P5A_DONE,
  TAG_ENRICH_P5A_PARTIAL,
  TAG_ENRICH_P5A_FAILED,
  TAG_ENRICH_P5B_DONE,
  TAG_ENRICH_P5B_SKIPPED,
  TAG_ENRICH_P5B_FAILED,
  TAG_ENRICH_P5C_DONE,
  TAG_READY_FOR_MODERATOR,
] as const;

export const ALL_REVIEW_TAGS = [
  TAG_NEEDS_MANUAL_TYPE,
  TAG_HUMAN_CONFIRMED,
  TAG_EVENT_DATE_CONFIRMED,
  ...ENRICH_STAGE_TAGS,
] as const;
