import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ImportReviewItem } from "@/types/import-review";
import { listImportReviewItems } from "@/lib/import-review/queries";
import {
  listCommentRecommendations,
  type CommentRecommendation,
} from "@/lib/import-review/recommendation-queries";
import {
  fromCommentRecommendation,
  fromEventRecommendation,
  fromImportReviewItem,
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
  InboxSourceKey,
} from "@/lib/admin/inbox/types";
import { TELEGRAM_SOURCES } from "@/lib/import-review/telegram-sources";
import { scoreImportReviewQueueItem } from "@/lib/import-review/queue-completeness-score";
import {
  countOpenFeedUniverse,
  countSourceScopedQueue,
} from "@/lib/admin/inbox/queue-counts";
import {
  IMPORT_REVIEW_OPEN_STATUSES,
  RECOMMENDATION_OPEN_STATUSES,
} from "@/lib/admin/inbox/queue-universe";
import { getAdminLaneCounts } from "@/lib/admin/lanes/counts";
import type { AdminLaneCounts } from "@/lib/admin/lanes/counts";
import type { AdminLaneId } from "@/lib/admin/lanes/types";

type Client = SupabaseClient<Database>;

/**
 * Working set for «Вся лента» (no source filter). UI shows 20/page;
 * keep the fetch modest so Supabase is not hammered on every open.
 */
export const INBOX_PER_SOURCE_CAP = 100;

/** Soft ceiling when loading one concrete source (group / directory). */
const SOURCE_PAGE_SIZE = 500;
const SOURCE_MAX_ROWS = 3000;

const QUEUE_REC_STATUSES = [...RECOMMENDATION_OPEN_STATUSES];
const QUEUE_IMPORT_STATUSES = [...IMPORT_REVIEW_OPEN_STATUSES];

async function fetchImportReviewByStatuses(
  client: Client,
  statuses: string[],
  pageSize: number,
): Promise<{ items: InboxItem[]; total: number }> {
  const perStatus = Math.max(20, Math.floor(pageSize / Math.max(1, statuses.length)));
  const chunks = await Promise.all(
    statuses.map(async (reviewStatus) => {
      const { items, total } = await listImportReviewItems(client, {
        reviewStatus: reviewStatus as never,
        page: 1,
        pageSize: perStatus,
        sort: "priority",
      });
      return { items: items.map(fromImportReviewItem), total };
    }),
  );
  return {
    items: chunks.flatMap((c) => c.items),
    total: chunks.reduce((s, c) => s + c.total, 0),
  };
}

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
    fetch: async (client) =>
      fetchImportReviewByStatuses(
        client,
        [...IMPORT_REVIEW_OPEN_STATUSES],
        INBOX_PER_SOURCE_CAP,
      ),
  },  // Ownership claims live under Верификация (/admin/claims), not the queue feed.
  {
    reviewType: "event_verification",
    label: "Events Verification",
    fetch: async (client) => {
      const { items, total } = await listCommentRecommendations(client, {
        statuses: QUEUE_REC_STATUSES,
        kind: "event",
        page: 1,
        pageSize: INBOX_PER_SOURCE_CAP,
        selectMode: "inbox",
      });
      return { items: items.map(fromEventRecommendation), total };
    },
  },
  {
    reviewType: "recommendation",
    label: "Recommendations",
    fetch: async (client) => {
      const { items, total } = await listCommentRecommendations(client, {
        statuses: QUEUE_REC_STATUSES,
        kind: "profi",
        page: 1,
        pageSize: INBOX_PER_SOURCE_CAP,
        selectMode: "inbox",
      });
      return {
        items: items.map(fromCommentRecommendation),
        total,
      };
    },
  },
];

export type InboxLoadResult = {
  items: InboxItem[];
  /** All loaded items before view/filter (for metrics / assignment scope) */
  allItems: InboxItem[];
  /** Exact queue size for this scope (DB), not loaded length */
  totalUnfiltered: number;
  totalFiltered: number;
  /** Rows actually fetched into the working set (pre-filter) */
  loadedUnfiltered: number;
  byReviewType: Record<string, number>;
  /** SQL lane proxies — same as /admin/queue tiles */
  laneCounts: AdminLaneCounts;
  errors: Array<{ source: string; message: string }>;
  filters: InboxFilters;
  metrics: InboxMetrics;
};

function applyComputedPriority(items: InboxItem[]): InboxItem[] {
  const nowMs = Date.now();
  return items.map((item) => ({
    ...item,
    // Keep P-badge score; list order uses completeness via sortInboxItems.
    priority: computeInboxPriorityScore({
      aiConfidence: item.aiConfidence,
      createdAt: item.createdAt,
      reviewType: item.reviewType,
      nowMs,
    }),
  }));
}

