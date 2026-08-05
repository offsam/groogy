import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type ContactRevealBusinessRow = {
  businessId: string;
  businessSlug: string;
  businessName: string;
  reveals: number;
};

export type ContactRevealLeaderboard = {
  items: ContactRevealBusinessRow[];
  /** Businesses matching the current search (for pagination). */
  totalCount: number;
  /** All contact_reveal events on the platform. */
  totalReveals: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 20;

export async function listContactRevealBusinesses(
  client: Client,
  opts: { q?: string; page?: number; pageSize?: number } = {},
): Promise<ContactRevealLeaderboard> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const q = opts.q?.trim() || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;
  const { data, error } = await anyClient.rpc(
    "admin_list_contact_reveal_businesses",
    {
      p_q: q,
      p_limit: pageSize,
      p_offset: offset,
    },
  );

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    business_id: string;
    business_slug: string;
    business_name: string;
    reveals: number;
    total_count: number | string;
    total_reveals: number | string;
  }>;

  const totalCount = Number(rows[0]?.total_count ?? 0);
  const totalReveals = Number(rows[0]?.total_reveals ?? 0);

  return {
    items: rows.map((row) => ({
      businessId: String(row.business_id),
      businessSlug: String(row.business_slug || "unknown"),
      businessName: String(row.business_name || "Без названия"),
      reveals: Number(row.reveals ?? 0),
    })),
    totalCount,
    totalReveals,
    page,
    pageSize,
  };
}

export async function countContactRevealsTotal(client: Client): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;
  const { count, error } = await anyClient
    .from("platform_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "contact_reveal");
  if (error) return 0;
  return count ?? 0;
}
