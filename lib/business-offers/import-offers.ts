import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportedOffer } from "@/lib/professional/import-services";

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

function offerKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Insert offers a business does not have yet (dedupe by normalised title). */
export async function addMissingBusinessOffers(
  client: SupabaseClient,
  businessId: string,
  offers: ImportedOffer[],
): Promise<number> {
  if (!offers.length) return 0;
  const db = untyped(client);
  const { data: existingRows } = await db
    .from("business_offers")
    .select("title, sort_order")
    .eq("business_id", businessId);
  const existing = (existingRows ?? []) as Array<{
    title: string | null;
    sort_order: number | null;
  }>;
  const taken = new Set(existing.map((row) => offerKey(row.title || "")));
  const nextSort = existing.reduce(
    (max, row) => Math.max(max, Number(row.sort_order ?? 0)),
    0,
  );
  let added = 0;
  let sort = nextSort;
  for (const offer of offers) {
    const key = offerKey(offer.title);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    sort += 10;
    const slugBase = key.replace(/\s+/g, "-").slice(0, 60) || `offer-${sort}`;
    const priceMode = offer.priceAmount ? offer.priceMode ?? "fixed" : "contact";
    const { error } = await db.from("business_offers").insert({
      business_id: businessId,
      offer_type: "service",
      title: offer.title.slice(0, 160),
      slug: `${slugBase}-${sort}`,
      short_description: offer.title.slice(0, 300),
      description: offer.description?.trim().slice(0, 8000) || null,
      status: "active",
      visibility: "public",
      price_mode:
        priceMode === "from" ? "from" : priceMode === "fixed" ? "fixed" : "contact",
      price_amount: priceMode === "contact" ? null : offer.priceAmount,
      currency: "USD",
      sort_order: sort,
      is_featured: false,
      is_available: true,
      attributes: {},
      published_at: new Date().toISOString(),
    });
    if (!error) added += 1;
  }
  return added;
}
