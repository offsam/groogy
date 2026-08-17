/**
 * Rough geographic centers for continental US states (+ AK/HI/DC)
 * used by the home map state-cluster circles. Not survey-accurate —
 * only for placing a count bubble when zoomed out.
 */

export type UsStateCentroid = {
  /** ISO 3166-2, e.g. US-CA */
  code: string;
  /** Two-letter abbreviation, e.g. CA */
  abbr: string;
  /** Short Russian label for tooltips */
  labelRu: string;
  lat: number;
  lng: number;
  /** Zoom target when the user taps the state circle. */
  zoom: number;
};

export const US_STATE_CENTROIDS: readonly UsStateCentroid[] = [
  { code: "US-AL", abbr: "AL", labelRu: "Алабама", lat: 32.8, lng: -86.8, zoom: 7 },
  { code: "US-AK", abbr: "AK", labelRu: "Аляска", lat: 64.2, lng: -153.5, zoom: 4.5 },
  { code: "US-AZ", abbr: "AZ", labelRu: "Аризона", lat: 34.3, lng: -111.7, zoom: 6.5 },
  { code: "US-AR", abbr: "AR", labelRu: "Арканзас", lat: 34.9, lng: -92.4, zoom: 7 },
  { code: "US-CA", abbr: "CA", labelRu: "Калифорния", lat: 37.2, lng: -119.5, zoom: 6 },
  { code: "US-CO", abbr: "CO", labelRu: "Колорадо", lat: 39.0, lng: -105.5, zoom: 7 },
  { code: "US-CT", abbr: "CT", labelRu: "Коннектикут", lat: 41.6, lng: -72.7, zoom: 8.5 },
  { code: "US-DE", abbr: "DE", labelRu: "Делавэр", lat: 39.0, lng: -75.5, zoom: 8.5 },
  { code: "US-DC", abbr: "DC", labelRu: "Вашингтон", lat: 38.9, lng: -77.0, zoom: 10 },
  { code: "US-FL", abbr: "FL", labelRu: "Флорида", lat: 28.1, lng: -81.7, zoom: 6.5 },
  { code: "US-GA", abbr: "GA", labelRu: "Джорджия", lat: 32.7, lng: -83.4, zoom: 7 },
  { code: "US-HI", abbr: "HI", labelRu: "Гавайи", lat: 20.8, lng: -156.3, zoom: 7 },
  { code: "US-ID", abbr: "ID", labelRu: "Айдахо", lat: 44.4, lng: -114.6, zoom: 6.5 },
  { code: "US-IL", abbr: "IL", labelRu: "Иллинойс", lat: 40.0, lng: -89.2, zoom: 7 },
  { code: "US-IN", abbr: "IN", labelRu: "Индиана", lat: 39.9, lng: -86.3, zoom: 7 },
  { code: "US-IA", abbr: "IA", labelRu: "Айова", lat: 42.0, lng: -93.5, zoom: 7 },
  { code: "US-KS", abbr: "KS", labelRu: "Канзас", lat: 38.5, lng: -98.3, zoom: 7 },
  { code: "US-KY", abbr: "KY", labelRu: "Кентукки", lat: 37.5, lng: -85.3, zoom: 7 },
  { code: "US-LA", abbr: "LA", labelRu: "Луизиана", lat: 31.0, lng: -92.0, zoom: 7 },
  { code: "US-ME", abbr: "ME", labelRu: "Мэн", lat: 45.3, lng: -69.2, zoom: 7 },
  { code: "US-MD", abbr: "MD", labelRu: "Мэриленд", lat: 39.0, lng: -76.7, zoom: 8 },
  { code: "US-MA", abbr: "MA", labelRu: "Массачусетс", lat: 42.2, lng: -71.5, zoom: 8 },
  { code: "US-MI", abbr: "MI", labelRu: "Мичиган", lat: 44.3, lng: -85.4, zoom: 6.5 },
  { code: "US-MN", abbr: "MN", labelRu: "Миннесота", lat: 46.3, lng: -94.3, zoom: 6.5 },
  { code: "US-MS", abbr: "MS", labelRu: "Миссисипи", lat: 32.7, lng: -89.7, zoom: 7 },
  { code: "US-MO", abbr: "MO", labelRu: "Миссури", lat: 38.4, lng: -92.5, zoom: 7 },
  { code: "US-MT", abbr: "MT", labelRu: "Монтана", lat: 47.0, lng: -109.6, zoom: 6 },
  { code: "US-NE", abbr: "NE", labelRu: "Небраска", lat: 41.5, lng: -99.8, zoom: 7 },
  { code: "US-NV", abbr: "NV", labelRu: "Невада", lat: 39.3, lng: -116.6, zoom: 6.5 },
  { code: "US-NH", abbr: "NH", labelRu: "Нью-Гэмпшир", lat: 43.7, lng: -71.6, zoom: 8 },
  { code: "US-NJ", abbr: "NJ", labelRu: "Нью-Джерси", lat: 40.1, lng: -74.5, zoom: 8 },
  { code: "US-NM", abbr: "NM", labelRu: "Нью-Мексико", lat: 34.4, lng: -106.1, zoom: 7 },
  { code: "US-NY", abbr: "NY", labelRu: "Нью-Йорк", lat: 42.9, lng: -75.5, zoom: 7 },
  { code: "US-NC", abbr: "NC", labelRu: "Сев. Каролина", lat: 35.6, lng: -79.4, zoom: 7 },
  { code: "US-ND", abbr: "ND", labelRu: "Сев. Дакота", lat: 47.5, lng: -100.5, zoom: 7 },
  { code: "US-OH", abbr: "OH", labelRu: "Огайо", lat: 40.3, lng: -82.8, zoom: 7 },
  { code: "US-OK", abbr: "OK", labelRu: "Оклахома", lat: 35.6, lng: -97.5, zoom: 7 },
  { code: "US-OR", abbr: "OR", labelRu: "Орегон", lat: 44.0, lng: -120.5, zoom: 7 },
  { code: "US-PA", abbr: "PA", labelRu: "Пенсильвания", lat: 40.9, lng: -77.8, zoom: 7 },
  { code: "US-RI", abbr: "RI", labelRu: "Род-Айленд", lat: 41.7, lng: -71.5, zoom: 9 },
  { code: "US-SC", abbr: "SC", labelRu: "Юж. Каролина", lat: 33.9, lng: -80.9, zoom: 7.5 },
  { code: "US-SD", abbr: "SD", labelRu: "Юж. Дакота", lat: 44.4, lng: -100.2, zoom: 7 },
  { code: "US-TN", abbr: "TN", labelRu: "Теннесси", lat: 35.8, lng: -86.3, zoom: 7 },
  { code: "US-TX", abbr: "TX", labelRu: "Техас", lat: 31.5, lng: -99.3, zoom: 6 },
  { code: "US-UT", abbr: "UT", labelRu: "Юта", lat: 39.3, lng: -111.7, zoom: 7 },
  { code: "US-VT", abbr: "VT", labelRu: "Вермонт", lat: 44.0, lng: -72.7, zoom: 8 },
  { code: "US-VA", abbr: "VA", labelRu: "Виргиния", lat: 37.5, lng: -78.9, zoom: 7 },
  { code: "US-WA", abbr: "WA", labelRu: "Вашингтон", lat: 47.4, lng: -120.5, zoom: 7 },
  { code: "US-WV", abbr: "WV", labelRu: "Зап. Виргиния", lat: 38.6, lng: -80.6, zoom: 7.5 },
  { code: "US-WI", abbr: "WI", labelRu: "Висконсин", lat: 44.5, lng: -89.5, zoom: 7 },
  { code: "US-WY", abbr: "WY", labelRu: "Вайоминг", lat: 43.0, lng: -107.6, zoom: 7 },
] as const;

