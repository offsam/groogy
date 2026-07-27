import { sanitizePublicDescription } from "@/lib/content/sanitize-public-description";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
import {
  formatStructuredAddressLine,
  normalizeStructuredAddress,
  resolvePublicCityPostal,
} from "@/lib/address/normalize";
import { parseOpeningHours } from "@/lib/business/opening-hours";
import {
  computePresenceFlags,
  type BusinessPresenceFlags,
} from "@/lib/business/presence-flags";
import type { Business, Category } from "@/types/business";
import type { BusinessWithCategory, CategoryRow } from "@/types/database";

const PLACEHOLDER_IMAGE = "/placeholder.svg";

export function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    icon: row.icon,
    sortOrder: row.sort_order,
  };
}

/**
 * Public city + ZIP for listing cards.
 * List payloads strip street address — so we resolve city/ZIP from
 * address_line / short / description here before the strip.
 */
function publicCityPostal(row: BusinessWithCategory): {
  city: string | null;
  postalCode: string | null;
} {
  return resolvePublicCityPostal({
    addressLine: row.address_line,
    city: row.city,
    region: row.region,
    stateCode: row.state_code,
    postalCode: row.postal_code,
    shortDescription: row.short_description,
    description: row.description,
    businessName: row.name,
  });
}

function baseBusiness(
  row: BusinessWithCategory,
  flags: BusinessPresenceFlags,
): Omit<
  Business,
  | "phone"
  | "email"
  | "website"
  | "instagramUrl"
  | "telegramUrl"
  | "sourceUrl"
  | "sourceKind"
  | "yelpUrl"
  | "googleMapsUrl"
  | "addressLine"
> {
  const { city, postalCode } = publicCityPostal(row);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    categoryId: row.category_id,
    categorySlug: row.categories?.slug ?? null,
    categoryName: row.categories?.name ?? null,
    shortDescription: row.short_description,
    description: sanitizePublicDescription(row.description),
    ratingAvg: Number(row.rating_avg),
    reviewsCount: row.reviews_count,
    aiVerifiedReviewsCount: Number(row.ai_verified_reviews_count ?? 0),
    transactionVerifiedReviewsCount: Number(
      row.transaction_verified_reviews_count ?? 0,
    ),
    googleRating:
      row.google_rating == null ? null : Number(row.google_rating),
    googleReviewsCount: Number(row.google_reviews_count ?? 0),
    yelpRating: row.yelp_rating == null ? null : Number(row.yelp_rating),
    yelpReviewsCount: Number(row.yelp_reviews_count ?? 0),
    instagramFollowersCount:
      row.instagram_followers_count == null
        ? null
        : Number(row.instagram_followers_count),
    bookingUrl: row.booking_url?.trim() || null,
    imageUrl: row.image_url || PLACEHOLDER_IMAGE,
    city,
    region: row.region,
    stateCode: row.state_code ?? null,
    postalCode,
    latitude: row.latitude,
    longitude: row.longitude,
    locationPrecision: row.location_precision ?? null,
    openingHours: parseOpeningHours(row.opening_hours),
    createdAt: row.created_at ?? null,
    presenceFlags: flags,
  };
}

/** Full business including contacts — owners, admins, contacts API. */
export function mapBusinessDetail(row: BusinessWithCategory): Business {
  const flags = computePresenceFlags(row);
  return {
    ...baseBusiness(row, flags),
    phone: row.phone,
    email: row.email ?? null,
    website: row.website,
    instagramUrl: row.instagram_url ?? null,
    telegramUrl: row.telegram_url ?? null,
    sourceUrl: row.source_url ?? null,
    sourceKind: row.source_kind ?? null,
    yelpUrl: row.yelp_url ?? null,
    googleMapsUrl: row.google_maps_url ?? null,
    addressLine: row.address_line,
  };
}

/**
 * Listing / search / home cards — contacts and street address stripped.
 * Presence flags remain so UI can show locked icon chips.
 */
export function mapBusinessList(row: BusinessWithCategory): Business {
  const flags = computePresenceFlags(row);
  const base = baseBusiness(row, flags);
  return {
    ...base,
    // Listings: never ship raw contact strings in copy or contact fields.
    shortDescription: redactContactsFromPublicText(base.shortDescription),
    description: redactContactsFromPublicText(base.description),
    phone: null,
    email: null,
    website: null,
    instagramUrl: null,
    telegramUrl: null,
    sourceUrl: null,
    sourceKind: row.source_kind === "platform" ? "platform" : null,
    yelpUrl: null,
    googleMapsUrl: null,
    addressLine: null,
  };
}

/** @deprecated Prefer mapBusinessDetail / mapBusinessList. Alias of detail. */
export function mapBusiness(row: BusinessWithCategory): Business {
  return mapBusinessDetail(row);
}

/** Strip gated contacts from an already-mapped business (guest profile SSR).
 * Street address stays — it is shown above the map on the public profile.
 */
export function stripBusinessContacts(business: Business): Business {
  const flags =
    business.presenceFlags ??
    computePresenceFlags({
      phone: business.phone,
      email: business.email,
      website: business.website,
      instagramUrl: business.instagramUrl,
      telegramUrl: business.telegramUrl,
      sourceUrl: business.sourceUrl,
      sourceKind: business.sourceKind,
      yelpUrl: business.yelpUrl,
      googleMapsUrl: business.googleMapsUrl,
      latitude: business.latitude,
      longitude: business.longitude,
    });
  return {
    ...business,
    phone: null,
    email: null,
    website: null,
    instagramUrl: null,
    telegramUrl: null,
    sourceUrl: null,
    // Platform provenance is public (КРУГИ).
    sourceKind: business.sourceKind === "platform" ? "platform" : null,
    yelpUrl: null,
    googleMapsUrl: null,
    // addressLine kept — public profile shows full address above the map.
    // Narrative only — phones/handles must not appear in description/HTML payload.
    shortDescription: redactContactsFromPublicText(business.shortDescription),
    description: redactContactsFromPublicText(
      sanitizePublicDescription(business.description),
    ),
    presenceFlags: flags,
  };
}

export function formatWebsiteHost(website: string | null): string {
  if (!website) return "";
  return website.replace(/^https?:\/\//, "");
}

export function formatAddress(business: Business): string {
  // City + ZIP; county only when there is no city (avoids «Sacramento, Orange County»).
  return formatStructuredAddressLine({
    addressLine: business.addressLine ?? null,
    city: business.city ?? null,
    region: business.region ?? null,
    stateCode: business.stateCode ?? null,
    postalCode: business.postalCode ?? null,
  });
}
