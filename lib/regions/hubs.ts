import {
  DIASPORA_STATE_GROUPS,
  DIASPORA_STATE_HUBS,
} from "@/lib/regions/diaspora-states";

/** Regional hubs for КРУГИ — diaspora metros + whole-state filters. */

export type RegionHubId =
  | "orange-county"
  | "los-angeles"
  | "inland-empire"
  | "san-diego"
  | "sacramento"
  | "san-francisco"
  | "chicago"
  | "south-florida"
  | "new-york"
  | "new-jersey"
  | "philadelphia"
  | "boston"
  | "seattle"
  | "portland"
  /** @deprecated legacy cookie id → portland */
  | "oregon"
  | "houston"
  | "dallas"
  | "austin"
  | "san-antonio"
  | "minneapolis"
  | "baltimore"
  | "atlanta"
  | "cleveland"
  | "phoenix"
  | "denver"
  | "las-vegas"
  | "state-ak"
  | "state-az"
  | "state-wa"
  | "state-ga"
  | "state-il"
  | "state-ca"
  | "state-co"
  | "state-ma"
  | "state-mn"
  | "state-md"
  | "state-nv"
  | "state-nj"
  | "state-ny"
  | "state-oh"
  | "state-or"
  | "state-pa"
  | "state-tx"
  | "state-fl"
  | "usa-overview"
  | "default";

/** Active hub keys stored in REGION_HUBS (excludes legacy oregon alias). */
export type ActiveRegionHubId = Exclude<
  RegionHubId,
  "default" | "usa-overview" | "oregon"
>;

/** California diaspora circles (template for other states). */
export const CALIFORNIA_HUB_IDS = [
  "orange-county",
  "los-angeles",
  "inland-empire",
  "san-diego",
  "sacramento",
  "san-francisco",
] as const satisfies readonly ActiveRegionHubId[];

/** @deprecated Use CALIFORNIA_HUB_IDS / SELECTABLE_HUB_IDS */
export const CALIFORNIA_LAUNCH_HUB_IDS = CALIFORNIA_HUB_IDS;

/** @deprecated Use CALIFORNIA_HUB_IDS */
export const SOCAL_LAUNCH_HUB_IDS = CALIFORNIA_HUB_IDS;

/** Metro / city diaspora circles (not whole-state filters). */
export const METRO_HUB_IDS = [
  "atlanta",
  "austin",
  "baltimore",
  "boston",
  "chicago",
  "cleveland",
  "dallas",
  "denver",
  "houston",
  "inland-empire",
  "las-vegas",
  "los-angeles",
  "minneapolis",
  "new-jersey",
  "new-york",
  "orange-county",
  "philadelphia",
  "phoenix",
  "portland",
  "sacramento",
  "san-antonio",
  "san-diego",
  "san-francisco",
  "seattle",
  "south-florida",
] as const satisfies readonly ActiveRegionHubId[];

/** @deprecated Use METRO_HUB_IDS + state hubs */
export const SELECTABLE_HUB_IDS = METRO_HUB_IDS;

export type RegionHubGroup = {
  label: string;
  hubIds: readonly ActiveRegionHubId[];
};

/** Sort hub labels with Russian locale (А…Я). */
export function compareHubLabelsRu(a: string, b: string): number {
  return a.localeCompare(b, "ru", { sensitivity: "base" });
}

export function normalizeStateCode(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s.startsWith("US-")) return s.slice(3) || null;
  if (/^[A-Z]{2}$/.test(s)) return s;
  return null;
}

/** Inclusive lat/lng box for home map pins (keep hubs from leaking into each other). */
export type RegionMapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type RegionHub = {
  id: RegionHubId;
  /** Prepositional place after «в»: «Оранж Каунти» */
  inLabel: string;
  /** Short label for UI chips */
  shortLabel: string;
  /** metro = diaspora city/county; state = whole US state */
  scope?: "metro" | "state";
  /** For state hubs: US-CA / CA */
  stateCodes?: readonly string[];
  /** Census county GEOIDs that map into this hub */
  countyGeoids: readonly string[];
  /** Full-bleed hero panorama (Unsplash / CDN). Swap for local assets anytime. */
  panoramaUrl: string;
  panoramaAlt: string;
  mapCenter: { lat: number; lng: number };
  mapZoom: number;
  /** Strict bounds for activity pins on the home map */
  mapBounds: RegionMapBounds;
  exampleQueries: readonly string[];
  /**
   * City / area name tokens for businesses without coordinates.
   * Matched case-insensitively against city+region+description location text.
   */
  cityAliases?: readonly string[];
};

export function isStateHub(hub: RegionHub | null | undefined): boolean {
  return hub?.scope === "state" || Boolean(hub?.stateCodes?.length);
}

/**
 * Active hubs. Add a hub here + county GEOIDs — ZIP/geo will pick it up automatically.
 * County FIPS: https://www.census.gov/library/reference/code-lists/ansi.html
 */
