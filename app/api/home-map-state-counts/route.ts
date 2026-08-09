import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getHomeMapStateCounts } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

/**
 * Tiny nationwide pin-count-per-state payload — used to paint the guest
 * USA-overview map's cluster bubbles instantly, ahead of the much heavier
 * /api/home-map-pins full-detail fetch.
 */
export async function GET() {
  try {
    const catalog = createServiceRoleClient();
    const counts = await getHomeMapStateCounts(catalog);
    return NextResponse.json(
      { counts },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
        },
      },
    );
  } catch {
    return NextResponse.json({ counts: [] });
  }
}
