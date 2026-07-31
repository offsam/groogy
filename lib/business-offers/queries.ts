import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  BusinessOffer,
  BusinessOfferType,
} from "@/types/business-offer";
import { mapBusinessOffer } from "@/lib/business-offers/mappers";
import { signOfferMediaUrls } from "@/lib/business-offers/media";
import { normalizeRouteSlug } from "@/lib/routing/normalize-route-slug";

type Client = SupabaseClient<Database>;

const OFFER_SELECT = `
  id,
  business_id,
  offer_type,
  title,
  slug,
  short_description,
  description,
  category_id,
  subcategory_id,
  status,
  visibility,
  price_mode,
  price_amount,
  price_min,
  price_max,
  currency,
  price_unit,
  primary_image_url,
  sort_order,
  is_featured,
  is_available,
  attributes,
  published_at,
  created_at,
  updated_at,
  categories ( name )
` as const;

function escapeIlike(value: string): string {
  return value.replace(/[%_,]/g, "\\$&");
}

async function attachMedia(
  client: Client,
  offers: BusinessOffer[],
): Promise<BusinessOffer[]> {
  if (offers.length === 0) return offers;

  const ids = offers.map((o) => o.id);
  const { data, error } = await client
    .from("business_offer_media")
    .select("id, offer_id, storage_path, sort_order, alt_text")
    .in("offer_id", ids)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  const byOffer = new Map<string, typeof data>();
  for (const row of data ?? []) {
    const list = byOffer.get(row.offer_id) ?? [];
    list.push(row);
    byOffer.set(row.offer_id, list);
  }

  return Promise.all(
    offers.map(async (offer) => {
      const rows = byOffer.get(offer.id) ?? [];
      const media = await signOfferMediaUrls(
        client,
        rows.map((r) => ({
          id: r.id,
          offerId: r.offer_id,
          storagePath: r.storage_path,
          sortOrder: r.sort_order,
          altText: r.alt_text,
        })),
      );
      return { ...offer, media };
    }),
  );
}

export async function getPublicOffersForBusiness(
  client: Client,
  businessId: string,
  opts?: { businessSlug?: string | null; businessName?: string | null },
): Promise<BusinessOffer[]> {
  const { data, error } = await client
    .from("business_offers")
    .select(OFFER_SELECT)
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) throw error;
  const offers = (data ?? []).map((row) => {
    const mapped = mapBusinessOffer(row);
    return {
      ...mapped,
      businessSlug: opts?.businessSlug ?? mapped.businessSlug,
      businessName: opts?.businessName ?? mapped.businessName,
    };
  });
  return attachMedia(client, offers);
}

export async function getPublicOfferBySlug(
  client: Client,
  businessSlug: string,
  offerSlug: string,
): Promise<BusinessOffer | null> {
  const normalizedBusinessSlug = normalizeRouteSlug(businessSlug);
  const normalizedOfferSlug = normalizeRouteSlug(offerSlug);
  const { data: business, error: bizError } = await client
    .from("businesses")
    .select("id")
    .eq("slug", normalizedBusinessSlug)
    .eq("status", "approved")
    .maybeSingle();

  if (bizError) throw bizError;
  if (!business) return null;

  const { data, error } = await client
    .from("business_offers")
    .select(OFFER_SELECT)
    .eq("business_id", business.id)
    .eq("slug", normalizedOfferSlug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const [offer] = await attachMedia(client, [mapBusinessOffer(data)]);
  return offer ?? null;
}

export async function getOwnerOffersForBusiness(
  client: Client,
  businessId: string,
): Promise<BusinessOffer[]> {
  const { data, error } = await client
    .from("business_offers")
    .select(OFFER_SELECT)
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) throw error;
  const offers = (data ?? []).map((row) => mapBusinessOffer(row));
  return attachMedia(client, offers);
}

