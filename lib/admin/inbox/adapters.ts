import type { PendingBusinessClaim } from "@/lib/admin/claim-actions";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import type { ImportReviewListItem } from "@/lib/import-review/queries";
import type { ImportReviewEntityType } from "@/types/import-review";
import { reviewWorkspacePath } from "@/lib/admin/review-workspace/task-id";
import { scoreImportReviewQueueItem } from "@/lib/import-review/queue-completeness-score";
import { importReviewCompleteness } from "@/lib/import-review/pre-publish-enrich";
import { yellowPagesEntityKind } from "@/lib/import-review/yellow-pages-preview";
import { structureEventFromText } from "@/lib/events/structure-event-from-text";
import { telegramSourceByGroupLabel } from "@/lib/import-review/telegram-sources";
import type {
  InboxEntityType,
  InboxItem,
  InboxSourceKey,
} from "@/lib/admin/inbox/types";

/** How “full” a recommendation card is — drives Inbox sort (ready first). */
export function scoreRecommendationReadiness(
  item: CommentRecommendation,
): number {
  let score = 0;
  if (item.display_name?.trim()) score += 25;
  if ((item.phones?.length ?? 0) > 0) score += 25;
  if ((item.instagram?.length ?? 0) > 0) score += 15;
  if ((item.websites?.length ?? 0) > 0) score += 15;
  if (item.category_guess?.trim()) score += 8;
  if (item.city?.trim()) score += 5;
  if (item.cover_image_url?.trim()) score += 4;
  if (item.notes?.trim()) score += 3;
  score += Math.min(5, Number(item.mention_count ?? 0));
  return Math.max(0, Math.min(100, score));
}

function compositeId(reviewType: InboxItem["reviewType"], sourceId: string) {
  return `${reviewType}:${sourceId}`;
}

