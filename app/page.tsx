import { HomeExperience } from "@/components/home/HomeExperience";
import { formatBrandHeadline } from "@/lib/brand";
import { getBrandLocationForProfile } from "@/lib/brand/location";
import {
  getHubResourceStats,
  type HubResourceStats,
} from "@/lib/platform/hub-resource-stats";
import { getPopularHomeResources } from "@/lib/platform/popular-resources";
import {
  DEFAULT_REGION_HUB,
  getSelectableRegionHubs,
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
  let initialHub = DEFAULT_REGION_HUB;
  let initialInLabel = DEFAULT_REGION_HUB.inLabel;
  let initialCountyGeoid: string | null = DEFAULT_REGION_HUB.countyGeoids[0] ?? null;
  let initialRegionStats: HubResourceStats | null = null;
  let initialPlatformStats: HubResourceStats | null = null;

  try {
    const client = await createServerClient();
    const catalog = createServiceRoleClient();
    const [userResult, pins] = await Promise.all([
      client.auth.getUser(),
      // Per-hub bounding boxes — national newest-800 left LA empty while counts showed ~300.
      getHomeMapPins(catalog, {
        hubs: getSelectableRegionHubs(),
        limitPerHub: 500,
      }).catch(() => [] as typeof mapPins),
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

    const [feed, regionStats, platformStats] = await Promise.all([
      getPopularHomeResources(catalog, {
        hubId: initialHub.id,
        limit: 6,
      }).catch(() => [] as typeof popularFeed),
      getHubResourceStats(initialHub.id).catch(() => null),
      getHubResourceStats(null).catch(() => null),
    ]);
    popularFeed = feed;
    initialRegionStats = regionStats;
    initialPlatformStats = platformStats;
  } catch (err) {
    error = err instanceof Error ? err.message : "Неизвестная ошибка";
  }

  return (
    <HomeExperience
      error={error}
      initialCountyGeoid={initialCountyGeoid}
      initialHub={initialHub}
      initialInLabel={initialInLabel}
      initialPlatformStats={initialPlatformStats}
      initialRegionStats={initialRegionStats}
      lockedFromProfile={lockedFromProfile}
      mapPins={mapPins}
      popularFeed={popularFeed}
    />
  );
}
