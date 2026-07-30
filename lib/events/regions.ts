/** Event geography — aligned with home region hubs (incl. Sacramento / SF). */

import {
  EVENT_CATEGORIES,
  parseEventCategory,
  type EventCategory,
} from "@/lib/events/categories";

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

/** YYYY-MM-DD or null. */
export function parseEventDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export function parseEventCategoryParam(
  raw: string | undefined,
): EventCategory | null {
  return parseEventCategory(raw);
}

export function pacificTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function weekendRangeFrom(ymd: string): { start: string; end: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  // Approximate weekday in Pacific via noon UTC-8 offset
  const pacific = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  const dow = pacific.getUTCDay(); // 0 Sun … 6 Sat
  const toSat = dow === 6 ? 0 : dow === 0 ? -1 : 6 - dow;
  const sat = new Date(utc);
  sat.setUTCDate(sat.getUTCDate() + toSat);
  const sun = new Date(sat);
  sun.setUTCDate(sun.getUTCDate() + 1);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  return { start: fmt(sat), end: fmt(sun) };
}

export { EVENT_CATEGORIES };
export type { EventCategory };
