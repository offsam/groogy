/**
 * Lightweight RU↔EN synonym expansion for directory search.
 * Used so "русский маникюр" also matches "Russian manicure".
 */

/** Each group: any token in the group can satisfy any other token in the group. */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["русский", "русская", "русское", "русские", "russian", "russians"],
  [
    "маникюр",
    "маникюра",
    "маникюры",
    "ногти",
    "ноготь",
    "manicure",
    "manicures",
    "nails",
    "nail",
  ],
  ["педикюр", "педикюра", "pedicure", "pedicures"],
  ["стоматолог", "стоматология", "dentist", "dental", "odontology"],
  ["сантехник", "сантехника", "plumber", "plumbing"],
  ["ресторан", "рестораны", "кафе", "restaurant", "restaurants", "cafe"],
  ["автосервис", "авто", "mechanic", "auto", "car", "garage", "shop"],
  [
    "масло",
    "масла",
    "маслу",
    "oil",
    "oils",
    "lube",
    "смазка",
  ],
  ["шиномонтаж", "шины", "tire", "tires", "колёса", "колеса", "rim"],
  ["юрист", "адвокат", "lawyer", "attorney", "legal"],
  ["врач", "доктор", "клиника", "doctor", "clinic", "medical"],
  ["репетитор", "учитель", "школа", "tutor", "teacher", "school"],
  ["handyman", "хандимен", "мастер", "ремонт", "repair"],
  // Typo forms (floring/floorin) live in spellcheck aliases, not here —
  // otherwise "пол"/"tile" OR-expand from a typo and drown real flooring shops.
  [
    "flooring",
    "floor",
    "floors",
    "hardwood",
    "laminate",
    "vinyl",
    "плитка",
    "ламинат",
    "паркет",
    "полы",
  ],
  ["рядом", "nearby", "near", "поблизости"],
];

const LOOKUP = new Map<string, readonly string[]>();
for (const group of SYNONYM_GROUPS) {
  const normalized = group.map((g) => g.toLowerCase());
  for (const token of normalized) {
    LOOKUP.set(token, normalized);
  }
}

/** Expand a single search token into itself + synonyms (deduped, lowercased). */
export function expandSearchToken(token: string): string[] {
  const lower = token.toLowerCase();
  const group = LOOKUP.get(lower);
  if (!group) return [lower];
  return [...new Set(group)];
}

/**
 * True if haystack satisfies the token via exact substring or any synonym.
 */
export function haystackMatchesToken(haystack: string, token: string): boolean {
  const variants = expandSearchToken(token);
  return variants.some((v) => haystack.includes(v));
}
