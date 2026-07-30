/** Admin review category picker options (from `categories` table). */

export type ReviewCategoryOption = {
  id: string;
  slug: string;
  name: string;
  domain: string;
};

/** Filter catalog categories for the preview hub (business vs pro). */
export function categoriesForPreviewHub(
  categories: ReviewCategoryOption[],
  hub: string,
): ReviewCategoryOption[] {
  if (hub === "businesses") {
    return categories.filter((c) => c.domain === "business");
  }
  if (hub === "professionals") {
    return categories.filter(
      (c) =>
        c.domain === "professional" ||
        c.domain === "business" ||
        c.domain === "services",
    );
  }
  return categories;
}
