import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type CityCenter = { lat: number; lng: number };

/**
 * platform_cities.name keeps the Census suffix («Elgin city», «Elgin CDP»);
 * name_normalized is the suffix-free lowercase form we match against.
 */
function normalizeCityName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStateCode(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toUpperCase();
  if (/^US-[A-Z]{2}$/.test(value)) return value;
  if (/^[A-Z]{2}$/.test(value)) return `US-${value}`;
  return null;
}

/**
 * City center for an area map when there is no street-level address.
 * Master geo data is granted to anon/authenticated only — service role gets 403.
 */
export async function getCityCenter(
  city: string | null | undefined,
  stateCode: string | null | undefined,
): Promise<CityCenter | null> {
  const needle = normalizeCityName(city ?? "");
  if (!needle) return null;

  const { url, anonKey } = getPublicSupabaseEnv();
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = client
    .from("platform_cities")
    .select("latitude, longitude, state_code")
    .eq("is_active", true)
    .eq("name_normalized", needle)
    .limit(3);

  const state = normalizeStateCode(stateCode);
  if (state) query = query.eq("state_code", state);

  const { data, error } = await query;
  if (error) return null;

  const rows = data ?? [];
  // Without a state the same city name exists in many states — don't guess.
  if (rows.length !== 1) return null;

  const lat = Number(rows[0].latitude);
  const lng = Number(rows[0].longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