function tallyByReviewType(items: InboxItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item.reviewType] = (out[item.reviewType] ?? 0) + 1;
  }
  return out;
}

async function listAllRecommendations(
  client: Client,
  opts: {
    kind?: "profi" | "event" | "all";
    directorySource?: string;
    sourceChannel?: string;
    bucket?: "yellow_pages";
    excludeBuckets?: Array<"yellow_pages">;
  },
): Promise<{ items: CommentRecommendation[]; total: number }> {
  const collected: CommentRecommendation[] = [];
  let total = 0;
  let page = 1;
  for (let guard = 0; guard < 20; guard += 1) {
    const { items, total: t } = await listCommentRecommendations(client, {
      statuses: [...QUEUE_REC_STATUSES],
      kind: opts.kind ?? "all",
      directorySource: opts.directorySource,
      sourceChannel: opts.sourceChannel,
      bucket: opts.bucket,
      excludeBuckets: opts.excludeBuckets,
      page,
      pageSize: SOURCE_PAGE_SIZE,
      selectMode: "inbox",
    });
    total = t;
    collected.push(...items);
    if (items.length < SOURCE_PAGE_SIZE || collected.length >= SOURCE_MAX_ROWS) {
      break;
    }
    if (collected.length >= total) break;
    page += 1;
  }
  return { items: collected, total };
}

async function listImportReviewForSource(
  client: Client,
  opts: {
    sourceChannel?: Extract<InboxSourceKey, "telegram" | "facebook">;
    sourceGroup?: string;
  },
): Promise<InboxItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as SupabaseClient<any>;
  const collected: InboxItem[] = [];
  let from = 0;
  for (let page = 0; page < 20; page += 1) {
    let query = anyClient
      .from("import_review_items")
      .select("*")
      .in("review_status", QUEUE_IMPORT_STATUSES)
      .order("created_at", { ascending: false })
      .range(from, from + SOURCE_PAGE_SIZE - 1);

    if (opts.sourceGroup) {
      query = query.eq("source_group", opts.sourceGroup);
    } else if (opts.sourceChannel === "telegram") {
      query = query.or(
        "source.ilike.%telegram%,source.ilike.tg_%,source.eq.telegram",
      );
    } else if (opts.sourceChannel === "facebook") {
      query = query.or(
        "source.ilike.%facebook%,source.ilike.%fb_%,source.eq.facebook",
      );
    }

    const { data, error } = await query;
    if (error || !data?.length) break;

    for (const row of data as ImportReviewItem[]) {
      const completeness = scoreImportReviewQueueItem(row);
      collected.push(
        fromImportReviewItem({
          ...row,
          contact_priority_score: completeness,
          completeness_score: completeness,
          contact_level: "none",
        }),
      );
    }
    if (data.length < SOURCE_PAGE_SIZE || collected.length >= SOURCE_MAX_ROWS) {
      break;
    }
    from += SOURCE_PAGE_SIZE;
  }
  return collected;
}

/**
 * Load every queue card that belongs to the selected source chip
 * (Telegram group / Yellow Pages directory / channel-wide filter).
 */
async function loadSourceScopedItems(
  client: Client,
  filters: InboxFilters,
): Promise<{ items: InboxItem[]; errors: Array<{ source: string; message: string }> }> {
  const errors: Array<{ source: string; message: string }> = [];
  const source = filters.source && filters.source !== "all" ? filters.source : null;
  const sourceRef =
    filters.sourceRef && filters.sourceRef !== "all" ? filters.sourceRef : null;

  const tasks: Array<Promise<InboxItem[]>> = [];

  const tgMeta =
    sourceRef && sourceRef in TELEGRAM_SOURCES
      ? TELEGRAM_SOURCES[sourceRef as keyof typeof TELEGRAM_SOURCES]
      : null;

  // Recommendations (+ events stored as recommendations)
  tasks.push(
    (async () => {
      try {
        if (source === "directories" || (sourceRef && !tgMeta && source !== "telegram" && source !== "facebook" && source !== "loveoverse" && source !== "eventbrite")) {
          const { items } = await listAllRecommendations(client, {
            directorySource: sourceRef || undefined,
            bucket: "yellow_pages",
          });
          return items.map((row) =>
            row.kind === "event"
              ? fromEventRecommendation(row)
              : fromCommentRecommendation(row),
          );
        }

        if (source === "telegram" || tgMeta) {
          const { items } = await listAllRecommendations(client, {
            sourceChannel: "telegram",
            directorySource: sourceRef || undefined,
            excludeBuckets: sourceRef ? undefined : ["yellow_pages"],
          });
          return items.map((row) =>
            row.kind === "event"
              ? fromEventRecommendation(row)
              : fromCommentRecommendation(row),
          );
        }

        if (source === "facebook") {
          const { items } = await listAllRecommendations(client, {
            sourceChannel: "facebook",
            directorySource: sourceRef || undefined,
            excludeBuckets: ["yellow_pages"],
          });
          return items.map((row) =>
            row.kind === "event"
              ? fromEventRecommendation(row)
              : fromCommentRecommendation(row),
          );
        }

        if (source === "loveoverse") {
          const { items } = await listAllRecommendations(client, {
            sourceChannel: "loveoverse",
            directorySource: sourceRef || undefined,
          });
          return items.map((row) =>
            row.kind === "event"
              ? fromEventRecommendation(row)
              : fromCommentRecommendation(row),
          );
        }

        if (source === "eventbrite") {
          const { items } = await listAllRecommendations(client, {
            sourceChannel: "eventbrite",
            directorySource: sourceRef || undefined,
          });
          return items.map((row) =>
            row.kind === "event"
              ? fromEventRecommendation(row)
              : fromCommentRecommendation(row),
          );
        }

        return [] as InboxItem[];
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "load failed";
        errors.push({ source: "Recommendations", message });
        return [] as InboxItem[];
      }
    })(),
  );

  // Import-review cards from the same Telegram/Facebook provenance
  if (source === "telegram" || source === "facebook" || tgMeta) {
    tasks.push(
      (async () => {
        try {
          return await listImportReviewForSource(client, {
            sourceChannel:
              source === "facebook"
                ? "facebook"
                : source === "telegram" || tgMeta
                  ? "telegram"
                  : undefined,
            sourceGroup: tgMeta?.groupLabel,
          });
        } catch (err) {
          const message =
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : "load failed";
          errors.push({ source: "Import Review", message });
          return [] as InboxItem[];
        }
      })(),
    );
  }

  const chunks = await Promise.all(tasks);
  return { items: chunks.flat(), errors };
}

