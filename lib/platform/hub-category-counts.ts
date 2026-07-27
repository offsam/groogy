import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeSupabaseUrl } from "@/lib/supabase/env";
import { searchBusinesses } from "@/lib/supabase/queries";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  searchLechuListings,
  searchMarketplaceListings,
  searchTransferListings,
} from "@/lib/listings/queries";
import { countApprovedProfessionals } from "@/lib/professional/queries";
import {
  emptyPlatformSectionCounts,
  PLATFORM_SECTIONS,
  type PlatformSectionCounts,
} from "@/lib/platform/sections";

/** @deprecated Use PlatformSectionCounts / PLATFORM_SECTIONS */
export type HubCategoryCounts = PlatformSectionCounts;

/** @deprecated Use PLATFORM_SECTIONS */
export const HUB_CATEGORY_COUNT_ITEMS = PLATFORM_SECTIONS;

async function countTable(
  client: ReturnType<typeof createServiceRoleClient>,
  table: string,
  status = "published",
): Promise<number> {
  try {
    // Untyped until Database types include events/jobs/etc.
    const { count, error } = await (client as unknown as {
      from: (t: string) => {
        select: (
          c: string,
          o: { count: "exact"; head: boolean },
        ) => {
          eq: (
            a: string,
            b: string,
          ) => Promise<{ count: number | null; error: { message?: string } | null }>;
        };
      };
    })
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function getHubCategoryCounts(
  hubId: string,
): Promise<PlatformSectionCounts> {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return emptyPlatformSectionCounts();

  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let catalog = client;
  try {
    catalog = createServiceRoleClient();
  } catch {
    // Local misconfig — keep anon
  }

  const [
    businesses,
    marketplace,
    professionals,
    jobs,
    real_estate,
    events,
    vehicles,
    lechu,
    transfers,
  ] = await Promise.all([
    searchBusinesses(catalog, { hubId }).then((rows) => rows.length),
    searchMarketplaceListings(client, { hubId, page: 1, pageSize: 1 }).then(
      (r) => r.total,
    ),
    countApprovedProfessionals(catalog).catch(() => 0),
    countTable(catalog, "jobs"),
    countTable(catalog, "real_estate_listings"),
    countTable(catalog, "events"),
    countTable(catalog, "vehicles"),
    searchLechuListings(client, { hubId, page: 1, pageSize: 1 }).then(
      (r) => r.total,
    ),
    searchTransferListings(client, { hubId, page: 1, pageSize: 1 }).then(
      (r) => r.total,
    ),
  ]);

  return {
    businesses,
    professionals,
    marketplace,
    jobs,
    real_estate,
    events,
    vehicles,
    lechu,
    transfers,
  };
}

export { emptyPlatformSectionCounts, PLATFORM_SECTIONS };
