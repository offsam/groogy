import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserRole } from "@/types/database";
import { DIRECTORY_SOURCE_LIST } from "@/lib/import-review/directory-sources";
import { TELEGRAM_SOURCE_LIST } from "@/lib/import-review/telegram-sources";

type Client = SupabaseClient<Database>;

export type AdminUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

export type AdminAnalytics = {
  users_total: number;
  users_today: number;
  users_7d: number;
  admins: number;
  businesses_total: number;
  businesses_approved: number;
  businesses_pending: number;
  businesses_today: number;
  listings_active: number;
  listings_pending_reports: number;
  offers_active: number;
  reviews_pending: number;
  page_views_today: number;
  page_views_7d: number;
  page_views_30d: number;
  top_paths_7d: Array<{ path: string; views: number }>;
  contact_reveals_today: number;
  contact_reveals_7d: number;
  contact_reveals_30d: number;
  top_contact_reveals_7d: Array<{
    business_id: string | null;
    business_slug: string;
    business_name: string;
    offer_id: string | null;
    offer_slug: string | null;
    reveals: number;
  }>;
};

export type AdminDashboardCounts = {
  businessesPending: number;
  reviewsPending: number;
  listingReportsPending: number;
  usersTotal: number;
  pageViewsToday: number;
  claimsPending: number;
  importReviewPending: number;
  eventsPending: number;
  recommendationsPending: number;
  yellowPagesPending: number;
  /** Pending yellow_pages cards keyed by directory_source. */
  directoryPendingBySource: Record<string, number>;
  /** Pending telegram cards keyed by directory_source (tg_*). */
  telegramPendingBySource: Record<string, number>;
  telegramPending: number;
};

export async function getAdminUsers(client: Client): Promise<AdminUserRow[]> {
  const { data, error } = await client.rpc("admin_list_users");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function getAdminAnalytics(client: Client): Promise<AdminAnalytics> {
  const { data, error } = await client.rpc("get_admin_platform_analytics");
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  const top = Array.isArray(raw.top_paths_7d) ? raw.top_paths_7d : [];
  const topReveals = Array.isArray(raw.top_contact_reveals_7d)
    ? raw.top_contact_reveals_7d
    : [];
  return {
    users_total: Number(raw.users_total ?? 0),
    users_today: Number(raw.users_today ?? 0),
    users_7d: Number(raw.users_7d ?? 0),
    admins: Number(raw.admins ?? 0),
    businesses_total: Number(raw.businesses_total ?? 0),
    businesses_approved: Number(raw.businesses_approved ?? 0),
    businesses_pending: Number(raw.businesses_pending ?? 0),
    businesses_today: Number(raw.businesses_today ?? 0),
    listings_active: Number(raw.listings_active ?? 0),
    listings_pending_reports: Number(raw.listings_pending_reports ?? 0),
    offers_active: Number(raw.offers_active ?? 0),
    reviews_pending: Number(raw.reviews_pending ?? 0),
    page_views_today: Number(raw.page_views_today ?? 0),
    page_views_7d: Number(raw.page_views_7d ?? 0),
    page_views_30d: Number(raw.page_views_30d ?? 0),
    top_paths_7d: top.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        path: String(row.path ?? "/"),
        views: Number(row.views ?? 0),
      };
    }),
    contact_reveals_today: Number(raw.contact_reveals_today ?? 0),
    contact_reveals_7d: Number(raw.contact_reveals_7d ?? 0),
    contact_reveals_30d: Number(raw.contact_reveals_30d ?? 0),
    top_contact_reveals_7d: topReveals.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        business_id: row.business_id ? String(row.business_id) : null,
        business_slug: String(row.business_slug ?? "unknown"),
        business_name: String(row.business_name ?? "Без названия"),
        offer_id: row.offer_id ? String(row.offer_id) : null,
        offer_slug: row.offer_slug ? String(row.offer_slug) : null,
        reveals: Number(row.reveals ?? 0),
      };
    }),
  };
}

