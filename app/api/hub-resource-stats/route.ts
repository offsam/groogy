import { NextResponse } from "next/server";
import {
  catalogAggregateCacheControl,
  CATALOG_CACHE_TTL,
  CATALOG_CDN_SWR_COUNTS,
} from "@/lib/platform/catalog-cache";
import { getHubResourceStats } from "@/lib/platform/hub-resource-stats";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const hub = url.searchParams.get("hub")?.trim() ?? "";
    if (!hub) {
      return NextResponse.json({ error: "hub required" }, { status: 400 });
    }
    const since = url.searchParams.get("since")?.trim() || null;

    const stats = await getHubResourceStats(hub === "all" ? null : hub, {
      since,
    });
    return NextResponse.json(stats, {
      headers: {
        "Cache-Control": catalogAggregateCacheControl(
          CATALOG_CACHE_TTL.hubResourceStats,
          CATALOG_CDN_SWR_COUNTS,
        ),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
