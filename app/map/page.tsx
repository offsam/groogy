import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { FullPlatformMapLoader } from "@/components/map/FullPlatformMapLoader";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAllMappableBusinesses } from "@/lib/supabase/queries";

export const metadata: Metadata = {
  title: "Карта — КРУГИ",
};

export const revalidate = 300;

const getCachedMappableBusinesses = unstable_cache(
  async () => {
    const catalog = createServiceRoleClient();
    return getAllMappableBusinesses(catalog, 500);
  },
  ["platform-map-businesses-v1"],
  { revalidate: 300, tags: ["platform-map-businesses"] },
);

export default async function MapPage() {
  let businesses: Awaited<ReturnType<typeof getAllMappableBusinesses>> = [];

  try {
    businesses = await getCachedMappableBusinesses();
  } catch {
    businesses = [];
  }

  return (
    <div className="home-fullwidth">
      <FullPlatformMapLoader businesses={businesses} />
    </div>
  );
}
