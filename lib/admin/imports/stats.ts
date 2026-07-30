import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  deriveImportStatus,
  emptyImportSourceStats,
  type ImportSourceStats,
} from "@/lib/admin/imports/types";

export type { ImportSourceStats } from "@/lib/admin/imports/types";
export { IMPORT_STATUS_LABELS } from "@/lib/admin/imports/types";

type Client = SupabaseClient<Database>;

function recommendationsTable(client: Client) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table pending in Database types
  return (client as SupabaseClient<any>).from("import_comment_recommendations");
}

/**
 * Status breakdown for a directory / telegram recommendation source.
 * Uses existing import_comment_recommendations rows — no schema changes.
 */
export async function getRecommendationSourceStats(
  client: Client,
  opts: {
    directorySource: string;
    sourceChannel?: string;
    /** When set, restrict to this target_bucket (e.g. yellow_pages) */
    targetBucket?: string;
    kind?: "profi" | "event" | "all";
  },
): Promise<ImportSourceStats> {
  let query = recommendationsTable(client).select(
    "status, created_at, updated_at",
  );
  query = query.eq("directory_source", opts.directorySource);
  if (opts.sourceChannel) {
    query = query.eq("source_channel", opts.sourceChannel);
  }
  if (opts.targetBucket) {
    query = query.eq("target_bucket", opts.targetBucket);
  }
  if (opts.kind && opts.kind !== "all") {
    query = query.eq("kind", opts.kind);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    status: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;

  const stats = emptyImportSourceStats();
  let lastMs = 0;

  for (const row of rows) {
    stats.imported += 1;
    const status = (row.status || "").toLowerCase();
    if (
      status === "pending" ||
      status === "in_review" ||
      status === "needs_more_info"
    ) {
      stats.inReview += 1;
    } else if (status === "approved" || status === "published") {
      stats.approved += 1;
    } else if (status === "rejected" || status === "duplicate") {
      stats.rejected += 1;
    } else if (status === "error" || status === "failed") {
      stats.error += 1;
    }

    for (const iso of [row.updated_at, row.created_at]) {
      if (!iso) continue;
      const t = Date.parse(iso);
      if (!Number.isNaN(t) && t > lastMs) {
        lastMs = t;
        stats.lastActivityAt = iso;
      }
    }
  }

  stats.importStatus = deriveImportStatus(stats);
  return stats;
}

export async function getTelegramSourceStats(
  client: Client,
  sourceId: string,
): Promise<ImportSourceStats> {
  return getRecommendationSourceStats(client, {
    directorySource: sourceId,
    sourceChannel: "telegram",
    kind: "profi",
  });
}

export async function getDirectorySourceStats(
  client: Client,
  sourceId: string,
): Promise<ImportSourceStats> {
  return getRecommendationSourceStats(client, {
    directorySource: sourceId,
    targetBucket: "yellow_pages",
    kind: "profi",
  });
}
