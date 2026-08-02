"use server";

/**
 * Lane lifecycle actions: quarantine / reclaim / destroy / mark seeking /
 * apply route suggestion. Shared by Inbox bulk and Workspace.
 */

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  appendReviewTag,
  removeReviewTag,
  TAG_QUARANTINE,
  TAG_SEEKING,
} from "@/lib/import-review/review-tags";
import { setImportReviewStatusAction } from "@/lib/import-review/actions";
import {
  confirmRecommendationMergeAction,
  scanPendingRecommendationsForDuplicatesAction,
} from "@/lib/import-review/recommendation-actions";
import { classifyLane } from "@/lib/admin/lanes/classify";
import { laneInputFromImportReview } from "@/lib/admin/lanes/from-item";
import type { ImportReviewEntityType, ImportReviewTargetCollection } from "@/types/import-review";

export type LaneActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function fail(message: string): LaneActionResult {
  return { ok: false, message };
}
function ok(message: string): LaneActionResult {
  return { ok: true, message };
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: fail("Нужно войти.") };
  if (!(await userIsAdmin(supabase))) {
    return { supabase, error: fail("Только для админов.") };
  }
  return { supabase, error: null as null };
}

function revalidateLanePaths(id?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/review/inbox");
  revalidatePath("/admin/queue");
  revalidatePath("/admin/import-review");
  if (id) {
    revalidatePath(`/admin/import-review/${id}`);
    revalidatePath(
      `/admin/review/${encodeURIComponent(`import_review:${id}`)}`,
    );
  }
}

/** Move import_review item into soft quarantine (помойка). */
export async function quarantineImportReviewAction(input: {
  id: string;
  reason?: string;
}): Promise<LaneActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data: row, error: loadErr } = await supabase
    .from("import_review_items")
    .select("id, review_notes, review_status")
    .eq("id", input.id)
    .maybeSingle();
  if (loadErr) return fail(loadErr.message);
  if (!row) return fail("Не найдено.");

  const notes = appendReviewTag(row.review_notes, TAG_QUARANTINE);
  const reasonLine = input.reason?.trim()
    ? `quarantine: ${input.reason.trim().slice(0, 200)}`
    : "quarantine";
  const withReason = notes.includes(reasonLine)
    ? notes
    : `${notes}\n${reasonLine}`.trim();

  const { error: updErr } = await supabase
    .from("import_review_items")
    .update({
      review_status: "quarantine",
      review_notes: withReason,
      reject_reason: input.reason?.trim()?.slice(0, 120) || "quarantine",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (updErr) return fail(updErr.message);

  revalidateLanePaths(input.id);
  return ok("В помойке (карантин). Можно вернуть или уничтожить.");
}

/** Restore from quarantine → pending + strip tags. */
export async function reclaimImportReviewAction(input: {
  id: string;
}): Promise<LaneActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data: row, error: loadErr } = await supabase
    .from("import_review_items")
    .select("id, review_notes")
    .eq("id", input.id)
    .maybeSingle();
  if (loadErr) return fail(loadErr.message);
  if (!row) return fail("Не найдено.");

  let notes = removeReviewTag(row.review_notes, TAG_QUARANTINE);
  notes = notes
    .split("\n")
    .filter((line) => !line.trim().toLowerCase().startsWith("quarantine:"))
    .join("\n")
    .trim();

  const { error: updErr } = await supabase
    .from("import_review_items")
    .update({
      review_status: "pending",
      review_notes: notes || null,
      reject_reason: null,
    })
    .eq("id", input.id);
  if (updErr) return fail(updErr.message);

  revalidateLanePaths(input.id);
  return ok("Вернули из помойки в очередь.");
}

/** Permanent delete after quarantine review. */
export async function destroyImportReviewAction(input: {
  id: string;
}): Promise<LaneActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data: row } = await supabase
    .from("import_review_items")
    .select("id, review_status, review_notes")
    .eq("id", input.id)
    .maybeSingle();
  if (!row) return fail("Не найдено.");
  if (
    row.review_status !== "quarantine" &&
    !(row.review_notes || "").includes(TAG_QUARANTINE)
  ) {
    return fail("Сначала в помойку — уничтожение только из карантина.");
  }

  const { error: delErr } = await supabase
    .from("import_review_items")
    .delete()
    .eq("id", input.id);
  if (delErr) return fail(delErr.message);

  revalidateLanePaths();
  return ok("Запись уничтожена.");
}

