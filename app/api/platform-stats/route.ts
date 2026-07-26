import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { PlatformResourceStats } from "@/lib/platform/resource-stats";
import { normalizeSupabaseUrl } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(payload: Record<string, unknown> | null, key: string): number {
  return Number(payload?.[key] ?? 0);
}

function parseStats(raw: Record<string, unknown> | null): PlatformResourceStats {
  const payload =
    raw && typeof raw === "object" && "total" in raw
      ? raw
      : raw && typeof raw === "object" && "get_platform_resource_stats" in raw
        ? (raw.get_platform_resource_stats as Record<string, unknown>)
        : null;

  return {
    total: num(payload, "total"),
    businesses: num(payload, "businesses"),
    listings: num(payload, "listings"),
    offers: num(payload, "offers"),
    services: num(payload, "services"),
    transfers: num(payload, "transfers"),
    lechu: num(payload, "lechu"),
    reviews: num(payload, "reviews"),
    categories: num(payload, "categories"),
    members: num(payload, "members"),
    addedYesterday: num(payload, "added_yesterday"),
    addedToday: num(payload, "added_today"),
    updatedToday: num(payload, "updated_today"),
    membersToday: num(payload, "members_today"),
  };
}

export async function GET() {
  try {
    const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!url || !anonKey) {
      return NextResponse.json({ error: "missing env" }, { status: 500 });
    }

    const supabase = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc("get_platform_resource_stats");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      parseStats((data ?? null) as Record<string, unknown> | null),
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
