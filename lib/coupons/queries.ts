import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Coupon, CouponComment, CouponSubmission } from "@/types/coupon";
import { mapCoupon, mapCouponComment, mapCouponSubmission } from "@/lib/coupons/mappers";
import { createServiceRoleClient } from "@/lib/supabase/service";

type Client = SupabaseClient<Database>;

const COUPON_SELECT = `
  id, curator_profile_id, curator_display_name, category_id, title, body,
  image_url, link_url, promo_code, status, source, published_at, created_at,
  categories ( name )
` as const;

export async function getPublishedCoupons(
  client: Client,
  opts?: { categoryId?: string | null; limit?: number },
): Promise<Coupon[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- select+join blows TS depth
  let q = (client as any)
    .from("coupons")
    .select(COUPON_SELECT)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(opts?.limit ?? 60);
  if (opts?.categoryId) q = q.eq("category_id", opts.categoryId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Parameters<typeof mapCoupon>[0][]).map(mapCoupon);
}

export async function getPublishedCouponById(
  client: Client,
  id: string,
): Promise<Coupon | null> {
  const { data, error } = await (
    client as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: string,
          ) => {
            eq: (
              c: string,
              v: string,
            ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
          };
        };
      };
    }
  )
    .from("coupons")
    .select(COUPON_SELECT)
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapCoupon(data as Parameters<typeof mapCoupon>[0]);
}

export async function getCommentsForCoupon(
  client: Client,
  couponId: string,
): Promise<CouponComment[]> {
  const { data, error } = await (
    client as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: string,
          ) => {
            eq: (
              c: string,
              v: string,
            ) => {
              order: (
                c: string,
                o: { ascending: boolean },
              ) => Promise<{ data: unknown[] | null; error: unknown }>;
            };
          };
        };
      };
    }
  )
    .from("coupon_comments")
    .select("id, coupon_id, profile_id, body, created_at, profiles ( display_name )")
    .eq("coupon_id", couponId)
    .eq("status", "visible")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Parameters<typeof mapCouponComment>[0][]).map(
    mapCouponComment,
  );
}

/** Curator-only — service role, app layer must have already checked isCouponCurator. */
export async function getPendingSubmissions(): Promise<CouponSubmission[]> {
  const catalog = createServiceRoleClient() as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string,
        ) => {
          order: (
            c: string,
            o: { ascending: boolean },
          ) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
  const { data, error } = await catalog
    .from("coupon_submissions")
    .select(
      "id, submitted_by_profile_id, title, body, image_url, link_url, status, reviewed_by, reviewed_at, review_note, resulting_coupon_id, created_at, profiles ( display_name )",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Parameters<typeof mapCouponSubmission>[0][]).map(
    mapCouponSubmission,
  );
}

/** Curator-only — her own posts, including archived. Service role. */
export async function getCouponsByCurator(
  curatorProfileId: string,
): Promise<Coupon[]> {
  const catalog = createServiceRoleClient() as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string,
        ) => {
          order: (
            c: string,
            o: { ascending: boolean },
          ) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
  const { data, error } = await catalog
    .from("coupons")
    .select(COUPON_SELECT)
    .eq("curator_profile_id", curatorProfileId)
    .order("published_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Parameters<typeof mapCoupon>[0][]).map(mapCoupon);
}

export async function getCouponCategories(): Promise<
  { id: string; name: string; slug: string }[]
> {
  const catalog = createServiceRoleClient() as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string,
        ) => {
          eq: (
            c: string,
            v: boolean,
          ) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => Promise<{ data: unknown[] | null; error: unknown }>;
          };
        };
      };
    };
  };
  const { data, error } = await catalog
    .from("categories")
    .select("id, name, slug")
    .eq("domain", "coupons")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as { id: string; name: string; slug: string }[];
}
