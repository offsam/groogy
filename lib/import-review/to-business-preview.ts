import type { Business } from "@/types/business";
import type { BusinessOffer } from "@/types/business-offer";
import type { Professional } from "@/types/professional";
import type { ImportReviewItem } from "@/types/import-review";
import { computePresenceFlags } from "@/lib/business/presence-flags";
import {
  importCategoryLabel,
  resolveImportDisplayName,
  sanitizeInstagramHandles,
} from "@/lib/import-review/display-name";

/** Fields enough to render a public BusinessCard / profile teaser. */
export type ImportReviewPreviewFields = {
  id: string;
  title?: string | null;
  business_name?: string | null;
  person_name?: string | null;
  description?: string | null;
  category?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string[] | null;
  email?: string[] | null;
  website?: string[] | null;
  instagram?: string[] | null;
  services?: string[] | null;
  price?: number | null;
  currency?: string | null;
  photos_count?: number | null;
  preview_image_url?: string | null;
  entity_type?: string | null;
  target_collection?: string | null;
  whatsapp?: string[] | null;
  telegram_username?: string | null;
  telegram_user_id?: string | null;
  source_author_username?: string | null;
  source_text?: string | null;
  source_url?: string | null;
  source?: string | null;
};

function first(values: string[] | null | undefined): string | null {
  const v = (values ?? []).map((s) => s.trim()).find(Boolean);
  return v || null;
}

function asHttpUrl(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("@")) return `https://www.instagram.com/${t.slice(1)}`;
  if (/instagram\.com/i.test(t)) return t.startsWith("http") ? t : `https://${t}`;
  return `https://${t}`;
}

function shortFrom(description: string | null, services: string[]): string | null {
  if (description?.trim()) {
    const line = description.trim().split(/\n+/)[0]?.trim() ?? "";
    return line.slice(0, 160) || null;
  }
  if (services.length) return services.slice(0, 3).join(" · ");
  return null;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "service"
  );
}

/** Map an import-review row (or live form) → public Business for card preview. */
export function importReviewToBusinessPreview(
  item: ImportReviewPreviewFields,
): Business {
  const resolved = resolveImportDisplayName(item);
  const name = resolved.name;
  const description = item.description?.trim() || null;
  const services = item.services ?? [];
  const website = asHttpUrl(
    first(
      (item.website ?? []).filter(
        (w) => !/facebook\.com|fb\.com|instagram\.com/i.test(w),
      ),
    ),
  );
  const igHandle = sanitizeInstagramHandles(item.instagram)[0] ?? null;
  const instagram = asHttpUrl(igHandle);
  const phone = first(item.phone);
  const email = first(item.email);
  const categoryLabel = importCategoryLabel(item.category);
  const imageUrl = item.preview_image_url?.trim() || null;
  const presenceFlags = computePresenceFlags({
    phone,
    email,
    website,
    instagramUrl: instagram,
    telegramUrl: null,
    sourceUrl: item.source_url?.trim() || null,
    sourceKind: item.source_url?.trim()
      ? item.source?.toLowerCase().startsWith("facebook")
        ? "facebook"
        : "telegram"
      : null,
    yelpUrl: null,
    googleMapsUrl: null,
  });

  return {
    id: item.id,
    slug: `preview-${item.id.slice(0, 8)}`,
    name,
    categoryId: null,
    categorySlug: item.category?.trim() || null,
    categoryName: categoryLabel,
    shortDescription: shortFrom(description, services),
    description,
    ratingAvg: 0,
    reviewsCount: 0,
    aiVerifiedReviewsCount: 0,
    transactionVerifiedReviewsCount: 0,
    phone,
    email,
    website,
    instagramUrl: instagram,
    telegramUrl: null,
    sourceUrl: item.source_url?.trim() || null,
    sourceKind: item.source_url?.trim()
      ? item.source?.toLowerCase().startsWith("facebook")
        ? "facebook"
        : "telegram"
      : null,
    yelpUrl: null,
    yelpRating: null,
    yelpReviewsCount: 0,
    instagramFollowersCount: null,
    googleMapsUrl: null,
    googleRating: null,
    googleReviewsCount: 0,
    bookingUrl: null,
    imageUrl,
    addressLine: null,
    city: item.city?.trim() || null,
    region: item.state?.trim() || null,
    latitude: null,
    longitude: null,
    locationPrecision: null,
    openingHours: null,
    createdAt: null,
    presenceFlags,
  };
}

