/** Regional hubs for КРУГИ — county → metro area + panorama. Easy to extend (NY, Oregon, …). */

export type RegionHubId =
  | "orange-county"
  | "los-angeles"
  | "san-diego"
  | "sacramento"
  | "san-francisco"
  | "seattle"
  | "new-york"
  | "oregon"
  | "default";

/** California hubs shown in the home / header region picker. */
export const CALIFORNIA_LAUNCH_HUB_IDS = [
  "orange-county",
  "los-angeles",
  "san-diego",
  "sacramento",
  "san-francisco",
] as const satisfies readonly Exclude<RegionHubId, "default">[];

/** @deprecated Use CALIFORNIA_LAUNCH_HUB_IDS */
export const SOCAL_LAUNCH_HUB_IDS = CALIFORNIA_LAUNCH_HUB_IDS;

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

/**
 * Active hubs. Add a hub here + county GEOIDs — ZIP/geo will pick it up automatically.
 * County FIPS: https://www.census.gov/library/reference/code-lists/ansi.html
 */
export const REGION_HUBS: Record<Exclude<RegionHubId, "default">, RegionHub> = {
  "orange-county": {
    id: "orange-county",
    inLabel: "Оранж Каунти",
    shortLabel: "Orange County",
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
    shortLabel: "Los Angeles",
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
      "la",
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
  "san-diego": {
    id: "san-diego",
    inLabel: "Сан-Диего",
    shortLabel: "San Diego",
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
    shortLabel: "Sacramento",
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
    shortLabel: "San Francisco",
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
    shortLabel: "Seattle",
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
    mapZoom: 11,
    mapBounds: {
      north: 47.85,
      south: 47.35,
      west: -122.55,
      east: -121.95,
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
    shortLabel: "New York",
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
  oregon: {
    id: "oregon",
    inLabel: "Орегоне",
    shortLabel: "Oregon",
    countyGeoids: [
      "41051", // Multnomah (Portland)
      "41067", // Washington
      "41005", // Clackamas
      "41039", // Lane (Eugene)
    ],
    panoramaUrl:
      "https://images.unsplash.com/photo-1565193298345-2d7890632db2?auto=format&fit=crop&w=2400&q=80",
    panoramaAlt: "Пейзаж Орегона",
    mapCenter: { lat: 45.5152, lng: -122.6784 },
    mapZoom: 10,
    mapBounds: {
      north: 45.75,
      south: 45.25,
      west: -123.05,
      east: -122.35,
    },
    exampleQueries: [
      "русский магазин Portland",
      "репетитор Portland",
      "автосервис Beaverton",
    ],
  },
};

/** Default when ZIP/geo unknown — SoCal launch market. */
export const DEFAULT_REGION_HUB: RegionHub = REGION_HUBS["orange-county"];

/** Ordered list for the home «Изменить» region picker (California launch markets). */
export function getSelectableRegionHubs(): RegionHub[] {
  return CALIFORNIA_LAUNCH_HUB_IDS.map((id) => REGION_HUBS[id]);
}

const COUNTY_TO_HUB = new Map<string, RegionHub>();
for (const hub of Object.values(REGION_HUBS)) {
  for (const geoid of hub.countyGeoids) {
    COUNTY_TO_HUB.set(geoid, hub);
  }
}

export function getRegionHubById(id: string | null | undefined): RegionHub {
  if (!id || id === "default") return DEFAULT_REGION_HUB;
  return REGION_HUBS[id as Exclude<RegionHubId, "default">] ?? DEFAULT_REGION_HUB;
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
  return tokens.some((token) => token && loc.includes(token));
}

/**
 * Hub match for a catalog row.
 * Coordinates win. If `city` clearly belongs to a launch hub, only that hub
 * matches — a wrong default `region` like «Orange County» on a Sacramento
 * business must not pull it into OC search.
 */
export function locationFieldsMatchHub(
  fields: {
    city?: string | null;
    region?: string | null;
    text?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  },
  hub: RegionHub,
): boolean {
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
    const byCity = getSelectableRegionHubs().filter((h) =>
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
  const serialized = serializeHubIds(hubIds);
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
