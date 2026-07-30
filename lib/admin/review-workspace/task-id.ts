import type { InboxReviewType } from "@/lib/admin/inbox/types";

const REVIEW_TYPES: InboxReviewType[] = [
  "import_review",
  "ownership_claim",
  "event_verification",
  "recommendation",
];

export type ParsedReviewTaskId = {
  reviewType: InboxReviewType;
  sourceId: string;
};

/** Composite task id used by Inbox + Workspace: `reviewType:sourceId`. */
export function buildReviewTaskId(
  reviewType: InboxReviewType,
  sourceId: string,
): string {
  return `${reviewType}:${sourceId}`;
}

export function parseReviewTaskId(
  taskId: string,
): ParsedReviewTaskId | null {
  const raw = decodeURIComponent(taskId.trim());
  if (!raw) return null;

  // Bare UUID → Import Review (legacy convenience)
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      raw,
    )
  ) {
    return { reviewType: "import_review", sourceId: raw };
  }

  const colon = raw.indexOf(":");
  if (colon <= 0) return null;
  const reviewType = raw.slice(0, colon) as InboxReviewType;
  const sourceId = raw.slice(colon + 1).trim();
  if (!sourceId || !REVIEW_TYPES.includes(reviewType)) return null;
  return { reviewType, sourceId };
}

export function reviewWorkspacePath(
  reviewType: InboxReviewType,
  sourceId: string,
): string {
  return `/admin/review/${encodeURIComponent(buildReviewTaskId(reviewType, sourceId))}`;
}
