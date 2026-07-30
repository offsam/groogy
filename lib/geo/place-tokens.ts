/**
 * Place selection tokens for region cookie / URL.
 * Formats: hub:<id> | county:<geoid> | city:<geoid>
 * Bare hub ids (legacy) still accepted.
 */

import {
  DEFAULT_REGION_HUB,
  GUEST_REGION_COOKIE,
  GUEST_REGION_STORAGE_KEY,
  getRegionHubByCountyGeoid,
  getRegionHubById,
  getSelectableRegionHubs,
  isUsaOverviewHub,
  type RegionHub,
} from "@/lib/regions/hubs";

export type PlaceKind = "hub" | "county" | "city";

export type PlaceToken =
  | { kind: "hub"; id: string; label?: string }
  | { kind: "county"; geoid: string; label?: string }
  | { kind: "city"; geoid: string; label?: string; countyGeoid?: string | null };

const HUB_PREFIX = "hub:";
const COUNTY_PREFIX = "county:";
const CITY_PREFIX = "city:";

export function serializePlaceToken(token: PlaceToken): string {
  if (token.kind === "hub") return `${HUB_PREFIX}${token.id}`;
  if (token.kind === "county") return `${COUNTY_PREFIX}${token.geoid}`;
  return `${CITY_PREFIX}${token.geoid}`;
}

export function parsePlaceToken(raw: string): PlaceToken | null {
  const value = decodeURIComponent(raw).trim();
  if (!value) return null;
  if (value.startsWith(COUNTY_PREFIX)) {
    const geoid = value.slice(COUNTY_PREFIX.length).trim();
    if (!/^\d{5}$/.test(geoid)) return null;
    return { kind: "county", geoid };
  }
  if (value.startsWith(CITY_PREFIX)) {
    const geoid = value.slice(CITY_PREFIX.length).trim();
    if (!geoid) return null;
    return { kind: "city", geoid };
  }
  if (value.startsWith(HUB_PREFIX)) {
    const id = value.slice(HUB_PREFIX.length).trim();
    if (!id) return null;
    return { kind: "hub", id: getRegionHubById(id).id };
  }
  // Legacy bare hub id
  const hub = getRegionHubById(value);
  if (hub && (value === hub.id || value === "usa-overview" || value === "default")) {
    return { kind: "hub", id: hub.id };
  }
  // Maybe it was a selectable id
  if (getSelectableRegionHubs().some((h) => h.id === value)) {
    return { kind: "hub", id: value };
  }
  return null;
}

/** Parse comma-separated place tokens (cookie / ?hub=). */
export function parsePlaceTokens(raw: string | null | undefined): PlaceToken[] {
  if (!raw) return [{ kind: "hub", id: "usa-overview" }];
  const parts = decodeURIComponent(raw)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const out: PlaceToken[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const token = parsePlaceToken(part);
    if (!token) continue;
    const key = serializePlaceToken(token);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out.length > 0 ? out : [{ kind: "hub", id: "usa-overview" }];
}

export function serializePlaceTokens(tokens: readonly PlaceToken[]): string {
  return parsePlaceTokens(tokens.map(serializePlaceToken).join(","))
    .map(serializePlaceToken)
    .join(",");
}

/** County GEOIDs covered by the current place selection. */
export function countyGeoidsForPlaceTokens(
  tokens: readonly PlaceToken[],
): string[] {
  const geoids = new Set<string>();
  for (const token of tokens) {
    if (token.kind === "hub") {
      const hub = getRegionHubById(token.id);
      if (isUsaOverviewHub(hub)) return []; // empty = no county filter (nationwide)
      for (const g of hub.countyGeoids) geoids.add(g);
    } else if (token.kind === "county") {
      geoids.add(token.geoid);
    } else if (token.kind === "city" && token.countyGeoid) {
      geoids.add(token.countyGeoid);
    }
  }
  return [...geoids];
}

/** Whether a row with county_geoid matches the place selection. */
export function countyGeoidMatchesPlaces(
  countyGeoid: string | null | undefined,
  tokens: readonly PlaceToken[],
): boolean | null {
  // null = caller should use legacy fallback (no county on row)
  if (!countyGeoid) return null;
  const hubsOnly = tokens.filter((t) => t.kind === "hub");
  if (
    hubsOnly.length > 0 &&
    hubsOnly.every((t) => isUsaOverviewHub(getRegionHubById(t.id)))
  ) {
    return true;
  }
  const allowed = countyGeoidsForPlaceTokens(tokens);
  if (allowed.length === 0) {
    // USA overview or empty → match all
    const hasNonOverview = tokens.some(
      (t) =>
        t.kind !== "hub" || !isUsaOverviewHub(getRegionHubById(t.id)),
    );
    return !hasNonOverview;
  }
  return allowed.includes(countyGeoid);
}

/** Map place tokens to RegionHub[] for map camera (best-effort). */
export function hubsForPlaceTokens(tokens: readonly PlaceToken[]): RegionHub[] {
  const hubs: RegionHub[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind === "hub") {
      const hub = getRegionHubById(token.id);
      if (!seen.has(hub.id)) {
        seen.add(hub.id);
        hubs.push(hub);
      }
      continue;
    }
    const geoid =
      token.kind === "county" ? token.geoid : token.countyGeoid ?? null;
    if (!geoid) continue;
    const hub = getRegionHubByCountyGeoid(geoid) ?? DEFAULT_REGION_HUB;
    if (!seen.has(hub.id)) {
      seen.add(hub.id);
      hubs.push(hub);
    }
  }
  return hubs.length > 0 ? hubs : [getRegionHubById("usa-overview")];
}

export function formatPlaceTokensLabel(tokens: readonly PlaceToken[]): string {
  if (tokens.length === 0) return DEFAULT_REGION_HUB.shortLabel;
  if (tokens.length === 1) {
    const t = tokens[0]!;
    if (t.kind === "hub") return getRegionHubById(t.id).shortLabel;
    return t.label || (t.kind === "county" ? `County ${t.geoid}` : `City`);
  }
  return `${formatPlaceTokensLabel([tokens[0]!])} +${tokens.length - 1}`;
}

/** Persist place selection (hubs and/or city/county) to cookie + localStorage. */
export function persistGuestPlaceTokens(tokens: readonly PlaceToken[]) {
  const cleaned = tokens.filter(Boolean);
  const hasMetro = cleaned.some(
    (t) => t.kind !== "hub" || t.id !== "usa-overview",
  );
  const finalTokens = hasMetro
    ? cleaned.filter((t) => !(t.kind === "hub" && t.id === "usa-overview"))
    : cleaned.length > 0
      ? cleaned
      : [];

  if (finalTokens.length === 0) {
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

  const serialized = serializePlaceTokens(finalTokens);
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

/**
 * Catalog row match against place tokens.
 * Prefer county_geoid; legacy fallback via hub text/coords when county missing.
 */
export function rowMatchesPlaceSelection(
  row: {
    county_geoid?: string | null;
    countyGeoid?: string | null;
    city?: string | null;
    region?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  },
  hubParam: string | null | undefined,
  matchLegacy: (hub: RegionHub) => boolean,
): boolean {
  const tokens = parsePlaceTokens(hubParam);
  const county = row.county_geoid ?? row.countyGeoid ?? null;
  const byCounty = countyGeoidMatchesPlaces(county, tokens);
  if (byCounty !== null) return byCounty;

  const hubs = hubsForPlaceTokens(tokens);
  return hubs.some((hub) => matchLegacy(hub));
}

