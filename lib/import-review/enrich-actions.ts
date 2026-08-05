"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  ENRICH_AUDIT_ACTION,
  type EnrichHistoryRow,
  type EnrichRunResult,
} from "@/lib/import-review/enrich-progress";

const LOCKED_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "review_status",
  "published_entity_id",
  "published_entity_type",
  "approved_at",
  "approved_by",
]);

const ARRAY_FIELDS = new Set([
  "phone",
  "email",
  "website",
  "instagram",
  "whatsapp",
  "services",
  "payment_methods",
  "source_message_ids",
  "source_media",
]);

function untyped(client: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as unknown as SupabaseClient<any>;
}

function jsonEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function emptyForField(key: string, written: unknown): unknown {
  if (ARRAY_FIELDS.has(key) || Array.isArray(written)) return [];
  if (typeof written === "number") return null;
  if (typeof written === "boolean") return false;
  return null;
}

export async function listPrePublishEnrichHistoryAction(
  itemId: string,
): Promise<{ ok: true; rows: EnrichHistoryRow[] } | { ok: false; message: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Нужна авторизация" };
  if (!(await userIsAdmin(supabase))) return { ok: false, message: "Только для админов" };

  const { data, error } = await supabase
    .from("import_review_audit")
    .select("id, created_at, note, previous_status, new_status, changed_fields")
    .eq("item_id", itemId)
    .eq("action", ENRICH_AUDIT_ACTION)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      note: row.note,
      previous_status: row.previous_status,
      new_status: row.new_status,
      changed_fields: (row.changed_fields ?? {}) as EnrichHistoryRow["changed_fields"],
    })),
  };
}

/**
 * Revert selected fields written by a pre-publish enrich audit row.
 */
export async function revertPrePublishEnrichFieldsAction(
  itemId: string,
  auditId: string,
  fields: string[],
): Promise<
  | { ok: true; revertedKeys: string[]; message: string }
  | { ok: false; message: string }
> {
  if (!itemId.trim() || !auditId.trim()) {
    return { ok: false, message: "Нужны itemId и auditId" };
  }
  const wanted = [
    ...new Set(fields.map((f) => f.trim()).filter(Boolean)),
  ].filter((k) => !LOCKED_KEYS.has(k) && !k.startsWith("_"));
  if (!wanted.length) return { ok: false, message: "Нечего удалять" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Нужна авторизация" };
  if (!(await userIsAdmin(supabase)))
    return { ok: false, message: "Только для админов" };

  const { data: audit, error: auditError } = await supabase
    .from("import_review_audit")
    .select("id, item_id, note, changed_fields, action")
    .eq("id", auditId)
    .eq("item_id", itemId)
    .eq("action", ENRICH_AUDIT_ACTION)
    .maybeSingle();
  if (auditError) return { ok: false, message: auditError.message };
  if (!audit) return { ok: false, message: "Запись истории не найдена" };

  const payload = (audit.changed_fields ?? {}) as EnrichRunResult;
  if (payload.reverted_at) {
    return { ok: false, message: "Это обогащение уже полностью отменено" };
  }
  const patch = (payload.patch ?? {}) as Record<string, unknown>;
  const before = (payload.before ?? {}) as Record<string, unknown>;
  const already = new Set(payload.reverted_fields ?? []);
  const targets = wanted.filter((k) => k in patch && !already.has(k));
  if (!targets.length) {
    return { ok: false, message: "Этих полей нет в этом запуске" };
  }

  const { data: current, error: loadError } = await supabase
    .from("import_review_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  if (loadError) return { ok: false, message: loadError.message };
  if (!current) return { ok: false, message: "Карточка не найдена" };
  if ((current as { review_status?: string }).review_status === "approved") {
    return { ok: false, message: "Опубликованную очередь нельзя откатывать здесь" };
  }

  const row = current as Record<string, unknown>;
  const revert: Record<string, unknown> = {};
  const revertedKeys: string[] = [];
  for (const key of targets) {
    if (!(key in row)) continue;
    const written = patch[key];
    if (!jsonEq(row[key], written)) continue;
    revert[key] = Object.prototype.hasOwnProperty.call(before, key)
      ? before[key]
      : emptyForField(key, written);
    revertedKeys.push(key);
  }

  if (Object.keys(revert).length) {
    const { error: updateError } = await untyped(supabase)
      .from("import_review_items")
      .update({
        ...revert,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    if (updateError) return { ok: false, message: updateError.message };
  }

  const nextReverted = [...new Set([...already, ...revertedKeys])];
  const remaining = Object.keys(patch).filter((k) => !nextReverted.includes(k));
  const fullyDone = remaining.length === 0;
  const nextPayload: EnrichRunResult = {
    ...payload,
    reverted_fields: nextReverted,
    reverted_at: fullyDone ? new Date().toISOString() : payload.reverted_at ?? null,
  };
  const baseNote = (audit.note as string | null)?.trim() || "Обогащение";
  const nextNote =
    fullyDone && !/отменено/i.test(baseNote)
      ? `${baseNote} · отменено`
      : baseNote;

  // Audit updates are service-role only (no admin UPDATE policy).
  const service = untyped(createServiceRoleClient());
  const { error: markError } = await service
    .from("import_review_audit")
    .update({
      changed_fields: nextPayload as unknown as Record<string, unknown>,
      note: nextNote,
    })
    .eq("id", auditId);
  if (markError) return { ok: false, message: markError.message };

  revalidatePath("/admin/import-review");
  revalidatePath(`/admin/import-review/${itemId}`);
  revalidatePath("/admin/review/inbox");
  revalidatePath(`/admin/review/${encodeURIComponent(`import_review:${itemId}`)}`);
  revalidatePath("/admin/queue");

  return {
    ok: true,
    revertedKeys,
    message: revertedKeys.length
      ? `Удалено из карточки: ${revertedKeys.join(", ")}`
      : "Поля уже изменены вручную — с карточки ничего не снято",
  };
}