/** Map an import-review row → public Professional for card / profile preview. */
export function importReviewToProfessionalPreview(
  item: ImportReviewPreviewFields,
): Professional {
  const resolved = resolveImportDisplayName(item);
  const name = resolved.name;
  const description = item.description?.trim() || null;
  const services = item.services ?? [];
  const website = asHttpUrl(
    first(
      (item.website ?? []).filter(
        (w) => !/facebook\.com|fb\.com|instagram\.com/i.test(w),
      ),
    ),
  );
  const igHandle = sanitizeInstagramHandles(item.instagram)[0] ?? null;
  const instagram = asHttpUrl(igHandle);
  const phone = first(item.phone);
  const email = first(item.email);
  const categoryLabel = importCategoryLabel(item.category);
  const imageUrl = item.preview_image_url?.trim() || null;
  const tg =
    item.telegram_username?.trim()
      ? `https://t.me/${item.telegram_username.replace(/^@/, "")}`
      : null;

  return {
    id: item.id,
    slug: `preview-${item.id.slice(0, 8)}`,
    displayName: name,
    headline: categoryLabel || shortFrom(description, services),
    shortDescription: shortFrom(description, services),
    description,
    imageUrl,
    status: "pending",
    experienceYears: null,
    languages: ["ru"],
    availabilityText: null,
    ratingAvg: 0,
    reviewsCount: 0,
    city: item.city?.trim() || null,
    region: item.state?.trim() || null,
    stateCode: item.state?.trim() || null,
    postalCode: null,
    latitude: null,
    longitude: null,
    serviceAreaText: [item.city, item.state].filter(Boolean).join(", ") || null,
    publishedAt: null,
    createdAt: null,
    categoryId: null,
    categorySlug: item.category?.trim() || null,
    categoryName: categoryLabel,
    presenceFlags: {
      hasPhone: Boolean(phone),
      hasEmail: Boolean(email),
      hasWebsite: Boolean(website),
      hasInstagram: Boolean(instagram),
      hasTelegram: Boolean(tg),
      hasSource: Boolean(item.source_url?.trim()),
    },
    phone,
    email,
    website,
    instagramUrl: instagram,
    telegramUrl: tg,
    sourceUrl: item.source_url?.trim() || null,
    sourceKind: item.source_url?.trim()
      ? item.source?.toLowerCase().startsWith("facebook")
        ? "facebook"
        : "telegram"
      : null,
    servicePreviewTitles: services.slice(0, 3),
    serviceCount: services.length || undefined,
  };
}

/** Preview offers from services list (+ optional single price on first). */
export function importReviewToOfferPreviews(
  item: ImportReviewPreviewFields,
): BusinessOffer[] {
  const services = (item.services ?? []).map((s) => s.trim()).filter(Boolean);
  const now = new Date().toISOString();
  const list = services.length > 0 ? services.slice(0, 12) : [];
  const resolved = resolveImportDisplayName(item);
  return list.map((title, index) => ({
    id: `preview-offer-${item.id}-${index}`,
    businessId: item.id,
    businessSlug: `preview-${item.id.slice(0, 8)}`,
    businessName: resolved.name,
    offerType: "service" as const,
    title,
    slug: slugify(title),
    shortDescription: title,
    description: null,
    categoryId: null,
    categoryName: importCategoryLabel(item.category),
    subcategoryId: null,
    status: "active" as const,
    visibility: "public" as const,
    priceMode:
      index === 0 && item.price != null ? ("from" as const) : ("contact" as const),
    priceAmount: index === 0 && item.price != null ? Number(item.price) : null,
    priceMin: null,
    priceMax: null,
    currency: item.currency || "USD",
    priceUnit: "service",
    primaryImageUrl: null,
    sortOrder: index * 10,
    isFeatured: index === 0,
    isAvailable: true,
    attributes: {},
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    media: [],
  }));
}

export function importReviewItemToPreviewFields(
  item: ImportReviewItem,
): ImportReviewPreviewFields {
  return {
    id: item.id,
    title: item.title,
    business_name: item.business_name,
    person_name: item.person_name,
    description: item.description || item.source_text,
    category: item.category,
    city: item.city,
    state: item.state,
    phone: item.phone,
    email: item.email,
    website: item.website,
    instagram: item.instagram,
    services: item.services,
    price: item.price,
    currency: item.currency,
    photos_count: item.photos_count,
    preview_image_url: item.preview_image_url,
    entity_type: item.entity_type,
    target_collection: item.target_collection,
    whatsapp: item.whatsapp,
    telegram_username: item.telegram_username,
    telegram_user_id: item.telegram_user_id,
    source_author_username: item.source_author_username,
    source_text: item.source_text,
    source_url: item.source_url,
    source: item.source,
  };
}
