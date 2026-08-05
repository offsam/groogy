import type { ImportReviewItem } from "@/types/import-review";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import type { InboxItem } from "@/lib/admin/inbox/types";
import type { LaneClassifyInput } from "@/lib/admin/lanes/types";
import { completenessPercent } from "@/lib/import-review/preview-completeness";
import { importReviewCompleteness } from "@/lib/import-review/pre-publish-enrich";

export function laneInputFromImportReview(
  item: Pick<
    ImportReviewItem,
    | "review_status"
    | "review_notes"
    | "entity_type"
    | "target_collection"
    | "title"
    | "business_name"
    | "person_name"
    | "description"
    | "source_text"
    | "phone"
    | "email"
    | "website"
    | "instagram"
    | "telegram_username"
    | "city"
    | "address_line"
    | "category"
  > & {
    completeness_score?: number | null;
    contact_priority_score?: number | null;
  },
): LaneClassifyInput {
  let completeness = item.completeness_score ?? item.contact_priority_score ?? null;
  if (completeness == null) {
    try {
      completeness = completenessPercent(
        importReviewCompleteness(item as ImportReviewItem),
      );
    } catch {
      completeness = null;
    }
  }
  return {
    kind: "import_review",
    status: item.review_status,
    reviewNotes: item.review_notes,
    entityType: item.entity_type,
    targetCollection: item.target_collection,
    title: item.title,
    businessName: item.business_name,
    personName: item.person_name,
    description: item.description,
    sourceText: item.source_text,
    phone: item.phone,
    email: item.email,
    website: item.website,
    instagram: item.instagram,
    telegram: item.telegram_username,
    city: item.city,
    addressLine: item.address_line,
    category: item.category,
    completenessPercent:
      typeof completeness === "number" ? completeness : null,
  };
}

export function laneInputFromRecommendation(
  item: CommentRecommendation,
): LaneClassifyInput {
  const third =
    Number(item.third_party_mention_count ?? 0) > 0 &&
    Number(item.self_ad_mention_count ?? 0) === 0;
  return {
    kind: item.kind === "event" ? "event_recommendation" : "recommendation",
    status: item.status,
    reviewNotes: item.notes,
    entityType: item.kind === "event" ? "event" : null,
    targetCollection: item.kind === "event" ? "events" : null,
    title: item.display_name,
    displayName: item.display_name,
    description: [
      ...(item.comment_texts || []),
      ...(item.request_snippets || []),
    ].join("\n"),
    sourceText: (item.request_snippets || []).join("\n"),
    phone: item.phones,
    website: item.websites,
    instagram: item.instagram,
    city: item.city,
    suspectedDuplicate: item.status === "suspected_duplicate",
    hasDuplicateTarget: Boolean(item.duplicate_of_entity_id),
    thirdPartyOnly: third,
    eventStartsAt: item.starts_at || item.event_at || item.ends_at,
  };
}

/** Lightweight classify from already-projected InboxItem (list filter). */
export function laneInputFromInboxItem(item: InboxItem): LaneClassifyInput {
  return {
    kind:
      item.reviewType === "recommendation"
        ? "recommendation"
        : item.reviewType === "event_verification"
          ? "event_recommendation"
          : "import_review",
    status: item.status,
    reviewNotes: item.reviewNotes,
    title: item.title,
    // Title often carries the seeking line («Ищу …») when notes lack [seeking].
    sourceText: item.title,
    completenessPercent: item.completenessPercent,
    suspectedDuplicate: item.status === "suspected_duplicate",
    hasDuplicateTarget: item.status === "suspected_duplicate",
    eventStartsAt: item.eventStartsAt,
    entityType:
      item.entityType === "professional"
        ? "private_specialist"
        : item.entityType === "business"
          ? "business"
          : item.entityType === "event"
            ? "event"
            : item.entityType === "job"
              ? "job"
              : item.entityType === "marketplace"
                ? "marketplace_listing"
                : null,
  };
}
