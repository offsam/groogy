/** Things-to-do categories for affiche (not concert-only). */

export const EVENT_CATEGORIES = [
  "festival",
  "outdoors",
  "family",
  "food",
  "culture",
  "sport",
  "music",
  "networking",
  "market",
  "other",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_CATEGORY_LABELS_RU: Record<EventCategory, string> = {
  festival: "Фестивали",
  outdoors: "На свежем воздухе",
  family: "Семья и дети",
  food: "Еда и напитки",
  culture: "Культура",
  sport: "Спорт",
  music: "Музыка",
  networking: "Нетворкинг",
  market: "Ярмарки и рынки",
  other: "Другое",
};

export function parseEventCategory(
  raw: string | null | undefined,
): EventCategory | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  return (EVENT_CATEGORIES as readonly string[]).includes(s)
    ? (s as EventCategory)
    : null;
}

/** Map Eventbrite / discovery category slugs into our taxonomy. */
export function mapExternalCategoryToEventCategory(
  raw: string | null | undefined,
): EventCategory {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "other";
  if (/festival|fair|parade|carnival|oktoberfest/.test(s)) return "festival";
  if (/food|drink|beer|wine|culinary|tasting|farm/.test(s)) return "food";
  if (/family|kid|children|parent/.test(s)) return "family";
  if (/outdoor|hike|park|garden|pick|berry|nature|beach/.test(s))
    return "outdoors";
  if (/sport|fitness|run|yoga|bike|golf/.test(s)) return "sport";
  if (/music|concert|dj|festival-music|performing/.test(s)) return "music";
  if (/art|museum|theater|theatre|film|culture|comedy/.test(s))
    return "culture";
  if (/network|business|startup|meetup|conference/.test(s))
    return "networking";
  if (/market|bazaar|flea|craft|maker/.test(s)) return "market";
  return "other";
}
