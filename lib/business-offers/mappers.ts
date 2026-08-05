import { sanitizePublicDescription } from "@/lib/content/sanitize-public-description";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
import type {
  BusinessOffer,
  BusinessOfferAttributes,
  BusinessOfferMedia,
  BusinessOfferPriceMode,
  BusinessOfferPriceUnit,
  BusinessOfferStatus,
  BusinessOfferType,
  BusinessOfferVisibility,
} from "@/types/business-offer";
import { OFFER_PRICE_UNIT_LABELS } from "@/types/business-offer";

type OfferRow = {
  id: string;
  business_id: string;
  offer_type: BusinessOfferType;
  title: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  status: BusinessOfferStatus;
  visibility: BusinessOfferVisibility;
  price_mode: BusinessOfferPriceMode;
  price_amount: number | null;
  price_min: number | null;
  price_max: number | null;
  currency: string;
  price_unit: string | null;
  primary_image_url: string | null;
  sort_order: number;
  is_featured: boolean;
  is_available: boolean;
  attributes: BusinessOfferAttributes;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  categories?: { name: string } | { name: string }[] | null;
  businesses?: { slug: string; name: string } | { slug: string; name: string }[] | null;
};

function relOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function mapBusinessOffer(
  row: OfferRow,
  media: BusinessOfferMedia[] = [],
): BusinessOffer {
  const category = relOne(row.categories);
  const business = relOne(row.businesses);

  return {
    id: row.id,
    businessId: row.business_id,
    businessSlug: business?.slug ?? null,
    businessName: business?.name ?? null,
    offerType: row.offer_type,
    title: row.title,
    slug: row.slug,
    shortDescription: redactContactsFromPublicText(row.short_description),
    description: redactContactsFromPublicText(
      sanitizePublicDescription(row.description),
    ),
    categoryId: row.category_id,
    categoryName: category?.name ?? null,
    subcategoryId: row.subcategory_id,
    status: row.status,
    visibility: row.visibility,
    priceMode: row.price_mode,
    priceAmount: row.price_amount,
    priceMin: row.price_min,
    priceMax: row.price_max,
    currency: row.currency,
    priceUnit: row.price_unit as BusinessOfferPriceUnit | null,
    primaryImageUrl: row.primary_image_url,
    sortOrder: row.sort_order,
    isFeatured: row.is_featured,
    isAvailable: row.is_available,
    attributes: row.attributes ?? {},
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    media,
  };
}

export function formatOfferPrice(
  offer: Pick<
    BusinessOffer,
    | "priceMode"
    | "priceAmount"
    | "priceMin"
    | "priceMax"
    | "currency"
    | "priceUnit"
  >,
): string {
  const currency = offer.currency || "USD";

  const fmt = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);

  const unitSuffix =
    offer.priceUnit && OFFER_PRICE_UNIT_LABELS[offer.priceUnit]
      ? ` ${OFFER_PRICE_UNIT_LABELS[offer.priceUnit]}`
      : "";

  switch (offer.priceMode as BusinessOfferPriceMode) {
    case "fixed":
      return offer.priceAmount != null
        ? `${fmt(offer.priceAmount)}${unitSuffix}`
        : "$уточняйте";
    case "from":
      return offer.priceAmount != null
        ? `от ${fmt(offer.priceAmount)}${unitSuffix}`
        : offer.priceMin != null
          ? `от ${fmt(offer.priceMin)}${unitSuffix}`
          : "$уточняйте";
    case "range": {
      const lo = offer.priceMin ?? offer.priceAmount;
      const hi = offer.priceMax;
      if (lo != null && hi != null) {
        return `${fmt(lo)}–${fmt(hi)}${unitSuffix}`;
      }
      return "$уточняйте";
    }
    case "on_request":
    case "contact":
      return "$уточняйте";
    case "free":
      return "Бесплатно";
    default:
      return "$уточняйте";
  }
}

export function offerCoverUrl(offer: BusinessOffer): string | null {
  return offer.media?.[0]?.publicUrl ?? offer.primaryImageUrl ?? null;
}

export function groupOffersByType(
  offers: BusinessOffer[],
): Partial<Record<BusinessOfferType, BusinessOffer[]>> {
  const groups: Partial<Record<BusinessOfferType, BusinessOffer[]>> = {};
  for (const offer of offers) {
    const list = groups[offer.offerType] ?? [];
    list.push(offer);
    groups[offer.offerType] = list;
  }
  return groups;
}
