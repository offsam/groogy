import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getHomeMapStateCounts } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

/**
 * Catalog card counts per state / metro hub — used for home map bubbles.
 * Counts published cards, not only rows with coordinates.
 */
export async function GET() {
  try {
    const catalog = createServiceRoleClient();
    const data = await getHomeMapStateCounts(catalog);
    return NextResponse.json(
      { counts: data.states, hubs: data.hubs },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
        },
      },
    );
  } catch {
    return NextResponse.json({ counts: [], hubs: [] });
  }
}
