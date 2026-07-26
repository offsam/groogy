import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

let browserClient: SupabaseClient<Database> | null = null;

/** Browser Supabase client (anon/publishable key only, cookie session via @supabase/ssr). */
export function createBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;
  const { url, anonKey } = getPublicSupabaseEnv();
  browserClient = createSupabaseBrowserClient<Database>(url, anonKey);
  return browserClient;
}
