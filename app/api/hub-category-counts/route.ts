import { NextResponse } from "next/server";
import {
  catalogAggregateCacheControl,
  CATALOG_CACHE_TTL,
  CATALOG_CDN_SWR_COUNTS,
} from "@/lib/platform/catalog-cache";
import { getHubCategoryCounts } from "@/lib/platform/hub-category-counts";
import { getRegionHubById } from "@/lib/regions/hubs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hubId = getRegionHubById(searchParams.get("hub")).id;

  try {
    const counts = await getHubCategoryCounts(hubId);
    return NextResponse.json(counts, {
      headers: {
        "Cache-Control": catalogAggregateCacheControl(
          CATALOG_CACHE_TTL.hubCategoryCounts,
          CATALOG_CDN_SWR_COUNTS,
        ),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load counts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
