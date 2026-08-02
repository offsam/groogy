"use server";

import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import type { EnrichHistoryRow, EnrichRunResult } from "@/lib/import-review/enrich-progress";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";

const KINDS = new Set<PublishedEnrichKind>([
  "business",
  "professional",
  "event",
  "service",
  "job",
  "transfer",
]);

export async function listPublishedEnrichHistoryAction(
  kind: PublishedEnrichKind,
  entityId: string,
): Promise<
  { ok: true; rows: EnrichHistoryRow[] } | { ok: false; message: string }
> {
  if (!KINDS.has(kind)) return { ok: false, message: "Некорректный kind" };
  if (!entityId.trim()) return { ok: false, message: "Нужен entityId" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Нужна авторизация" };
  if (!(await userIsAdmin(supabase)))
    return { ok: false, message: "Только для админов" };

  const { data, error } = await supabase
    .from("entity_enrich_runs")
    .select("id, created_at, note, payload")
    .eq("entity_kind", kind)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((row) => {
      const payload = (row.payload ?? {}) as EnrichRunResult &
        Record<string, unknown>;
      return {
        id: row.id as string,
        created_at: row.created_at as string,
        note: (row.note as string | null) ?? null,
        previous_status: null,
        new_status: null,
        changed_fields: payload,
      };
    }),
  };
}
