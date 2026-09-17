import { NextResponse } from "next/server";
import { getCachedAllHomeMapPins } from "@/lib/supabase/queries";

export const revalidate = 300;

export async function GET() {
  try {
    const pins = await getCachedAllHomeMapPins();
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