export async function getOwnerOfferById(
  client: Client,
  offerId: string,
): Promise<BusinessOffer | null> {
  const { data, error } = await client
    .from("business_offers")
    .select(OFFER_SELECT)
    .eq("id", offerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const [offer] = await attachMedia(client, [mapBusinessOffer(data)]);
  return offer ?? null;
}

export async function getSimilarOffers(
  client: Client,
  offer: BusinessOffer,
  limit = 4,
): Promise<BusinessOffer[]> {
  const { data, error } = await client
    .from("business_offers")
    .select(OFFER_SELECT)
    .eq("business_id", offer.businessId)
    .eq("offer_type", offer.offerType)
    .neq("id", offer.id)
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(limit);

  if (error) throw error;
  const offers = (data ?? []).map((row) => mapBusinessOffer(row));
  return attachMedia(client, offers);
}

export type OfferSearchParams = {
  query?: string;
  offerType?: BusinessOfferType | null;
  categoryId?: string | null;
  businessId?: string | null;
  city?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  availableOnly?: boolean;
};

export async function searchPublicOffers(
  client: Client,
  params: OfferSearchParams = {},
  limit = 50,
): Promise<BusinessOffer[]> {
  const query = params.query?.trim() ?? "";
  const city = params.city?.trim() ?? "";

  let request = client.from("business_offers_public").select("*");

  if (params.offerType) {
    request = request.eq("offer_type", params.offerType);
  }
  if (params.businessId) {
    request = request.eq("business_id", params.businessId);
  }
  if (params.availableOnly !== false) {
    request = request.eq("is_available", true);
  }
  if (query) {
    const pattern = `%${escapeIlike(query)}%`;
    request = request.or(
      `title.ilike.${pattern},short_description.ilike.${pattern}`,
    );
  }

  const { data, error } = await request
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(limit);

  if (error) throw error;

  let offers = (data ?? []).map((row) =>
    mapBusinessOffer({
      ...row,
      description: null,
      category_id: null,
      subcategory_id: null,
      status: "active",
      visibility: "public",
      created_at: row.published_at ?? new Date().toISOString(),
      updated_at: row.published_at ?? new Date().toISOString(),
      categories: null,
      businesses: { slug: row.business_slug, name: row.business_name },
    }),
  );

  const slugs = [
    ...new Set(offers.map((o) => o.businessSlug).filter(Boolean)),
  ] as string[];

  if (slugs.length > 0) {
    const { data: businesses } = await client
      .from("businesses")
      .select(
        "slug, city, website, instagram_url, google_maps_url, google_rating, google_reviews_count, latitude, longitude",
      )
      .in("slug", slugs);

    const bySlug = new Map((businesses ?? []).map((b) => [b.slug, b]));

    if (city) {
      const cityLower = city.toLowerCase();
      offers = offers.filter((o) => {
        if (!o.businessSlug) return false;
        const b = bySlug.get(o.businessSlug);
        return (b?.city ?? "").toLowerCase().includes(cityLower);
      });
    }

    offers = offers.map((o) => {
      if (!o.businessSlug) return o;
      const b = bySlug.get(o.businessSlug);
      if (!b) return o;
      return {
        ...o,
        presence: {
          website: b.website,
          instagramUrl: b.instagram_url,
          googleMapsUrl: b.google_maps_url,
          googleRating:
            b.google_rating == null ? null : Number(b.google_rating),
          googleReviewsCount: Number(b.google_reviews_count ?? 0),
          latitude: b.latitude,
          longitude: b.longitude,
        },
      };
    });
  }

  if (params.minPrice != null) {
    offers = offers.filter((o) => {
      const amount = o.priceAmount ?? o.priceMin;
      return amount == null || amount >= params.minPrice!;
    });
  }
  if (params.maxPrice != null) {
    offers = offers.filter((o) => {
      const amount = o.priceMax ?? o.priceAmount ?? o.priceMin;
      return amount == null || amount <= params.maxPrice!;
    });
  }

  return attachMedia(client, offers);
}

export async function getSitemapOfferSlugs(
  client: Client,
  limit = 500,
): Promise<{ businessSlug: string; offerSlug: string; updatedAt: string }[]> {
  const { data, error } = await client
    .from("business_offers_public")
    .select("business_slug, slug, published_at")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    businessSlug: row.business_slug,
    offerSlug: row.slug,
    updatedAt: row.published_at ?? new Date().toISOString(),
  }));
}

export async function getBusinessIdBySlugForOwner(
  client: Client,
  slug: string,
): Promise<string | null> {
  const normalized = normalizeRouteSlug(slug);
  const { data, error } = await client
    .from("businesses")
    .select("id, status")
    .eq("slug", normalized)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}
