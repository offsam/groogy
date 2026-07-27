import type { Metadata } from "next";
import { FullPlatformMapLoader } from "@/components/map/FullPlatformMapLoader";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAllMappableBusinesses } from "@/lib/supabase/queries";

export const metadata: Metadata = {
  title: "Карта — КРУГИ",
};

export const dynamic = "force-dynamic";

export default async function MapPage() {
  let businesses: Awaited<ReturnType<typeof getAllMappableBusinesses>> = [];

  try {
    const catalog = createServiceRoleClient();
    businesses = await getAllMappableBusinesses(catalog, 500);
  } catch {
    businesses = [];
  }

  return (
    <div className="home-fullwidth">
      <FullPlatformMapLoader businesses={businesses} />
    </div>
  );
}
