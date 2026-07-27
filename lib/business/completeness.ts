import { isPlaceholderBusinessImage } from "@/lib/business/media";
import type { Business } from "@/types/business";
import { hasCoordinates } from "@/types/business";

/**
 * Higher = more filled / trustworthy listing card.
 * Used to push empty / half-empty businesses to the bottom of search results.
 */
export function businessCompletenessScore(business: Business): number {
  const flags = business.presenceFlags;
  let score = 0;

  if (flags?.hasPhone) score += 4;
  if (flags?.hasWebsite) score += 3;
  if (flags?.hasInstagram) score += 3;
  if (flags?.hasEmail) score += 2;
  if (flags?.hasYelp) score += 2;
  if (flags?.hasGoogleMaps) score += 2;
  if (flags?.hasTelegram) score += 1;

  if (hasCoordinates(business)) score += 4;
  if (business.locationPrecision === "street") score += 3;
  else if (business.locationPrecision === "city") score += 1;

  if (business.categoryId) score += 2;

  const shortLen = business.shortDescription?.trim().length ?? 0;
  const descLen = business.description?.trim().length ?? 0;
  if (shortLen >= 80) score += 2;
  else if (shortLen >= 30) score += 1;
  if (descLen >= 200) score += 2;
  else if (descLen >= 80) score += 1;

  if (
    business.imageUrl &&
    !isPlaceholderBusinessImage(business.imageUrl)
  ) {
    score += 2;
  }

  if ((business.reviewsCount ?? 0) > 0) score += 2;
  if ((business.ratingAvg ?? 0) >= 4) score += 1;
  if (business.googleRating != null) score += 2;
  if ((business.googleReviewsCount ?? 0) > 0) score += 1;

  return score;
}

export function compareBusinessesByCompleteness(a: Business, b: Business): number {
  const diff = businessCompletenessScore(b) - businessCompletenessScore(a);
  if (diff !== 0) return diff;
  const ratingDiff = (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
  if (ratingDiff !== 0) return ratingDiff;
  return (a.name ?? "").localeCompare(b.name ?? "", "ru");
}
