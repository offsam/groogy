import type { OpeningHours } from "@/lib/business/opening-hours";
import type { BusinessPresenceFlags } from "@/lib/business/presence-flags";

export type Category = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  sortOrder: number;
};

export type { BusinessPresenceFlags };

export type Business = {
  id: string;
  slug: string;
  name: string;
  categoryId: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  shortDescription: string | null;
  description: string | null;
  ratingAvg: number;
  reviewsCount: number;
  aiVerifiedReviewsCount: number;
  transactionVerifiedReviewsCount: number;
  /** Platform likes on the business card. */
  likesCount: number;
  /** Platform subscribers/followers on the business card. */
  followersCount: number;
  /** Null on list/public payloads — contacts load after auth via API. */
  phone: string | null;
  email: string | null;
  website: string | null;
  instagramUrl: string | null;
  /** Telegram channel / username contact — gated via contacts reveal. */
  telegramUrl: string | null;
  /** Original post / import provenance — gated via contacts reveal. */
  sourceUrl: string | null;
  sourceKind: "telegram" | "facebook" | "platform" | null;
  yelpUrl: string | null;
  /** Public listing metric — Yelp stars when known. */
  yelpRating: number | null;
  yelpReviewsCount: number;
  /** Public listing metric — IG followers when known. */
  instagramFollowersCount: number | null;
  googleMapsUrl: string | null;
  googleRating: number | null;
  googleReviewsCount: number;
  /**
   * Online booking / «Book now» URL — public CTA (not contact-gated).
   */
  bookingUrl: string | null;
  imageUrl: string | null;
  /** Street / suite only — no city, state, ZIP, or county. */
  addressLine: string | null;
  city: string | null;
  /** County / metro label only (e.g. Orange County). */
  region: string | null;
  /** US-CA etc. */
  stateCode?: string | null;
  /** 5-digit ZIP. */
  postalCode?: string | null;
  latitude: number | null;
  longitude: number | null;
  /** street = точный адрес; county = только район (Orange County и т.п.) */
  locationPrecision: "street" | "county" | null;
  openingHours: OpeningHours | null;
  createdAt?: string | null;
  /** Safe for listing cards — which contact channels exist without exposing values. */
  presenceFlags: BusinessPresenceFlags;
};

export type BusinessSearchParams = {
  query?: string;
  categoryId?: string | null;
  categorySlug?: string | null;
  city?: string | null;
  /** Filter to a regional hub (map bounds / county label). */
  hubId?: string | null;
  /** When set, results with coordinates are sorted nearest-first. */
  nearLat?: number | null;
  nearLng?: number | null;
};

export function hasCoordinates(
  business: Business,
): business is Business & { latitude: number; longitude: number } {
  return (
    typeof business.latitude === "number" &&
    Number.isFinite(business.latitude) &&
    typeof business.longitude === "number" &&
    Number.isFinite(business.longitude)
  );
}
