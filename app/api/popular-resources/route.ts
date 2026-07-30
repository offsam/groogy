import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getPopularHomeResources } from "@/lib/platform/popular-resources";

export const dynamic = "force-dynamic";

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
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
