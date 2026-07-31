import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getPendingBusinessClaims } from "@/lib/admin/claim-actions";
import { listImportReviewItems } from "@/lib/import-review/queries";
import {
  countCommentRecommendations,
  listCommentRecommendations,
} from "@/lib/import-review/recommendation-queries";
import {
  countPendingEventRecommendations,
  listPendingEventRecommendations,
} from "@/lib/events/queries";
import {
  fromCommentRecommendation,
  fromEventRecommendation,
  fromImportReviewItem,
  fromOwnershipClaim,
} from "@/lib/admin/inbox/adapters";
import {
  filterInboxItems,
  matchInboxView,
  resolveInboxFilters,
  sortInboxItems,
} from "@/lib/admin/inbox/views";
import { computeInboxPriorityScore } from "@/lib/admin/inbox/priority";
import { computeInboxMetrics } from "@/lib/admin/inbox/metrics";
import type {
  InboxFilters,
  InboxItem,
  InboxMetrics,
  InboxReviewType,
} from "@/lib/admin/inbox/types";

type Client = SupabaseClient<Database>;

/**
 * Working set per queue source. Moderators review the top of the priority
 * stack; full queue totals come from separate count queries.
 */
export const INBOX_PER_SOURCE_CAP = 1000;

/**
 * Pluggable source registry. Add a new queue by appending a fetcher —
 * no schema or legacy page changes required.
 */
export const INBOX_SOURCE_FETCHERS: Array<{
  reviewType: InboxReviewType;
  label: string;
  fetch: (client: Client) => Promise<{ items: InboxItem[]; total: number }>;
}> = [
  {
    reviewType: "import_review",
    label: "Import Review",
    fetch: async (client) => {
      const { items, total } = await listImportReviewItems(client, {
        reviewStatus: "pending",
        page: 1,
        pageSize: INBOX_PER_SOURCE_CAP,
        sort: "priority",
      });
      return { items: items.map(fromImportReviewItem), total };
    },
  },
  {
    reviewType: "ownership_claim",
    label: "Ownership Claims",
    fetch: async () => {
      const claims = await getPendingBusinessClaims();
      const items = claims.map(fromOwnershipClaim);
      return { items, total: items.length };
    },
  },
  {
    reviewType: "event_verification",
    label: "Events Verification",
    fetch: async (client) => {
      const [{ items }, total] = await Promise.all([
        listPendingEventRecommendations(client, {
          page: 1,
          pageSize: INBOX_PER_SOURCE_CAP,
        }),
        countPendingEventRecommendations(client),
      ]);
      return { items: items.map(fromEventRecommendation), total };
    },
  },
  {
    reviewType: "recommendation",
    label: "Recommendations",
    fetch: async (client) => {
      const suspectedCap = 50;
      const pendingCap = INBOX_PER_SOURCE_CAP - suspectedCap;
      const [pending, suspected, pendingTotal, suspectedTotal] =
        await Promise.all([
          listCommentRecommendations(client, {
            status: "pending",
            kind: "profi",
            page: 1,
            pageSize: pendingCap,
            selectMode: "inbox",
          }),
          listCommentRecommendations(client, {
            status: "suspected_duplicate",
            kind: "profi",
            page: 1,
            pageSize: suspectedCap,
            selectMode: "inbox",
          }),
          countCommentRecommendations(client, {
            status: "pending",
            kind: "profi",
          }),
          countCommentRecommendations(client, {
            status: "suspected_duplicate",
            kind: "profi",
          }),
        ]);
      return {
        items: [...pending.items, ...suspected.items].map(
          fromCommentRecommendation,
        ),
        total: pendingTotal + suspectedTotal,
      };
    },
  },
];

export type InboxLoadResult = {
  items: InboxItem[];
  /** All loaded items before view/filter (for metrics / assignment scope) */
  allItems: InboxItem[];
  /** Exact queue size across sources (DB counts), not loaded length */
  totalUnfiltered: number;
  totalFiltered: number;
  /** Rows actually fetched into the working set (pre-filter) */
  loadedUnfiltered: number;
  byReviewType: Record<string, number>;
  errors: Array<{ source: string; message: string }>;
  filters: InboxFilters;
  metrics: InboxMetrics;
};

function applyComputedPriority(items: InboxItem[]): InboxItem[] {
  const nowMs = Date.now();
  return items.map((item) => ({
    ...item,
    priority: computeInboxPriorityScore({
      aiConfidence: item.aiConfidence,
      createdAt: item.createdAt,
      reviewType: item.reviewType,
      nowMs,
    }),
  }));
}

export async function loadInboxItems(
  client: Client,
  rawFilters: InboxFilters = {},
): Promise<InboxLoadResult> {
  const filters = resolveInboxFilters(rawFilters);
  filters.view = matchInboxView(filters);
  const errors: Array<{ source: string; message: string }> = [];
  const byReviewType: Record<string, number> = {};

  const chunks = await Promise.all(
    INBOX_SOURCE_FETCHERS.map(async (src) => {
      try {
        const result = await src.fetch(client);
        byReviewType[src.reviewType] = result.total;
        return result.items;
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "load failed";
        errors.push({ source: src.label, message });
        byReviewType[src.reviewType] = 0;
        return [] as InboxItem[];
      }
    }),
  );

  const merged = sortInboxItems(applyComputedPriority(chunks.flat()));
  const filtered = filterInboxItems(merged, filters);
  const queueTotal = Object.values(byReviewType).reduce((a, b) => a + b, 0);
  const metrics = computeInboxMetrics(merged);
  metrics.total = queueTotal;

  return {
    items: filtered,
    allItems: merged,
    totalUnfiltered: queueTotal,
    totalFiltered: filtered.length,
    loadedUnfiltered: merged.length,
    byReviewType,
    errors,
    filters,
    metrics,
  };
}
