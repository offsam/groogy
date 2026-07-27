import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

export type PlatformResourceStats = {
  total: number;
  businesses: number;
  listings: number;
  offers: number;
  services: number;
  transfers: number;
  lechu: number;
  reviews: number;
  categories: number;
  members: number;
  addedYesterday: number;
  addedToday: number;
  updatedToday: number;
  membersToday: number;
};

export function emptyPlatformResourceStats(): PlatformResourceStats {
  return {
    total: 0,
    businesses: 0,
    listings: 0,
    offers: 0,
    services: 0,
    transfers: 0,
    lechu: 0,
    reviews: 0,
    categories: 0,
    members: 0,
    addedYesterday: 0,
    addedToday: 0,
    updatedToday: 0,
    membersToday: 0,
  };
}

function num(payload: Record<string, unknown> | null, key: string): number {
  return Number(payload?.[key] ?? 0);
}

function parseStats(raw: Record<string, unknown> | null): PlatformResourceStats {
  const payload =
    raw && typeof raw === "object" && "total" in raw
      ? raw
      : raw && typeof raw === "object" && "get_platform_resource_stats" in raw
        ? (raw.get_platform_resource_stats as Record<string, unknown>)
        : null;

  return {
    total: num(payload, "total"),
    businesses: num(payload, "businesses"),
    listings: num(payload, "listings"),
    offers: num(payload, "offers"),
    services: num(payload, "services"),
    transfers: num(payload, "transfers"),
    lechu: num(payload, "lechu"),
    reviews: num(payload, "reviews"),
    categories: num(payload, "categories"),
    members: num(payload, "members"),
    addedYesterday: num(payload, "added_yesterday"),
    addedToday: num(payload, "added_today"),
    updatedToday: num(payload, "updated_today"),
    membersToday: num(payload, "members_today"),
  };
}

async function fetchPlatformResourceStats(): Promise<PlatformResourceStats> {
  const { url, anonKey } = getPublicSupabaseEnv();

  const supabase = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("get_platform_resource_stats");
  if (error) throw new Error(error.message);
  return parseStats((data ?? null) as Record<string, unknown> | null);
}

/** Short TTL so the top bar stays near real-time without hammering the DB. */
export const getPlatformResourceStats = unstable_cache(
  fetchPlatformResourceStats,
  ["platform-resource-stats-v4"],
  { revalidate: 30 },
);

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function pluralResources(n: number): string {
  return pluralRu(n, "ресурс", "ресурса", "ресурсов");
}

export function pluralBusinessCards(n: number): string {
  return pluralRu(n, "бизнес", "бизнеса", "бизнесов");
}

export function pluralOffers(n: number): string {
  return pluralRu(n, "предложение", "предложения", "предложений");
}

export function pluralListings(n: number): string {
  return pluralRu(n, "объявление", "объявления", "объявлений");
}

export function pluralServices(n: number): string {
  return pluralRu(n, "услуга", "услуги", "услуг");
}

export function pluralTransfers(n: number): string {
  return pluralRu(n, "перевод", "перевода", "переводов");
}

export function pluralLechu(n: number): string {
  return pluralRu(n, "поездка", "поездки", "поездок");
}

export function pluralReviews(n: number): string {
  return pluralRu(n, "отзыв", "отзыва", "отзывов");
}

export function pluralCategories(n: number): string {
  return pluralRu(n, "категория", "категории", "категорий");
}

export function pluralMembers(n: number): string {
  return pluralRu(n, "участник", "участника", "участников");
}

export function pluralUpdates(n: number): string {
  return pluralRu(n, "обновление", "обновления", "обновлений");
}