async function countPendingByDirectorySource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anyClient: SupabaseClient<any>,
  filter: {
    targetBucket?: string;
    sourceChannel?: string;
  },
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const pageSize = 1000;
  let from = 0;
  for (let page = 0; page < 50; page += 1) {
    let query = anyClient
      .from("import_comment_recommendations")
      .select("directory_source")
      .eq("status", "pending")
      .range(from, from + pageSize - 1);
    if (filter.targetBucket) {
      query = query.eq("target_bucket", filter.targetBucket);
    }
    if (filter.sourceChannel) {
      query = query.eq("source_channel", filter.sourceChannel);
    }
    const { data, error } = await query;
    if (error || !data?.length) break;
    for (const row of data as Array<{ directory_source?: string | null }>) {
      const key = row.directory_source?.trim() || "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return counts;
}

export async function getAdminDashboardCounts(
  client: Client,
): Promise<AdminDashboardCounts> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;

  const [
    analytics,
    claims,
    importCounts,
    eventsPending,
    recommendationsPending,
    yellowPagesPending,
    directoryPendingBySourceRaw,
    telegramPendingBySourceRaw,
    telegramPending,
  ] = await Promise.all([
    getAdminAnalytics(client).catch(() => null),
    Promise.resolve(
      anyClient
        .from("business_claims")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .then((r: { count: number | null; error: unknown }) => {
          if (r.error) return 0;
          return r.count ?? 0;
        }),
    ).catch(() => 0),
    Promise.resolve(
      anyClient
        .rpc("admin_import_review_counts")
        .then((r: { data: unknown; error: unknown }) => {
          if (r.error) return 0;
          const raw = (r.data ?? {}) as { by_status?: Record<string, number> };
          return Number(raw.by_status?.pending ?? 0);
        }),
    ).catch(() => 0),
    Promise.resolve(
      anyClient
        .from("import_comment_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("kind", "event")
        .eq("status", "pending")
        .then((r: { count: number | null; error: unknown }) => {
          if (r.error) return 0;
          return r.count ?? 0;
        }),
    ).catch(() => 0),
    Promise.resolve(
      anyClient
        .from("import_comment_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("kind", "profi")
        .eq("status", "pending")
        .neq("target_bucket", "yellow_pages")
        .then((r: { count: number | null; error: unknown }) => {
          if (r.error) return 0;
          return r.count ?? 0;
        }),
    ).catch(() => 0),
    Promise.resolve(
      anyClient
        .from("import_comment_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("target_bucket", "yellow_pages")
        .eq("status", "pending")
        .then((r: { count: number | null; error: unknown }) => {
          if (r.error) return 0;
          return r.count ?? 0;
        }),
    ).catch(() => 0),
    countPendingByDirectorySource(anyClient, {
      targetBucket: "yellow_pages",
    }).catch(() => ({}) as Record<string, number>),
    countPendingByDirectorySource(anyClient, {
      sourceChannel: "telegram",
    }).catch(() => ({}) as Record<string, number>),
    Promise.resolve(
      anyClient
        .from("import_comment_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("source_channel", "telegram")
        .eq("status", "pending")
        .then((r: { count: number | null; error: unknown }) => {
          if (r.error) return 0;
          return r.count ?? 0;
        }),
    ).catch(() => 0),
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

  return {
    businessesPending: analytics?.businesses_pending ?? 0,
    reviewsPending: analytics?.reviews_pending ?? 0,
    listingReportsPending: analytics?.listings_pending_reports ?? 0,
    usersTotal: analytics?.users_total ?? 0,
    pageViewsToday: analytics?.page_views_today ?? 0,
    claimsPending: claims,
    importReviewPending: importCounts,
    eventsPending,
    recommendationsPending,
    yellowPagesPending,
    directoryPendingBySource,
    telegramPendingBySource,
    telegramPending,
  };
}
