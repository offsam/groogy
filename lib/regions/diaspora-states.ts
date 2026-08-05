/**
 * US states with Russian-speaking diaspora circles.
 * Picker: states A→Я, then «Весь штат» + metro cities.
 * Keep this file free of imports from hubs.ts (avoids circular deps).
 */

export type DiasporaStateGroup = {
  /** Russian state name (Аляска, Калифорния…) */
  label: string;
  stateHubId: string;
  /** Diaspora metros/cities under this state (hub ids) */
  cityHubIds: readonly string[];
};

type StateHubDef = {
  id: string;
  shortLabel: string;
  inLabel: string;
  stateCode: string;
  mapCenter: { lat: number; lng: number };
  mapBounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  panoramaUrl: string;
};

function stateHub(input: StateHubDef) {
  return {
    id: input.id,
    shortLabel: input.shortLabel,
    inLabel: input.inLabel,
    scope: "state" as const,
    stateCodes: [input.stateCode, `US-${input.stateCode}`],
    countyGeoids: [] as string[],
    panoramaUrl: input.panoramaUrl,
    panoramaAlt: input.shortLabel,
    mapCenter: input.mapCenter,
    mapZoom: 6,
    mapBounds: input.mapBounds,
    exampleQueries: [`русский бизнес ${input.shortLabel}`],
    cityAliases: [input.shortLabel.toLowerCase()],
  };
}

const CA_BOUNDS: StateHubDef["mapBounds"] = {
  north: 42.05,
  south: 32.5,
  west: -124.5,
  east: -114.1,
};

