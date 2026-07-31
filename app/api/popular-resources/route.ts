import { NextResponse } from "next/server";
import {
  catalogAggregateCacheControl,
  CATALOG_CACHE_TTL,
} from "@/lib/platform/catalog-cache";
import { getPopularHomeResources } from "@/lib/platform/popular-resources";
import { createServiceRoleClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hub = searchParams.get("hub")?.trim() || null;
  const hubId = !hub || hub === "all" ? null : hub;

  try {
    const catalog = createServiceRoleClient();
    const items = await getPopularHomeResources(catalog, {
      hubId,
      limit: 6,
    });
    return NextResponse.json(
      { items },
      {
        headers: {
          "Cache-Control": catalogAggregateCacheControl(
            CATALOG_CACHE_TTL.popularHome,
          ),
        },
      },
    );
  } catch {
    return NextResponse.json({ items: [] });
  }
}