const BY_CODE = new Map(US_STATE_CENTROIDS.map((s) => [s.code, s]));

export function getUsStateCentroid(
  stateCode: string | null | undefined,
): UsStateCentroid | null {
  if (!stateCode) return null;
  const normalized = normalizeUsStateCode(stateCode);
  return normalized ? (BY_CODE.get(normalized) ?? null) : null;
}

/** Accepts `US-CA`, `CA`, `ca` → `US-CA`. */
export function normalizeUsStateCode(
  value: string | null | undefined,
): string | null {
  const raw = (value ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (/^US-[A-Z]{2}$/.test(raw)) return raw;
  if (/^[A-Z]{2}$/.test(raw)) return `US-${raw}`;
  return null;
}

/**
 * Home map zoom bands:
 *   < STATE_MAX        — one circle per US state
 *   STATE_MAX–GROUP_MAX — metro groups (Greater LA, SF, NY, …)
 *   GROUP_MAX–HUB_MAX   — individual hubs (LA / OC / Inland Empire)
 *   ≥ HUB_MAX           — pins
 */
export const HOME_MAP_STATE_CLUSTER_MAX_ZOOM = 5.75;
export const HOME_MAP_METRO_GROUP_MAX_ZOOM = 8.25;
export const HOME_MAP_HUB_CLUSTER_MAX_ZOOM = 10;
