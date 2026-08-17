import {
  HOME_MAP_HUB_CLUSTER_MAX_ZOOM,
  HOME_MAP_METRO_GROUP_MAX_ZOOM,
  HOME_MAP_STATE_CLUSTER_MAX_ZOOM,
  getUsStateCentroid,
  normalizeUsStateCode,
} from "@/lib/geo/us-state-centroids";
import { reconcileStateCode } from "@/lib/geo/us-zip-state";
import {
  METRO_HUB_IDS,
  REGION_HUBS,
  locationFieldsMatchHub,
  type RegionHub,
} from "@/lib/regions/hubs";
import type { HomeMapPin, HomeMapStateCount } from "@/lib/supabase/queries";

export type HomeMapLayer = "state" | "metro-group" | "hub" | "pins";

export type HomeMapPlaceCluster = {
  id: string;
  label: string;
  count: number;
  lat: number;
  lng: number;
  flyZoom: number;
};

export type HomeMapMetroGroup = {
  id: string;
  labelRu: string;
  hubIds: readonly string[];
  lat: number;
  lng: number;
  zoom: number;
};

/**
 * Nearby metros that share one circle until the user zooms closer.
 * Greater LA is the only merge — OC / Inland Empire split out at hub zoom.
 */
const MERGED_METRO_GROUPS: readonly HomeMapMetroGroup[] = [
  {
    id: "greater-la",
    labelRu: "Лос-Анджелес",
    hubIds: ["los-angeles", "orange-county", "inland-empire"],
    lat: 33.95,
    lng: -117.85,
    zoom: 8.6,
  },
];

function hubArea(hub: RegionHub): number {
  const { north, south, east, west } = hub.mapBounds;
  return Math.max(0.0001, (north - south) * (east - west));
}

const METRO_HUBS_SMALLEST_FIRST = METRO_HUB_IDS.map((id) => REGION_HUBS[id]).sort(
  (a, b) => hubArea(a) - hubArea(b),
);

let cachedGroups: HomeMapMetroGroup[] | null = null;

export function getHomeMapMetroGroups(): HomeMapMetroGroup[] {
  if (cachedGroups) return cachedGroups;
  const covered = new Set(MERGED_METRO_GROUPS.flatMap((g) => [...g.hubIds]));
  const singles: HomeMapMetroGroup[] = METRO_HUB_IDS.filter(
    (id) => !covered.has(id),
  ).map((id) => {
    const hub = REGION_HUBS[id];
    return {
      id,
      labelRu: hub.shortLabel,
      hubIds: [id],
      lat: hub.mapCenter.lat,
      lng: hub.mapCenter.lng,
      zoom: hub.mapZoom,
    };
  });
  cachedGroups = [...MERGED_METRO_GROUPS, ...singles];
  return cachedGroups;
}

export function pinStateCode(pin: HomeMapPin): string | null {
  return (
    reconcileStateCode({
      stateCode: pin.stateCode,
      postalCode: pin.postalCode,
      city: pin.city,
    }) ?? normalizeUsStateCode(pin.stateCode)
  );
}

export function matchPinToMetroHub(pin: HomeMapPin): RegionHub | null {
  const fields = {
    city: pin.city,
    latitude: pin.latitude,
    longitude: pin.longitude,
    state_code: pin.stateCode,
  };
  for (const hub of METRO_HUBS_SMALLEST_FIRST) {
    if (locationFieldsMatchHub(fields, hub)) return hub;
  }
  return null;
}

export function homeMapLayerForZoom(
  zoom: number,
  pinsReady: boolean,
): HomeMapLayer {
  if (zoom < HOME_MAP_STATE_CLUSTER_MAX_ZOOM || !pinsReady) return "state";
  if (zoom < HOME_MAP_METRO_GROUP_MAX_ZOOM) return "metro-group";
  if (zoom < HOME_MAP_HUB_CLUSTER_MAX_ZOOM) return "hub";
  return "pins";
}