/** Prefer end → start → parseable event_at for “already over” checks. */
function resolveEventInstant(
  item: Pick<CommentRecommendation, "ends_at" | "starts_at" | "event_at">,
): string | null {
  for (const raw of [item.ends_at, item.starts_at, item.event_at]) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

/**
 * Affiche date parsed from the post — same source the preview card uses, so a
 * queue row and its card never disagree. Recurring posts list several
 * sessions: take the latest, otherwise a still-running series looks expired.
 */
function eventInstantFromPostText(text: string): string | null {
  if (!text.trim()) return null;
  const structured = structureEventFromText(text);
  const stamps = [
    structured.startsAt,
    ...structured.occurrences.map((o) => o.startsAt),
  ]
    .filter((x): x is string => Boolean(x))
    .map((x) => Date.parse(x))
    .filter((t) => !Number.isNaN(t));
  if (!stamps.length) return null;
  return new Date(Math.max(...stamps)).toISOString();
}

function mapImportEntityType(
  entityType: ImportReviewEntityType | null | undefined,
): InboxEntityType {
  switch (entityType) {
    case "business":
      return "business";
    case "private_specialist":
      return "professional";
    case "marketplace_listing":
      return "marketplace";
    case "job":
      return "job";
    case "event":
      return "event";
    case "organization":
      return "organization";
    case "real_estate":
    case "lechu_listing":
    case "transfer_listing":
      return "other";
    default:
      return "unknown";
  }
}

/** Same resolver the workspace preview uses, so header and card agree. */
function mapRecommendationEntity(item: CommentRecommendation): InboxEntityType {
  if (item.kind === "event") return "event";
  return yellowPagesEntityKind(item);
}

/** Normalize raw provenance strings into Inbox Source filter keys. */
export function normalizeInboxSource(
  raw: string | null | undefined,
): InboxSourceKey {
  const s = (raw ?? "").toLowerCase().trim();
  if (!s) return "other";
  if (s === "claims" || s === "ownership_claim") return "claims";
  if (s.includes("loveoverse")) return "loveoverse";
  if (s.includes("eventbrite")) return "eventbrite";
  if (s.includes("telegram") || s.startsWith("tg_")) return "telegram";
  if (s.includes("facebook") || s.includes("fb_")) return "facebook";
  if (
    s.includes("yellow") ||
    s.includes("director") ||
    s.includes("svoi") ||
    s.includes("orange_pages") ||
    s.includes("pages") ||
    s.includes("zerkalo") ||
    s.includes("echoru") ||
    s.includes("to4ka") ||
    s.includes("slavic") ||
    s.includes("ruspages") ||
    s.includes("boston") ||
    s.includes("our_texas") ||
    s.includes("russian_seattle")
  ) {
    return "directories";
  }
  if (s.includes("professional_cleanup") || s.includes("cleanup")) {
    return "professional_cleanup";
  }
  if (s.includes("recommend")) return "recommendations";
  if (s.includes("import")) return "import";
  return "other";
}

export function fromImportReviewItem(item: ImportReviewListItem): InboxItem {
  const title =
    item.title?.trim() ||
    item.business_name?.trim() ||
    item.person_name?.trim() ||
    item.source_text?.trim()?.slice(0, 80) ||
    "Без названия";

  const source = normalizeInboxSource(item.source);
  const sourceName =
    item.source_group?.trim() ||
    item.source?.trim() ||
    "Import Review";
  const tgMeta = telegramSourceByGroupLabel(item.source_group?.trim() || "");
  const sourceRef =
    tgMeta?.id ??
    (item.source_group?.trim() || item.source?.trim() || null);

  const checklist = importReviewCompleteness(item);
  const entityType = mapImportEntityType(item.entity_type);
  let eventStartsAt: string | null = null;
  if (entityType === "event") {
    const raw =
      item.raw_payload && typeof item.raw_payload === "object"
        ? (item.raw_payload as Record<string, unknown>)
        : {};
    eventStartsAt =
      resolveEventInstant({
        ends_at: typeof raw.ends_at === "string" ? raw.ends_at : null,
        starts_at: typeof raw.starts_at === "string" ? raw.starts_at : null,
        event_at:
          typeof raw.event_at_label === "string"
            ? raw.event_at_label
            : typeof raw.event_at === "string"
              ? raw.event_at
              : null,
      }) ??
      eventInstantFromPostText(
        [item.description, item.source_text, item.title]
          .filter((x): x is string => Boolean(x?.trim()))
          .join("\n"),
      );
  }

  return {
    id: compositeId("import_review", item.id),
    sourceId: item.id,
    entityType,
    title,
    source,
    sourceName,
    sourceRef,
    status: item.review_status,
    reviewNotes: item.review_notes ?? null,
    aiConfidence:
      typeof item.ai_confidence === "number" ? item.ai_confidence : null,
    // Enrich weighted score (same as history 65→73), not checklist %.
    completenessPercent: scoreImportReviewQueueItem(item),
    checklistReady: checklist.readyCount,
    checklistTotal: checklist.total,
    createdAt: item.created_at,
    eventStartsAt,
    priority: Number(item.contact_priority_score ?? 0),
    targetUrl: reviewWorkspacePath("import_review", item.id),
    reviewType: "import_review",
  };
}

export function fromOwnershipClaim(claim: PendingBusinessClaim): InboxItem {
  const applicant =
    claim.applicantDisplayName?.trim() ||
    claim.applicantEmail?.trim() ||
    "заявитель";
  return {
    id: compositeId("ownership_claim", claim.id),
    sourceId: claim.id,
    entityType: "business",
    title: `Владение: ${claim.businessName || "бизнес"}`,
    source: "claims",
    sourceName: applicant,
    sourceRef: null,
    status: "pending",
    aiConfidence: null,
    completenessPercent: null,
    checklistReady: null,
    checklistTotal: null,
    createdAt: claim.createdAt,
    eventStartsAt: null,
    priority: 80,
    targetUrl: reviewWorkspacePath("ownership_claim", claim.id),
    reviewType: "ownership_claim",
  };
}

export function fromEventRecommendation(
  item: CommentRecommendation,
): InboxItem {
  const title =
    item.display_name?.trim() ||
    item.comment_texts?.[0]?.trim()?.slice(0, 80) ||
    "Событие";
  const rawSource = item.source_channel || item.source_groups?.[0] || "facebook";
  return {
    id: compositeId("event_verification", item.id),
    sourceId: item.id,
    entityType: "event",
    title,
    source: normalizeInboxSource(rawSource),
    sourceName:
      item.source_groups?.[0]?.trim() ||
      item.source_channel ||
      "Events",
    sourceRef: item.directory_source?.trim() || null,
    status: item.status,
    reviewNotes: item.notes ?? null,
    aiConfidence: null,
    completenessPercent: scoreRecommendationReadiness(item),
    checklistReady: null,
    checklistTotal: null,
    createdAt: item.created_at,
    eventStartsAt: resolveEventInstant(item),
    priority: Number(item.mention_count ?? 0) * 10,
    targetUrl: reviewWorkspacePath("event_verification", item.id),
    reviewType: "event_verification",
  };
}

export function fromCommentRecommendation(
  item: CommentRecommendation,
): InboxItem {
  const title =
    item.display_name?.trim() ||
    item.comment_texts?.[0]?.trim()?.slice(0, 80) ||
    "Рекомендация";
  const isDirectory = item.target_bucket === "yellow_pages";
  const rawSource =
    item.source_channel ||
    item.directory_source ||
    item.source_groups?.[0] ||
    "recommendations";
  const source: InboxSourceKey = isDirectory
    ? "directories"
    : normalizeInboxSource(rawSource);
  return {
    id: compositeId("recommendation", item.id),
    sourceId: item.id,
    entityType: mapRecommendationEntity(item),
    title,
    source,
    sourceName:
      item.directory_source?.trim() ||
      item.source_groups?.[0]?.trim() ||
      item.source_channel ||
      "Recommendations",
    sourceRef: item.directory_source?.trim() || null,
    status: item.status,
    reviewNotes: item.notes ?? null,
    aiConfidence: null,
    completenessPercent: scoreRecommendationReadiness(item),
    checklistReady: null,
    checklistTotal: null,
    createdAt: item.created_at,
    eventStartsAt:
      item.kind === "event" ? resolveEventInstant(item) : null,
    priority: Number(item.mention_count ?? 0) * 10,
    targetUrl: reviewWorkspacePath("recommendation", item.id),
    reviewType: "recommendation",
  };
}