function isSourceScoped(filters: InboxFilters): boolean {
  const source = filters.source && filters.source !== "all" ? filters.source : null;
  const sourceRef =
    filters.sourceRef && filters.sourceRef !== "all" ? filters.sourceRef : null;
  return Boolean(source || sourceRef);
}

export async function loadInboxItems(
  client: Client,
  rawFilters: InboxFilters = {},
): Promise<InboxLoadResult> {
  const filters = resolveInboxFilters(rawFilters);
  filters.view = matchInboxView(filters);
  const errors: Array<{ source: string; message: string }> = [];
  let byReviewType: Record<string, number> = {};
  let merged: InboxItem[] = [];
  let queueTotal = 0;

  const [laneCounts, feedUniverse] = await Promise.all([
    getAdminLaneCounts(client).catch(() => ({
      attach: 0,
      route: 0,
      ready: 0,
      seeking: 0,
      quarantine: 0,
      review: 0,
      totalOpen: 0,
    })),
    countOpenFeedUniverse(client).catch(() => ({
      importReview: 0,
      events: 0,
      recommendations: 0,
      total: 0,
    })),
  ]);

  if (isSourceScoped(filters)) {
    const scoped = await loadSourceScopedItems(client, filters);
    errors.push(...scoped.errors);
    merged = sortInboxItems(applyComputedPriority(scoped.items));
    byReviewType = tallyByReviewType(merged);
    queueTotal = await countSourceScopedQueue(client, {
      source: filters.source,
      sourceRef: filters.sourceRef,
    }).catch(() => merged.length);
  } else {
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
    merged = sortInboxItems(applyComputedPriority(chunks.flat()));
    // Same number as «Вся лента» / «На обработку» tiles.
    queueTotal = feedUniverse.total;
    byReviewType = {
      import_review: feedUniverse.importReview,
      event_verification: feedUniverse.events,
      recommendation: feedUniverse.recommendations,
    };
  }

  const filtered = filterInboxItems(merged, filters);
  const metrics = computeInboxMetrics(merged);

  const lane =
    filters.lane && filters.lane !== "all"
      ? (filters.lane as AdminLaneId)
      : null;
  const extraNarrowed =
    (filters.entityType && filters.entityType !== "all") ||
    (filters.reviewType && filters.reviewType !== "all") ||
    (filters.status && filters.status !== "all") ||
    Boolean(filters.needsReview) ||
    filters.minConfidence != null ||
    filters.maxAgeHours != null;

  if (lane) {
    // Tile on /admin/queue ↔ chip ↔ «В очереди»
    metrics.total = laneCounts[lane] ?? filtered.length;
  } else if (extraNarrowed) {
    metrics.total = filtered.length;
  } else {
    // Source scope or whole feed: exact DB total for that scope.
    metrics.total = queueTotal;
  }

  return {
    items: filtered,
    allItems: merged,
    totalUnfiltered: queueTotal,
    totalFiltered: filtered.length,
    loadedUnfiltered: merged.length,
    byReviewType,
    laneCounts,
    errors,
    filters,
    metrics,
  };
}
