/**
 * Review Center Inbox — unified task projection.
 * Aggregator over existing queues. Assignment is client-side until a backend exists.
 */

export type InboxEntityType =
  | "business"
  | "professional"
  | "marketplace"
  | "job"
  | "event"
  | "service"
  | "organization"
  | "other"
  | "unknown";

/** Provenance / channel key used in Source filter */
export type InboxSourceKey =
  | "telegram"
  | "facebook"
  | "directories"
  | "loveoverse"
  | "eventbrite"
  | "professional_cleanup"
  | "claims"
  | "recommendations"
  | "import"
  | "other";

export type InboxReviewType =
  | "import_review"
  | "ownership_claim"
  | "event_verification"
  | "recommendation";

export type InboxItem = {
  /** Stable composite id: `${reviewType}:${sourceId}` */
  id: string;
  sourceId: string;
  entityType: InboxEntityType;
  title: string;
  source: InboxSourceKey;
  sourceName: string;
  /** Provenance key for Imports → Inbox deep links (telegram/directory id) */
  sourceRef: string | null;
  status: string;
  /** review_notes / recommendation notes — for lane classify (seeking/quarantine tags) */
  reviewNotes?: string | null;
  aiConfidence: number | null;
  /** Enrich weighted score (same as Обогатить history); null for other review types. */
  completenessPercent: number | null;
  /** Checklist ready count (import_review); null for other types. */
  checklistReady: number | null;
  /** Checklist total fields (import_review); null for other types. */
  checklistTotal: number | null;
  createdAt: string;
  /**
   * Event start/end instant (ISO) when known — used to flag past events in Inbox.
   * Null for non-events or undated rows.
   */
  eventStartsAt: string | null;
  /** Computed priority score (0–100). Not a DB column. */
  priority: number;
  targetUrl: string;
  reviewType: InboxReviewType;
};

/** System Saved View ids. Custom views use free-form string ids later. */
export type InboxSystemViewId =
  | "all"
  | "high_confidence"
  | "professionals"
  | "businesses"
  | "marketplace"
  | "jobs"
  | "events"
  | "claims"
  | "recommendations"
  | "telegram"
  | "facebook"
  | "directories"
  | "loveoverse"
  | "eventbrite"
  | "needs_review"
  | "recently_imported"
  | "ready_to_publish"
  | "lane_attach"
  | "lane_route"
  | "lane_ready"
  | "lane_seeking"
  | "lane_quarantine"
  | "lane_review";

export type InboxViewId = InboxSystemViewId | (string & {});

export type InboxFilters = {
  view?: InboxViewId;
  entityType?: InboxEntityType | "all";
  source?: InboxSourceKey | "all";
  status?: string | "all";
  reviewType?: InboxReviewType | "all";
  /** Exact match on InboxItem.sourceRef */
  sourceRef?: string | "all";
  /** Minimum AI confidence 0–1 (High Confidence view) */
  minConfidence?: number | null;
  /** Only items newer than this many hours (Recently Imported) */
  maxAgeHours?: number | null;
  /** Statuses that count as “needs review” */
  needsReview?: boolean;
  /** Admin order lane filter */
  lane?: import("@/lib/admin/lanes/types").AdminLaneId | "all";
  /** Client-side quick search (title / source) */
  q?: string;
};

export type InboxMetrics = {
  total: number;
  inReview: number;
  highConfidence: number;
  oldestTaskAt: string | null;
};

export type InboxSourceAdapter = {
  id: InboxReviewType;
  label: string;
  /** Fetch pending (or default-queue) items for aggregation */
  fetch: (client: unknown) => Promise<InboxItem[]>;
};
