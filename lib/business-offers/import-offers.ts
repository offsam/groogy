import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportedOffer } from "@/lib/professional/import-services";
import type { ParsedMenuItem } from "@/lib/business-offers/parse-menu-text";
import type { BusinessOfferType } from "@/types/business-offer";
import { ensureOffersCopyRu } from "@/lib/content/translate-copy-to-ru";

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

export function menuItemsToImportedOffers(
  items: ParsedMenuItem[],
): ImportedOffer[] {
  return items.map((item) => ({
    title: item.title,
    description: item.description,
    priceAmount: item.priceAmount,
    priceMode: item.priceAmount != null ? ("fixed" as const) : ("contact" as const),
    offerType: "menu_item" as const,
    menuSection: item.section,
  }));
}

export type AddMissingBusinessOffersOpts = {
  /** Default `service`. Menu imports pass `menu_item`. */
  offerType?: BusinessOfferType;
};

/** Insert offers a business does not have yet (dedupe by normalised title). */
export async function addMissingBusinessOffers(
  client: SupabaseClient,
  businessId: string,
  offers: ImportedOffer[],
  opts?: AddMissingBusinessOffersOpts,
): Promise<number> {
  if (!offers.length) return 0;
  const localized = await ensureOffersCopyRu(offers);
  const db = untyped(client);
  const defaultType: BusinessOfferType = opts?.offerType ?? "service";
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
  for (const offer of localized) {
    const key = offerKey(offer.title);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    sort += 10;
    const slugBase = key.replace(/\s+/g, "-").slice(0, 60) || `offer-${sort}`;
    const priceMode = offer.priceAmount ? offer.priceMode ?? "fixed" : "contact";
    const offerType: BusinessOfferType =
      offer.offerType === "menu_item" ? "menu_item" : defaultType;
    const attributes =
      offerType === "menu_item" && offer.menuSection
        ? { menu_section: offer.menuSection.slice(0, 80) }
        : {};
    const short =
      offerType === "menu_item" && offer.description?.trim()
        ? offer.description.trim().slice(0, 300)
        : offer.title.slice(0, 300);
    const { error } = await db.from("business_offers").insert({
      business_id: businessId,
      offer_type: offerType,
      title: offer.title.slice(0, 160),
      slug: `${slugBase}-${sort}`,
      short_description: short,
      description: offer.description?.trim().slice(0, 8000) || null,
      status: "active",
      visibility: "public",
      price_mode:
        priceMode === "from" ? "from" : priceMode === "fixed" ? "fixed" : "contact",
      price_amount: priceMode === "contact" ? null : offer.priceAmount,
      price_unit: offer.priceUnit?.trim() || null,
      currency: "USD",
      sort_order: sort,
      is_featured: false,
      is_available: true,
      attributes,
      published_at: new Date().toISOString(),
    });
    if (!error) added += 1;
  }
  return added;
}
