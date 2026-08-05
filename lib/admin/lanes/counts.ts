/**
 * Lane counts for /admin dashboard + Inbox chips.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADMIN_LANE_IDS,
  type AdminLaneId,
} from "@/lib/admin/lanes/types";
import { TAG_QUARANTINE, TAG_SEEKING } from "@/lib/import-review/review-tags";

export type AdminLaneCounts = Record<AdminLaneId, number> & {
  totalOpen: number;
};

const EMPTY: AdminLaneCounts = {
  attach: 0,
  route: 0,
  ready: 0,
  seeking: 0,
  quarantine: 0,
  review: 0,
  totalOpen: 0,
};

async function countExact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>,
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply: (q: any) => any,
): Promise<number> {
  let query = client.from(table).select("id", { count: "exact", head: true });
  query = apply(query);
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

/**
 * Approximate SQL counts for lanes (fast dashboard).
 * Full classifyLane is used on loaded rows; these are operational proxies.
 */
export async function getAdminLaneCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>,
): Promise<AdminLaneCounts> {
  const [
    ready,
    seekingIr,
    quarantineIr,
    pendingIr,
    inReviewIr,
    needsInfoIr,
    attachRec,
    pendingRec,
    quarantineRec,
  ] = await Promise.all([
    countExact(client, "import_review_items", (q) =>
      q.eq("review_status", "ready_to_publish"),
    ),
    countExact(client, "import_review_items", (q) =>
      q
        .in("review_status", [
          "pending",
          "in_review",
          "needs_more_info",
          "ready_to_publish",
        ])
        .ilike("review_notes", `%${TAG_SEEKING}%`),
    ),
    countExact(client, "import_review_items", (q) =>
      q.eq("review_status", "quarantine"),
    ),
    countExact(client, "import_review_items", (q) =>
      q.eq("review_status", "pending"),
    ),
    countExact(client, "import_review_items", (q) =>
      q.eq("review_status", "in_review"),
    ),
    countExact(client, "import_review_items", (q) =>
      q.eq("review_status", "needs_more_info"),
    ),
    countExact(client, "import_comment_recommendations", (q) =>
      q.eq("status", "suspected_duplicate"),
    ),
    countExact(client, "import_comment_recommendations", (q) =>
      q.eq("status", "pending"),
    ),
    countExact(client, "import_comment_recommendations", (q) =>
      q.eq("status", "quarantine"),
    ),
  ]);

  // Route ≈ typed pending (has target_collection) — sample via filter.
  const route = await countExact(client, "import_review_items", (q) =>
    q
      .in("review_status", ["pending", "in_review", "needs_more_info"])
      .not("target_collection", "is", null)
      .not("review_notes", "ilike", `%${TAG_SEEKING}%`)
      .not("review_notes", "ilike", `%${TAG_QUARANTINE}%`),
  );

  const quarantine = quarantineIr + quarantineRec;
  const attach = attachRec;
  // Review = open items not already counted in ready/route/seeking proxies.
  const openIr = pendingIr + inReviewIr + needsInfoIr;
  const review = Math.max(
    0,
    openIr + pendingRec - route - seekingIr - ready,
  );

  const counts: AdminLaneCounts = {
    attach,
    route,
    ready,
    seeking: seekingIr,
    quarantine,
    review,
    totalOpen:
      attach + route + ready + seekingIr + quarantine + review,
  };

  // Ensure keys exist
  for (const id of ADMIN_LANE_IDS) {
    counts[id] = counts[id] ?? 0;
  }
  return counts;
}

export { EMPTY as EMPTY_LANE_COUNTS };
