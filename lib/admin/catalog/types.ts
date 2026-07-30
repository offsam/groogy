/**
 * Catalog browser shared types (client-safe).
 */

export type CatalogSort = "newest" | "oldest" | "title";

export type CatalogStatusFilter = "all" | "published" | "draft" | "archived" | "other";

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
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "draft", label: "Draft / Pending" },
  { id: "archived", label: "Archived" },
  { id: "other", label: "Other" },
];

export const CATALOG_SORT_OPTIONS: Array<{ id: CatalogSort; label: string }> = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "title", label: "Title" },
];
