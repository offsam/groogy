import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { EnrichRunResult } from "@/lib/import-review/enrich-progress";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";

const LOCKED_KEYS = new Set([
  "id",
  "slug",
  "created_at",
  "updated_at",
  "owner_user_id",
  "publisher_id",
  "status",
]);

function untyped(client: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as unknown as SupabaseClient<any>;
}

/** Attach pre-enrich field snapshot onto the finished result for undo. */
export function attachEnrichBeforeSnapshot(
  result: EnrichRunResult,
  snapshot: Record<string, unknown> | null | undefined,
): EnrichRunResult {
  if (!snapshot) return result;
  const patch = result.patch ?? {};
  const before: Record<string, unknown> = { ...(result.before ?? {}) };
  for (const key of Object.keys(patch)) {
    if (LOCKED_KEYS.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(before, key)) continue;
    before[key] = key in snapshot ? snapshot[key] : null;
  }
  if (!Object.keys(before).length) return result;
  return { ...result, before };
}

/**
 * Put the entity row back to the pre-enrich snapshot (abort / stop).
 * Skips identity / ownership columns.
 */
export async function restoreEntityEnrichSnapshot(input: {
  table: string;
  entityId: string;
  snapshot: Record<string, unknown> | null | undefined;
}): Promise<void> {
  if (!input.snapshot || !input.entityId || !input.table) return;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.snapshot)) {
    if (LOCKED_KEYS.has(key)) continue;
    // Skip nested objects that are not columns (PostgREST join leftovers).
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      continue;
    }
    patch[key] = value;
  }
  if (!Object.keys(patch).length) return;
  const catalog = untyped(createServiceRoleClient());
  const { error } = await catalog
    .from(input.table)
    .update(patch)
    .eq("id", input.entityId);
  if (error) {
    console.error("enrich snapshot restore failed", error.message);
    throw new Error(error.message);
  }
}

/** Persist one published-entity enrich run for admin history. */
export async function writePublishedEnrichHistory(input: {
  kind: PublishedEnrichKind;
  entityId: string;
  adminId: string;
  result: EnrichRunResult;
}): Promise<void> {
  const supabase = await createServerClient();
  const patchKeys = Object.keys(input.result.patch ?? {});
  const ok = input.result.resources_ok ?? 0;
  const failed = input.result.resources_failed ?? 0;
  const note = input.result.skipped
    ? `Пропуск: ${input.result.reason ?? "n/a"}`
    : patchKeys.length
      ? `Заполнено: ${patchKeys.join(", ")} · ресурсы ${ok} ок / ${failed} нет`
      : input.result.reason ||
        `Без новых полей · ресурсы ${ok} ок / ${failed} нет`;

  const { error } = await supabase.from("entity_enrich_runs").insert({
    entity_kind: input.kind,
    entity_id: input.entityId,
    admin_id: input.adminId,
    note,
    payload: input.result as unknown as import("@/types/database").Json,
  });
  if (error) {
    console.error("entity_enrich_runs insert failed", error.message);
  }
}
