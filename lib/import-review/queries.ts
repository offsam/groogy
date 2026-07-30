import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  ImportReviewEntityType,
  ImportReviewItem,
  ImportReviewStatus,
  ImportReviewTargetCollection,
} from "@/types/import-review";
import {
  contactLevelFromFlags,
  computeContactPriorityScore,
  getContactFlags,
  type ContactLevel,
} from "@/lib/import-review/contacts";

type Client = SupabaseClient<Database>;

export type ImportReviewSort =
  | "priority"
  | "newest"
  | "oldest"
  | "confidence_asc"
  | "confidence_desc"
  | "posted_at"
  | "updated";

export type ImportReviewListFilters = {
  reviewStatus?: ImportReviewStatus | "all";
  targetCollection?: ImportReviewTargetCollection | "all";
  entityType?: ImportReviewEntityType | "all";
  category?: string;
  city?: string;
  hasPhone?: boolean;
  hasTelegram?: boolean;
  hasInstagram?: boolean;
  hasWebsite?: boolean;
  hasMedia?: boolean;
  duplicateStatus?: string;
  confidenceMin?: number;
  confidenceMax?: number;
  postedFrom?: string;
  postedTo?: string;
  q?: string;
  sort?: ImportReviewSort;
  page?: number;
  pageSize?: number;
};

export type ImportReviewCounts = {
  total: number;
  by_status: Record<string, number>;
  by_collection: Record<string, number>;
};

export type ImportReviewListItem = ImportReviewItem & {
  contact_priority_score: number;
  completeness_score: number;
  contact_level: ContactLevel;
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function withComputed<T extends { source_posted_at: string | null }>(
  row: T,
): T & { days_since_source_post: number | null } {
  return { ...row, days_since_source_post: daysSince(row.source_posted_at) };
}

export async function getImportReviewCounts(
  client: Client,
): Promise<ImportReviewCounts> {
  const { data, error } = await client.rpc("admin_import_review_counts");
  if (error) throw error;
  const raw = (data ?? {}) as ImportReviewCounts;
  return {
    total: raw.total ?? 0,
    by_status: raw.by_status ?? {},
    by_collection: raw.by_collection ?? {},
  };
}

function enrichItem(
  item: ImportReviewItem,
  score?: number | null,
  completeness?: number | null,
  level?: string | null,
): ImportReviewListItem {
  const computed =
    typeof score === "number"
      ? score
      : computeContactPriorityScore(getContactFlags(item));
  const contactLevel =
    level === "full" ||
    level === "has_contact" ||
    level === "telegram_only" ||
    level === "none"
      ? level
      : contactLevelFromFlags(getContactFlags(item));
  return {
    ...item,
    contact_priority_score: computed,
    completeness_score: completeness ?? 0,
    contact_level: contactLevel,
  };
}

export async function listImportReviewItems(
  client: Client,
  filters: ImportReviewListFilters = {},
): Promise<{ items: ImportReviewListItem[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(300, Math.max(1, filters.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  const sort = filters.sort ?? "priority";

  const { data, error } = await client.rpc("admin_list_import_review_items", {
    p_review_status:
      filters.reviewStatus && filters.reviewStatus !== "all"
        ? filters.reviewStatus
        : null,
    p_target_collection:
      filters.targetCollection && filters.targetCollection !== "all"
        ? filters.targetCollection
        : null,
    p_entity_type:
      filters.entityType && filters.entityType !== "all"
        ? filters.entityType
        : null,
    p_category: filters.category ?? null,
    p_city: filters.city ?? null,
    p_has_phone: Boolean(filters.hasPhone),
    p_has_telegram: Boolean(filters.hasTelegram),
    p_has_instagram: Boolean(filters.hasInstagram),
    p_has_website: Boolean(filters.hasWebsite),
    p_has_media: Boolean(filters.hasMedia),
    p_duplicate_status: filters.duplicateStatus ?? null,
    p_confidence_min: filters.confidenceMin ?? null,
    p_confidence_max: filters.confidenceMax ?? null,
    p_posted_from: filters.postedFrom ?? null,
    p_posted_to: filters.postedTo ?? null,
    p_q: filters.q ?? null,
    p_sort: sort,
    p_limit: pageSize,
    p_offset: offset,
  });

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    item: ImportReviewItem;
    total_count: number;
    contact_priority_score: number;
    completeness_score: number;
    contact_level: string;
  }>;

  const total = rows[0]?.total_count ?? 0;
  const items = rows.map((row) =>
    enrichItem(
      row.item,
      row.contact_priority_score,
      row.completeness_score,
      row.contact_level,
    ),
  );

  return { items, total: Number(total) };
}

export async function getImportReviewItem(
  client: Client,
  id: string,
): Promise<ImportReviewItem | null> {
  const { data, error } = await client
    .from("import_review_items")
    .select("*, raw_payload")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ImportReviewItem) ?? null;
}

export async function getNextPendingImportReviewItem(
  client: Client,
  filters: ImportReviewListFilters,
  afterId?: string,
): Promise<ImportReviewItem | null> {
  const nextFilters: ImportReviewListFilters = {
    ...filters,
    reviewStatus:
      filters.reviewStatus && filters.reviewStatus !== "all"
        ? filters.reviewStatus
        : "pending",
    page: 1,
    pageSize: 20,
    sort: filters.sort ?? "priority",
  };
  const { items } = await listImportReviewItems(client, nextFilters);
  if (!afterId) return items[0] ?? null;
  const idx = items.findIndex((i) => i.id === afterId);
  if (idx >= 0 && idx + 1 < items.length) return items[idx + 1];
  return items.find((i) => i.id !== afterId) ?? null;
}
