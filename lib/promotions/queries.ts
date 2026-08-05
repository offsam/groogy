import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureTitleBodyRu } from "@/lib/content/translate-copy-to-ru";
import type {
  EntityPromotion,
  PromotionOwnerType,
  QueuePromotion,
} from "@/types/promotion";
import { isPromotionActive } from "@/lib/promotions/extract";

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

type PromotionRow = {
  id: string;
  owner_type: PromotionOwnerType;
  owner_id: string;
  title: string;
  body: string | null;
  discount_label: string | null;
  discount_percent: number | null;
  category_id: string | null;
  status: EntityPromotion["status"];
  valid_from: string | null;
  valid_until: string | null;
  sort_order: number;
  categories?: {
    id: string;
    name: string | null;
    slug: string | null;
  } | null;
};

function mapRow(
  row: PromotionRow,
  owner?: {
    name?: string | null;
    slug?: string | null;
    href?: string | null;
    imageUrl?: string | null;
  },
): EntityPromotion {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    title: row.title,
    body: row.body,
    discountLabel: row.discount_label,
    discountPercent:
      row.discount_percent == null ? null : Number(row.discount_percent),
    categoryId: row.category_id,
    categoryName: row.categories?.name ?? null,
    categorySlug: row.categories?.slug ?? null,
    status: row.status,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    sortOrder: row.sort_order,
    ownerName: owner?.name ?? null,
    ownerSlug: owner?.slug ?? null,
    ownerHref: owner?.href ?? null,
    ownerImageUrl: owner?.imageUrl ?? null,
  };
}

const SELECT =
  "id, owner_type, owner_id, title, body, discount_label, discount_percent, category_id, status, valid_from, valid_until, sort_order, categories(id, name, slug)";

/** Active promotions for one owner (profile section). */
export async function listOwnerPromotions(
  client: SupabaseClient,
  ownerType: PromotionOwnerType,
  ownerId: string,
): Promise<EntityPromotion[]> {
  const { data, error } = await untyped(client)
    .from("entity_promotions")
    .select(SELECT)
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .order("sort_order", { ascending: true })
    .limit(40);
  if (error || !data) return [];
  return (data as unknown as PromotionRow[])
    .map((row) => mapRow(row))
    .filter((p) => isPromotionActive(p));
}

/** Public feed of active promotions, optional category slug filter. */
export async function listPublicPromotions(
  client: SupabaseClient,
  opts?: { categorySlug?: string | null; limit?: number },
): Promise<EntityPromotion[]> {
  let query = untyped(client)
    .from("entity_promotions")
    .select(SELECT)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 60);

  if (opts?.categorySlug) {
    const { data: cat } = await client
      .from("categories")
      .select("id")
      .eq("slug", opts.categorySlug)
      .maybeSingle();
    if (cat?.id) {
      query = query.eq("category_id", cat.id);
    }
  }

  const { data, error } = await query;
  if (error || !data) return [];
  const rows = (data as unknown as PromotionRow[]).filter((row) =>
    isPromotionActive({
      valid_until: row.valid_until,
      status: row.status,
    }),
  );

  // Resolve owner display for business / professional only (MVP feed).
  const businessIds = rows
    .filter((r) => r.owner_type === "business")
    .map((r) => r.owner_id);
  const professionalIds = rows
    .filter((r) => r.owner_type === "professional")
    .map((r) => r.owner_id);

  const businessMap = new Map<
    string,
    { name: string; slug: string; imageUrl: string | null }
  >();
  const professionalMap = new Map<
    string,
    { name: string; slug: string; imageUrl: string | null }
  >();

  if (businessIds.length) {
    const { data: businesses } = await client
      .from("businesses")
      .select("id, name, slug, image_url")
      .in("id", businessIds)
      .eq("status", "approved");
    for (const b of businesses ?? []) {
      businessMap.set(b.id, {
        name: b.name,
        slug: b.slug,
        imageUrl: b.image_url,
      });
    }
  }
  if (professionalIds.length) {
    const { data: pros } = await untyped(client)
      .from("professionals")
      .select("id, display_name, slug, image_url")
      .in("id", professionalIds)
      .eq("status", "approved");
    for (const p of (pros ?? []) as Array<{
      id: string;
      display_name: string;
      slug: string;
      image_url: string | null;
    }>) {
      professionalMap.set(p.id, {
        name: p.display_name,
        slug: p.slug,
        imageUrl: p.image_url,
      });
    }
  }

  return rows
    .map((row) => {
      if (row.owner_type === "business") {
        const o = businessMap.get(row.owner_id);
        if (!o) return null;
        return mapRow(row, {
          name: o.name,
          slug: o.slug,
          href: `/business/${o.slug}`,
          imageUrl: o.imageUrl,
        });
      }
      if (row.owner_type === "professional") {
        const o = professionalMap.get(row.owner_id);
        if (!o) return null;
        return mapRow(row, {
          name: o.name,
          slug: o.slug,
          href: `/professional/${o.slug}`,
          imageUrl: o.imageUrl,
        });
      }
      return mapRow(row);
    })
    .filter((x): x is EntityPromotion => Boolean(x));
}

/** Insert missing promotions for an owner (dedupe by title). */
export async function addMissingEntityPromotions(
  client: SupabaseClient,
  ownerType: PromotionOwnerType,
  ownerId: string,
  promotions: QueuePromotion[],
  categoryId?: string | null,
): Promise<number> {
  if (!promotions.length) return 0;
  const db = untyped(client);
  const { data: existing } = await db
    .from("entity_promotions")
    .select("title")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId);
  const taken = new Set(
    ((existing ?? []) as Array<{ title: string }>).map((r) =>
      r.title.toLowerCase().trim(),
    ),
  );
  let added = 0;
  let sort = 0;
  for (const promo of promotions) {
    const localized = await ensureTitleBodyRu({
      title: (promo.title || "").trim(),
      body: promo.body,
    });
    const title = localized.title.slice(0, 160);
    if (!title) continue;
    const key = title.toLowerCase();
    if (taken.has(key)) continue;
    // Skip already-expired windows so we don't publish dead promos.
    if (
      promo.valid_until &&
      !isPromotionActive({ valid_until: promo.valid_until, status: "active" })
    ) {
      continue;
    }
    taken.add(key);
    sort += 10;
    const { error } = await db.from("entity_promotions").insert({
      owner_type: ownerType,
      owner_id: ownerId,
      title,
      body: localized.body?.trim().slice(0, 4000) || null,
      discount_label: promo.discount_label ?? null,
      discount_percent: promo.discount_percent ?? null,
      category_id: categoryId ?? null,
      status: "active",
      valid_from: promo.valid_from ?? null,
      valid_until: promo.valid_until ?? null,
      sort_order: sort,
    });
    if (!error) added += 1;
  }
  return added;
}
