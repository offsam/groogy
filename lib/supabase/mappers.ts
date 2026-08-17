import { sanitizePublicDescription } from "@/lib/content/sanitize-public-description";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
import {
  formatStructuredAddressLine,
  normalizeStructuredAddress,
  resolvePublicCityPostal,
} from "@/lib/address/normalize";
import { parseOpeningHours } from "@/lib/business/opening-hours";
import { parseContactLinks } from "@/lib/contacts/channels";
import { parseGalleryUrls } from "@/lib/business/media";
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
  | "facebookUrl"
  | "tiktokUrl"
  | "yelpUrl"
  | "trustpilotUrl"
  | "googleMapsUrl"
  | "addressLine"
  | "contactLinks"
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
    descriptionOriginal: redactContactsFromPublicText(
      (row as { description_original?: string | null }).description_original ??
        null,
    ),
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
    trustpilotRating:
      (row as { trustpilot_rating?: number | null }).trustpilot_rating == null
        ? null
        : Number((row as { trustpilot_rating?: number | null }).trustpilot_rating),
    trustpilotReviewsCount: Number(
      (row as { trustpilot_reviews_count?: number | null })
        .trustpilot_reviews_count ?? 0,
    ),
    facebookRecommendPct:
      (row as { facebook_recommend_pct?: number | null })
        .facebook_recommend_pct == null
        ? null
        : Number(
            (row as { facebook_recommend_pct?: number | null })
              .facebook_recommend_pct,
          ),
    facebookReviewsCount: Number(
      (row as { facebook_reviews_count?: number | null })
        .facebook_reviews_count ?? 0,
    ),
    instagramFollowersCount:
      row.instagram_followers_count == null
        ? null
        : Number(row.instagram_followers_count),
    bookingUrl: row.booking_url?.trim() || null,
    paymentMethods: Array.isArray(
      (row as BusinessWithCategory & { payment_methods?: string[] | null })
        .payment_methods,
    )
      ? (
          row as BusinessWithCategory & { payment_methods?: string[] | null }
        ).payment_methods!.filter(Boolean)
      : [],
    imageUrl: row.image_url || PLACEHOLDER_IMAGE,
    galleryUrls: parseGalleryUrls(
      (row as BusinessWithCategory & { gallery_urls?: unknown }).gallery_urls,
    ),
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
    thirdPartyMentionCount:
      (row as { third_party_mention_count?: number | null })
        .third_party_mention_count == null
        ? null
        : Number(
            (row as { third_party_mention_count?: number | null })
              .third_party_mention_count,
          ),
    selfAdMentionCount:
      (row as { self_ad_mention_count?: number | null }).self_ad_mention_count ==
      null
        ? null
        : Number(
            (row as { self_ad_mention_count?: number | null })
              .self_ad_mention_count,
          ),
  };
}

/** Full business including contacts — owners, admins, contacts API. */
export function mapBusinessDetail(row: BusinessWithCategory): Business {
  const flags = computePresenceFlags(row);
  const address = normalizeStructuredAddress({
    addressLine: row.address_line,
    city: row.city,
    region: row.region,
    stateCode: row.state_code,
    postalCode: row.postal_code,
    businessName: row.name,
  });
  return {
    ...baseBusiness(row, flags),
    phone: row.phone,
    email: row.email ?? null,
    website: row.website,
    instagramUrl: row.instagram_url ?? null,
    telegramUrl: row.telegram_url ?? null,
    sourceUrl: row.source_url ?? null,
    sourceKind: row.source_kind ?? null,
    facebookUrl: null,
    tiktokUrl: null,
    yelpUrl: row.yelp_url ?? null,
    trustpilotUrl:
      (row as { trustpilot_url?: string | null }).trustpilot_url ?? null,
    googleMapsUrl: row.google_maps_url ?? null,
    // Street only — city/ZIP already on the card via publicCityPostal.
    addressLine: address.addressLine,
    contactLinks: parseContactLinks(
      (row as { contact_links?: unknown }).contact_links,
    ),
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
    descriptionOriginal: redactContactsFromPublicText(
      base.descriptionOriginal ?? null,
    ),
    phone: null,
    email: null,
    website: null,
    instagramUrl: null,
    telegramUrl: null,
    sourceUrl: null,
    sourceKind: row.source_kind === "platform" ? "platform" : null,
    facebookUrl: null,
    tiktokUrl: null,
    yelpUrl: null,
    trustpilotUrl: null,
    googleMapsUrl: null,
    addressLine: null,
    contactLinks: [],
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
      contactLinks: business.contactLinks,
      latitude: business.latitude,
      longitude: business.longitude,
    });
  return {
    ...business,
    contactLinks: [],
    phone: null,
    email: null,
    website: null,
    instagramUrl: null,
    telegramUrl: null,
    sourceUrl: null,
    // Platform provenance is public (КРУГИ).
    sourceKind: business.sourceKind === "platform" ? "platform" : null,
    facebookUrl: null,
    tiktokUrl: null,
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
