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
import { tryCreateServiceRoleClient } from "@/lib/supabase/service";
import {
  getHomeMapPins,
  getProfileById,
} from "@/lib/supabase/queries";

/** Auth still makes this dynamic per request; dropping force-dynamic restores
 * Data Cache for hub map pins / popular / stats under unstable_cache. */
export const revalidate = 60;

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
    // Pins / popular need service role (address + contacts). Counts work via *_public.
    const catalog = tryCreateServiceRoleClient() ?? client;
    const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    // Resolve auth/hub first so locked users only pay for one hub's pins.
    const userResult = await client.auth.getUser();
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

    const pinHubs = lockedFromProfile
      ? [initialHub].filter((h) => Boolean(h.mapBounds))
      : getMapPinRegionHubs();

    const [pins, feed, regionStats] = await Promise.all([
      pinHubs.length > 0
        ? withTimeout(
            getHomeMapPins(catalog, {
              hubs: pinHubs,
              limitPerHub: lockedFromProfile ? 200 : 120,
            }).catch(() => [] as typeof mapPins),
            lockedFromProfile ? 3500 : 4000,
            [] as typeof mapPins,
          )
        : Promise.resolve([] as typeof mapPins),
      getPopularHomeResources(catalog, {
        hubId: lockedFromProfile ? initialHub.id : null,
        limit: 6,
      }).catch(() => [] as typeof popularFeed),
      lockedFromProfile
        ? getHubResourceStats(initialHub.id).catch(() => null)
        : getHubResourceStats(null).catch(() => null),
    ]);
    mapPins = pins;
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
