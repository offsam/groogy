import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** Shared tag name (manual revalidate if needed later). */
export const ADMIN_DASHBOARD_CACHE_TAG = "admin-dashboard-counts";

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
  contact_reveals_total: number;
  top_contact_reveals_7d: Array<{
    business_id: string | null;
    business_slug: string;
    business_name: string;
    offer_id: string | null;
    offer_slug: string | null;
    reveals: number;
  }>;
};

/** Refresh full analytics at most every 5 minutes per server process. */
const ANALYTICS_BUCKET_MS = 5 * 60 * 1000;

type AnalyticsSnapshot = {
  bucket: string;
  stats: AdminAnalytics;
};

let analyticsSnapshot: AnalyticsSnapshot | null = null;

function mapAnalytics(raw: Record<string, unknown>): AdminAnalytics {
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
    contact_reveals_total: Number(raw.contact_reveals_total ?? 0),
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

export async function getAdminAnalyticsUncached(
  client: Client,
): Promise<AdminAnalytics> {
  const { data, error } = await client.rpc("get_admin_platform_analytics");
  if (error) throw error;
  return mapAnalytics((data ?? {}) as Record<string, unknown>);
}

/**
 * Analytics page: keep last result for 5 minutes; uses admin session (not service role).
 */
export async function getAdminAnalytics(
  client: Client,
): Promise<AdminAnalytics> {
  const bucket = String(Math.floor(Date.now() / ANALYTICS_BUCKET_MS));
  if (analyticsSnapshot && analyticsSnapshot.bucket === bucket) {
    return analyticsSnapshot.stats;
  }
  const stats = await getAdminAnalyticsUncached(client);
  analyticsSnapshot = { bucket, stats };
  return stats;
}
