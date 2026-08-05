import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { reconcileStateCode } from "@/lib/geo/us-zip-state";

export type CityCenter = { lat: number; lng: number };

/**
 * platform_cities.name keeps the Census suffix («Elgin city», «Elgin CDP»);
 * name_normalized is the suffix-free lowercase form we match against.
 */
export function normalizeCityName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeStateCode(
  raw: string | null | undefined,
): string | null {
  const value = (raw ?? "").trim().toUpperCase();
  if (/^US-[A-Z]{2}$/.test(value)) return value;
  if (/^[A-Z]{2}$/.test(value)) return `US-${value}`;
  return null;
}

export type CityCenterLookupOpts = {
  postalCode?: string | null;
  region?: string | null;
};

/**
 * City center for an area map when there is no street-level pin.
 * Works with anon or server clients (platform_cities is public-readable).
 *
 * When a hub-default state (often US-CA) disagrees with ZIP/region, ZIP wins
 * so «Miami + US-CA + 33138» still finds Florida Miami instead of blank map.
 */
export async function queryCityCenter(
  client: SupabaseClient<Database>,
  city: string | null | undefined,
  stateCode: string | null | undefined,
  opts?: CityCenterLookupOpts,
): Promise<CityCenter | null> {
  const needle = normalizeCityName(city ?? "");
  if (!needle) return null;

  const reconciled = reconcileStateCode({
    stateCode,
    postalCode: opts?.postalCode,
    region: opts?.region,
    city,
  });
  const statesToTry = uniqueStates([
    reconciled,
    normalizeStateCode(stateCode),
    null,
  ]);

  for (const state of statesToTry) {
    const hit = await lookupCityCenter(client, needle, state);
    if (hit) return hit;
  }
  return null;
}

function uniqueStates(
  values: Array<string | null | undefined>,
): Array<string | null> {
  const out: Array<string | null> = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value ?? null);
  }
  return out;
}

async function lookupCityCenter(
  client: SupabaseClient<Database>,
  needle: string,
  state: string | null,
): Promise<CityCenter | null> {
  let query = client
    .from("platform_cities")
    .select("latitude, longitude, state_code")
    .eq("is_active", true)
    .eq("name_normalized", needle)
    .limit(5);

  if (state) query = query.eq("state_code", state);

  const { data, error } = await query;
  if (error) return null;

  const rows = data ?? [];
  // Without a state the same city name exists in many states — don't guess
  // unless exactly one row (rare) or we already filtered by reconciled state.
  if (!state && rows.length !== 1) return null;
  if (state && rows.length === 0) return null;

  const row = rows[0];
  if (!row) return null;
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
