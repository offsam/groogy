import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type PendingBusinessClaimItem = {
  claimId: string;
  businessId: string;
  name: string;
  slug: string;
  createdAt: string;
};

/** Pending ownership claims for the signed-in user (not yet approved). */
export async function listMyPendingBusinessClaims(
  client: Client,
  userId: string,
): Promise<PendingBusinessClaimItem[]> {
  const { data, error } = await client
    .from("business_claims")
    .select(
      "id, business_id, created_at, businesses ( id, name, slug, status )",
    )
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const out: PendingBusinessClaimItem[] = [];
  for (const row of data ?? []) {
    const bizRaw = row.businesses as
      | { id: string; name: string; slug: string; status: string }
      | { id: string; name: string; slug: string; status: string }[]
      | null;
    const biz = Array.isArray(bizRaw) ? bizRaw[0] : bizRaw;
    if (!biz) continue;
    out.push({
      claimId: row.id,
      businessId: biz.id,
      name: biz.name,
      slug: biz.slug,
      createdAt: row.created_at,
    });
  }
  return out;
}
