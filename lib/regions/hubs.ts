/** Regional hubs for КРУГИ — county → metro area + panorama. Easy to extend (NY, Oregon, …). */

export type RegionHubId =
  | "orange-county"
  | "los-angeles"
  | "san-diego"
  | "new-york"
  | "oregon"
  | "default";

/** Southern California launch hubs shown in the home region picker. */
export const SOCAL_LAUNCH_HUB_IDS = [
  "orange-county",
  "los-angeles",
  "san-diego",
] as const satisfies readonly Exclude<RegionHubId, "default">[];

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
      south: 32.5,
      west: -117.35,
      east: -116.85,
    },
    exampleQueries: [
      "русский магазин San Diego",
      "стоматолог La Jolla",
      "автосервис Chula Vista",
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

/** Ordered list for the home «Изменить» region picker (SoCal first). */
export function getSelectableRegionHubs(): RegionHub[] {
  return SOCAL_LAUNCH_HUB_IDS.map((id) => REGION_HUBS[id]);
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

/** Union map view — wider bounds / lower zoom when several hubs are selected. */
export function mergeHubsForMap(hubs: readonly RegionHub[]): RegionHub {
  const list = hubs.length > 0 ? [...hubs] : [DEFAULT_REGION_HUB];
  if (list.length === 1) return list[0];

  const raw: RegionMapBounds = {
    north: Math.max(...list.map((h) => h.mapBounds.north)),
    south: Math.min(...list.map((h) => h.mapBounds.south)),
    east: Math.max(...list.map((h) => h.mapBounds.east)),
    west: Math.min(...list.map((h) => h.mapBounds.west)),
  };
  // Pad so coast / edges aren't clipped under the 3D trapezoid + fades
  const padLat = (raw.north - raw.south) * 0.08;
  const padLng = (raw.east - raw.west) * 0.08;
  const bounds: RegionMapBounds = {
    north: raw.north + padLat,
    south: raw.south - padLat,
    east: raw.east + padLng,
    west: raw.west - padLng,
  };
  const mapCenter = {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.west + bounds.east) / 2,
  };
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;
  const span = Math.max(latSpan, lngSpan);
  // Zoom must stay below 9 for multi-hub — canvas/pins used to clamp to 9 and cropped SoCal
  let mapZoom = 9.25;
  if (span > 2.4 || list.length >= 3) mapZoom = 7.6;
  else if (span > 1.7) mapZoom = 8.1;
  else if (span > 1.15) mapZoom = 8.6;
  else if (span > 0.75) mapZoom = 9;

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
