import {
  isLatLngInHubBounds,
  locationTextMatchesHub,
  type RegionHub,
} from "@/lib/regions/hubs";
import type { BusinessLocation } from "@/types/business-location";

/** Does this location belong to the active hub (coords or city aliases)? */
export function businessLocationMatchesHub(
  location: BusinessLocation,
  hub: RegionHub,
): boolean {
  if (
    typeof location.latitude === "number" &&
    Number.isFinite(location.latitude) &&
    typeof location.longitude === "number" &&
    Number.isFinite(location.longitude) &&
    isLatLngInHubBounds(location.latitude, location.longitude, hub)
  ) {
    return true;
  }

  // Match city / label / region only — not street line (avoids "la" ⊂ "Lambert").
  const text = [
    location.label,
    location.city,
    location.region,
    location.stateCode?.replace(/^US-/, ""),
  ]
    .filter(Boolean)
    .join(" ");

  return locationTextMatchesHub(text, hub);
}

/**
 * Sidebar / map: only locations in the visitor's hub filter.
 * Single-location businesses always show that one location.
 * Multi-location with no hub match → empty (office cities are named in the description).
 */
export function pickBusinessLocationsForHubs(
  locations: BusinessLocation[],
  hubs: readonly RegionHub[],
): BusinessLocation[] {
  if (locations.length === 0) return [];
  if (locations.length === 1) return locations;
  if (hubs.length === 0) {
    const primary = locations.find((l) => l.isPrimary);
    return primary ? [primary] : locations.slice(0, 1);
  }

  const matched = locations.filter((loc) =>
    hubs.some((hub) => businessLocationMatchesHub(loc, hub)),
  );
  return matched;
}

export function formatNetworkCitiesLine(
  locations: BusinessLocation[],
): string | null {
  if (locations.length < 2) return null;
  const labels = locations
    .map((loc) => {
      const state = loc.stateCode?.replace(/^US-/, "") || loc.region;
      const city = loc.city || loc.label;
      if (city && state) return `${city}, ${state}`;
      return city || loc.label || "";
    })
    .filter(Boolean);
  const unique = [...new Set(labels)];
  if (unique.length < 2) return null;
  return unique.join(" · ");
}

/** One sentence for the company description (not a separate UI card). */
export function formatOfficesDescriptionLine(
  locations: BusinessLocation[],
): string | null {
  const line = formatNetworkCitiesLine(locations);
  if (!line) return null;
  return `Офисы: ${line}.`;
}
