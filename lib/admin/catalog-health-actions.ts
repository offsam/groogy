"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import {
  ALL_CATALOG_CACHE_TAGS,
  CATALOG_CACHE_TAGS,
  CATALOG_CACHE_TTL,
} from "@/lib/platform/catalog-cache";
import { getNationalSectionCounts } from "@/lib/platform/hub-category-counts";
import { getHubResourceStatsUncached } from "@/lib/platform/hub-resource-stats";
import { getPopularHomeResourcesUncached } from "@/lib/platform/popular-resources";
import { CALIFORNIA_LAUNCH_HUB_IDS, getMapPinRegionHubs } from "@/lib/regions/hubs";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getHomeMapPinsUncached } from "@/lib/supabase/queries";
import { userIsAdmin } from "@/lib/reviews/queries";

export type AdminActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

export type CatalogProbe = {
  id: string;
  label: string;
  ms: number;
  ok: boolean;
  detail?: string;
  error?: string;
};

export type CatalogHealthSnapshot = {
  probedAt: string;
  cache: {
    tags: typeof ALL_CATALOG_CACHE_TAGS;
    ttlSeconds: typeof CATALOG_CACHE_TTL;
  };
  counts: Awaited<ReturnType<typeof getNationalSectionCounts>>;
  probes: CatalogProbe[];
};

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Нужно войти в аккаунт." as const };
  }
  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    return { error: "Только для администраторов." as const };
  }
  return { error: null };
}

async function timeProbe(
  id: string,
  label: string,
  run: () => Promise<string | void>,
): Promise<CatalogProbe> {
  const started = Date.now();
  try {
    const detail = (await run()) ?? undefined;
    return {
      id,
      label,
      ms: Date.now() - started,
      ok: true,
      detail: detail || undefined,
    };
  } catch (err) {
    return {
      id,
      label,
      ms: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : "failed",
    };
  }
}

export async function revalidateCatalogAggregatesAction(): Promise<AdminActionResult> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, message: auth.error };

  for (const tag of ALL_CATALOG_CACHE_TAGS) {
    revalidateTag(tag);
  }
  revalidatePath("/");
  revalidatePath("/admin/system/health");
  return {
    ok: true,
    message: `Сброшен кэш: ${ALL_CATALOG_CACHE_TAGS.join(", ")}`,
  };
}

export async function probeCatalogHealthAction(): Promise<
  | { ok: true; snapshot: CatalogHealthSnapshot }
  | { ok: false; message: string }
> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, message: auth.error };

  let catalog;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Service role client недоступен",
    };
  }

  const sampleHub = CALIFORNIA_LAUNCH_HUB_IDS[0] ?? "los-angeles";

  const [counts, ...probes] = await Promise.all([
    getNationalSectionCounts().catch(() => ({
      businesses: 0,
      professionals: 0,
      marketplace: 0,
      jobs: 0,
      real_estate: 0,
      events: 0,
      vehicles: 0,
      lechu: 0,
      transfers: 0,
    })),
    timeProbe("hub-stats-all", "Hub stats (all)", async () => {
      const stats = await getHubResourceStatsUncached(null);
      return `total=${stats.total}, cards=${stats.cards.length}`;
    }),
    timeProbe(`hub-stats-${sampleHub}`, `Hub stats (${sampleHub})`, async () => {
      const stats = await getHubResourceStatsUncached(sampleHub);
      return `total=${stats.total}`;
    }),
    timeProbe("popular-home", "Popular home feed", async () => {
      const items = await getPopularHomeResourcesUncached(catalog, {
        hubId: null,
        limit: 6,
      });
      return `items=${items.length}`;
    }),
    timeProbe("home-map-pins", "Home map pins (launch hubs)", async () => {
      const pins = await getHomeMapPinsUncached(catalog, {
        hubs: getMapPinRegionHubs(),
        limitPerHub: 500,
      });
      return `pins=${pins.length}`;
    }),
  ]);

  return {
    ok: true,
    snapshot: {
      probedAt: new Date().toISOString(),
      cache: {
        tags: ALL_CATALOG_CACHE_TAGS,
        ttlSeconds: CATALOG_CACHE_TTL,
      },
      counts,
      probes,
    },
  };
}

/** Tag list for UI (no side effects). */
export async function getCatalogCacheMetaAction() {
  return {
    tags: ALL_CATALOG_CACHE_TAGS,
    ttlSeconds: CATALOG_CACHE_TTL,
    tagNames: CATALOG_CACHE_TAGS,
  };
}
