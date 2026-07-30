/**
 * Pre-publish enrich (P5A–P5C) — status aliases + tag parse + field-source heuristics.
 * Execution lives in scripts/import-review/run_pre_publish_enrich.py (CLI, auto OFF).
 * See docs/architecture/P5_PRE_PUBLISH_ENRICH_INTEGRATION_V1.md
 */

import type { CompletenessReport } from "@/lib/import-review/preview-completeness";
import {
  businessPreviewCompleteness,
  listingPreviewCompleteness,
  professionalPreviewCompleteness,
} from "@/lib/import-review/preview-completeness";
import {
  TAG_ENRICH_P5A_DONE,
  TAG_ENRICH_P5A_FAILED,
  TAG_ENRICH_P5A_PARTIAL,
  TAG_ENRICH_P5B_DONE,
  TAG_ENRICH_P5B_FAILED,
  TAG_ENRICH_P5B_SKIPPED,
  TAG_ENRICH_P5C_DONE,
  TAG_READY_FOR_MODERATOR,
} from "@/lib/import-review/review-tags";
import {
  importReviewItemToPreviewFields,
  importReviewToBusinessPreview,
  importReviewToProfessionalPreview,
} from "@/lib/import-review/to-business-preview";
import { resolveImportPreviewKind } from "@/lib/import-review/preview-section";
import type { ImportReviewItem, ImportReviewStatus } from "@/types/import-review";

/** UX phases from the integration brief — aliases over the live 7-state enum. */
export type ReviewWorkflowPhase =
  | "queued"
  | "enriching"
  | "ai_processing"
  | "needs_review"
  | "ready"
  | "approved"
  | "rejected"
  | "publishing"
  | "published"
  | "duplicate";

export const REVIEW_WORKFLOW_PHASE_LABELS: Record<ReviewWorkflowPhase, string> =
  {
    queued: "Queued",
    enriching: "Enriching",
    ai_processing: "AI Processing",
    needs_review: "Needs Review",
    ready: "Ready",
    approved: "Approved",
    rejected: "Rejected",
    publishing: "Publishing",
    published: "Published",
    duplicate: "Duplicate",
  };

export type EnrichStageState = "pending" | "done" | "partial" | "failed" | "skipped";

export type PrePublishEnrichSnapshot = {
  phase: ReviewWorkflowPhase;
  phaseLabel: string;
  liveStatus: ImportReviewStatus;
  readyForModerator: boolean;
  p5a: EnrichStageState;
  p5b: EnrichStageState;
  p5c: EnrichStageState;
  completeness: CompletenessReport;
  fieldSources: Array<{ field: string; label: string; source: string; value: string }>;
  aiConfidence: number | null;
  autoLaunchEnabled: boolean;
};

function notesHas(notes: string | null | undefined, tag: string): boolean {
  return Boolean(notes && notes.includes(tag));
}

function stageFromTags(
  notes: string | null | undefined,
  done: string,
  partial: string | null,
  failed: string,
  skipped?: string,
): EnrichStageState {
  if (notesHas(notes, failed)) return "failed";
  if (skipped && notesHas(notes, skipped)) return "skipped";
  if (partial && notesHas(notes, partial)) return "partial";
  if (notesHas(notes, done)) return "done";
  return "pending";
}

export function resolveReviewWorkflowPhase(
  item: Pick<
    ImportReviewItem,
    "review_status" | "review_notes" | "published_entity_id"
  >,
): ReviewWorkflowPhase {
  const { review_status: status, review_notes: notes, published_entity_id } =
    item;
  if (status === "approved" && published_entity_id) return "published";
  if (status === "approved") return "publishing";
  if (status === "rejected") return "rejected";
  if (status === "duplicate") return "duplicate";
  if (status === "ready_to_publish" || notesHas(notes, TAG_READY_FOR_MODERATOR)) {
    return "ready";
  }
  if (status === "needs_more_info" || status === "in_review") {
    return "needs_review";
  }
  // pending — enrich tags may already be present after CLI
  const p5a = stageFromTags(
    notes,
    TAG_ENRICH_P5A_DONE,
    TAG_ENRICH_P5A_PARTIAL,
    TAG_ENRICH_P5A_FAILED,
  );
  if (p5a === "pending" && !notesHas(notes, TAG_ENRICH_P5C_DONE)) {
    return "queued";
  }
  return "needs_review";
}

function firstList(v: string[] | null | undefined): string {
  return (v?.[0] || "").trim();
}

function textIncludes(hay: string, needle: string): boolean {
  if (!needle) return false;
  return hay.toLowerCase().includes(needle.toLowerCase());
}

