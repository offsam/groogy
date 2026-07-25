/** FCC Census area lookup (lat/lng → county FIPS). Safe for server + route handlers. */

export type FccCountyResult = {
  countyGeoid: string;
  countyName: string | null;
  stateCode: string | null;
};

export async function resolveCountyFromLatLng(
  lat: number,
  lng: number,
): Promise<FccCountyResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  try {
    const url = new URL("https://geo.fcc.gov/api/census/area");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "json");
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{
        county_fips?: string;
        county_name?: string;
        state_code?: string;
      }>;
    };
    const row = data.results?.[0];
    const fips = row?.county_fips;
    if (!fips || !/^\d{5}$/.test(fips)) return null;
    return {
      countyGeoid: fips,
      countyName: row?.county_name ?? null,
      stateCode: row?.state_code ? `US-${row.state_code}` : null,
    };
  } catch {
    return null;
  }
}