export function clustersFromStateCounts(
  counts: HomeMapStateCount[],
): HomeMapPlaceCluster[] {
  const clusters: HomeMapPlaceCluster[] = [];
  for (const { stateCode, count } of counts) {
    const centroid = getUsStateCentroid(stateCode);
    if (!centroid || count <= 0) continue;
    clusters.push({
      id: stateCode,
      label: centroid.labelRu,
      count,
      lat: centroid.lat,
      lng: centroid.lng,
      flyZoom: Math.max(
        centroid.zoom,
        HOME_MAP_STATE_CLUSTER_MAX_ZOOM + 0.35,
      ),
    });
  }
  return clusters;
}

export function groupPinsByState(pins: HomeMapPin[]): HomeMapPlaceCluster[] {
  const buckets = new Map<string, number>();
  for (const pin of pins) {
    const code = pinStateCode(pin);
    if (!code) continue;
    buckets.set(code, (buckets.get(code) ?? 0) + 1);
  }
  return clustersFromStateCounts(
    [...buckets.entries()].map(([stateCode, count]) => ({ stateCode, count })),
  );
}

function remainderCluster(
  stateCode: string,
  count: number,
): HomeMapPlaceCluster | null {
  const centroid = getUsStateCentroid(stateCode);
  if (!centroid || count <= 0) return null;
  return {
    id: `rest-${stateCode}`,
    label: `Остальные · ${centroid.labelRu}`,
    count,
    lat: centroid.lat,
    lng: centroid.lng,
    flyZoom: HOME_MAP_HUB_CLUSTER_MAX_ZOOM + 0.25,
  };
}

export function groupPinsByMetroGroup(
  pins: HomeMapPin[],
): HomeMapPlaceCluster[] {
  const groups = getHomeMapMetroGroups();
  const hubToGroup = new Map<string, HomeMapMetroGroup>();
  for (const group of groups) {
    for (const hubId of group.hubIds) hubToGroup.set(hubId, group);
  }

  const counts = new Map<string, number>();
  const leftovers = new Map<string, number>();
  for (const pin of pins) {
    const hub = matchPinToMetroHub(pin);
    const group = hub ? hubToGroup.get(hub.id) : undefined;
    if (group) {
      counts.set(group.id, (counts.get(group.id) ?? 0) + 1);
      continue;
    }
    const state = pinStateCode(pin);
    if (state) leftovers.set(state, (leftovers.get(state) ?? 0) + 1);
  }

  const clusters: HomeMapPlaceCluster[] = [];
  for (const group of groups) {
    const count = counts.get(group.id) ?? 0;
    if (count <= 0) continue;
    const flyZoom =
      group.hubIds.length > 1
        ? Math.max(group.zoom, HOME_MAP_METRO_GROUP_MAX_ZOOM + 0.35)
        : Math.max(group.zoom, HOME_MAP_HUB_CLUSTER_MAX_ZOOM + 0.25);
    clusters.push({
      id: group.id,
      label: group.labelRu,
      count,
      lat: group.lat,
      lng: group.lng,
      flyZoom,
    });
  }
  for (const [state, count] of leftovers) {
    const rest = remainderCluster(state, count);
    if (rest) clusters.push(rest);
  }
  return clusters;
}

export function groupPinsByHub(pins: HomeMapPin[]): HomeMapPlaceCluster[] {
  const counts = new Map<string, number>();
  const leftovers = new Map<string, number>();
  for (const pin of pins) {
    const hub = matchPinToMetroHub(pin);
    if (hub) {
      counts.set(hub.id, (counts.get(hub.id) ?? 0) + 1);
      continue;
    }
    const state = pinStateCode(pin);
    if (state) leftovers.set(state, (leftovers.get(state) ?? 0) + 1);
  }

  const clusters: HomeMapPlaceCluster[] = [];
  for (const id of METRO_HUB_IDS) {
    const count = counts.get(id) ?? 0;
    if (count <= 0) continue;
    const hub = REGION_HUBS[id];
    clusters.push({
      id,
      label: hub.shortLabel,
      count,
      lat: hub.mapCenter.lat,
      lng: hub.mapCenter.lng,
      flyZoom: Math.max(hub.mapZoom, HOME_MAP_HUB_CLUSTER_MAX_ZOOM + 0.25),
    });
  }
  for (const [state, count] of leftovers) {
    const rest = remainderCluster(state, count);
    if (rest) clusters.push(rest);
  }
  return clusters;
}
