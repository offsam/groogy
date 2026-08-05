/**
 * Additive map: business-domain category slug → professional-domain slug.
 * Does not remove or rename existing categories — only remaps when publishing
 * a specialist that somehow carries a biz-only slug.
 *
 * Prefer identity (beauty→beauty) when pro slug exists in PROFESSIONAL_CATEGORY_SLUGS.
 */

import {
  PROFESSIONAL_CATEGORY_SLUGS,
  type ProfessionalCategorySlug,
} from "@/lib/professional/categories";

const PRO_SET = new Set<string>(PROFESSIONAL_CATEGORY_SLUGS);

/**
 * When a specialist card has a category that only exists (or was intended)
 * as business taxonomy, map to the closest professional slug.
 * Returns null if no remap needed / unknown.
 */
export function mapBizCategorySlugToPro(
  slug: string | null | undefined,
): ProfessionalCategorySlug | null {
  const s = String(slug || "").trim();
  if (!s || s === "pro_other") return null;
  // Already a valid professional slug — keep as-is (no change).
  if (PRO_SET.has(s)) return s as ProfessionalCategorySlug;

  const MAP: Record<string, ProfessionalCategorySlug> = {
    medical: "health",
    dentistry: "health",
    dental: "health",
    groceries: "home_food",
    restaurant: "home_food",
    restaurants: "home_food",
    cafe: "home_food",
    services: "home_services",
    construction: "home_services",
    beauty_salon: "beauty",
    nails: "beauty",
    hair: "beauty",
    spa: "massage_wellness",
    wellness: "massage_wellness",
    education_center: "education",
    tutoring: "education",
    schools: "education",
  };
  return MAP[s] ?? null;
}
