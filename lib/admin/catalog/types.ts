/**
 * Catalog browser shared types (client-safe).
 */

export type CatalogSort = "newest" | "oldest" | "title";

export type CatalogStatusFilter =
  | "all"
  | "published"
  | "draft"
  | "archived"
  | "other";

/** Sentinel in URL for “null field” filters (state / county / category). */
export const CATALOG_FILTER_NONE = "__none__";

export type CatalogFilterOption = {
  id: string;
  label: string;
};

export type CatalogListItem = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  city: string | null;
  createdAt: string | null;
  publicHref: string | null;
  editHref: string | null;
  /** When set, Archive action is enabled and calls this key */
  archiveAvailable: boolean;
};

export const CATALOG_PAGE_SIZE = 24;

export const CATALOG_STATUS_OPTIONS: Array<{
  id: CatalogStatusFilter;
  label: string;
}> = [
  { id: "all", label: "Все" },
  { id: "published", label: "Опубликованные" },
  { id: "draft", label: "Черновики" },
  { id: "archived", label: "Архив" },
  { id: "other", label: "Прочее" },
];

export const CATALOG_SORT_OPTIONS: Array<{ id: CatalogSort; label: string }> = [
  { id: "newest", label: "Новые" },
  { id: "oldest", label: "Старые" },
  { id: "title", label: "А → Я" },
];
