import type { PendingBusinessClaim } from "@/lib/admin/claim-actions";
import type { InboxItem, InboxReviewType } from "@/lib/admin/inbox/types";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import type { ImportReviewItem } from "@/types/import-review";
import type { Business } from "@/types/business";
import type { PlatformEvent } from "@/lib/events/queries";

export type ReviewWorkspacePayload =
  | {
      kind: "import_review";
      item: ImportReviewItem;
    }
  | {
      kind: "ownership_claim";
      claim: PendingBusinessClaim;
      business: Business | null;
    }
  | {
      kind: "event_verification";
      item: CommentRecommendation;
      eventPreview: PlatformEvent;
    }
  | {
      kind: "recommendation";
      item: CommentRecommendation;
    };

export type ReviewWorkspaceTask = {
  taskId: string;
  reviewType: InboxReviewType;
  sourceId: string;
  meta: InboxItem;
  originalUrl: string;
  publicUrl: string | null;
  sourceUrl: string | null;
  payload: ReviewWorkspacePayload;
};