const METRO_REGION_HUBS = {
  "orange-county": {
    id: "orange-county",
    inLabel: "Оранж Каунти",
    shortLabel: "Оранж Каунти",
    countyGeoids: ["06059"],
    panoramaUrl:
      "https://images.unsplash.com/photo-1580655653885-65763b2597d0?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Побережье Orange County на закате",
    // Slightly north so San Clemente sits nearer the bottom edge of the home map frame
    mapCenter: { lat: 33.66, lng: -117.78 },
    mapZoom: 10.5,
    mapBounds: {
      north: 33.95,
      south: 33.38,
      west: -118.14,
      east: -117.4,
    },
    exampleQueries: [
      "русский ресторан рядом",
      "детский стоматолог Irvine",
      "ремонт машины Anaheim",
    ],
    cityAliases: [
      "orange county",
      "оранж каунти",
      "irvine",
      "anaheim",
      "santa ana",
      "costa mesa",
      "huntington beach",
      "newport beach",
      "tustin",
      "orange",
      "fullerton",
      "garden grove",
      "westminster",
      "mission viejo",
      "laguna hills",
      "laguna niguel",
      "laguna beach",
      "lake forest",
      "fountain valley",
      "buena park",
      "yorba linda",
      "placentia",
      "brea",
      "cypress",
      "los alamitos",
      "seal beach",
      "san clemente",
      "san juan capistrano",
      "dana point",
      "aliso viejo",
      "rancho santa margarita",
      "villa park",
      "stanton",
      "la habra",
      "la palma",
      "corona del mar",
    ],
  },
  "los-angeles": {
    id: "los-angeles",
    inLabel: "Лос-Анджелесе",
    shortLabel: "Лос-Анджелес",
    countyGeoids: ["06037"],
    panoramaUrl:
      "https://images.unsplash.com/photo-1515896769750-31548aa180ed?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Панорама Лос-Анджелеса",
    mapCenter: { lat: 34.0522, lng: -118.2437 },
    mapZoom: 10,
    mapBounds: {
      // Keep east of ~Seal Beach out of LA so OC cities (Anaheim, Irvine) don't leak in
      north: 34.35,
      south: 33.7,
      west: -118.7,
      east: -118.15,
    },
    exampleQueries: [
      "русский магазин в LA",
      "маникюр West Hollywood",
      "адвокат Glendale",
    ],
    cityAliases: [
      "los angeles",
      "лос-анджелес",
      "hollywood hills",
      "glendale",
      "burbank",
      "pasadena",
      "santa monica",
      "venice",
      "hollywood",
      "west hollywood",
      "studio city",
      "sherman oaks",
      "encino",
      "van nuys",
      "north hollywood",
      "long beach",
      "torrance",
      "redondo beach",
      "culver city",
      "westwood",
      "brentwood",
      "pacific palisades",
    ],
  },
  "inland-empire": {
    id: "inland-empire",
    inLabel: "Инленд-Эмпайре",
    shortLabel: "Инленд-Эмпайр",
    countyGeoids: [
      "06065", // Riverside
      "06071", // San Bernardino
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Горы Inland Empire",
    mapCenter: { lat: 34.05, lng: -117.3 },
    mapZoom: 10,
    mapBounds: {
      north: 34.35,
      south: 33.75,
      west: -117.7,
      east: -116.9,
    },
    exampleQueries: [
      "русский магазин Riverside",
      "стоматолог Rancho Cucamonga",
      "автосервис Ontario",
    ],
    cityAliases: [
      "inland empire",
      "riverside",
      "san bernardino",
      "ontario",
      "rancho cucamonga",
      "corona",
      "fontana",
      "moreno valley",
      "redlands",
      "upland",
      "chino",
      "chino hills",
      "temecula",
      "murrieta",
      "hemet",
      "perris",
      "victorville",
      "rialto",
    ],
  },
  "san-diego": {
    id: "san-diego",
    inLabel: "Сан-Диего",
    shortLabel: "Сан-Диего",
    countyGeoids: ["06073"],
    panoramaUrl:
      "https://images.unsplash.com/photo-1568849676085-51415703900f?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Панорама Сан-Диего",
    mapCenter: { lat: 32.7157, lng: -117.1611 },
    mapZoom: 11,
    mapBounds: {
      north: 33.2,
      // Stay north of the US–Mexico line (Tijuana starts ~32.53)
      south: 32.54,
      west: -117.35,
      east: -116.85,
    },
    exampleQueries: [
      "русский магазин San Diego",
      "стоматолог La Jolla",
      "автосервис Chula Vista",
    ],
    cityAliases: [
      "san diego",
      "сан-диего",
      "la jolla",
      "chula vista",
      "carlsbad",
      "oceanside",
      "escondido",
      "encinitas",
      "del mar",
      "poway",
      "el cajon",
      "la mesa",
      "national city",
    ],
  },
  sacramento: {
    id: "sacramento",
    inLabel: "Сакраменто",
    shortLabel: "Сакраменто",
    countyGeoids: ["06067"], // Sacramento County
    panoramaUrl:
      "https://images.unsplash.com/photo-1565008447742-97f6f38c985c?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Капитолий Сакраменто",
    mapCenter: { lat: 38.5816, lng: -121.4944 },
    mapZoom: 11,
    mapBounds: {
      north: 38.8,
      south: 38.35,
      west: -121.7,
      east: -121.2,
    },
    exampleQueries: [
      "русский магазин Sacramento",
      "юрист Sacramento",
      "стоматолог Roseville",
    ],
    cityAliases: [
      "sacramento",
      "сакраменто",
      "roseville",
      "elk grove",
      "folsom",
      "citrus heights",
      "rancho cordova",
      "carmichael",
      "fair oaks",
      "davis",
      "west sacramento",
      "natomas",
    ],
  },
  "san-francisco": {
    id: "san-francisco",
    inLabel: "Сан-Франциско",
    shortLabel: "Сан-Франциско",
    // SF city/county + close Bay cities often tagged as SF in listings
    countyGeoids: [
      "06075", // San Francisco
      "06081", // San Mateo
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Мост Золотые Ворота, Сан-Франциско",
    mapCenter: { lat: 37.7749, lng: -122.4194 },
    mapZoom: 11,
    mapBounds: {
      north: 37.95,
      south: 37.45,
      west: -122.55,
      east: -122.15,
    },
    exampleQueries: [
      "русский ресторан SF",
      "маникюр San Francisco",
      "адвокат Bay Area",
    ],
    cityAliases: [
      "san francisco",
      "сан-франциско",
      "sf",
      "bay area",
      "dali city",
      "daly city",
      "south san francisco",
      "pacifica",
      "san mateo",
      "burlingame",
      "millbrae",
      "brisbane",
    ],
  },
  seattle: {
    id: "seattle",
    inLabel: "Сиэтле",
    shortLabel: "Сиэтл",
    // King + nearby Snohomish / Pierce for Eastside / Tacoma spillover
    countyGeoids: [
      "53033", // King
      "53061", // Snohomish
      "53053", // Pierce
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1502175353174-a7a70e73b362?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Сиэтл и Space Needle",
    mapCenter: { lat: 47.6062, lng: -122.3321 },
    mapZoom: 10,
    // King + Pierce + Snohomish — keep in sync with countyGeoids above
    mapBounds: {
      north: 48.1,
      south: 47.05,
      west: -122.65,
      east: -121.7,
    },
    exampleQueries: [
      "русский магазин Seattle",
      "стоматолог Bellevue",
      "риэлтор Redmond",
    ],
    cityAliases: [
      "seattle",
      "сиэтл",
      "сиэттл",
      "bellevue",
      "redmond",
      "kirkland",
      "lynnwood",
      "everett",
      "tacoma",
      "renton",
      "kent",
      "federal way",
      "bothell",
      "shoreline",
      "issaquah",
      "sammamish",
      "mountlake terrace",
      "washington",
    ],
  },
  "new-york": {
    id: "new-york",
    inLabel: "Нью-Йорке",
    shortLabel: "Нью-Йорк",
    // NYC five boroughs + nearby common landing counties
    countyGeoids: [
      "36061", // New York (Manhattan)
      "36047", // Kings (Brooklyn)
      "36081", // Queens
      "36005", // Bronx
      "36085", // Richmond (Staten Island)
      "36059", // Nassau
      "36119", // Westchester
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Панорама Нью-Йорка",
    mapCenter: { lat: 40.7128, lng: -74.006 },
    mapZoom: 11,
    mapBounds: {
      north: 41.0,
      south: 40.45,
      west: -74.35,
      east: -73.65,
    },
    exampleQueries: [
      "русский ресторан Brooklyn",
      "стоматолог Brighton Beach",
      "юрист Manhattan",
    ],
  },
  portland: {
    id: "portland",
    inLabel: "Портленде",
    shortLabel: "Портленд",
    // Portland OR + Vancouver WA (same diaspora circle)
    countyGeoids: [
      "41051", // Multnomah
      "41067", // Washington (OR)
      "41005", // Clackamas
      "53011", // Clark (Vancouver WA)
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1565193298345-2d7890632db2?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Портленд и мост",
    mapCenter: { lat: 45.52, lng: -122.55 },
    mapZoom: 10,
    mapBounds: {
      north: 45.85,
      south: 45.25,
      west: -123.05,
      east: -122.25,
    },
    exampleQueries: [
      "русский магазин Portland",
      "репетитор Beaverton",
      "автосервис Vancouver",
    ],
    cityAliases: [
      "portland",
      "портленд",
      "beaverton",
      "hillsboro",
      "gresham",
      "lake oswego",
      "tigard",
      "happy valley",
      "troutdale",
      "oregon city",
      "vancouver",
      "battle ground",
      "camas",
      "washougal",
    ],
  },
  chicago: {
    id: "chicago",
    inLabel: "Чикаго",
    shortLabel: "Чикаго",
    countyGeoids: [
      "17031", // Cook
      "17097", // Lake IL
      "17043", // DuPage
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1477959858617-67f85b34b5df?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Чикаго skyline",
    mapCenter: { lat: 41.95, lng: -87.75 },
    mapZoom: 10,
    mapBounds: {
      north: 42.35,
      south: 41.6,
      west: -88.15,
      east: -87.45,
    },
    exampleQueries: [
      "русский магазин Chicago",
      "стоматолог Skokie",
      "адвокат Buffalo Grove",
    ],
    cityAliases: [
      "chicago",
      "чикаго",
      "skokie",
      "скоки",
      "wheeling",
      "buffalo grove",
      "northbrook",
      "glenview",
      "niles",
      "arlington heights",
      "evanston",
      "des plaines",
      "palatine",
      "highland park",
      "rogers park",
      "lincolnwood",
      "morton grove",
      "vernon hills",
      "deerfield",
    ],
  },
  "south-florida": {
    id: "south-florida",
    inLabel: "Южной Флориде",
    shortLabel: "Южная Флорида",
    countyGeoids: [
      "12086", // Miami-Dade
      "12011", // Broward
      "12099", // Palm Beach
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1533106497176-45ae19e68ba2?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Побережье South Florida",
    mapCenter: { lat: 26.05, lng: -80.2 },
    mapZoom: 10,
    mapBounds: {
      north: 26.55,
      south: 25.7,
      west: -80.45,
      east: -80.05,
    },
    exampleQueries: [
      "русский магазин Sunny Isles",
      "риэлтор Aventura",
      "ресторан Hallandale",
    ],
    cityAliases: [
      "south florida",
      "sunny isles",
      "sunny isles beach",
      "miami",
      "майами",
      "miami beach",
      "aventura",
      "hallandale",
      "hallandale beach",
      "hollywood",
      "boca raton",
      "fort lauderdale",
      "hollywood beach",
      "north miami",
      "north miami beach",
      "pompano beach",
      "coral gables",
      "bal harbour",
    ],
  },
  philadelphia: {
    id: "philadelphia",
    inLabel: "Филадельфии",
    shortLabel: "Филадельфия",
    countyGeoids: [
      "42101", // Philadelphia
      "42017", // Bucks
      "42091", // Montgomery
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1569761371960-3cdb40141b43?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Филадельфия",
    mapCenter: { lat: 40.1, lng: -75.05 },
    mapZoom: 10,
    mapBounds: {
      north: 40.35,
      south: 39.85,
      west: -75.35,
      east: -74.85,
    },
    exampleQueries: [
      "русский магазин Philadelphia",
      "стоматолог Bustleton",
      "адвокат Southampton",
    ],
    cityAliases: [
      "philadelphia",
      "филадельфия",
      "philly",
      "bustleton",
      "somerton",
      "southampton",
      "feasterville",
      "feasterville-trevose",
      "northeast philadelphia",
      "warminster",
      "newtown",
      "browns mills",
    ],
  },
  boston: {
    id: "boston",
    inLabel: "Бостоне",
    shortLabel: "Бостон",
    countyGeoids: [
      "25025", // Suffolk
      "25017", // Middlesex
      "25021", // Norfolk
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1501979376754-2ff867a4f659?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Бостон",
    mapCenter: { lat: 42.36, lng: -71.2 },
    mapZoom: 10,
    mapBounds: {
      north: 42.55,
      south: 42.15,
      west: -71.55,
      east: -70.9,
    },
    exampleQueries: [
      "русский магазин Boston",
      "репетитор Newton",
      "стоматолог Framingham",
    ],
    cityAliases: [
      "boston",
      "бостон",
      "newton",
      "framingham",
      "brookline",
      "cambridge",
      "somerville",
      "lynn",
      "swampscott",
      "natick",
      "lexington",
      "needham",
      "allston",
      "brighton",
      "waltham",
      "malden",
    ],
  },
  houston: {
    id: "houston",
    inLabel: "Хьюстоне",
    shortLabel: "Хьюстон",
    countyGeoids: [
      "48201", // Harris
      "48157", // Fort Bend
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1530089711124-9ca31fb9e317?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Хьюстон",
    mapCenter: { lat: 29.76, lng: -95.37 },
    mapZoom: 10,
    mapBounds: {
      north: 30.05,
      south: 29.5,
      west: -95.75,
      east: -95.05,
    },
    exampleQueries: [
      "русский магазин Houston",
      "адвокат Sugar Land",
      "стоматолог The Woodlands",
    ],
    cityAliases: [
      "houston",
      "хьюстон",
      "sugar land",
      "the woodlands",
      "pearland",
      "katy",
      "pasadena",
      "missouri city",
    ],
  },
  dallas: {
    id: "dallas",
    inLabel: "Далласе",
    shortLabel: "Даллас",
    countyGeoids: [
      "48113", // Dallas
      "48085", // Collin
      "48121", // Denton
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1545193544-312983719507?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Даллас",
    mapCenter: { lat: 32.95, lng: -96.8 },
    mapZoom: 10,
    mapBounds: {
      north: 33.25,
      south: 32.65,
      west: -97.15,
      east: -96.5,
    },
    exampleQueries: [
      "русский магазин Dallas",
      "риэлтор Plano",
      "стоматолог Richardson",
    ],
    cityAliases: [
      "dallas",
      "даллас",
      "plano",
      "richardson",
      "frisco",
      "allen",
      "carrollton",
      "farmers branch",
      "irving",
      "garland",
      "mckinney",
    ],
  },
  minneapolis: {
    id: "minneapolis",
    inLabel: "Миннеаполисе",
    shortLabel: "Миннеаполис",
    countyGeoids: [
      "27053", // Hennepin
      "27123", // Ramsey
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Миннеаполис",
    mapCenter: { lat: 44.95, lng: -93.3 },
    mapZoom: 10,
    mapBounds: {
      north: 45.15,
      south: 44.75,
      west: -93.55,
      east: -93.05,
    },
    exampleQueries: [
      "русский магазин Minneapolis",
      "адвокат St Paul",
      "стоматолог Plymouth",
    ],
    cityAliases: [
      "minneapolis",
      "миннеаполис",
      "st paul",
      "saint paul",
      "plymouth",
      "burnsville",
      "golden valley",
      "st louis park",
      "bloomington",
      "eden prairie",
      "minnetonka",
      "maple grove",
      "minnesota",
    ],
  },
  baltimore: {
    id: "baltimore",
    inLabel: "Балтиморе",
    shortLabel: "Балтимор",
    // Pikesville / Reisterstown Russian-speaking circle
    countyGeoids: [
      "24510", // Baltimore city
      "24005", // Baltimore County
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1617581629397-a72507c3de9e?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Балтимор",
    mapCenter: { lat: 39.35, lng: -76.7 },
    mapZoom: 11,
    mapBounds: {
      north: 39.55,
      south: 39.2,
      west: -76.9,
      east: -76.5,
    },
    exampleQueries: [
      "русский магазин Pikesville",
      "стоматолог Reisterstown",
      "адвокат Baltimore",
    ],
    cityAliases: [
      "baltimore",
      "балтимор",
      "pikesville",
      "reisterstown",
      "owings mills",
      "towson",
      "randallstown",
      "glyndon",
    ],
  },
  atlanta: {
    id: "atlanta",
    inLabel: "Атланте",
    shortLabel: "Атланта",
    countyGeoids: [
      "13121", // Fulton
      "13135", // Gwinnett
      "13089", // DeKalb
      "13067", // Cobb
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1575936123452-b67c3203c355?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Атланта",
    mapCenter: { lat: 33.9, lng: -84.3 },
    mapZoom: 10,
    mapBounds: {
      north: 34.15,
      south: 33.65,
      west: -84.55,
      east: -84.05,
    },
    exampleQueries: [
      "русский магазин Atlanta",
      "стоматолог Alpharetta",
      "риэлтор Roswell",
    ],
    cityAliases: [
      "atlanta",
      "атланта",
      "roswell",
      "alpharetta",
      "marietta",
      "sandy springs",
      "norcross",
      "duluth",
      "johns creek",
      "peachtree corners",
      "lawrenceville",
      "doraville",
      "lilburn",
    ],
  },
  austin: {
    id: "austin",
    inLabel: "Остине",
    shortLabel: "Остин",
    countyGeoids: [
      "48453", // Travis
      "48491", // Williamson
      "48021", // Bastrop
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1531218150217-54595bc2b934?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Остин",
    mapCenter: { lat: 30.27, lng: -97.74 },
    mapZoom: 10,
    mapBounds: {
      north: 30.55,
      south: 30.05,
      west: -98.0,
      east: -97.45,
    },
    exampleQueries: [
      "русский магазин Austin",
      "репетитор Round Rock",
      "стоматолог Cedar Park",
    ],
    cityAliases: [
      "austin",
      "остин",
      "round rock",
      "cedar park",
      "pflugerville",
      "georgetown",
      "leander",
      "kyle",
      "bee cave",
    ],
  },
  "san-antonio": {
    id: "san-antonio",
    inLabel: "Сан-Антонио",
    shortLabel: "Сан-Антонио",
    countyGeoids: [
      "48029", // Bexar
      "48091", // Comal
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1587595431973-160d0d94add1?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Сан-Антонио",
    mapCenter: { lat: 29.42, lng: -98.49 },
    mapZoom: 10,
    mapBounds: {
      north: 29.65,
      south: 29.25,
      west: -98.7,
      east: -98.25,
    },
    exampleQueries: [
      "русский магазин San Antonio",
      "адвокат San Antonio",
      "стоматолог New Braunfels",
    ],
    cityAliases: [
      "san antonio",
      "сан-антонио",
      "сан антонио",
      "new braunfels",
      "schertz",
      "universal city",
    ],
  },
  cleveland: {
    id: "cleveland",
    inLabel: "Кливленде",
    shortLabel: "Кливленд",
    // Parma / Mayfield — classic Cleveland Russian circle; RusRek Cleveland
    countyGeoids: [
      "39035", // Cuyahoga
      "39085", // Lake OH
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1505761671935-60b3a7427bad?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Кливленд",
    mapCenter: { lat: 41.45, lng: -81.65 },
    mapZoom: 10,
    mapBounds: {
      north: 41.65,
      south: 41.25,
      west: -81.9,
      east: -81.35,
    },
    exampleQueries: [
      "русский магазин Parma",
      "стоматолог Mayfield",
      "адвокат Cleveland",
    ],
    cityAliases: [
      "cleveland",
      "кливленд",
      "parma",
      "mayfield",
      "mayfield heights",
      "willoughby",
      "lyndhurst",
      "woodmere",
      "beachwood",
      "solon",
    ],
  },
  phoenix: {
    id: "phoenix",
    inLabel: "Финиксе",
    shortLabel: "Финикс",
    countyGeoids: ["04013"], // Maricopa
    panoramaUrl:
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Финикс",
    mapCenter: { lat: 33.45, lng: -112.07 },
    mapZoom: 10,
    mapBounds: {
      north: 33.75,
      south: 33.2,
      west: -112.4,
      east: -111.75,
    },
    exampleQueries: [
      "русский магазин Phoenix",
      "риэлтор Scottsdale",
      "стоматолог Chandler",
    ],
    cityAliases: [
      "phoenix",
      "финикс",
      "scottsdale",
      "chandler",
      "mesa",
      "tempe",
      "glendale az",
      "surprise",
      "peoria",
      "gilbert",
    ],
  },
  denver: {
    id: "denver",
    inLabel: "Денвере",
    shortLabel: "Денвер",
    countyGeoids: [
      "08031", // Denver
      "08005", // Arapahoe
      "08059", // Jefferson
      "08001", // Adams
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1546156929-a4c0ac411f47?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Денвер",
    mapCenter: { lat: 39.74, lng: -104.99 },
    mapZoom: 10,
    mapBounds: {
      north: 39.95,
      south: 39.55,
      west: -105.25,
      east: -104.7,
    },
    exampleQueries: [
      "русский магазин Denver",
      "стоматолог Aurora",
      "риэлтор Lakewood",
    ],
    cityAliases: [
      "denver",
      "денвер",
      "aurora",
      "lakewood",
      "littleton",
      "englewood",
      "centennial",
      "westminster",
      "arvada",
      "boulder",
    ],
  },
  "las-vegas": {
    id: "las-vegas",
    inLabel: "Лас-Вегасе",
    shortLabel: "Лас-Вегас",
    countyGeoids: ["32003"], // Clark
    panoramaUrl:
      "https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Лас-Вегас",
    mapCenter: { lat: 36.17, lng: -115.14 },
    mapZoom: 10,
    mapBounds: {
      north: 36.35,
      south: 35.95,
      west: -115.35,
      east: -114.95,
    },
    exampleQueries: [
      "русский магазин Las Vegas",
      "риэлтор Henderson",
      "стоматолог Summerlin",
    ],
    cityAliases: [
      "las vegas",
      "лас-вегас",
      "vegas",
      "henderson",
      "summerlin",
      "north las vegas",
      "paradise",
      "enterprise",
    ],
  },
  "new-jersey": {
    id: "new-jersey",
    inLabel: "Фэр-Лоуне",
    shortLabel: "Фэр-Лоун",
    // Fair Lawn / Bergen + Central Jersey Russian circles (separate from NYC)
    countyGeoids: [
      "34003", // Bergen
      "34023", // Middlesex
      "34025", // Monmouth
      "34013", // Essex
      "34027", // Morris
      "34039", // Union
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1568515387631-8b650bbcdb90?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Нью-Джерси",
    mapCenter: { lat: 40.7, lng: -74.25 },
    mapZoom: 9,
    mapBounds: {
      north: 41.05,
      south: 40.25,
      west: -74.7,
      east: -73.95,
    },
    exampleQueries: [
      "русский магазин Fair Lawn",
      "стоматолог East Brunswick",
      "риэлтор Fort Lee",
    ],
    cityAliases: [
      "new jersey",
      "нью-джерси",
      "fair lawn",
      "fairlawn",
      "fort lee",
      "east brunswick",
      "marlboro",
      "livingston",
      "paramus",
      "teaneck",
      "englewood",
      "edison",
      "freehold",
      "wayne",
    ],
  },
} as const satisfies Record<(typeof METRO_HUB_IDS)[number], RegionHub>;

export const REGION_HUBS: Record<ActiveRegionHubId, RegionHub> = {
  ...METRO_REGION_HUBS,
  ...(DIASPORA_STATE_HUBS as Record<string, RegionHub>),
} as unknown as Record<ActiveRegionHubId, RegionHub>;

/** Default when ZIP/geo unknown — SoCal launch market (after guest picks a region). */
export const DEFAULT_REGION_HUB: RegionHub = REGION_HUBS["orange-county"];

/**
 * Guest home before region/geo — continental USA camera (not a picker option).
 * Pins still come from loaded hubs; map frame shows the whole country.
 */
export const USA_OVERVIEW_HUB: RegionHub = {
  id: "usa-overview",
  inLabel: "США",
  shortLabel: "США",
  countyGeoids: [],
  panoramaUrl:
    "https://images.unsplash.com/photo-1485738422979-f5c462d49f74?auto=format&fit=crop&w=2400&q=80",
  panoramaAlt: "Панорама США",
  mapCenter: { lat: 39.5, lng: -98.35 },
  mapZoom: 4,
  mapBounds: {
    north: 49.4,
    south: 24.5,
    west: -125.0,
    east: -66.9,
  },
  exampleQueries: [
    "русский ресторан",
    "детский стоматолог",
    "помощь с документами",
  ],
};

export function isUsaOverviewHub(hub: RegionHub | null | undefined): boolean {
  return hub?.id === "usa-overview";
}

export type RegionPickerStateGroup = {
  label: string;
  stateHub: RegionHub;
  cityHubs: RegionHub[];
};

/** States A→Я with «Весь штат» + diaspora cities (sorted). */
export function getRegionPickerGroups(): RegionPickerStateGroup[] {
  return DIASPORA_STATE_GROUPS.map((group) => ({
    label: group.label,
    stateHub: REGION_HUBS[group.stateHubId as ActiveRegionHubId],
    cityHubs: [...group.cityHubIds]
      .map((id) => REGION_HUBS[id as ActiveRegionHubId])
      .sort((a, b) => compareHubLabelsRu(a.shortLabel, b.shortLabel)),
  }));
}

/** @deprecated Prefer getRegionPickerGroups — flat list of metros A→Я. */
export function getSelectableRegionHubs(): RegionHub[] {
  const local = METRO_HUB_IDS.map((id) => REGION_HUBS[id]).sort((a, b) =>
    compareHubLabelsRu(a.shortLabel, b.shortLabel),
  );
  return [USA_OVERVIEW_HUB, ...local];
}

/** Hubs used to load home map pins (metros + state frames). */
export function getMapPinRegionHubs(): RegionHub[] {
  return [
    ...METRO_HUB_IDS.map((id) => REGION_HUBS[id]),
    ...DIASPORA_STATE_GROUPS.map(
      (g) => REGION_HUBS[g.stateHubId as ActiveRegionHubId],
    ),
  ];
}

/** @deprecated */
export const REGION_HUB_GROUPS: RegionHubGroup[] = DIASPORA_STATE_GROUPS.map(
  (g) => ({
    label: g.label,
    hubIds: [g.stateHubId as ActiveRegionHubId, ...(g.cityHubIds as ActiveRegionHubId[])],
  }),
);

const COUNTY_TO_HUB = new Map<string, RegionHub>();
for (const hub of Object.values(REGION_HUBS)) {
  for (const geoid of hub.countyGeoids) {
    COUNTY_TO_HUB.set(geoid, hub);
  }
}

export function getRegionHubById(id: string | null | undefined): RegionHub {
  if (!id || id === "default") return DEFAULT_REGION_HUB;
  if (id === "usa-overview") return USA_OVERVIEW_HUB;
  // Legacy cookie / URL id from when Portland was labeled «Oregon»
  if (id === "oregon") return REGION_HUBS.portland;
  return REGION_HUBS[id as ActiveRegionHubId] ?? DEFAULT_REGION_HUB;
}

export function getRegionHubByCountyGeoid(
  countyGeoid: string | null | undefined,
): RegionHub | null {
  if (!countyGeoid) return null;
  return COUNTY_TO_HUB.get(countyGeoid) ?? null;
}

export function resolveRegionHub(input: {
  countyGeoid?: string | null;
  hubId?: string | null;
}): RegionHub {
  if (input.hubId) return getRegionHubById(input.hubId);
  return getRegionHubByCountyGeoid(input.countyGeoid) ?? DEFAULT_REGION_HUB;
}

export function isLatLngInHubBounds(
  lat: number,
  lng: number,
  hub: RegionHub,
): boolean {
  const b = hub.mapBounds;
  return (
    lat <= b.north &&
    lat >= b.south &&
    lng <= b.east &&
    lng >= b.west
  );
}

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/**
 * Token match on whole words only. A plain `includes` puts Portland, Philadelphia
 * and Laguna Hills into the Los Angeles hub, so a token may not sit inside a longer word.
 */
function containsLocationToken(haystack: string, token: string): boolean {
  for (let from = 0; from <= haystack.length - token.length; ) {
    const at = haystack.indexOf(token, from);
    if (at < 0) return false;
    const before = at > 0 ? haystack[at - 1] : "";
    const after = haystack[at + token.length] ?? "";
    if (!WORD_CHAR_RE.test(before) && !WORD_CHAR_RE.test(after)) return true;
    from = at + 1;
  }
  return false;
}

/** Text location (city/region) against hub labels + city aliases. */
export function locationTextMatchesHub(
  locationText: string,
  hub: RegionHub,
): boolean {
  const loc = locationText.toLowerCase();
  if (!loc.trim()) return false;
  const tokens = [
    hub.shortLabel.toLowerCase(),
    hub.inLabel.toLowerCase(),
    ...(hub.cityAliases ?? []),
  ];
  return tokens.some((token) => token && containsLocationToken(loc, token));
}

/**
 * Hub match for a catalog row.
 * county_geoid wins when present (USA Location Canon).
 * Legacy fallback: coordinates → city aliases → city+region text.
 */
export function locationFieldsMatchHub(
  fields: {
    city?: string | null;
    region?: string | null;
    text?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    countyGeoid?: string | null;
    county_geoid?: string | null;
    stateCode?: string | null;
    state_code?: string | null;
  },
  hub: RegionHub,
): boolean {
  // National overview = whole catalog for this filter.
  if (isUsaOverviewHub(hub)) return true;

  const rowState = normalizeStateCode(
    fields.stateCode ?? fields.state_code ?? null,
  );

  // Whole-state hub: match by state_code, else lat/lng in state box.
  if (isStateHub(hub) && hub.stateCodes?.length) {
    const hubStates = new Set(
      hub.stateCodes.map((c) => normalizeStateCode(c)).filter(Boolean),
    );
    if (rowState && hubStates.has(rowState)) return true;
    const lat = fields.latitude;
    const lng = fields.longitude;
    if (
      typeof lat === "number" &&
      Number.isFinite(lat) &&
      typeof lng === "number" &&
      Number.isFinite(lng)
    ) {
      return isLatLngInHubBounds(lat, lng, hub);
    }
    return false;
  }

  const countyGeoid = fields.countyGeoid ?? fields.county_geoid ?? null;
  if (countyGeoid && hub.countyGeoids.length > 0) {
    return hub.countyGeoids.includes(countyGeoid);
  }

  const lat = fields.latitude;
  const lng = fields.longitude;
  if (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng)
  ) {
    return isLatLngInHubBounds(lat, lng, hub);
  }

  const city = (fields.city ?? "").trim();
  if (city) {
    const byCity = METRO_HUB_IDS.map((id) => REGION_HUBS[id]).filter((h) =>
      locationTextMatchesHub(city, h),
    );
    if (byCity.length > 0) {
      return byCity.some((h) => h.id === hub.id);
    }
  }

  const loc = `${city} ${fields.region ?? ""} ${fields.text ?? ""}`;
  return locationTextMatchesHub(loc, hub);
}

export function isLatLngInAnyHub(
  lat: number,
  lng: number,
  hubs: readonly RegionHub[],
): boolean {
  return hubs.some((hub) => isLatLngInHubBounds(lat, lng, hub));
}

/** Parse `hub` query/cookie — supports one id or comma-separated list. */
export function parseHubIds(raw: string | null | undefined): string[] {
  if (!raw) return [DEFAULT_REGION_HUB.id];
  const parts = decodeURIComponent(raw)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((id) => getRegionHubById(id).id);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of parts) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : [DEFAULT_REGION_HUB.id];
}

export function serializeHubIds(ids: readonly string[]): string {
  return parseHubIds(ids.join(",")).join(",");
}

export function getRegionHubsByIds(ids: readonly string[]): RegionHub[] {
  return parseHubIds(ids.join(",")).map((id) => getRegionHubById(id));
}

export function formatHubsInLabel(hubs: readonly RegionHub[]): string {
  if (hubs.length === 0) return DEFAULT_REGION_HUB.inLabel;
  if (hubs.length === 1) return hubs[0].inLabel;
  if (hubs.length === 2) return `${hubs[0].inLabel} и ${hubs[1].inLabel}`;
  const head = hubs
    .slice(0, -1)
    .map((h) => h.inLabel)
    .join(", ");
  return `${head} и ${hubs[hubs.length - 1].inLabel}`;
}

export function formatHubsShortLabel(hubs: readonly RegionHub[]): string {
  if (hubs.length === 0) return DEFAULT_REGION_HUB.shortLabel;
  if (hubs.length === 1) return hubs[0].shortLabel;
  if (hubs.length === 2) return `${hubs[0].shortLabel} + ${hubs[1].shortLabel}`;
  return `${hubs[0].shortLabel} +${hubs.length - 1}`;
}

/**
 * Web-Mercator zoom for `bounds` in a map face of `size` px.
 * Home face is ~2× page width — fixed low zooms undershoot and show Baja.
 * `contain` = entire bounds visible (may show outside); `cover` = bounds fill the frame (may crop).
 */
export function zoomToFitBounds(
  bounds: RegionMapBounds,
  size: { width: number; height: number },
  options?: { paddingRatio?: number; fit?: "contain" | "cover" },
): number {
  const paddingRatio = options?.paddingRatio ?? 0.1;
  const fit = options?.fit ?? "contain";
  const width = Math.max(1, size.width * (1 - paddingRatio * 2));
  const height = Math.max(1, size.height * (1 - paddingRatio * 2));

  const mercatorY = (lat: number) => {
    const sin = Math.sin((lat * Math.PI) / 180);
    const clamped = Math.min(0.9999, Math.max(-0.9999, sin));
    return 0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI);
  };

  const xSpan = Math.max(1e-9, (bounds.east - bounds.west) / 360);
  const ySpan = Math.max(
    1e-9,
    Math.abs(mercatorY(bounds.north) - mercatorY(bounds.south)),
  );
  const zoomX = Math.log2(width / (256 * xSpan));
  const zoomY = Math.log2(height / (256 * ySpan));
  const zoom = fit === "cover" ? Math.max(zoomX, zoomY) : Math.min(zoomX, zoomY);
  if (!Number.isFinite(zoom)) return 10;
  return Math.min(12, Math.max(7.5, zoom));
}

/** Union map view — tighter bounds; zoom refined with viewport via zoomToFitBounds. */
export function mergeHubsForMap(hubs: readonly RegionHub[]): RegionHub {
  const list = hubs.length > 0 ? [...hubs] : [DEFAULT_REGION_HUB];
  if (list.length === 1) return list[0];

  const raw: RegionMapBounds = {
    north: Math.max(...list.map((h) => h.mapBounds.north)),
    south: Math.min(...list.map((h) => h.mapBounds.south)),
    east: Math.max(...list.map((h) => h.mapBounds.east)),
    west: Math.min(...list.map((h) => h.mapBounds.west)),
  };
  // Light pad on north/coast only — never push south into Mexico
  const padLat = Math.min(0.05, (raw.north - raw.south) * 0.03);
  const padLng = Math.min(0.06, (raw.east - raw.west) * 0.04);
  const bounds: RegionMapBounds = {
    north: raw.north + padLat,
    south: raw.south,
    east: raw.east + padLng,
    west: raw.west - padLng,
  };
  const mapCenter = {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.west + bounds.east) / 2,
  };
  // Fallback before face measure — cover page-sized frame so Baja stays out
  const mapZoom = zoomToFitBounds(
    bounds,
    { width: 1200, height: 920 },
    { paddingRatio: 0.06, fit: "cover" },
  );

  return {
    ...list[0],
    id: list[0].id,
    inLabel: formatHubsInLabel(list),
    shortLabel: formatHubsShortLabel(list),
    countyGeoids: list.flatMap((h) => [...h.countyGeoids]),
    mapCenter,
    mapZoom,
    mapBounds: bounds,
  };
}

export const GUEST_REGION_STORAGE_KEY = "krugi-region-hub";
/** Cookie mirror of guest hub(s) so the server Header can read it. */
export const GUEST_REGION_COOKIE = "krugi-hub";

export function withHubParam(href: string, hubIds: string | readonly string[]): string {
  const serialized = Array.isArray(hubIds)
    ? serializeHubIds(hubIds)
    : serializeHubIds(String(hubIds).split(","));
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}hub=${encodeURIComponent(serialized)}`;
}

/** Persist guest hub selection (one or many) for client + server. */
export function persistGuestHubIds(hubIds: readonly string[]) {
  const cleaned = hubIds
    .map((id) => id.trim())
    .filter((id) => id && id !== "default");
  const metros = cleaned.filter((id) => id !== "usa-overview");
  // США is exclusive: alone, or drop it when any local hub is chosen.
  const finalIds =
    metros.length > 0
      ? metros
      : cleaned.includes("usa-overview")
        ? ["usa-overview"]
        : [];

  if (finalIds.length === 0) {
    try {
      localStorage.removeItem(GUEST_REGION_STORAGE_KEY);
    } catch {
      // ignore
    }
    try {
      document.cookie = `${GUEST_REGION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    } catch {
      // ignore
    }
    return;
  }
  const serialized = serializeHubIds(finalIds);
  try {
    localStorage.setItem(GUEST_REGION_STORAGE_KEY, serialized);
  } catch {
    // ignore
  }
  try {
    document.cookie = `${GUEST_REGION_COOKIE}=${encodeURIComponent(serialized)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  } catch {
    // ignore
  }
}

/** @deprecated use persistGuestHubIds */
export function persistGuestHubId(hubId: string) {
  persistGuestHubIds([hubId]);
}
