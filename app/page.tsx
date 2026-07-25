import { HomeExperience } from "@/components/home/HomeExperience";
import { formatBrandHeadline } from "@/lib/brand";
import { getBrandLocationForProfile } from "@/lib/brand/location";
import { getHubCategoryCounts } from "@/lib/platform/hub-category-counts";
import { getPopularHomeResources } from "@/lib/platform/popular-resources";
import {
  DEFAULT_REGION_HUB,
  resolveRegionHub,
} from "@/lib/regions/hubs";
import { createServerClient } from "@/lib/supabase/server";
import {
  getHomeActivityBusinesses,
  getProfileById,
} from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let popularFeed: Awaited<ReturnType<typeof getPopularHomeResources>> = [];
  let activityNewest: Awaited<
    ReturnType<typeof getHomeActivityBusinesses>
  >["newest"] = [];
  let activityPopular: Awaited<
    ReturnType<typeof getHomeActivityBusinesses>
  >["popular"] = [];
  let error: string | null = null;
  let lockedFromProfile = false;
  let initialHub = DEFAULT_REGION_HUB;
  let initialInLabel = DEFAULT_REGION_HUB.inLabel;
  let initialCountyGeoid: string | null = DEFAULT_REGION_HUB.countyGeoids[0] ?? null;
  let initialSectionCounts: Awaited<
    ReturnType<typeof getHubCategoryCounts>
  > | null = null;

  try {
    const client = await createServerClient();
    const [userResult, activity] = await Promise.all([
      client.auth.getUser(),
      getHomeActivityBusinesses(client, 40).catch(() => ({
        newest: [],
        popular: [],
      })),
    ]);

    activityNewest = activity.newest;
    activityPopular = activity.popular;

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

    const [feed, counts] = await Promise.all([
      getPopularHomeResources(client, {
        hubId: initialHub.id,
        limit: 6,
      }).catch(() => [] as typeof popularFeed),
      getHubCategoryCounts(initialHub.id).catch(() => null),
    ]);
    popularFeed = feed;
    initialSectionCounts = counts;
  } catch (err) {
    error = err instanceof Error ? err.message : "Неизвестная ошибка";
  }

  return (
    <HomeExperience
      error={error}
      initialCountyGeoid={initialCountyGeoid}
      initialHub={initialHub}
      initialInLabel={initialInLabel}
      initialSectionCounts={initialSectionCounts}
      lockedFromProfile={lockedFromProfile}
      newest={activityNewest}
      popular={activityPopular}
      popularFeed={popularFeed}
    />
  );
}
