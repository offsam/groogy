/**
 * Shared TTL / cache-tag constants for public catalog aggregates.
 * Keep home / API / admin health in sync with these values.
 */

export const CATALOG_CACHE_TAGS = {
  hubResourceStats: "hub-resource-stats",
  popularHome: "popular-home",
  homeMapPins: "home-map-pins",
  homeMapStateCounts: "home-map-state-counts",
  hubCategoryCounts: "hub-category-counts",
} as const;

export type CatalogCacheTag =
  (typeof CATALOG_CACHE_TAGS)[keyof typeof CATALOG_CACHE_TAGS];

/** All aggregate tags — used by admin «Сбросить кэш». */
export const ALL_CATALOG_CACHE_TAGS: readonly CatalogCacheTag[] = [
  CATALOG_CACHE_TAGS.hubResourceStats,
  CATALOG_CACHE_TAGS.popularHome,
  CATALOG_CACHE_TAGS.homeMapPins,
  CATALOG_CACHE_TAGS.hubCategoryCounts,
];

export const CATALOG_CACHE_TTL = {
  /** Keep short — bulk import/archive must not leave home heroes on stale totals. */
  hubResourceStats: 60,
  popularHome: 300,
  homeMapPins: 300,
  homeMapStateCounts: 300,
  hubCategoryCounts: 60,
} as const;

/** CDN stale-while-revalidate window after s-maxage. */
export const CATALOG_CDN_SWR = 600;

/** Short SWR for hub counters so archived businesses drop off quickly. */
export const CATALOG_CDN_SWR_COUNTS = 60;

export function catalogAggregateCacheControl(
  sMaxAge: number,
  swr: number = CATALOG_CDN_SWR,
): string {
  return `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;
}

/**
 * Per-entity detail-page cache tags (business/professional `/[slug]` routes).
 * Short TTL is the safety net; owner/admin mutations should also call
 * revalidateTag(...) with these so edits reflect immediately instead of
 * waiting out the TTL.
 */
export const ENTITY_DETAIL_TTL = 45;

export function businessDetailTag(slug: string): string {
  return `business-detail:${slug}`;
}

export function professionalDetailTag(slug: string): string {
  return `professional-detail:${slug}`;
}
