import { NextResponse } from "next/server";
import { getHubCategoryCounts } from "@/lib/platform/hub-category-counts";
import { getRegionHubById } from "@/lib/regions/hubs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hubId = getRegionHubById(searchParams.get("hub")).id;

  try {
    const counts = await getHubCategoryCounts(hubId);
    return NextResponse.json(counts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load counts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