/** State-level hubs (whole state filter). */
export const DIASPORA_STATE_HUBS: Record<string, ReturnType<typeof stateHub>> = {
  "state-ak": stateHub({
    id: "state-ak",
    shortLabel: "Аляска",
    inLabel: "Аляске",
    stateCode: "AK",
    mapCenter: { lat: 64.2, lng: -149.5 },
    mapBounds: { north: 71.4, south: 54.5, west: -168, east: -130 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1539593395743-7da5ee10ff07?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-az": stateHub({
    id: "state-az",
    shortLabel: "Аризона",
    inLabel: "Аризоне",
    stateCode: "AZ",
    mapCenter: { lat: 34.05, lng: -111.09 },
    mapBounds: { north: 37.0, south: 31.3, west: -114.8, east: -109.0 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-wa": stateHub({
    id: "state-wa",
    shortLabel: "Вашингтон",
    inLabel: "Вашингтоне",
    stateCode: "WA",
    mapCenter: { lat: 47.4, lng: -120.5 },
    mapBounds: { north: 49.0, south: 45.5, west: -124.8, east: -116.9 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1502175353174-a7a70e73b362?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-ga": stateHub({
    id: "state-ga",
    shortLabel: "Джорджия",
    inLabel: "Джорджии",
    stateCode: "GA",
    mapCenter: { lat: 32.7, lng: -83.5 },
    mapBounds: { north: 35.0, south: 30.3, west: -85.6, east: -80.8 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1575936123452-b67c3203c355?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-il": stateHub({
    id: "state-il",
    shortLabel: "Иллинойс",
    inLabel: "Иллинойсе",
    stateCode: "IL",
    mapCenter: { lat: 40.0, lng: -89.2 },
    mapBounds: { north: 42.5, south: 36.9, west: -91.5, east: -87.0 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1477959858617-67f85b34b5df?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-ca": stateHub({
    id: "state-ca",
    shortLabel: "Калифорния",
    inLabel: "Калифорнии",
    stateCode: "CA",
    mapCenter: { lat: 37.2, lng: -119.5 },
    mapBounds: CA_BOUNDS,
    panoramaUrl:
      "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-co": stateHub({
    id: "state-co",
    shortLabel: "Колорадо",
    inLabel: "Колорадо",
    stateCode: "CO",
    mapCenter: { lat: 39.0, lng: -105.5 },
    mapBounds: { north: 41.0, south: 36.9, west: -109.1, east: -102.0 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1546156929-a4c0ac411f47?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-ma": stateHub({
    id: "state-ma",
    shortLabel: "Массачусетс",
    inLabel: "Массачусетсе",
    stateCode: "MA",
    mapCenter: { lat: 42.2, lng: -71.8 },
    mapBounds: { north: 42.9, south: 41.2, west: -73.5, east: -69.9 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1501979376754-2ff867a4f659?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-mn": stateHub({
    id: "state-mn",
    shortLabel: "Миннесота",
    inLabel: "Миннесоте",
    stateCode: "MN",
    mapCenter: { lat: 46.0, lng: -94.5 },
    mapBounds: { north: 49.4, south: 43.5, west: -97.2, east: -89.5 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-md": stateHub({
    id: "state-md",
    shortLabel: "Мэриленд",
    inLabel: "Мэриленде",
    stateCode: "MD",
    mapCenter: { lat: 39.0, lng: -76.7 },
    mapBounds: { north: 39.75, south: 37.9, west: -79.5, east: -75.0 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1617581629397-a72507c3de9e?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-nv": stateHub({
    id: "state-nv",
    shortLabel: "Невада",
    inLabel: "Неваде",
    stateCode: "NV",
    mapCenter: { lat: 38.5, lng: -117.0 },
    mapBounds: { north: 42.0, south: 35.0, west: -120.0, east: -114.0 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-nj": stateHub({
    id: "state-nj",
    shortLabel: "Нью-Джерси",
    inLabel: "Нью-Джерси",
    stateCode: "NJ",
    mapCenter: { lat: 40.1, lng: -74.5 },
    mapBounds: { north: 41.36, south: 38.9, west: -75.6, east: -73.9 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1568515387631-8b650bbcdb90?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-ny": stateHub({
    id: "state-ny",
    shortLabel: "Нью-Йорк",
    inLabel: "штате Нью-Йорк",
    stateCode: "NY",
    mapCenter: { lat: 42.9, lng: -75.5 },
    mapBounds: { north: 45.0, south: 40.5, west: -79.8, east: -71.8 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-oh": stateHub({
    id: "state-oh",
    shortLabel: "Огайо",
    inLabel: "Огайо",
    stateCode: "OH",
    mapCenter: { lat: 40.4, lng: -82.8 },
    mapBounds: { north: 42.0, south: 38.4, west: -84.8, east: -80.5 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1505761671935-60b3a7427bad?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-or": stateHub({
    id: "state-or",
    shortLabel: "Орегон",
    inLabel: "Орегоне",
    stateCode: "OR",
    mapCenter: { lat: 44.0, lng: -120.5 },
    mapBounds: { north: 46.3, south: 41.9, west: -124.6, east: -116.5 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1565193298345-2d7890632db2?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-pa": stateHub({
    id: "state-pa",
    shortLabel: "Пенсильвания",
    inLabel: "Пенсильвании",
    stateCode: "PA",
    mapCenter: { lat: 40.9, lng: -77.2 },
    mapBounds: { north: 42.3, south: 39.7, west: -80.5, east: -74.7 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1569761371960-3cdb40141b43?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-tx": stateHub({
    id: "state-tx",
    shortLabel: "Техас",
    inLabel: "Техасе",
    stateCode: "TX",
    mapCenter: { lat: 31.0, lng: -99.0 },
    mapBounds: { north: 36.5, south: 25.8, west: -106.6, east: -93.5 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1530089711124-9ca31fb9e317?auto=format&fit=crop&w=2400&q=80",
  }),
  "state-fl": stateHub({
    id: "state-fl",
    shortLabel: "Флорида",
    inLabel: "Флориде",
    stateCode: "FL",
    mapCenter: { lat: 27.8, lng: -81.7 },
    mapBounds: { north: 31.0, south: 24.5, west: -87.6, east: -80.0 },
    panoramaUrl:
      "https://images.unsplash.com/photo-1533106497176-45ae19e68ba2?auto=format&fit=crop&w=2400&q=80",
  }),
};

/**
 * States A→Я with diaspora cities under each.
 * «Весь штат» = stateHubId; cities = cityHubIds.
 */
export const DIASPORA_STATE_GROUPS: readonly DiasporaStateGroup[] = [
  { label: "Аляска", stateHubId: "state-ak", cityHubIds: [] },
  { label: "Аризона", stateHubId: "state-az", cityHubIds: ["phoenix"] },
  { label: "Вашингтон", stateHubId: "state-wa", cityHubIds: ["seattle"] },
  { label: "Джорджия", stateHubId: "state-ga", cityHubIds: ["atlanta"] },
  { label: "Иллинойс", stateHubId: "state-il", cityHubIds: ["chicago"] },
  {
    label: "Калифорния",
    stateHubId: "state-ca",
    cityHubIds: [
      "inland-empire",
      "los-angeles",
      "orange-county",
      "sacramento",
      "san-diego",
      "san-francisco",
    ],
  },
  { label: "Колорадо", stateHubId: "state-co", cityHubIds: ["denver"] },
  { label: "Массачусетс", stateHubId: "state-ma", cityHubIds: ["boston"] },
  { label: "Миннесота", stateHubId: "state-mn", cityHubIds: ["minneapolis"] },
  { label: "Мэриленд", stateHubId: "state-md", cityHubIds: ["baltimore"] },
  { label: "Невада", stateHubId: "state-nv", cityHubIds: ["las-vegas"] },
  { label: "Нью-Джерси", stateHubId: "state-nj", cityHubIds: ["new-jersey"] },
  { label: "Нью-Йорк", stateHubId: "state-ny", cityHubIds: ["new-york"] },
  { label: "Огайо", stateHubId: "state-oh", cityHubIds: ["cleveland"] },
  { label: "Орегон", stateHubId: "state-or", cityHubIds: ["portland"] },
  { label: "Пенсильвания", stateHubId: "state-pa", cityHubIds: ["philadelphia"] },
  {
    label: "Техас",
    stateHubId: "state-tx",
    cityHubIds: ["austin", "dallas", "san-antonio", "houston"],
  },
  { label: "Флорида", stateHubId: "state-fl", cityHubIds: ["south-florida"] },
];

export const STATE_HUB_IDS = Object.keys(DIASPORA_STATE_HUBS);
