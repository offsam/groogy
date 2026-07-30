import {
  isLatLngInHubBounds,
  isUsaOverviewHub,
  locationTextMatchesHub,
  type RegionHub,
} from "@/lib/regions/hubs";
import type { BusinessLocation } from "@/types/business-location";

/** Does this location belong to the active hub (county first, then coords/text)? */
export function businessLocationMatchesHub(
  location: BusinessLocation & { countyGeoid?: string | null },
  hub: RegionHub,
): boolean {
  // National filter = every office is in scope.
  if (isUsaOverviewHub(hub)) return true;

  const county = location.countyGeoid ?? null;
  if (county && hub.countyGeoids.length > 0) {
    return hub.countyGeoids.includes(county);
  }
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
 * Sidebar / map: locations that belong to the visitor's hub filter.
 * - One location → always show it.
 * - США (usa-overview) or no hub → show every office.
 * - Specific metro → only offices in that hub; empty when none match
 *   (office cities stay named in the description via formatOfficesDescriptionLine).
 */
export function pickBusinessLocationsForHubs(
  locations: BusinessLocation[],
  hubs: readonly RegionHub[],
): BusinessLocation[] {
  if (locations.length === 0) return [];
  if (locations.length === 1) return locations;
  if (hubs.length === 0 || hubs.some((hub) => isUsaOverviewHub(hub))) {
    return locations;
  }

  return locations.filter((loc) =>
    hubs.some((hub) => businessLocationMatchesHub(loc, hub)),
  );
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
