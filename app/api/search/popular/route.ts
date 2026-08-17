import { NextResponse } from "next/server";
import { assertAiSearchRequestAllowed } from "@/lib/security/ai-search-guard";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type PopularRow = { query: string; hits: number };

function aggregateFromEvents(
  rows: Array<{ meta: Record<string, unknown> | null }>,
): PopularRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = String(row.meta?.q ?? "").trim().toLowerCase();
    if (raw.length < 2 || raw.length > 80) continue;
    if (/https?:\/\//i.test(raw) || /[0-9]{7,}/.test(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
    .slice(0, 50)
    .map(([query, hits]) => ({ query, hits }));
}

export async function GET(request: Request) {
  const originGate = assertAiSearchRequestAllowed(request);
  if (!originGate.ok) {
    return NextResponse.json(
      { error: originGate.error },
      { status: originGate.status },
    );
  }

  try {
    const catalog = createServiceRoleClient();
    const { data, error } = await catalog.rpc("get_popular_search_queries", {
      p_limit: 50,
    });
    if (!error && data) {
      const queries = data
        .map((row) => ({
          query: String(row.query ?? "").trim(),
          hits: Number(row.hits ?? 0),
        }))
        .filter((row) => row.query.length >= 2)
        .slice(0, 50);
      return NextResponse.json({ queries });
    }

    const { data: events } = await catalog
      .from("platform_events")
      .select("meta")
      .eq("event_type", "search")
      .limit(3000);
    return NextResponse.json({
      queries: aggregateFromEvents(events ?? []),
    });
  } catch {
    return NextResponse.json({ queries: [] });
  }
}

