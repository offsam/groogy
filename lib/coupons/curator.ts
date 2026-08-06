import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createServiceRoleClient } from "@/lib/supabase/service";

type Client = SupabaseClient<Database>;

/** Mirrors userIsAdmin() in lib/reviews/queries.ts, same RPC pattern. */
export async function isCouponCurator(client: Client): Promise<boolean> {
  const { data, error } = await client.rpc("is_coupon_curator");
  if (error) throw error;
  return Boolean(data);
}

export async function getCouponCuratorDisplayName(
  profileId: string,
): Promise<string | null> {
  const catalog = createServiceRoleClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          maybeSingle: () => Promise<{
            data: { display_name: string | null } | null;
          }>;
        };
      };
    };
  };
  const { data } = await catalog
    .from("coupon_curators")
    .select("display_name")
    .eq("profile_id", profileId)
    .maybeSingle();
  return data?.display_name ?? null;
}
