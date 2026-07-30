import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";
import { createServerClient } from "@/lib/supabase/server";
import type { EnrichRunResult } from "@/lib/import-review/enrich-progress";
import { ENRICH_AUDIT_ACTION } from "@/lib/import-review/enrich-progress";
import type { ImportReviewStatus } from "@/types/import-review";

export async function writePrePublishEnrichAudit(input: {
  itemId: string;
  result: EnrichRunResult;
  previousStatus: ImportReviewStatus | null;
  newStatus: ImportReviewStatus | null;
}): Promise<void> {
  const supabase = await createServerClient();
  const patchKeys = Object.keys(input.result.patch ?? {});
  const note = input.result.skipped
    ? `Пропуск: ${input.result.reason ?? "n/a"}`
    : patchKeys.length
      ? `Заполнено: ${patchKeys.join(", ")} · score ${input.result.score_before ?? "—"}→${input.result.score_after ?? "—"}`
      : `Без новых полей · score ${input.result.score_before ?? "—"}→${input.result.score_after ?? "—"}`;

  const { error } = await supabase.rpc("admin_import_review_write_audit", {
    p_item_id: input.itemId,
    p_action: ENRICH_AUDIT_ACTION,
    p_previous_status: input.previousStatus,
    p_new_status: input.newStatus,
    p_changed_fields: input.result as unknown as Record<string, unknown>,
    p_created_entity_type: null,
    p_created_entity_id: null,
    p_note: note,
  });
  if (error) {
    console.error("pre_publish_enrich audit failed", error.message);
  }
}

/** Spawn P5 CLI with NDJSON progress for one queue item. */
export function spawnPrePublishEnrichNdjson(itemId: string): {
  child: ReturnType<typeof spawn>;
  script: string;
} {
  const root = process.cwd();
  const script = path.join(
    root,
    "scripts",
    "import-review",
    "run_pre_publish_enrich.py",
  );
  const child = spawn(
    "python3",
    [
      script,
      "--ids",
      itemId,
      "--apply",
      "--ndjson",
      "--website-pages",
      "10",
    ],
    {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return { child, script };
}
