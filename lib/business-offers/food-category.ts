/**
 * Food / restaurant category helpers for menu offers vs generic services.
 */

const FOOD_CATEGORY_RE =
  /food|restaurant|cafe|café|bakery|кухн|ресторан|кафе|пекар|еда|deli|bistro|кулинар/i;

/** Enrich: pull /menu when category looks like food. */
export function isFoodBusinessCategory(
  slug?: string | null,
  name?: string | null,
): boolean {
  return FOOD_CATEGORY_RE.test(`${slug || ""} ${name || ""}`);
}

/** Profile UI: «Услуги» → «Меню» only for the restaurants category. */
export function isRestaurantsCategory(slug?: string | null): boolean {
  return (slug || "").trim().toLowerCase() === "restaurants";
}