export async function markImportReviewSeekingAction(input: {
  id: string;
}): Promise<LaneActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data: row, error: loadErr } = await supabase
    .from("import_review_items")
    .select("id, review_notes")
    .eq("id", input.id)
    .maybeSingle();
  if (loadErr) return fail(loadErr.message);
  if (!row) return fail("Не найдено.");

  const notes = appendReviewTag(row.review_notes, TAG_SEEKING);
  const { error: updErr } = await supabase
    .from("import_review_items")
    .update({ review_notes: notes })
    .eq("id", input.id);
  if (updErr) return fail(updErr.message);

  revalidateLanePaths(input.id);
  return ok("Помечено как «Я ищу» (категорию не создаём).");
}

/** Apply classifyLane route suggestion onto the queue row. */
export async function applyImportReviewRouteAction(input: {
  id: string;
}): Promise<LaneActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data: row, error: loadErr } = await supabase
    .from("import_review_items")
    .select(
      "id, review_status, review_notes, entity_type, target_collection, title, business_name, person_name, description, source_text, phone, email, website, instagram, telegram_username, city, address_line, category",
    )
    .eq("id", input.id)
    .maybeSingle();
  if (loadErr) return fail(loadErr.message);
  if (!row) return fail("Не найдено.");

  const classified = classifyLane(laneInputFromImportReview(row));
  if (!classified.suggestedEntityType || !classified.suggestedCollection) {
    return fail("Не удалось определить раздел — оставь в Разборе.");
  }

  const { error: updErr } = await supabase
    .from("import_review_items")
    .update({
      entity_type: classified.suggestedEntityType as ImportReviewEntityType,
      target_collection:
        classified.suggestedCollection as ImportReviewTargetCollection,
    })
    .eq("id", input.id);
  if (updErr) return fail(updErr.message);

  revalidateLanePaths(input.id);
  return ok(
    `Раздел: ${classified.suggestedCollection} (${classified.reason}).`,
  );
}

export async function promoteImportReviewReadyAction(input: {
  id: string;
}): Promise<LaneActionResult> {
  const res = await setImportReviewStatusAction({
    id: input.id,
    status: "ready_to_publish",
    notes: "lane:ready",
  });
  return res.ok ? ok(res.message || "Готово к публикации.") : fail(res.message);
}

export async function quarantineRecommendationAction(input: {
  id: string;
  reason?: string;
}): Promise<LaneActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from("import_comment_recommendations")
    .update({
      status: "quarantine",
      notes: appendReviewTag(
        input.reason ? `quarantine: ${input.reason}` : null,
        TAG_QUARANTINE,
      ),
    })
    .eq("id", input.id);
  if (updErr) return fail(updErr.message);
  revalidateLanePaths();
  return ok("Рекомендация в помойке.");
}

export async function reclaimRecommendationAction(input: {
  id: string;
}): Promise<LaneActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from("import_comment_recommendations")
    .select("id, notes")
    .eq("id", input.id)
    .maybeSingle();
  if (!row) return fail("Не найдено.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from("import_comment_recommendations")
    .update({
      status: "pending",
      notes: removeReviewTag(row.notes, TAG_QUARANTINE) || null,
    })
    .eq("id", input.id);
  if (updErr) return fail(updErr.message);
  revalidateLanePaths();
  return ok("Рекомендация возвращена.");
}

