import {
  INBOX_HIGH_CONFIDENCE_THRESHOLD,
  normalizeAiConfidence,
} from "@/lib/admin/inbox/priority";
import type { InboxItem, InboxMetrics } from "@/lib/admin/inbox/types";

export function computeInboxMetrics(items: InboxItem[]): InboxMetrics {
  let inReview = 0;
  let highConfidence = 0;
  let oldestTaskAt: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;

  for (const item of items) {
    if (item.status === "in_review") inReview += 1;
    const conf = normalizeAiConfidence(item.aiConfidence);
    if (conf != null && conf >= INBOX_HIGH_CONFIDENCE_THRESHOLD) {
      highConfidence += 1;
    }
    const t = Date.parse(item.createdAt);
    if (!Number.isNaN(t) && t < oldestMs) {
      oldestMs = t;
      oldestTaskAt = item.createdAt;
    }
  }

  return {
    total: items.length,
    inReview,
    highConfidence,
    oldestTaskAt,
  };
}