/** Heuristic sources until per-field provenance exists. */
export function inferQueueFieldSources(item: ImportReviewItem): Array<{
  field: string;
  label: string;
  source: string;
  value: string;
}> {
  const src = `${item.source_text || ""}\n${item.description || ""}`;
  const rows: Array<{
    field: string;
    label: string;
    source: string;
    value: string;
  }> = [];

  const push = (
    field: string,
    label: string,
    value: string,
    source: string,
  ) => {
    if (!value) return;
    rows.push({ field, label, source, value });
  };

  const phone = firstList(item.phone);
  if (phone) {
    push(
      "phone",
      "Phone",
      phone,
      textIncludes(src, phone.replace(/\D/g, "").slice(-10)) ||
        textIncludes(src, phone)
        ? "source_text"
        : "enrichment",
    );
  }
  const email = firstList(item.email);
  if (email) {
    push(
      "email",
      "Email",
      email,
      textIncludes(src, email) ? "source_text" : "enrichment",
    );
  }
  const website = firstList(item.website);
  if (website) {
    push(
      "website",
      "Website",
      website,
      textIncludes(src, website.replace(/^https?:\/\//i, ""))
        ? "source_text"
        : "enrichment",
    );
  }
  const ig = firstList(item.instagram);
  if (ig) {
    push(
      "instagram",
      "Instagram",
      ig,
      textIncludes(src, ig) || textIncludes(src, `@${ig}`)
        ? "source_text"
        : "enrichment",
    );
  }
  if (item.telegram_username) {
    push(
      "telegram",
      "Telegram",
      item.telegram_username,
      textIncludes(src, item.telegram_username) ? "source_text" : "enrichment",
    );
  }
  if (item.city) {
    push(
      "city",
      "City",
      item.city,
      textIncludes(src, item.city) ? "source_text" : "enrichment",
    );
  }
  if (item.preview_image_url) {
    push("image", "Photo", item.preview_image_url.slice(0, 48), "enrichment");
  }
  if (item.ai_decision) {
    push("ai_decision", "AI decision", item.ai_decision, "AI");
  }
  if (item.category) {
    push("category", "Category", item.category, "classify / manual");
  }
  return rows;
}

export function importReviewCompleteness(
  item: ImportReviewItem,
): CompletenessReport {
  const fields = importReviewItemToPreviewFields(item);
  const kind = resolveImportPreviewKind(item);
  if (kind === "professional") {
    return professionalPreviewCompleteness(
      importReviewToProfessionalPreview(fields),
    );
  }
  if (kind === "business") {
    return businessPreviewCompleteness(importReviewToBusinessPreview(fields));
  }
  return listingPreviewCompleteness({
    title: fields.title || fields.business_name || fields.person_name,
    description: fields.description,
    city: fields.city,
    phone: fields.phone?.[0] ?? null,
    imageUrl: fields.preview_image_url,
    priceAmount: fields.price ?? null,
  });
}

/** Auto launch stays OFF in app — CLI only. */
export function isPrePublishEnrichAutoEnabled(): boolean {
  return false;
}

export function getPrePublishEnrichSnapshot(
  item: ImportReviewItem,
): PrePublishEnrichSnapshot {
  const notes = item.review_notes;
  const phase = resolveReviewWorkflowPhase(item);
  return {
    phase,
    phaseLabel: REVIEW_WORKFLOW_PHASE_LABELS[phase],
    liveStatus: item.review_status,
    readyForModerator: notesHas(notes, TAG_READY_FOR_MODERATOR),
    p5a: stageFromTags(
      notes,
      TAG_ENRICH_P5A_DONE,
      TAG_ENRICH_P5A_PARTIAL,
      TAG_ENRICH_P5A_FAILED,
    ),
    p5b: stageFromTags(
      notes,
      TAG_ENRICH_P5B_DONE,
      null,
      TAG_ENRICH_P5B_FAILED,
      TAG_ENRICH_P5B_SKIPPED,
    ),
    p5c: notesHas(notes, TAG_ENRICH_P5C_DONE) ? "done" : "pending",
    completeness: importReviewCompleteness(item),
    fieldSources: inferQueueFieldSources(item),
    aiConfidence: item.ai_confidence,
    autoLaunchEnabled: isPrePublishEnrichAutoEnabled(),
  };
}

export const ENRICH_STAGE_LABELS: Record<EnrichStageState, string> = {
  pending: "не запускался",
  done: "выполнен",
  partial: "частично",
  failed: "ошибка",
  skipped: "пропущен",
};
