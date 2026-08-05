import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import {
  queryCityCenter,
  type CityCenter,
} from "@/lib/geo/city-center-query";

export type { CityCenter };

/**
 * City center for an area map when there is no street-level address.
 * Master geo data is granted to anon/authenticated only — service role gets 403.
 */
export async function getCityCenter(
  city: string | null | undefined,
  stateCode: string | null | undefined,
  opts?: { postalCode?: string | null; region?: string | null },
): Promise<CityCenter | null> {
  const { url, anonKey } = getPublicSupabaseEnv();
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return queryCityCenter(client, city, stateCode, opts);
}
