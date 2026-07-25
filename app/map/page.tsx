import type { Metadata } from "next";
import { FullPlatformMapLoader } from "@/components/map/FullPlatformMapLoader";
import { createServerClient } from "@/lib/supabase/server";
import { getAllMappableBusinesses } from "@/lib/supabase/queries";

export const metadata: Metadata = {
  title: "Карта — КРУГИ",
};

export const dynamic = "force-dynamic";

export default async function MapPage() {
  let businesses: Awaited<ReturnType<typeof getAllMappableBusinesses>> = [];

  try {
    const client = await createServerClient();
    businesses = await getAllMappableBusinesses(client, 500);
  } catch {
    businesses = [];
  }

  return (
    <div className="home-fullwidth">
      <FullPlatformMapLoader businesses={businesses} />
    </div>
  );
}
