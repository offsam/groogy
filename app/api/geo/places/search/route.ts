import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CityHit = {
  kind: "city";
  geoid: string;
  name: string;
  stateCode: string;
  countyGeoid: string | null;
  label: string;
};

type CountyHit = {
  kind: "county";
  geoid: string;
  name: string;
  stateCode: string;
  label: string;
};

export type PlaceSearchHit = CityHit | CountyHit;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const state = searchParams.get("state") || null;
  if (q.length < 2) {
    return NextResponse.json({ results: [] as PlaceSearchHit[] });
  }

  const supabase = await createServerClient();
  const untyped = supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    from: (table: string) => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => Promise<{ data: unknown }>;
      };
    };
  };

  const [{ data: cities, error: cityErr }, { data: counties, error: countyErr }] =
    await Promise.all([
      untyped.rpc("search_platform_cities", {
        p_query: q,
        p_state_code: state,
        p_limit: 8,
      }),
      untyped.rpc("search_platform_counties", {
        p_query: q,
        p_state_code: state,
        p_limit: 6,
      }),
    ]);

  if (cityErr || countyErr) {
    return NextResponse.json(
      { error: cityErr?.message || countyErr?.message || "search failed" },
      { status: 500 },
    );
  }

  const cityRows = (cities ?? []) as Array<{
    geoid: string;
    name: string;
    state_code: string;
    primary_county_geoid?: string | null;
  }>;
  const countyRows = (counties ?? []) as Array<{
    geoid: string;
    name: string;
    state_code: string;
  }>;

  // search_platform_cities may not return primary_county_geoid — look up.
  const cityGeoids = cityRows.map((c) => c.geoid);
  let countyByCity = new Map<string, string | null>();
  if (cityGeoids.length > 0) {
    const { data: cityMeta } = await (
      supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            in: (
              col: string,
              vals: string[],
            ) => Promise<{
              data: Array<{
                geoid: string;
                primary_county_geoid: string | null;
              }> | null;
            }>;
          };
        };
      }
    )
      .from("platform_cities")
      .select("geoid, primary_county_geoid")
      .in("geoid", cityGeoids);
    for (const row of cityMeta ?? []) {
      countyByCity.set(row.geoid, row.primary_county_geoid);
    }
  }

  const results: PlaceSearchHit[] = [
    ...countyRows.map((c) => ({
      kind: "county" as const,
      geoid: c.geoid,
      name: c.name,
      stateCode: c.state_code,
      label: `${c.name}, ${c.state_code.replace(/^US-/, "")}`,
    })),
    ...cityRows.map((c) => ({
      kind: "city" as const,
      geoid: c.geoid,
      name: c.name,
      stateCode: c.state_code,
      countyGeoid: countyByCity.get(c.geoid) ?? c.primary_county_geoid ?? null,
      label: `${c.name}, ${c.state_code.replace(/^US-/, "")}`,
    })),
  ];

  return NextResponse.json({ results });
}
