import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserRole } from "@/types/database";
import {
  getAdminDashboardCountsCached,
} from "@/lib/admin/dashboard-counts-cache";
import {
  type AdminDashboardCounts,
} from "@/lib/admin/dashboard-counts-compute";
import {
  getAdminAnalytics,
  type AdminAnalytics,
} from "@/lib/admin/platform-analytics";

export type { AdminAnalytics, AdminDashboardCounts };
export { getAdminAnalytics };

type Client = SupabaseClient<Database>;

export type AdminUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

/**
 * Admin home / queue tile counters.
 * Cheap watermark check every visit; full recount only when data changed.
 */
export async function getAdminDashboardCounts(
  client: Client,
): Promise<AdminDashboardCounts> {
  return getAdminDashboardCountsCached(client);
}

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
