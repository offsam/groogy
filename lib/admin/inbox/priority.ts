import type { InboxReviewType } from "@/lib/admin/inbox/types";

/** High-confidence threshold used by Saved View + metrics (0–1 scale). */
export const INBOX_HIGH_CONFIDENCE_THRESHOLD = 0.7;

/** Normalize stored confidence (0–1 or 0–100) to 0–1. */
export function normalizeAiConfidence(
  value: number | null | undefined,
): number | null {
  if (value == null || Number.isNaN(value)) return null;
  if (value > 1) return Math.min(1, value / 100);
  return Math.max(0, Math.min(1, value));
}

const REVIEW_TYPE_WEIGHT: Record<InboxReviewType, number> = {
  ownership_claim: 20,
  import_review: 15,
  event_verification: 12,
  recommendation: 10,
};

/**
 * Computed Priority Score (0–100), no DB schema.
 * - AI Confidence → up to 40
 * - Age (older = higher) → up to 40
 * - Review Type → up to 20
 */
export function computeInboxPriorityScore(input: {
  aiConfidence: number | null;
  createdAt: string;
  reviewType: InboxReviewType;
  nowMs?: number;
}): number {
  const conf = normalizeAiConfidence(input.aiConfidence);
  // Missing confidence → neutral mid so age/type still drive ranking
  const confidencePart = Math.round((conf ?? 0.5) * 40);

  const created = Date.parse(input.createdAt);
  const now = input.nowMs ?? Date.now();
  const ageDays = Number.isNaN(created)
    ? 0
    : Math.max(0, (now - created) / 86_400_000);
  // Cap at 14 days → full 40 points
  const agePart = Math.round(Math.min(40, (ageDays / 14) * 40));

  const typePart = REVIEW_TYPE_WEIGHT[input.reviewType] ?? 10;

  return Math.max(0, Math.min(100, confidencePart + agePart + typePart));
}

export function priorityBand(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}
