import { sanitizePublicDescription } from "@/lib/content/sanitize-public-description";
import { parseOpeningHours } from "@/lib/business/opening-hours";
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

export function mapBusiness(row: BusinessWithCategory): Business {
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
    phone: row.phone,
    email: row.email ?? null,
    website: row.website,
    instagramUrl: row.instagram_url ?? null,
    yelpUrl: row.yelp_url ?? null,
    googleMapsUrl: row.google_maps_url ?? null,
    googleRating:
      row.google_rating == null ? null : Number(row.google_rating),
    googleReviewsCount: Number(row.google_reviews_count ?? 0),
    imageUrl: row.image_url || PLACEHOLDER_IMAGE,
    addressLine: row.address_line,
    city: row.city,
    region: row.region,
    latitude: row.latitude,
    longitude: row.longitude,
    locationPrecision: row.location_precision ?? null,
    openingHours: parseOpeningHours(row.opening_hours),
    createdAt: row.created_at ?? null,
  };
}

export function formatWebsiteHost(website: string | null): string {
  if (!website) return "";
  return website.replace(/^https?:\/\//, "");
}

export function formatAddress(business: Business): string {
  const street = business.addressLine?.trim() || "";
  const city = business.city?.trim() || "";
  if (!street && !city) return "";
  if (!street) return city;
  if (!city) return street;

  // Avoid duplicates like "13031 Newport Ave, Tustin CA, Tustin"
  const streetNorm = street
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cityNorm = city.toLowerCase().trim();
  if (streetNorm.includes(cityNorm)) return street;

  return `${street}, ${city}`;
}