export async function destroyRecommendationAction(input: {
  id: string;
}): Promise<LaneActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from("import_comment_recommendations")
    .select("id, status, notes")
    .eq("id", input.id)
    .maybeSingle();
  if (!row) return fail("Не найдено.");
  if (
    row.status !== "quarantine" &&
    !(row.notes || "").includes(TAG_QUARANTINE)
  ) {
    return fail("Сначала в помойку.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: delErr } = await (supabase as any)
    .from("import_comment_recommendations")
    .delete()
    .eq("id", input.id);
  if (delErr) return fail(delErr.message);
  revalidateLanePaths();
  return ok("Рекомендация уничтожена.");
}

/** Bulk scan: exact attach recommendations (existing mechanism). */
export async function runAttachLaneScanAction(): Promise<
  LaneActionResult & { attached?: number; suspected?: number; scanned?: number }
> {
  const res = await scanPendingRecommendationsForDuplicatesAction();
  if (!res.ok) return fail(res.message);
  return {
    ok: true,
    message: res.message || "Скан завершён.",
    attached: res.attached,
    suspected: res.suspected,
    scanned: res.scanned,
  };
}

export type LaneBulkAction =
  | "quarantine"
  | "reclaim"
  | "destroy"
  | "mark_seeking"
  | "apply_route"
  | "promote_ready"
  | "approve_ready"
  | "attach_confirm";

export async function runLaneBulkAction(input: {
  action: LaneBulkAction;
  targets: Array<{
    sourceId: string;
    reviewType: "import_review" | "recommendation" | "event_verification";
    /** For attach_confirm */
    entityType?: "business" | "professional";
    entityId?: string;
  }>;
}): Promise<{
  ok: boolean;
  processed: number;
  failed: number;
  messages: string[];
}> {
  const messages: string[] = [];
  let processed = 0;
  let failed = 0;

  for (const t of input.targets) {
    try {
      let res: LaneActionResult;
      if (t.reviewType === "import_review") {
        if (input.action === "quarantine") {
          res = await quarantineImportReviewAction({ id: t.sourceId });
        } else if (input.action === "reclaim") {
          res = await reclaimImportReviewAction({ id: t.sourceId });
        } else if (input.action === "destroy") {
          res = await destroyImportReviewAction({ id: t.sourceId });
        } else if (input.action === "mark_seeking") {
          res = await markImportReviewSeekingAction({ id: t.sourceId });
        } else if (input.action === "apply_route") {
          res = await applyImportReviewRouteAction({ id: t.sourceId });
        } else if (input.action === "promote_ready") {
          res = await promoteImportReviewReadyAction({ id: t.sourceId });
        } else if (input.action === "approve_ready") {
          const { approveImportReviewItemAction } = await import(
            "@/lib/import-review/actions"
          );
          const a = await approveImportReviewItemAction({ id: t.sourceId });
          res = a.ok ? ok(a.message || "OK") : fail(a.message);
        } else {
          res = fail("Действие недоступно для import_review");
        }
      } else {
        if (input.action === "quarantine") {
          res = await quarantineRecommendationAction({ id: t.sourceId });
        } else if (input.action === "reclaim") {
          res = await reclaimRecommendationAction({ id: t.sourceId });
        } else if (input.action === "destroy") {
          res = await destroyRecommendationAction({ id: t.sourceId });
        } else if (input.action === "attach_confirm" && t.entityId && t.entityType) {
          const a = await confirmRecommendationMergeAction({
            id: t.sourceId,
            entityType: t.entityType,
            entityId: t.entityId,
          });
          res = a.ok ? ok(a.message || "Прикреплено") : fail(a.message);
        } else if (input.action === "approve_ready") {
          // Recommendations: prefer reject-as-attach path via scan; approve creates card — skip.
          res = fail("Для рекомендаций используй Прикрепить, не Approve как новую карточку");
        } else {
          res = fail("Действие недоступно для recommendation");
        }
      }

      if (res.ok) processed += 1;
      else {
        failed += 1;
        messages.push(`${t.sourceId}: ${res.message}`);
      }
    } catch (err) {
      failed += 1;
      messages.push(
        `${t.sourceId}: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  return {
    ok: failed === 0,
    processed,
    failed,
    messages: messages.slice(0, 12),
  };
}

export async function llmClassifyReviewLaneAction(input: {
  id: string;
}): Promise<LaneActionResult & { suggestion?: unknown }> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data: row } = await supabase
    .from("import_review_items")
    .select(
      "id, title, description, source_text, business_name, person_name, review_status, entity_type, target_collection",
    )
    .eq("id", input.id)
    .maybeSingle();
  if (!row) return fail("Не найдено.");

  const { llmSuggestLane } = await import("@/lib/admin/lanes/llm-classify");
  const suggestion = await llmSuggestLane({
    title: row.title || row.business_name || row.person_name,
    text: [row.description, row.source_text].filter(Boolean).join("\n"),
  });
  if (!suggestion) {
    return fail("LLM недоступен или не ответил — оставь в Разборе.");
  }

  if (suggestion.action === "seeking") {
    return markImportReviewSeekingAction({ id: input.id });
  }
  if (suggestion.action === "quarantine" && suggestion.confidence >= 0.75) {
    return quarantineImportReviewAction({
      id: input.id,
      reason: suggestion.reason,
    });
  }
  if (suggestion.action === "enrich") {
    return {
      ok: true,
      message: `LLM: enrich — ${suggestion.reason} (обогащение отдельно)`,
      suggestion,
    };
  }
  if (
    suggestion.action === "route_entity" &&
    suggestion.entityType &&
    suggestion.targetCollection
  ) {
    const { error: updErr } = await supabase
      .from("import_review_items")
      .update({
        entity_type: suggestion.entityType as ImportReviewEntityType,
        target_collection:
          suggestion.targetCollection as ImportReviewTargetCollection,
      })
      .eq("id", input.id);
    if (updErr) return fail(updErr.message);
    revalidateLanePaths(input.id);
    return {
      ok: true,
      message: `LLM: ${suggestion.targetCollection} (${suggestion.reason})`,
      suggestion,
    };
  }
  if (suggestion.action === "ready" && suggestion.confidence >= 0.8) {
    return promoteImportReviewReadyAction({ id: input.id });
  }

  return {
    ok: true,
    message: `LLM: ${suggestion.action} — ${suggestion.reason}`,
    suggestion,
  };
}
