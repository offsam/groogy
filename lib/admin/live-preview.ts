import type { Business } from "@/types/business";
import type { Professional } from "@/types/professional";
import { computePresenceFlags } from "@/lib/business/presence-flags";

/** Map a live business → professional-shaped preview (admin section switch). */
export function liveBusinessToProfessionalPreview(
  business: Business,
): Professional {
  return {
    id: business.id,
    slug: business.slug,
    displayName: business.name,
    headline: business.categoryName || business.shortDescription,
    shortDescription: business.shortDescription,
    description: business.description,
    imageUrl: business.imageUrl,
    status: "approved",
    experienceYears: null,
    languages: ["ru"],
    availabilityText: null,
    ratingAvg: business.ratingAvg,
    reviewsCount: business.reviewsCount,
    city: business.city,
    region: business.region,
    stateCode: business.stateCode ?? null,
    postalCode: business.postalCode ?? null,
    latitude: business.latitude,
    longitude: business.longitude,
    serviceAreaText:
      [business.city, business.region || business.stateCode]
        .filter(Boolean)
        .join(", ") || null,
    publishedAt: business.createdAt ?? null,
    createdAt: business.createdAt ?? null,
    categoryId: business.categoryId,
    categorySlug: business.categorySlug,
    categoryName: business.categoryName,
    presenceFlags: {
      hasPhone: Boolean(business.phone?.trim()),
      hasEmail: Boolean(business.email?.trim()),
      hasWebsite: Boolean(business.website?.trim()),
      hasInstagram: Boolean(business.instagramUrl?.trim()),
      hasTelegram: Boolean(business.telegramUrl?.trim()),
      hasSource: Boolean(business.sourceUrl?.trim()),
    },
    phone: business.phone,
    email: business.email,
    website: business.website,
    instagramUrl: business.instagramUrl,
    telegramUrl: business.telegramUrl,
    contactLinks: business.contactLinks,
    sourceUrl: business.sourceUrl,
    sourceKind: business.sourceKind,
  };
}

/** Map a live professional → business-shaped preview (admin section switch). */
export function liveProfessionalToBusinessPreview(
  professional: Professional,
): Business {
  const phone = professional.phone;
  const email = professional.email;
  const website = professional.website;
  const instagramUrl = professional.instagramUrl;
  const telegramUrl = professional.telegramUrl;

  return {
    id: professional.id,
    slug: professional.slug,
    name: professional.displayName,
    shortDescription: professional.shortDescription || professional.headline,
    description: professional.description,
    imageUrl: professional.imageUrl,
    phone,
    email,
    website,
    addressLine: null,
    city: professional.city,
    region: professional.region,
    stateCode: professional.stateCode,
    postalCode: professional.postalCode,
    latitude: professional.latitude,
    longitude: professional.longitude,
    locationPrecision: professional.city ? "county" : null,
    googleMapsUrl: null,
    googleRating: null,
    googleReviewsCount: 0,
    facebookUrl: null,
    tiktokUrl: null,
    yelpUrl: null,
    yelpRating: null,
    yelpReviewsCount: 0,
    bookingUrl: null,
    instagramUrl,
    instagramFollowersCount: null,
    telegramUrl,
    contactLinks: professional.contactLinks,
    sourceUrl: professional.sourceUrl,
    sourceKind: professional.sourceKind,
    categoryId: professional.categoryId,
    categorySlug: professional.categorySlug,
    categoryName: professional.categoryName,
    openingHours: null,
    ratingAvg: professional.ratingAvg,
    reviewsCount: professional.reviewsCount,
    aiVerifiedReviewsCount: 0,
    transactionVerifiedReviewsCount: 0,
    createdAt: professional.createdAt,
    presenceFlags: computePresenceFlags({
      phone,
      email,
      website,
      instagramUrl,
      telegramUrl,
      sourceUrl: professional.sourceUrl,
      yelpUrl: null,
      googleMapsUrl: null,
      bookingUrl: null,
    }),
  };
}
