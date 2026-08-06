import { HomeExperience } from "@/components/home/HomeExperience";
import { formatBrandHeadline } from "@/lib/brand";
import { getBrandLocationForProfile } from "@/lib/brand/location";
import {
  getHubResourceStats,
  type HubResourceStats,
} from "@/lib/platform/hub-resource-stats";
import { getPopularHomeResources } from "@/lib/platform/popular-resources";
import {
  USA_OVERVIEW_HUB,
  getMapPinRegionHubs,
  resolveRegionHub,
} from "@/lib/regions/hubs";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  getHomeMapPins,
  getProfileById,
} from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let popularFeed: Awaited<ReturnType<typeof getPopularHomeResources>> = [];
  let mapPins: Awaited<ReturnType<typeof getHomeMapPins>> = [];
  let error: string | null = null;
  let lockedFromProfile = false;
  // Guests without a saved/profile region start on the USA overview map.
  let initialHub = USA_OVERVIEW_HUB;
  let initialInLabel = USA_OVERVIEW_HUB.inLabel;
  let initialCountyGeoid: string | null = null;
  let initialRegionStats: HubResourceStats | null = null;

  try {
    const client = await createServerClient();
    const catalog = createServiceRoleClient();
    const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    const [userResult, pins] = await Promise.all([
      client.auth.getUser(),
      // Per-hub bounding boxes — national newest-800 left LA empty while counts showed ~300.
      // Capped at 150/hub (actual counts are ~300 nationally) to avoid the 15-way
      // fan-out (5 hubs x 3 tables) spiking memory/timeout on cache-miss requests.
      // Hard timeout so a slow Supabase response can't hang the whole homepage.
      withTimeout(
        getHomeMapPins(catalog, {
          hubs: getMapPinRegionHubs(),
          limitPerHub: 150,
        }).catch(() => [] as typeof mapPins),
        4000,
        [] as typeof mapPins,
      ),
    ]);

    mapPins = pins;

    const user = userResult.data.user;
    if (user) {
      const profile = await getProfileById(client, user.id);
      const brandLocation = await getBrandLocationForProfile(client, profile);
      if (brandLocation) {
        lockedFromProfile = true;
        const hub = resolveRegionHub({
          countyGeoid: brandLocation.countyGeoid,
          hubId: brandLocation.hub?.id,
        });
        initialHub = hub;
        initialInLabel = brandLocation.inLabel;
        initialCountyGeoid = brandLocation.countyGeoid;
        formatBrandHeadline(brandLocation);
      }
    }

    const [feed, regionStats] = await Promise.all([
      getPopularHomeResources(catalog, {
        hubId: lockedFromProfile ? initialHub.id : null,
        limit: 6,
      }).catch(() => [] as typeof popularFeed),
      lockedFromProfile
        ? getHubResourceStats(initialHub.id).catch(() => null)
        : getHubResourceStats(null).catch(() => null),
    ]);
    popularFeed = feed;
    initialRegionStats = regionStats;
  } catch (err) {
    error = err instanceof Error ? err.message : "Неизвестная ошибка";
  }

  return (
    <HomeExperience
      error={error}
      initialCountyGeoid={initialCountyGeoid}
      initialHub={initialHub}
      initialInLabel={initialInLabel}
      initialRegionStats={initialRegionStats}
      lockedFromProfile={lockedFromProfile}
      mapPins={mapPins}
      popularFeed={popularFeed}
    />
  );
}
