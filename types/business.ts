export type Category = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  sortOrder: number;
};

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
  phone: string | null;
  website: string | null;
  instagramUrl: string | null;
  googleMapsUrl: string | null;
  googleRating: number | null;
  googleReviewsCount: number;
  imageUrl: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  /** street = точный адрес; county = только район (Orange County и т.п.) */
  locationPrecision: "street" | "county" | null;
};

export type BusinessSearchParams = {
  query?: string;
  categoryId?: string | null;
  categorySlug?: string | null;
  city?: string | null;
  /** Filter to a regional hub (map bounds / county label). */
  hubId?: string | null;
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
