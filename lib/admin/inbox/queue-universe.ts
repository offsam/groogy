/**
 * One definition of “open queue” for admin tiles + Inbox totals.
 * If these diverge, the home tile says 10 000 and the list shows 190.
 */

/** import_review_items statuses that appear in the Inbox working set. */
export const IMPORT_REVIEW_OPEN_STATUSES = [
  "pending",
  "ready_to_publish",
  "quarantine",
  "in_review",
  "needs_more_info",
] as const;

/** Recommendation statuses that appear in the Inbox working set. */
export const RECOMMENDATION_OPEN_STATUSES = [
  "pending",
  "suspected_duplicate",
  "quarantine",
] as const;

export function sumStatusCounts(
  byStatus: Record<string, number> | null | undefined,
  statuses: readonly string[],
): number {
  let total = 0;
  for (const status of statuses) {
    total += Number(byStatus?.[status] ?? 0);
  }
  return total;
}
