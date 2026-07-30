import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAllHomeMapPins } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const catalog = createServiceRoleClient();
    const pins = await getAllHomeMapPins(catalog);
    return NextResponse.json(
      { pins },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
        },
      },
    );
  } catch {
    return NextResponse.json({ pins: [] });
  }
}
