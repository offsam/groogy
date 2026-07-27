/** Event geography — aligned with home region hubs (incl. Sacramento / SF). */

export type EventRegionId =
  | "sacramento"
  | "san-francisco"
  | "los-angeles"
  | "san-diego"
  | "orange-county";

export type EventRegion = {
  id: EventRegionId;
  /** City value stored on events.city */
  city: string;
  label: string;
};

export const EVENT_REGIONS: readonly EventRegion[] = [
  { id: "sacramento", city: "Сакраменто", label: "Сакраменто" },
  { id: "san-francisco", city: "Сан-Франциско", label: "Сан-Франциско" },
  { id: "los-angeles", city: "Лос-Анджелес", label: "Лос-Анджелес" },
  { id: "san-diego", city: "Сан-Диего", label: "Сан-Диего" },
  { id: "orange-county", city: "Orange County", label: "Orange County" },
] as const;

export type EventSort = "soon" | "later" | "newest";
export type EventWhen = "all" | "upcoming" | "past";

export function parseEventSort(raw: string | undefined): EventSort {
  if (raw === "later" || raw === "newest") return raw;
  return "soon";
}

export function parseEventWhen(raw: string | undefined): EventWhen {
  if (raw === "upcoming" || raw === "past") return raw;
  return "all";
}

export function parseEventRegions(
  raw: string | undefined,
): EventRegionId[] {
  if (!raw?.trim()) return [];
  const allowed = new Set(EVENT_REGIONS.map((r) => r.id));
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((id): id is EventRegionId => allowed.has(id as EventRegionId));
}

export function citiesForRegionIds(ids: EventRegionId[]): string[] {
  if (ids.length === 0) return [];
  const map = new Map(EVENT_REGIONS.map((r) => [r.id, r.city]));
  return ids.map((id) => map.get(id)).filter((c): c is string => Boolean(c));
}

export function serializeEventRegions(ids: EventRegionId[]): string {
  return ids.join(",");
}
