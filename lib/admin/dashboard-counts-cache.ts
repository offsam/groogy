/**
 * Admin dashboard tile counts — keep last good numbers, recount only
 * domains whose data actually changed.
 *
 * Important: must use the request admin client (RPCs need auth.uid() + is_admin).
 * Service-role cache was wrong and produced zeros.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  computeAdminAnalyticsTile,
  computeAdminClaimsCount,
  computeAdminErrorsCount,
  computeAdminQueueCounts,
  type AdminDashboardCounts,
} from "@/lib/admin/dashboard-counts-compute";
import { ADMIN_DASHBOARD_CACHE_TAG } from "@/lib/admin/platform-analytics";

type Client = SupabaseClient<Database>;

export { ADMIN_DASHBOARD_CACHE_TAG };

/** Activity / users tile — refresh at most this often. */
const ANALYTICS_BUCKET_MS = 5 * 60 * 1000;

type Watermarks = {
  queue: string;
  claims: string;
  errors: string;
  analytics: string;
};

type Snapshot = {
  /** Bump when count formulas change so stale process memory is dropped. */
  schema: number;
  marks: Watermarks;
  counts: AdminDashboardCounts;
};

const COUNTS_SCHEMA = 4;

/** Last known good counts for this server process. */
let snapshot: Snapshot | null = null;

async function latestTimestamp(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anyClient: SupabaseClient<any>,
  table: string,
  column: "updated_at" | "created_at" | "reviewed_at" = "updated_at",
): Promise<string> {
  let query = anyClient.from(table).select(column).order(column, {
    ascending: false,
  });
  if (column === "reviewed_at") {
    query = query.not(column, "is", null);
  }
  const { data, error } = await query.limit(1).maybeSingle();
  if (error || !data) return "0";
  const value = (data as Record<string, unknown>)[column];
  return typeof value === "string" && value ? value : "0";
}

async function fetchWatermarks(client: Client): Promise<Watermarks> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;

  const [
    importReviewAt,
    recommendationsAt,
    businessClaimsAt,
    professionalClaimsAt,
    listingClaimsAt,
    eventClaimsAt,
    jobClaimsAt,
    errorsCreatedAt,
    errorsReviewedAt,
  ] = await Promise.all([
    latestTimestamp(anyClient, "import_review_items"),
    latestTimestamp(anyClient, "import_comment_recommendations"),
    latestTimestamp(anyClient, "business_claims"),
    latestTimestamp(anyClient, "professional_claims"),
    latestTimestamp(anyClient, "listing_claims"),
    latestTimestamp(anyClient, "event_claims"),
    latestTimestamp(anyClient, "job_claims"),
    latestTimestamp(anyClient, "platform_error_reports", "created_at"),
    latestTimestamp(anyClient, "platform_error_reports", "reviewed_at"),
  ]);

  return {
    queue: `${importReviewAt}|${recommendationsAt}`,
    claims: [
      businessClaimsAt,
      professionalClaimsAt,
      listingClaimsAt,
      eventClaimsAt,
      jobClaimsAt,
    ].join("|"),
    errors: `${errorsCreatedAt}|${errorsReviewedAt}`,
    analytics: String(Math.floor(Date.now() / ANALYTICS_BUCKET_MS)),
  };
}

function emptyCounts(): AdminDashboardCounts {
  return {
    businessesPending: 0,
    reviewsPending: 0,
    listingReportsPending: 0,
    usersTotal: 0,
    pageViewsToday: 0,
    contactRevealsTotal: 0,
    claimsPending: 0,
    importReviewPending: 0,
    eventsPending: 0,
    recommendationsPending: 0,
    yellowPagesPending: 0,
    facebookPending: 0,
    loveoversePending: 0,
    eventbritePending: 0,
    errorsOpen: 0,
    feedPending: 0,
    directoryPendingBySource: {},
    telegramPendingBySource: {},
    telegramPending: 0,
  };
}

/**
 * If nothing changed since last visit → return the same numbers (no recount).
 * If a domain changed → recount only that domain with the admin session.
 */
export async function getAdminDashboardCountsCached(
  client: Client,
): Promise<AdminDashboardCounts> {
  const marks = await fetchWatermarks(client);
  const prev =
    snapshot && snapshot.schema === COUNTS_SCHEMA ? snapshot : null;

  if (
    prev &&
    prev.marks.queue === marks.queue &&
    prev.marks.claims === marks.claims &&
    prev.marks.errors === marks.errors &&
    prev.marks.analytics === marks.analytics
  ) {
    return prev.counts;
  }

  const base = prev?.counts ?? emptyCounts();
  const next: AdminDashboardCounts = { ...base };

  const jobs: Array<Promise<void>> = [];

  if (!prev || prev.marks.queue !== marks.queue) {
    jobs.push(
      computeAdminQueueCounts(client).then((queue) => {
        Object.assign(next, queue);
      }),
    );
  }

  if (!prev || prev.marks.claims !== marks.claims) {
    jobs.push(
      computeAdminClaimsCount(client).then((claimsPending) => {
        next.claimsPending = claimsPending;
      }),
    );
  }

  if (!prev || prev.marks.errors !== marks.errors) {
    jobs.push(
      computeAdminErrorsCount(client).then((errorsOpen) => {
        next.errorsOpen = errorsOpen;
      }),
    );
  }

  if (!prev || prev.marks.analytics !== marks.analytics) {
    jobs.push(
      computeAdminAnalyticsTile(client).then((analytics) => {
        Object.assign(next, analytics);
      }),
    );
  }

  await Promise.all(jobs);

  // Deep-copy maps so later mutations don't leak into the snapshot.
  snapshot = {
    schema: COUNTS_SCHEMA,
    marks,
    counts: {
      ...next,
      directoryPendingBySource: { ...next.directoryPendingBySource },
      telegramPendingBySource: { ...next.telegramPendingBySource },
    },
  };

  return snapshot.counts;
}
