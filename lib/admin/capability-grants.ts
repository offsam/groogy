import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isAdminCapabilityId,
  type AdminCapabilityId,
} from "@/lib/admin/capabilities";
import type { Database } from "@/types/database";

export type AdminGrantMap = Record<string, AdminCapabilityId[]>;

export async function loadAdminCapabilityGrants(
  client: SupabaseClient<Database> | SupabaseClient,
): Promise<AdminGrantMap | null> {
  const { data, error } = await (client as SupabaseClient)
    .from("admin_capability_grants")
    .select("user_id, capabilities");
  if (error) return null;
  const map: AdminGrantMap = {};
  for (const row of (data ?? []) as Array<{
    user_id?: string;
    capabilities?: unknown;
  }>) {
    const userId = String(row.user_id ?? "");
    const raw = Array.isArray(row.capabilities) ? row.capabilities : [];
    if (!userId) continue;
    map[userId] = raw.filter(
      (item: unknown): item is AdminCapabilityId =>
        typeof item === "string" && isAdminCapabilityId(item),
    );
  }
  return map;
}
