import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeSupabaseUrl } from "@/lib/supabase/env";

/**
 * Service-role client for server-side catalog reads (bypasses RLS).
 * Never import in client components. Never expose this key as NEXT_PUBLIC_*.
 */
export function createServiceRoleClient(): SupabaseClient<Database> {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Не задан SUPABASE_SERVICE_ROLE_KEY или корректный NEXT_PUBLIC_SUPABASE_URL. " +
        "В Vercel → Settings → Environment Variables добавьте оба (service role — без NEXT_PUBLIC_). " +
        "После правки нужен Redeploy.",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
