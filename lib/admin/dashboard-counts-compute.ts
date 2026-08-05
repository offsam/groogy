/**
 * Pure count computation for admin dashboard tiles.
 * Cached by lib/admin/dashboard-counts-cache.ts — keep this free of Next cache APIs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  countImportReviewOpenForSource,
  countOpenFeedUniverse,
  countRecommendationsOpen,
  countSourceScopedQueue,
} from "@/lib/admin/inbox/queue-counts";
import { RECOMMENDATION_OPEN_STATUSES } from "@/lib/admin/inbox/queue-universe";
import { countContactRevealsTotal } from "@/lib/admin/contact-reveal-queries";
import { getAdminAnalyticsUncached } from "@/lib/admin/platform-analytics";
import { DIRECTORY_SOURCE_LIST } from "@/lib/import-review/directory-sources";
import { TELEGRAM_SOURCE_LIST } from "@/lib/import-review/telegram-sources";

type Client = SupabaseClient<Database>;
const QUEUE_STATUSES = [...RECOMMENDATION_OPEN_STATUSES];

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
      .in("status", QUEUE_STATUSES)
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

export async function computeAdminQueueCounts(
  client: Client,
): Promise<AdminQueueCounts> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;

  const [
    feed,
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
    countOpenFeedUniverse(client),
    countRecommendationsOpen(client, { bucket: "yellow_pages" }),
    countImportReviewOpenForSource(client, { sourceChannel: "telegram" }),
    countImportReviewOpenForSource(client, { sourceChannel: "facebook" }),
    countRecommendationsOpen(client, {
      kind: "event",
      sourceChannel: "telegram",
    }),
    countRecommendationsOpen(client, {
      kind: "event",
      sourceChannel: "facebook",
    }),
    countRecommendationsOpen(client, {
      sourceChannel: "loveoverse",
    }),
    countRecommendationsOpen(client, {
      sourceChannel: "eventbrite",
    }),
    countRecommendationsOpen(client, {
      kind: "profi",
      sourceChannel: "telegram",
      excludeYellowPages: true,
    }),
    countRecommendationsOpen(client, {
      kind: "profi",
      sourceChannel: "facebook",
      excludeYellowPages: true,
    }),
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

  // Per Telegram group: same total as opening that source tile (recs + import_review).
  const telegramPendingBySource: Record<string, number> = {
    ...telegramPendingBySourceRaw,
  };
  await Promise.all(
    TELEGRAM_SOURCE_LIST.map(async (source) => {
      const total = await countSourceScopedQueue(client, {
        source: "telegram",
        sourceRef: source.id,
      }).catch(() => telegramPendingBySourceRaw[source.id] ?? 0);
      telegramPendingBySource[source.id] = total;
    }),
  );

  // Per-source telegram tiles: recommendations already keyed by directory_source;
  // add import_review for that group when we only have rec counts from the scan.
  // (Hub “Telegram · все” uses telegramPending below.)

  const telegramPending = telegramImport + telegramEvents + telegramProfi;
  const facebookPending = facebookImport + facebookEvents + facebookProfi;
  const loveoversePending = loveoverseEvents;
  const eventbritePending = eventbriteEvents;

  return {
    importReviewPending: feed.importReview,
    eventsPending: feed.events,
    recommendationsPending: feed.recommendations,
    yellowPagesPending,
    facebookPending,
    loveoversePending,
    eventbritePending,
    feedPending: feed.total,
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
    countContactRevealsTotal(client).catch(() => 0),
  ]);

  return {
    businessesPending: analytics?.businesses_pending ?? 0,
    reviewsPending: analytics?.reviews_pending ?? 0,
    listingReportsPending: analytics?.listings_pending_reports ?? 0,
    usersTotal: analytics?.users_total ?? 0,
    pageViewsToday: analytics?.page_views_today ?? 0,
    contactRevealsTotal,
  };
}
