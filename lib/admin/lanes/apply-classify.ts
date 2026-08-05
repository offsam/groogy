import "server-only";

/**
 * Apply classifyLane to a single queue row after ingest (or backlog job).
 * Deterministic only — no LLM.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyLane } from "@/lib/admin/lanes/classify";
import { laneInputFromImportReview } from "@/lib/admin/lanes/from-item";
import {
  appendReviewTag,
  TAG_QUARANTINE,
  TAG_SEEKING,
} from "@/lib/import-review/review-tags";
import type {
  ImportReviewEntityType,
  ImportReviewTargetCollection,
} from "@/types/import-review";
import type { AdminLaneId } from "@/lib/admin/lanes/types";

export type ApplyLaneResult = {
  lane: AdminLaneId;
  reason: string;
  patched: boolean;
};

/**
 * Write lane side-effects onto import_review_items:
 * - seeking → tag
 * - quarantine → status + tag (only when classify says obvious junk)
 * - route → fill empty entity_type / target_collection
 * Does not auto-publish or auto-approve.
 */
export async function applyLaneClassifyToImportReview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>,
  itemId: string,
  opts: { applyQuarantine?: boolean } = {},
): Promise<ApplyLaneResult> {
  const { data: row, error } = await client
    .from("import_review_items")
    .select(
      "id, review_status, review_notes, entity_type, target_collection, title, business_name, person_name, description, source_text, phone, email, website, instagram, telegram_username, city, address_line, category",
    )
    .eq("id", itemId)
    .maybeSingle();
  if (error || !row) {
    return { lane: "review", reason: error?.message || "not_found", patched: false };
  }

  // Skip settled
  if (
    ["approved", "rejected", "duplicate", "quarantine"].includes(
      row.review_status,
    )
  ) {
    return {
      lane: row.review_status === "quarantine" ? "quarantine" : "review",
      reason: `skip_${row.review_status}`,
      patched: false,
    };
  }

  const classified = classifyLane(laneInputFromImportReview(row));
  const patch: Record<string, unknown> = {};
  let notes = row.review_notes as string | null;

  if (
    classified.lane === "seeking" &&
    !(notes || "").includes(TAG_SEEKING)
  ) {
    notes = appendReviewTag(notes, TAG_SEEKING);
    patch.review_notes = notes;
  }

  if (
    classified.lane === "quarantine" &&
    opts.applyQuarantine !== false &&
    classified.reason === "obvious_junk"
  ) {
    notes = appendReviewTag(notes, TAG_QUARANTINE);
    patch.review_notes = notes;
    patch.review_status = "quarantine";
    patch.reject_reason = "quarantine";
  }

  if (
    classified.lane === "route" &&
    classified.suggestedEntityType &&
    classified.suggestedCollection
  ) {
    if (!row.entity_type) {
      patch.entity_type =
        classified.suggestedEntityType as ImportReviewEntityType;
    }
    if (!row.target_collection) {
      patch.target_collection =
        classified.suggestedCollection as ImportReviewTargetCollection;
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      lane: classified.lane,
      reason: classified.reason,
      patched: false,
    };
  }

  const { error: updErr } = await client
    .from("import_review_items")
    .update(patch)
    .eq("id", itemId);
  if (updErr) {
    return {
      lane: classified.lane,
      reason: updErr.message,
      patched: false,
    };
  }
  return {
    lane: classified.lane,
    reason: classified.reason,
    patched: true,
  };
}
