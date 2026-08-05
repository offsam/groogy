/**
 * Exact open-queue counts shared by dashboard tiles and Inbox totals.
 * One formula → tile N and «В очереди» N for the same scope.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeInboxSource } from "@/lib/admin/inbox/adapters";
import type { InboxSourceKey } from "@/lib/admin/inbox/types";
import {
  IMPORT_REVIEW_OPEN_STATUSES,
  RECOMMENDATION_OPEN_STATUSES,
  sumStatusCounts,
} from "@/lib/admin/inbox/queue-universe";
import { TELEGRAM_SOURCES } from "@/lib/import-review/telegram-sources";

type Client = SupabaseClient<Database>;

const REC_OPEN = [...RECOMMENDATION_OPEN_STATUSES];
const IMPORT_OPEN = [...IMPORT_REVIEW_OPEN_STATUSES];

async function countExact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anyClient: SupabaseClient<any>,
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply: (q: any) => any,
): Promise<number> {
  let query = anyClient.from(table).select("id", { count: "exact", head: true });
  query = apply(query);
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

/** Import-review + events + profi recommendations (same universe as «Вся лента»). */
export async function countOpenFeedUniverse(client: Client): Promise<{
  importReview: number;
  events: number;
  recommendations: number;
  total: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;

  const [importReview, events, recommendations] = await Promise.all([
    Promise.resolve(
      anyClient.rpc("admin_import_review_counts"),
    )
      .then((r: { data: unknown; error: unknown }) => {
        if (r.error) return 0;
        const raw = (r.data ?? {}) as { by_status?: Record<string, number> };
        return sumStatusCounts(raw.by_status, IMPORT_REVIEW_OPEN_STATUSES);
      })
      .catch(() => 0),
    countExact(anyClient, "import_comment_recommendations", (q) =>
      q.eq("kind", "event").in("status", REC_OPEN),
    ),
    countExact(anyClient, "import_comment_recommendations", (q) =>
      q.eq("kind", "profi").in("status", REC_OPEN),
    ),
  ]);

  return {
    importReview,
    events,
    recommendations,
    total: importReview + events + recommendations,
  };
}

export async function countRecommendationsOpen(
  client: Client,
  opts: {
    kind?: "profi" | "event" | "all";
    directorySource?: string;
    sourceChannel?: string;
    bucket?: "yellow_pages";
    excludeYellowPages?: boolean;
  },
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;
  return countExact(anyClient, "import_comment_recommendations", (q) => {
    let next = q.in("status", REC_OPEN);
    if (opts.kind && opts.kind !== "all") next = next.eq("kind", opts.kind);
    if (opts.sourceChannel) next = next.eq("source_channel", opts.sourceChannel);
    if (opts.directorySource) {
      next = next.eq("directory_source", opts.directorySource);
    }
    if (opts.bucket) next = next.eq("target_bucket", opts.bucket);
    if (opts.excludeYellowPages) {
      next = next.or("target_bucket.is.null,target_bucket.neq.yellow_pages");
    }
    return next;
  });
}

/**
 * Count import_review_items in the open queue for a Telegram/Facebook slice.
 * Matches listImportReviewForSource filters.
 */
export async function countImportReviewOpenForSource(
  client: Client,
  opts: {
    sourceChannel?: Extract<InboxSourceKey, "telegram" | "facebook">;
    sourceGroup?: string;
  },
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;

  if (opts.sourceGroup) {
    return countExact(anyClient, "import_review_items", (q) =>
      q.in("review_status", IMPORT_OPEN).eq("source_group", opts.sourceGroup),
    );
  }

  // Channel-wide: scan source field (same normalize as dashboard).
  let total = 0;
  const pageSize = 1000;
  let from = 0;
  const want = opts.sourceChannel;
  if (!want) return 0;

  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await anyClient
      .from("import_review_items")
      .select("source")
      .in("review_status", IMPORT_OPEN)
      .range(from, from + pageSize - 1);
    if (error || !data?.length) break;
    for (const row of data as Array<{ source?: string | null }>) {
      if (normalizeInboxSource(row.source) === want) total += 1;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return total;
}

/** Exact DB total for a source-scoped Inbox URL (tile ↔ «В очереди»). */
export async function countSourceScopedQueue(
  client: Client,
  opts: {
    source?: InboxSourceKey | "all" | null;
    sourceRef?: string | null;
  },
): Promise<number> {
  const source =
    opts.source && opts.source !== "all" ? opts.source : null;
  const sourceRef =
    opts.sourceRef && opts.sourceRef !== "all" ? opts.sourceRef : null;

  const tgMeta =
    sourceRef && sourceRef in TELEGRAM_SOURCES
      ? TELEGRAM_SOURCES[sourceRef as keyof typeof TELEGRAM_SOURCES]
      : null;

  if (
    source === "directories" ||
    (sourceRef &&
      !tgMeta &&
      source !== "telegram" &&
      source !== "facebook" &&
      source !== "loveoverse" &&
      source !== "eventbrite")
  ) {
    return countRecommendationsOpen(client, {
      directorySource: sourceRef || undefined,
      bucket: "yellow_pages",
    });
  }

  if (source === "telegram" || tgMeta) {
    const [recs, ir] = await Promise.all([
      countRecommendationsOpen(client, {
        sourceChannel: "telegram",
        directorySource: sourceRef || undefined,
        excludeYellowPages: !sourceRef,
      }),
      countImportReviewOpenForSource(client, {
        sourceChannel: "telegram",
        sourceGroup: tgMeta?.groupLabel,
      }),
    ]);
    return recs + ir;
  }

  if (source === "facebook") {
    const [recs, ir] = await Promise.all([
      countRecommendationsOpen(client, {
        sourceChannel: "facebook",
        directorySource: sourceRef || undefined,
        excludeYellowPages: true,
      }),
      countImportReviewOpenForSource(client, {
        sourceChannel: "facebook",
      }),
    ]);
    return recs + ir;
  }

  if (source === "loveoverse") {
    return countRecommendationsOpen(client, {
      sourceChannel: "loveoverse",
      directorySource: sourceRef || undefined,
    });
  }

  if (source === "eventbrite") {
    return countRecommendationsOpen(client, {
      sourceChannel: "eventbrite",
      directorySource: sourceRef || undefined,
    });
  }

  return 0;
}
