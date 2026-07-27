import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/types/business";
import type { Database } from "@/types/database";
import type { Listing } from "@/types/listing";
import {
  searchLechuListings,
  searchMarketplaceListings,
  searchServiceListings,
  searchTransferListings,
} from "@/lib/listings/queries";
import {
  isPopularResourceKind,
  type PopularResourceKind,
} from "@/lib/platform/resource-kinds";
import {
  getRegionHubsByIds,
  isLatLngInHubBounds,
  parseHubIds,
} from "@/lib/regions/hubs";
import { searchBusinesses } from "@/lib/supabase/queries";
import { hasCoordinates } from "@/types/business";

type Client = SupabaseClient<Database>;

export type PopularHomeItem =
  | { kind: "business"; score: number; business: Business }
  | { kind: "marketplace"; score: number; listing: Listing }
  | { kind: "service"; score: number; listing: Listing }
  | { kind: "lechu"; score: number; listing: Listing }
  | { kind: "transfer"; score: number; listing: Listing };

type ScoreRow = {
  entity_type: string;
  entity_id: string;
  score: number;
};

function businessInHub(business: Business, hubId: string | null | undefined) {
  if (!hubId) return true;
  if (!hasCoordinates(business)) return false;
  const hubs = getRegionHubsByIds(parseHubIds(hubId));
  return hubs.some((hub) =>
    isLatLngInHubBounds(business.latitude, business.longitude, hub),
  );
}

async function fetchScores(
  client: Client,
  days: number,
  limit: number,
): Promise<ScoreRow[]> {
  try {
    const { data, error } = await client.rpc("popular_resource_scores", {
      p_days: days,
      p_limit: limit,
    });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>)
      .map((row): ScoreRow | null => {
        const entity_type = String(row.entity_type ?? "");
        const entity_id = String(row.entity_id ?? "");
        const score = Number(row.score ?? 0);
        if (!isPopularResourceKind(entity_type) || !entity_id || score <= 0) {
          return null;
        }
        return { entity_type, entity_id, score };
      })
      .filter((row): row is ScoreRow => row !== null);
  } catch {
    // RPC not applied yet — fall back to recent mix.
    return [];
  }
}

async function loadFallbackPools(
  client: Client,
  hubId: string | null | undefined,
  perKind: number,
): Promise<PopularHomeItem[]> {
  const [businesses, marketplace, services, lechu, transfers] =
    await Promise.all([
      searchBusinesses(client, { hubId: hubId ?? undefined }).then((rows) =>
        rows.slice(0, perKind),
      ),
      searchMarketplaceListings(client, {
        hubId: hubId ?? undefined,
        page: 1,
        pageSize: perKind,
      }).then((r) => r.listings),
      searchServiceListings(client, {
        hubId: hubId ?? undefined,
        page: 1,
        pageSize: perKind,
      }).then((r) => r.listings),
      searchLechuListings(client, {
        hubId: hubId ?? undefined,
        page: 1,
        pageSize: perKind,
      }).then((r) => r.listings),
      searchTransferListings(client, {
        hubId: hubId ?? undefined,
        page: 1,
        pageSize: perKind,
      }).then((r) => r.listings),
    ]);

  const pools: PopularHomeItem[][] = [
    businesses.map((business) => ({ kind: "business" as const, score: 0, business })),
    marketplace.map((listing) => ({
      kind: "marketplace" as const,
      score: 0,
      listing,
    })),
    services.map((listing) => ({ kind: "service" as const, score: 0, listing })),
    lechu.map((listing) => ({ kind: "lechu" as const, score: 0, listing })),
    transfers.map((listing) => ({
      kind: "transfer" as const,
      score: 0,
      listing,
    })),
  ];

  // Round-robin so the home feed is a true mix, not only businesses.
  const mixed: PopularHomeItem[] = [];
  const maxLen = Math.max(...pools.map((p) => p.length), 0);
  for (let i = 0; i < maxLen; i += 1) {
    for (const pool of pools) {
      if (pool[i]) mixed.push(pool[i]);
    }
  }
  return mixed;
}

async function hydrateScored(
  client: Client,
  scores: ScoreRow[],
  hubId: string | null | undefined,
): Promise<PopularHomeItem[]> {
  const { getBusinessById } = await import("@/lib/supabase/queries");
  const { stripBusinessContacts } = await import("@/lib/supabase/mappers");
  const { getListingById } = await import("@/lib/listings/queries");

  const resolved = await Promise.all(
    scores.map(async (row) => {
      const kind = row.entity_type as PopularResourceKind;
      if (kind === "business") {
        const full = await getBusinessById(client, row.entity_id);
        if (!full || !businessInHub(full, hubId)) return null;
        const business = stripBusinessContacts(full);
        return {
          kind,
          score: row.score,
          business,
        } satisfies PopularHomeItem;
      }

      const listing = await getListingById(client, row.entity_id).catch(
        () => null,
      );
      if (!listing || listing.status !== "active") return null;
      return { kind, score: row.score, listing } satisfies PopularHomeItem;
    }),
  );

  return resolved.filter((item): item is PopularHomeItem => item !== null);
}

/**
 * Home «Популярное» feed.
 * Prefers click-ranked entities; fills with a recent multi-catalog mix.
 */
export async function getPopularHomeResources(
  client: Client,
  opts: { hubId?: string | null; limit?: number; days?: number } = {},
): Promise<PopularHomeItem[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 6, 24));
  const days = opts.days ?? 14;
  const hubId = opts.hubId ?? null;

  const scores = await fetchScores(client, days, Math.max(limit * 4, 24));
  const ranked = scores.length > 0 ? await hydrateScored(client, scores, hubId) : [];

  const seen = new Set(
    ranked.map((item) =>
      item.kind === "business"
        ? `business:${item.business.id}`
        : `${item.kind}:${item.listing.id}`,
    ),
  );

  const out = [...ranked];
  if (out.length < limit) {
    const fallback = await loadFallbackPools(client, hubId, limit);
    for (const item of fallback) {
      const key =
        item.kind === "business"
          ? `business:${item.business.id}`
          : `${item.kind}:${item.listing.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= limit) break;
    }
  }

  return out.slice(0, limit);
}
