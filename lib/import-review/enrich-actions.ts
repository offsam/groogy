"use server";

import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  ENRICH_AUDIT_ACTION,
  type EnrichHistoryRow,
} from "@/lib/import-review/enrich-progress";

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
