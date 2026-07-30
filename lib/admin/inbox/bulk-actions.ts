"use server";

/**
 * Bulk Inbox actions — thin fan-out over existing moderation handlers.
 * No new moderation product / DB schema.
 */

import {
  approveImportReviewItemAction,
  setImportReviewStatusAction,
} from "@/lib/import-review/actions";
import { adminReviewBusinessClaimAction } from "@/lib/admin/claim-actions";
import {
  approveCommentRecommendationAction,
  approveEventRecommendationAction,
  rejectCommentRecommendationAction,
} from "@/lib/import-review/recommendation-actions";
import type { ImportReviewStatus } from "@/types/import-review";
import type { InboxReviewType } from "@/lib/admin/inbox/types";

export type InboxBulkAction =
  | "approve"
  | "reject"
  | "archive"
  | "change_status";

export type InboxBulkTarget = {
  id: string;
  sourceId: string;
  reviewType: InboxReviewType;
};

export type InboxBulkResult = {
  ok: boolean;
  processed: number;
  failed: number;
  skipped: number;
  messages: string[];
};

function parseTargets(items: InboxBulkTarget[]): InboxBulkTarget[] {
  return items.filter((t) => t.sourceId && t.reviewType);
}

async function approveOne(t: InboxBulkTarget): Promise<string | null> {
  if (t.reviewType === "import_review") {
    const res = await approveImportReviewItemAction({ id: t.sourceId });
    return res.ok ? null : res.message;
  }
  if (t.reviewType === "ownership_claim") {
    const res = await adminReviewBusinessClaimAction({
      claimId: t.sourceId,
      decision: "approved",
      moderatorNote: null,
    });
    return res.ok ? null : res.message;
  }
  if (t.reviewType === "recommendation") {
    const res = await approveCommentRecommendationAction({ id: t.sourceId });
    return res.ok ? null : res.message || "Approve failed";
  }
  if (t.reviewType === "event_verification") {
    const res = await approveEventRecommendationAction({ id: t.sourceId });
    return res.ok ? null : res.message || "Approve failed";
  }
  return "Unsupported review type";
}

async function rejectOne(t: InboxBulkTarget): Promise<string | null> {
  if (t.reviewType === "import_review") {
    const res = await setImportReviewStatusAction({
      id: t.sourceId,
      status: "rejected",
      rejectReason: "other",
    });
    return res.ok ? null : res.message;
  }
  if (t.reviewType === "ownership_claim") {
    const res = await adminReviewBusinessClaimAction({
      claimId: t.sourceId,
      decision: "rejected",
      moderatorNote: null,
    });
    return res.ok ? null : res.message;
  }
  if (
    t.reviewType === "recommendation" ||
    t.reviewType === "event_verification"
  ) {
    const res = await rejectCommentRecommendationAction({ id: t.sourceId });
    return res.ok ? null : res.message || "Reject failed";
  }
  return "Unsupported review type";
}

async function changeStatusOne(
  t: InboxBulkTarget,
  status: ImportReviewStatus,
): Promise<"ok" | "skip" | string> {
  if (t.reviewType !== "import_review") {
    return "skip";
  }
  const res = await setImportReviewStatusAction({
    id: t.sourceId,
    status,
  });
  return res.ok ? "ok" : res.message;
}

export async function runInboxBulkAction(input: {
  action: InboxBulkAction;
  targets: InboxBulkTarget[];
  /** For change_status — Import Review statuses only */
  status?: ImportReviewStatus;
}): Promise<InboxBulkResult> {
  const targets = parseTargets(input.targets);
  const messages: string[] = [];
  let processed = 0;
  let failed = 0;
  let skipped = 0;

  if (input.action === "archive") {
    return {
      ok: false,
      processed: 0,
      failed: 0,
      skipped: targets.length,
      messages: [
        "Archive bulk: Coming Soon (нет единого admin archive API для всех типов).",
      ],
    };
  }

  for (const t of targets) {
    try {
      if (input.action === "approve") {
        const err = await approveOne(t);
        if (err) {
          failed += 1;
          messages.push(`${t.id}: ${err}`);
        } else {
          processed += 1;
        }
        continue;
      }
      if (input.action === "reject") {
        const err = await rejectOne(t);
        if (err) {
          failed += 1;
          messages.push(`${t.id}: ${err}`);
        } else {
          processed += 1;
        }
        continue;
      }
      if (input.action === "change_status") {
        if (!input.status) {
          failed += 1;
          messages.push(`${t.id}: status required`);
          continue;
        }
        const res = await changeStatusOne(t, input.status);
        if (res === "ok") processed += 1;
        else if (res === "skip") skipped += 1;
        else {
          failed += 1;
          messages.push(`${t.id}: ${res}`);
        }
        continue;
      }
      skipped += 1;
    } catch (err) {
      failed += 1;
      messages.push(
        `${t.id}: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  return {
    ok: failed === 0,
    processed,
    failed,
    skipped,
    messages: messages.slice(0, 12),
  };
}
