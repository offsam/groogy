/** Map recommendation category_guess → catalog filter labels + DB category slugs. */

export type RecommendationEntityFilter =
  | "all"
  | "professional"
  | "business"
  | "service";

export type RecommendationCategoryMeta = {
  /** Stable filter id used in URL */
  id: string;
  /** Display label (Russian) */
  label: string;
  /** Values of category_guess that belong here */
  guesses: string[];
};

/** Canonical categories for admin filter chips (Telegram / recommendations). */
export const RECOMMENDATION_CATEGORIES: RecommendationCategoryMeta[] = [
  {
    id: "beauty",
    label: "Красота",
    guesses: ["визаж / beauty", "парикмахер", "косметология"],
  },
  {
    id: "massage",
    label: "Массаж",
    guesses: ["массаж"],
  },
  {
    id: "medical",
    label: "Медицина",
    guesses: [
      "медицина",
      "стоматолог",
      "врач",
      "клиника",
      "dentist",
      "dermatologist",
      "hospitals",
      "pulmonology",
    ],
  },
  {
    id: "legal",
    label: "Юристы",
    guesses: ["юрист"],
  },
  {
    id: "finance",
    label: "Бухгалтерия / нотариус",
    guesses: ["бухгалтерия / нотариус"],
  },
  {
    id: "real_estate",
    label: "Риелторы",
    guesses: ["риелтор"],
  },
  {
    id: "education",
    label: "Репетиторы",
    guesses: ["репетитор"],
  },
  {
    id: "childcare",
    label: "Няни",
    guesses: ["няня"],
  },
  {
    id: "auto",
    label: "Авто",
    guesses: ["автосервис", "авто / страхование"],
  },
  {
    id: "home",
    label: "Ремонт / дом",
    guesses: [
      "ремонт / стройка",
      "клининг",
      "переезд / перевозки",
      "сантехник",
      "электрик",
      "handyman",
    ],
  },
  {
    id: "photo",
    label: "Фото / видео",
    guesses: ["фото / видео"],
  },
  {
    id: "fitness",
    label: "Фитнес",
    guesses: ["фитнес"],
  },
  {
    id: "food",
    label: "Еда / цветы",
    guesses: ["кейтеринг / цветы"],
  },
  {
    id: "other",
    label: "Прочее",
    guesses: ["услуга / специалист", "событие"],
  },
];

const GUESS_TO_CATEGORY_ID = new Map<string, string>();
for (const cat of RECOMMENDATION_CATEGORIES) {
  for (const g of cat.guesses) {
    if (!GUESS_TO_CATEGORY_ID.has(g.toLowerCase())) {
      GUESS_TO_CATEGORY_ID.set(g.toLowerCase(), cat.id);
    }
  }
}

export function recommendationCategoryId(
  categoryGuess: string | null | undefined,
): string {
  const g = (categoryGuess || "").trim().toLowerCase();
  if (!g) return "other";
  const mapped = GUESS_TO_CATEGORY_ID.get(g);
  if (mapped) return mapped;
  if (
    /медицин|стоматолог|dentist|dermatolog|hospital|clinic|клиник|врач|doctor|pulmonolog|pediatr|хирург/.test(
      g,
    )
  ) {
    return "medical";
  }
  if (/attorney|lawyer|юрист|адвокат|нотариус/.test(g)) return "legal";
  if (/realtor|риелтор|real\s*estate/.test(g)) return "real_estate";
  if (/restaurant|cafe|grocery|supermarket|food/.test(g)) return "food";
  if (/auto|tire|mechanic|авто/.test(g)) return "auto";
  if (/beauty|salon|hair|nail|парикмахер|визаж|косметолог/.test(g)) {
    return "beauty";
  }
  if (/insurance|страхов/.test(g)) return "auto";
  return "other";
}

export function recommendationCategoryLabel(
  categoryGuess: string | null | undefined,
): string {
  const id = recommendationCategoryId(categoryGuess);
  return (
    RECOMMENDATION_CATEGORIES.find((c) => c.id === id)?.label ||
    categoryGuess ||
    "Прочее"
  );
}

export function guessesForCategoryId(categoryId: string): string[] {
  if (categoryId === "all") return [];
  const meta = RECOMMENDATION_CATEGORIES.find((c) => c.id === categoryId);
  return meta?.guesses ?? [];
}

/** category_guess → professionals.categories slug (domain=professional) */
export const GUESS_TO_PROFESSIONAL_SLUG: Record<string, string> = {
  "визаж / beauty": "beauty",
  парикмахер: "beauty",
  косметология: "beauty",
  массаж: "massage_wellness",
  репетитор: "education",
  няня: "childcare",
  риелтор: "real_estate",
  юрист: "legal",
  "бухгалтерия / нотариус": "finance",
  фитнес: "fitness",
  автосервис: "auto",
  "авто / страхование": "insurance",
  "ремонт / стройка": "home_services",
  клининг: "home_services",
  "переезд / перевозки": "home_services",
  сантехник: "home_services",
  электрик: "home_services",
  handyman: "home_services",
  "кейтеринг / цветы": "home_food",
  "фото / видео": "photo_video",
  "услуга / специалист": "pro_other",
};

/** category_guess → businesses.categories slug (domain=business) */
export const GUESS_TO_BUSINESS_SLUG: Record<string, string> = {
  "визаж / beauty": "beauty",
  парикмахер: "beauty",
  косметология: "beauty",
  массаж: "beauty",
  репетитор: "education",
  риелтор: "real_estate",
  юрист: "legal",
  "бухгалтерия / нотариус": "finance",
  фитнес: "fitness",
  автосервис: "auto",
  "авто / страхование": "insurance",
  "ремонт / стройка": "services",
  клининг: "services",
  "переезд / перевозки": "services",
  сантехник: "services",
  электрик: "services",
  handyman: "services",
  "кейтеринг / цветы": "events",
  "фото / видео": "services",
  няня: "services",
  "услуга / специалист": "services",
};

export function professionalSlugFromGuess(
  categoryGuess: string | null | undefined,
): string {
  const g = (categoryGuess || "").trim().toLowerCase();
  return GUESS_TO_PROFESSIONAL_SLUG[g] ?? "pro_other";
}

export function businessSlugFromGuess(
  categoryGuess: string | null | undefined,
): string {
  const g = (categoryGuess || "").trim().toLowerCase();
  return GUESS_TO_BUSINESS_SLUG[g] ?? "services";
}
