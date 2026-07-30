/**
 * Russian (and loose Latin) labels for US cities that arrive in imported copy.
 * SoT for «Хьюстон» → «Houston» across directories, imports and enrichment.
 * See docs/architecture/runtime/USA_LOCATION_CANON_V1.md — this feeds rung 2
 * (city + state) of the ladder.
 */

export type CityAlias = { city: string; stateCode: string };

/** Keys are lowercase with hyphens/spaces collapsed to a single space. */
const CITY_ALIASES: Record<string, CityAlias> = {
  "нью йорк": { city: "New York", stateCode: "US-NY" },
  бруклин: { city: "Brooklyn", stateCode: "US-NY" },
  "статен айленд": { city: "Staten Island", stateCode: "US-NY" },
  куинс: { city: "Queens", stateCode: "US-NY" },
  бронкс: { city: "Bronx", stateCode: "US-NY" },
  "лос анджелес": { city: "Los Angeles", stateCode: "US-CA" },
  "сан франциско": { city: "San Francisco", stateCode: "US-CA" },
  "сан диего": { city: "San Diego", stateCode: "US-CA" },
  "сан хосе": { city: "San Jose", stateCode: "US-CA" },
  сакраменто: { city: "Sacramento", stateCode: "US-CA" },
  глендейл: { city: "Glendale", stateCode: "US-CA" },
  ирвайн: { city: "Irvine", stateCode: "US-CA" },
  чикаго: { city: "Chicago", stateCode: "US-IL" },
  бостон: { city: "Boston", stateCode: "US-MA" },
  майами: { city: "Miami", stateCode: "US-FL" },
  орландо: { city: "Orlando", stateCode: "US-FL" },
  тампа: { city: "Tampa", stateCode: "US-FL" },
  филадельфия: { city: "Philadelphia", stateCode: "US-PA" },
  сиэтл: { city: "Seattle", stateCode: "US-WA" },
  сиэттл: { city: "Seattle", stateCode: "US-WA" },
  портленд: { city: "Portland", stateCode: "US-OR" },
  денвер: { city: "Denver", stateCode: "US-CO" },
  хьюстон: { city: "Houston", stateCode: "US-TX" },
  даллас: { city: "Dallas", stateCode: "US-TX" },
  остин: { city: "Austin", stateCode: "US-TX" },
  "сан антонио": { city: "San Antonio", stateCode: "US-TX" },
  атланта: { city: "Atlanta", stateCode: "US-GA" },
  "лас вегас": { city: "Las Vegas", stateCode: "US-NV" },
  финикс: { city: "Phoenix", stateCode: "US-AZ" },
  миннеаполис: { city: "Minneapolis", stateCode: "US-MN" },
  балтимор: { city: "Baltimore", stateCode: "US-MD" },
  шарлотт: { city: "Charlotte", stateCode: "US-NC" },
  нэшвилл: { city: "Nashville", stateCode: "US-TN" },
  детройт: { city: "Detroit", stateCode: "US-MI" },
  кливленд: { city: "Cleveland", stateCode: "US-OH" },
};

function aliasKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[-–—_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cyrillic city labels from to4ka / directories → English catalog city. */
export const CYRILLIC_CITY_TO_EN: Record<string, string> = Object.fromEntries(
  Object.entries(CITY_ALIASES).flatMap(([key, alias]) => [
    [key, alias.city],
    [key.replace(/ /g, "-"), alias.city],
  ]),
);

/** «TX», «US-TX», «USA», «12345» — not a city, however the source labelled it. */
export function isNonCityLabel(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim();
  if (!v) return true;
  if (/^us[-\s]?[a-z]{2}$/i.test(v)) return true;
  if (/^[a-z]{2}$/i.test(v)) return true;
  if (/^(usa|us|united states|america|сша)$/i.test(v)) return true;
  if (/^[\d\s-]+$/.test(v)) return true;
  return false;
}

/** Known label → canonical city + state. Latin names pass through unmapped. */
export function cityAliasFromLabel(
  raw: string | null | undefined,
): CityAlias | null {
  const v = (raw ?? "").trim();
  if (!v || isNonCityLabel(v)) return null;
  return CITY_ALIASES[aliasKey(v)] ?? null;
}

/** Catalog spelling for a city label; null when the label is not a city. */
export function normalizeCityLabel(
  raw: string | null | undefined,
): string | null {
  const v = (raw ?? "").replace(/\s+/g, " ").replace(/^[,.\s]+|[,.\s]+$/g, "");
  if (!v || isNonCityLabel(v)) return null;
  const alias = CITY_ALIASES[aliasKey(v)];
  if (alias) return alias.city;
  if (/^[a-z .'-]+$/i.test(v)) {
    return v.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return v;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** «в Хьюстоне», «Лос-Анджелес» — Russian case endings included. */
const TEXT_MATCHERS: Array<{ re: RegExp; alias: CityAlias }> = Object.entries(
  CITY_ALIASES,
).map(([key, alias]) => ({
  alias,
  re: new RegExp(
    `(?<![\\p{L}])${escapeRe(key).replace(/ /g, "[\\s-]+")}(?:[а-яё]{1,3})?(?![\\p{L}])`,
    "iu",
  ),
}));

const LATIN_MATCHERS: Array<{ re: RegExp; alias: CityAlias }> = Object.values(
  CITY_ALIASES,
).map((alias) => ({
  alias,
  re: new RegExp(
    `(?<![\\p{L}])${escapeRe(alias.city).replace(/ /g, "[\\s-]+")}(?![\\p{L}])`,
    "iu",
  ),
}));

/**
 * City mentioned in free copy («…маникюр и педикюр в Хьюстоне»).
 * Two different cities in one text → null: guessing between them is worse
 * than leaving the card unresolved.
 */
export function cityFromFreeText(
  text: string | null | undefined,
): CityAlias | null {
  const body = (text ?? "").trim();
  if (!body) return null;
  const hits = new Map<string, CityAlias>();
  for (const { re, alias } of [...TEXT_MATCHERS, ...LATIN_MATCHERS]) {
    if (re.test(body)) hits.set(`${alias.city}|${alias.stateCode}`, alias);
  }
  if (hits.size !== 1) return null;
  return [...hits.values()][0] ?? null;
}
