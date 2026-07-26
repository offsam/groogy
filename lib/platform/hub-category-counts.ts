import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeSupabaseUrl } from "@/lib/supabase/env";
import { searchBusinesses } from "@/lib/supabase/queries";
import {
  searchLechuListings,
  searchMarketplaceListings,
  searchServiceListings,
  searchTransferListings,
} from "@/lib/listings/queries";
import {
  emptyPlatformSectionCounts,
  PLATFORM_SECTIONS,
  type PlatformSectionCounts,
} from "@/lib/platform/sections";

/** @deprecated Use PlatformSectionCounts / PLATFORM_SECTIONS */
export type HubCategoryCounts = PlatformSectionCounts;

/** @deprecated Use PLATFORM_SECTIONS */
export const HUB_CATEGORY_COUNT_ITEMS = PLATFORM_SECTIONS;

export async function getHubCategoryCounts(
  hubId: string,
): Promise<PlatformSectionCounts> {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return emptyPlatformSectionCounts();

  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [businesses, marketplace, services, lechu, transfers] =
    await Promise.all([
      searchBusinesses(client, { hubId }).then((rows) => rows.length),
      searchMarketplaceListings(client, { hubId, page: 1, pageSize: 1 }).then(
        (r) => r.total,
      ),
      searchServiceListings(client, { hubId, page: 1, pageSize: 1 }).then(
        (r) => r.total,
      ),
      searchLechuListings(client, { hubId, page: 1, pageSize: 1 }).then(
        (r) => r.total,
      ),
      searchTransferListings(client, { hubId, page: 1, pageSize: 1 }).then(
        (r) => r.total,
      ),
    ]);

  return {
    businesses,
    marketplace,
    services,
    lechu,
    transfers,
  };
}

export { emptyPlatformSectionCounts, PLATFORM_SECTIONS };
