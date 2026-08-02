import "server-only";

import { createServerClient } from "@/lib/supabase/server";
import type { EnrichRunResult } from "@/lib/import-review/enrich-progress";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";

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
