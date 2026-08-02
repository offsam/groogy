/**
 * Pure count computation for admin dashboard tiles.
 * Cached by lib/admin/dashboard-counts-cache.ts — keep this free of Next cache APIs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeInboxSource } from "@/lib/admin/inbox/adapters";
import type { InboxSourceKey } from "@/lib/admin/inbox/types";
import { DIRECTORY_SOURCE_LIST } from "@/lib/import-review/directory-sources";
import { TELEGRAM_SOURCE_LIST } from "@/lib/import-review/telegram-sources";
import { countContactRevealsTotal } from "@/lib/admin/contact-reveal-queries";
import { getAdminAnalyticsUncached } from "@/lib/admin/platform-analytics";

type Client = SupabaseClient<Database>;
const QUEUE_STATUSES = ["pending", "suspected_duplicate"] as const;

export type AdminQueueCounts = {
  importReviewPending: number;
  eventsPending: number;
  recommendationsPending: number;
  yellowPagesPending: number;
  facebookPending: number;
  loveoversePending: number;
  eventbritePending: number;
  feedPending: number;
  directoryPendingBySource: Record<string, number>;
  telegramPendingBySource: Record<string, number>;
  telegramPending: number;
};

export type AdminAnalyticsTile = {
  businessesPending: number;
  reviewsPending: number;
  listingReportsPending: number;
  usersTotal: number;
  pageViewsToday: number;
  contactRevealsTotal: number;
};

export type AdminDashboardCounts = AdminQueueCounts &
  AdminAnalyticsTile & {
    claimsPending: number;
    errorsOpen: number;
  };

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

async function countPendingByDirectorySource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anyClient: SupabaseClient<any>,
  filter: {
    targetBucket?: string;
    sourceChannel?: string;
    excludeYellowPages?: boolean;
  },
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const pageSize = 1000;
  let from = 0;
  for (let page = 0; page < 50; page += 1) {
    let query = anyClient
      .from("import_comment_recommendations")
      .select("directory_source,target_bucket")
      .in("status", [...QUEUE_STATUSES])
      .range(from, from + pageSize - 1);
    if (filter.targetBucket) {
      query = query.eq("target_bucket", filter.targetBucket);
    }
    if (filter.sourceChannel) {
      query = query.eq("source_channel", filter.sourceChannel);
    }
    const { data, error } = await query;
    if (error || !data?.length) break;
    for (const row of data as Array<{
      directory_source?: string | null;
      target_bucket?: string | null;
    }>) {
      if (
        filter.excludeYellowPages &&
        row.target_bucket === "yellow_pages"
      ) {
        continue;
      }
      const key = row.directory_source?.trim() || "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return counts;
}

async function countImportReviewPendingByInboxSource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anyClient: SupabaseClient<any>,
  sourceKey: Extract<InboxSourceKey, "telegram" | "facebook">,
): Promise<number> {
  let total = 0;
  const pageSize = 1000;
  let from = 0;
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await anyClient
      .from("import_review_items")
      .select("source")
      .eq("review_status", "pending")
      .range(from, from + pageSize - 1);
    if (error || !data?.length) break;
    for (const row of data as Array<{ source?: string | null }>) {
      if (normalizeInboxSource(row.source) === sourceKey) total += 1;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return total;
}

async function countChannelProfiRecommendations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anyClient: SupabaseClient<any>,
  sourceChannel: "telegram" | "facebook",
): Promise<number> {
  return countExact(anyClient, "import_comment_recommendations", (q) =>
    q
      .eq("kind", "profi")
      .eq("source_channel", sourceChannel)
      .or("target_bucket.is.null,target_bucket.neq.yellow_pages")
      .in("status", [...QUEUE_STATUSES]),
  );
}

async function countChannelEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anyClient: SupabaseClient<any>,
  sourceChannel: "telegram" | "facebook" | "loveoverse" | "eventbrite",
): Promise<number> {
  return countExact(anyClient, "import_comment_recommendations", (q) =>
    q
      .eq("kind", "event")
      .eq("status", "pending")
      .eq("source_channel", sourceChannel),
  );
}

export async function computeAdminQueueCounts(
  client: Client,
): Promise<AdminQueueCounts> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;

  const [
    importReviewPending,
    eventsPending,
    recommendationsPending,
    yellowPagesPending,
    telegramImport,
    facebookImport,
    telegramEvents,
    facebookEvents,
    loveoverseEvents,
    eventbriteEvents,
    telegramProfi,
    facebookProfi,
    directoryPendingBySourceRaw,
    telegramPendingBySourceRaw,
  ] = await Promise.all([
    Promise.resolve(
      anyClient
        .rpc("admin_import_review_counts")
        .then((r: { data: unknown; error: unknown }) => {
          if (r.error) return 0;
          const raw = (r.data ?? {}) as { by_status?: Record<string, number> };
          return Number(raw.by_status?.pending ?? 0);
        }),
    ).catch(() => 0),
    countExact(anyClient, "import_comment_recommendations", (q) =>
      q.eq("kind", "event").eq("status", "pending"),
    ),
    countExact(anyClient, "import_comment_recommendations", (q) =>
      q.eq("kind", "profi").in("status", [...QUEUE_STATUSES]),
    ),
    countExact(anyClient, "import_comment_recommendations", (q) =>
      q.eq("target_bucket", "yellow_pages").in("status", [...QUEUE_STATUSES]),
    ),
    countImportReviewPendingByInboxSource(anyClient, "telegram"),
    countImportReviewPendingByInboxSource(anyClient, "facebook"),
    countChannelEvents(anyClient, "telegram"),
    countChannelEvents(anyClient, "facebook"),
    countChannelEvents(anyClient, "loveoverse"),
    countChannelEvents(anyClient, "eventbrite"),
    countChannelProfiRecommendations(anyClient, "telegram"),
    countChannelProfiRecommendations(anyClient, "facebook"),
    countPendingByDirectorySource(anyClient, {
      targetBucket: "yellow_pages",
    }).catch(() => ({}) as Record<string, number>),
    countPendingByDirectorySource(anyClient, {
      sourceChannel: "telegram",
      excludeYellowPages: true,
    }).catch(() => ({}) as Record<string, number>),
  ]);

  const directoryPendingBySource: Record<string, number> = {
    ...directoryPendingBySourceRaw,
  };
  for (const source of DIRECTORY_SOURCE_LIST) {
    directoryPendingBySource[source.id] =
      directoryPendingBySource[source.id] ?? 0;
  }

  const telegramPendingBySource: Record<string, number> = {
    ...telegramPendingBySourceRaw,
  };
  for (const source of TELEGRAM_SOURCE_LIST) {
    telegramPendingBySource[source.id] =
      telegramPendingBySource[source.id] ?? 0;
  }

  const telegramPending = telegramImport + telegramEvents + telegramProfi;
  const facebookPending = facebookImport + facebookEvents + facebookProfi;
  const loveoversePending = loveoverseEvents;
  const eventbritePending = eventbriteEvents;
  const feedPending =
    importReviewPending + eventsPending + recommendationsPending;

  return {
    importReviewPending,
    eventsPending,
    recommendationsPending,
    yellowPagesPending,
    facebookPending,
    loveoversePending,
    eventbritePending,
    feedPending,
    directoryPendingBySource,
    telegramPendingBySource,
    telegramPending,
  };
}

export async function computeAdminClaimsCount(client: Client): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;
  const ns = await Promise.all([
    countExact(anyClient, "business_claims", (q) => q.eq("status", "pending")),
    countExact(anyClient, "professional_claims", (q) =>
      q.eq("status", "pending"),
    ),
    countExact(anyClient, "listing_claims", (q) => q.eq("status", "pending")),
    countExact(anyClient, "event_claims", (q) => q.eq("status", "pending")),
    countExact(anyClient, "job_claims", (q) => q.eq("status", "pending")),
  ]);
  return ns.reduce((a, b) => a + b, 0);
}

export async function computeAdminErrorsCount(client: Client): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;
  return countExact(anyClient, "platform_error_reports", (q) =>
    q.eq("status", "open"),
  );
}

export async function computeAdminAnalyticsTile(
  client: Client,
): Promise<AdminAnalyticsTile> {
  const [analytics, contactRevealsTotal] = await Promise.all([
    getAdminAnalyticsUncached(client).catch(() => null),
    countContactRevealsTotal(client),
  ]);
  return {
    businessesPending: analytics?.businesses_pending ?? 0,
    reviewsPending: analytics?.reviews_pending ?? 0,
    listingReportsPending: analytics?.listings_pending_reports ?? 0,
    usersTotal: analytics?.users_total ?? 0,
    pageViewsToday: analytics?.page_views_today ?? 0,
    contactRevealsTotal:
      analytics?.contact_reveals_total || contactRevealsTotal,
  };
}
