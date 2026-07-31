import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeSupabaseUrl } from "@/lib/supabase/env";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  CATALOG_CACHE_TAGS,
  CATALOG_CACHE_TTL,
} from "@/lib/platform/catalog-cache";
import {
  emptyPlatformSectionCounts,
  PLATFORM_SECTIONS,
  type PlatformSectionCounts,
} from "@/lib/platform/sections";
import {
  getRegionHubsByIds,
  locationFieldsMatchHub,
  parseHubIds,
} from "@/lib/regions/hubs";

/** @deprecated Use PlatformSectionCounts / PLATFORM_SECTIONS */
export type HubCategoryCounts = PlatformSectionCounts;

/** @deprecated Use PLATFORM_SECTIONS */
export const HUB_CATEGORY_COUNT_ITEMS = PLATFORM_SECTIONS;

/** Untyped until Database types cover all catalog tables/views. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

async function exactCount(
  client: unknown,
  table: string,
  status?: string,
): Promise<number> {
  try {
    let query = db(client).from(table).select("id", {
      count: "exact",
      head: true,
    });
    if (status) query = query.eq("status", status);
    const { count, error } = await query;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Same hub filter as search / listing pages (USA Location Canon). */
function asCoord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function rowMatchesHub(
  row: {
    city?: string | null;
    region?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    county_geoid?: string | null;
  },
  hubId: string,
): boolean {
  const hubs = getRegionHubsByIds(parseHubIds(hubId));
  return hubs.some((hub) =>
    locationFieldsMatchHub(
      {
        city: row.city,
        region: row.region,
        latitude: asCoord(row.latitude),
        longitude: asCoord(row.longitude),
        county_geoid: row.county_geoid,
      },
      hub,
    ),
  );
}

/** Count hub-scoped rows via light stamp select (no full entity payloads). */
async function countHubScoped(
  client: unknown,
  table: string,
  hubId: string,
  status: string,
): Promise<number> {
  try {
    const hubs = getRegionHubsByIds(parseHubIds(hubId));
    const geoids = hubs.flatMap((h) => [...h.countyGeoids]);
    const richGeo = table === "businesses" || table === "professionals";
    const cols = richGeo
      ? "id, city, region, latitude, longitude, county_geoid"
      : "id, city, county_geoid";
    const buildQuery = () => {
      let query = db(client).from(table).select(cols).eq("status", status);
      if (geoids.length > 0) {
        query = query.or(
          `county_geoid.in.(${geoids.join(",")}),county_geoid.is.null`,
        );
      }
      return query.order("id", { ascending: true });
    };

    // PostgREST often caps one response at ~1000 — page so counts match search.
    const pageSize = 1000;
    const maxRows = 20_000;
    type Stamp = {
      city?: string | null;
      region?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      county_geoid?: string | null;
    };
    const raw: Stamp[] = [];
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const { data, error } = await buildQuery().range(
        offset,
        offset + pageSize - 1,
      );
      if (error || !data) break;
      const batch = data as Stamp[];
      raw.push(...batch);
      if (batch.length < pageSize) break;
    }
    return raw.filter((row) => rowMatchesHub(row, hubId)).length;
  } catch {
    return 0;
  }
}

async function countListingCatalogHub(
  client: unknown,
  view: string,
  hubId: string,
): Promise<number> {
  try {
    const { data, error } = await db(client)
      .from(view)
      .select("id, city")
      .limit(2000);
    if (error || !data) return 0;
    return (data as Array<{ city?: string | null }>).filter((row) =>
      rowMatchesHub({ city: row.city }, hubId),
    ).length;
  } catch {
    return 0;
  }
}

async function computeHubCategoryCounts(
  hubId: string,
): Promise<PlatformSectionCounts> {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return emptyPlatformSectionCounts();

  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let catalog: unknown = client;
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
    countHubScoped(catalog, "businesses", hubId, "approved"),
    countListingCatalogHub(client, "marketplace_catalog", hubId),
    countHubScoped(catalog, "professionals", hubId, "approved").catch(() => 0),
    countHubScoped(catalog, "jobs", hubId, "published"),
    countHubScoped(catalog, "real_estate_listings", hubId, "published"),
    countHubScoped(catalog, "events", hubId, "published"),
    countHubScoped(catalog, "vehicles", hubId, "published"),
    countListingCatalogHub(client, "lechu_catalog", hubId),
    countListingCatalogHub(client, "transfers_catalog", hubId),
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

export async function getHubCategoryCounts(
  hubId: string,
): Promise<PlatformSectionCounts> {
  const key = hubId.trim() || "default";
  return unstable_cache(
    () => computeHubCategoryCounts(key),
    // v5: bust stale hub counters after catalog migration (no-street → pros)
    ["hub-category-counts-v5", key],
    {
      revalidate: CATALOG_CACHE_TTL.hubCategoryCounts,
      tags: [CATALOG_CACHE_TAGS.hubCategoryCounts],
    },
  )();
}

export async function getHubCategoryCountsUncached(
  hubId: string,
): Promise<PlatformSectionCounts> {
  return computeHubCategoryCounts(hubId);
}

/** National exact counts — used by admin health snapshot. */
export async function getNationalSectionCounts(): Promise<PlatformSectionCounts> {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return emptyPlatformSectionCounts();

  let catalog: unknown;
  try {
    catalog = createServiceRoleClient();
  } catch {
    catalog = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  const [
    businesses,
    professionals,
    marketplace,
    jobs,
    real_estate,
    events,
    vehicles,
    lechu,
    transfers,
  ] = await Promise.all([
    exactCount(catalog, "businesses", "approved"),
    exactCount(catalog, "professionals", "approved"),
    exactCount(catalog, "marketplace_catalog"),
    exactCount(catalog, "jobs", "published"),
    exactCount(catalog, "real_estate_listings", "published"),
    exactCount(catalog, "events", "published"),
    exactCount(catalog, "vehicles", "published"),
    exactCount(catalog, "lechu_catalog"),
    exactCount(catalog, "transfers_catalog"),
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
