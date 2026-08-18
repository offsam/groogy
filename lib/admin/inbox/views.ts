import {
  INBOX_HIGH_CONFIDENCE_THRESHOLD,
  normalizeAiConfidence,
} from "@/lib/admin/inbox/priority";
import { isEventPast } from "@/lib/events/timing";
import type {
  InboxFilters,
  InboxItem,
  InboxSystemViewId,
  InboxViewId,
} from "@/lib/admin/inbox/types";
import {
  classifyLane,
  laneInputFromInboxItem,
} from "@/lib/admin/lanes";
import { ADMIN_LANE_HINTS, ADMIN_LANE_LABELS } from "@/lib/admin/lanes/types";

export type InboxViewPreset = {
  id: InboxViewId;
  label: string;
  description: string;
  /** System presets ship in code; custom views load from user store later */
  system: boolean;
  /** Partial filters applied when the view is selected */
  filters: Omit<InboxFilters, "view" | "q">;
};

/**
 * Queue tabs shown above the feed — lanes only (sources live on /admin/queue).
 */
export const INBOX_SYSTEM_VIEWS: InboxViewPreset[] = [
  {
    id: "all",
    label: "Вся лента",
    description: "Все источники, сверху — самые готовые",
    system: true,
    filters: {},
  },
  {
    id: "ready_to_publish",
    label: "Готово к публикации (проверено)",
    description:
      "Только review_status = ready_to_publish — телефон или город, без дубля",
    system: true,
    filters: { status: "ready_to_publish" },
  },
  {
    id: "lane_attach",
    label: ADMIN_LANE_LABELS.attach,
    description: ADMIN_LANE_HINTS.attach,
    system: true,
    filters: { lane: "attach" },
  },
  {
    id: "lane_route",
    label: ADMIN_LANE_LABELS.route,
    description: ADMIN_LANE_HINTS.route,
    system: true,
    filters: { lane: "route" },
  },
  {
    id: "lane_ready",
    label: ADMIN_LANE_LABELS.ready,
    description: ADMIN_LANE_HINTS.ready,
    system: true,
    filters: { lane: "ready" },
  },
  {
    id: "lane_seeking",
    label: ADMIN_LANE_LABELS.seeking,
    description: ADMIN_LANE_HINTS.seeking,
    system: true,
    filters: { lane: "seeking" },
  },
  {
    id: "lane_quarantine",
    label: ADMIN_LANE_LABELS.quarantine,
    description: ADMIN_LANE_HINTS.quarantine,
    system: true,
    filters: { lane: "quarantine" },
  },
  {
    id: "lane_review",
    label: ADMIN_LANE_LABELS.review,
    description: ADMIN_LANE_HINTS.review,
    system: true,
    filters: { lane: "review" },
  },
];

/** Source filters — still deep-linkable from /admin/queue, not primary chips. */
export const INBOX_SOURCE_VIEWS: InboxViewPreset[] = [
  {
    id: "telegram",
    label: "Telegram",
    description: "Только Telegram",
    system: true,
    filters: { source: "telegram" },
  },
  {
    id: "facebook",
    label: "Facebook",
    description: "Только Facebook",
    system: true,
    filters: { source: "facebook" },
  },
  {
    id: "directories",
    label: "Справочники",
    description: "Yellow Pages и каталоги",
    system: true,
    filters: { source: "directories" },
  },
  {
    id: "loveoverse",
    label: "Loveoverse",
    description: "Афиша loveoverse.com (LA)",
    system: true,
    filters: { source: "loveoverse" },
  },
  {
    id: "eventbrite",
    label: "Eventbrite",
    description: "Афиша Eventbrite (CA hubs)",
    system: true,
    filters: { source: "eventbrite" },
  },
];

/** Kept for deep links / matchInboxView; not shown as primary chips. */
export const INBOX_EXTRA_VIEWS: InboxViewPreset[] = [
  {
    id: "high_confidence",
    label: "Готовые",
    description: `AI confidence ≥ ${Math.round(INBOX_HIGH_CONFIDENCE_THRESHOLD * 100)}%`,
    system: true,
    filters: { minConfidence: INBOX_HIGH_CONFIDENCE_THRESHOLD },
  },
  {
    id: "professionals",
    label: "Специалисты",
    description: "Специалисты",
    system: true,
    filters: { entityType: "professional" },
  },
  {
    id: "businesses",
    label: "Бизнесы",
    description: "Бизнесы",
    system: true,
    filters: { entityType: "business" },
  },
  {
    id: "marketplace",
    label: "Marketplace",
    description: "Маркетплейс / объявления",
    system: true,
    filters: { entityType: "marketplace" },
  },
  {
    id: "jobs",
    label: "Вакансии",
    description: "Вакансии",
    system: true,
    filters: { entityType: "job" },
  },
  {
    id: "events",
    label: "События",
    description: "События до Approve",
    system: true,
    filters: { entityType: "event" },
  },
  {
    id: "claims",
    label: "Верификация",
    description: "Заявки на владение — смотри /admin/claims",
    system: true,
    filters: { reviewType: "ownership_claim" },
  },
  {
    id: "recommendations",
    label: "Рекомендации",
    description: "Рекомендации из комментариев",
    system: true,
    filters: { reviewType: "recommendation" },
  },
  {
    id: "needs_review",
    label: "Нужна проверка",
    description: "in_review / needs_more_info",
    system: true,
    filters: { needsReview: true },
  },
  {
    id: "recently_imported",
    label: "Свежие",
    description: "Созданы за последние 48 часов",
    system: true,
    filters: { maxAgeHours: 48 },
  },
];

export const INBOX_ALL_VIEWS: InboxViewPreset[] = [
  ...INBOX_SYSTEM_VIEWS,
  ...INBOX_SOURCE_VIEWS,
  ...INBOX_EXTRA_VIEWS,
];

/**
 * Live-card audit view — not an Inbox filter preset.
 * Linked from Saved Views as a sibling Review Center page.
 */
export const WRONG_SECTION_VIEW = {
  id: "wrong_section",
  label: "Карточка не в своём разделе",
  description:
    "Опубликованные карточки, у которых маршрутизатор предлагает другой раздел",
  href: "/admin/review/wrong-section",
} as const;

/** Primary queue tabs in the UI. */
export const INBOX_VIEWS = INBOX_SYSTEM_VIEWS;

const ALL_VIEW_IDS = new Set(
  INBOX_ALL_VIEWS.map((v) => v.id as InboxSystemViewId),
);

/**
 * Merge primary + extra + optional custom presets.
 * Custom ids must not collide with known ids.
 */
export function listInboxViews(
  custom: InboxViewPreset[] = [],
): InboxViewPreset[] {
  const extras = custom.filter((v) => !ALL_VIEW_IDS.has(v.id as InboxSystemViewId));
  return [...INBOX_ALL_VIEWS, ...extras];
}

export function getInboxView(
  id: string | undefined,
  custom: InboxViewPreset[] = [],
): InboxViewPreset {
  const views = listInboxViews(custom);
  return views.find((v) => v.id === id) ?? views[0]!;
}

/**
 * View presets fill defaults; explicit URL params (including `"all"`) override.
 * Missing param → view default → `"all"`.
 */
export function resolveInboxFilters(
  raw: InboxFilters,
  custom: InboxViewPreset[] = [],
): InboxFilters {
  const view = getInboxView(raw.view, custom);
  return {
    view: view.id,
    entityType: raw.entityType ?? view.filters.entityType ?? "all",
    source: raw.source ?? view.filters.source ?? "all",
    status: raw.status ?? view.filters.status ?? "all",
    reviewType: raw.reviewType ?? view.filters.reviewType ?? "all",
    sourceRef: raw.sourceRef ?? view.filters.sourceRef ?? "all",
    lane: raw.lane ?? view.filters.lane ?? "all",
    minConfidence:
      raw.minConfidence !== undefined
        ? raw.minConfidence
        : (view.filters.minConfidence ?? null),
    maxAgeHours:
      raw.maxAgeHours !== undefined
        ? raw.maxAgeHours
        : (view.filters.maxAgeHours ?? null),
    needsReview:
      raw.needsReview !== undefined
        ? raw.needsReview
        : Boolean(view.filters.needsReview),
    q: raw.q?.trim() || undefined,
  };
}

/** Highlight the View chip that matches effective filters (after manual overrides). */
export function matchInboxView(
  filters: InboxFilters,
  custom: InboxViewPreset[] = [],
): InboxViewId {
  const entity = filters.entityType ?? "all";
  const source = filters.source ?? "all";
  const status = filters.status ?? "all";
  const reviewType = filters.reviewType ?? "all";
  const minConfidence = filters.minConfidence ?? null;
  const maxAgeHours = filters.maxAgeHours ?? null;
  const needsReview = Boolean(filters.needsReview);
  const lane = filters.lane ?? "all";

  for (const view of listInboxViews(custom)) {
    if (view.id === "all") continue;
    const f = view.filters;
    const matches =
      (f.entityType ? entity === f.entityType : entity === "all") &&
      (f.source ? source === f.source : source === "all") &&
      (f.status ? status === f.status : status === "all") &&
      (f.reviewType ? reviewType === f.reviewType : reviewType === "all") &&
      (f.lane ? lane === f.lane : lane === "all") &&
      (f.minConfidence != null
        ? minConfidence === f.minConfidence
        : minConfidence == null) &&
      (f.maxAgeHours != null
        ? maxAgeHours === f.maxAgeHours
        : maxAgeHours == null) &&
      (f.needsReview ? needsReview : !needsReview);
    if (matches) return view.id;
  }
  return "all";
}

const NEEDS_REVIEW_STATUSES = new Set(["in_review", "needs_more_info"]);

/** Higher = more filled / closer to publish. Drives “готовые сверху”. */
export function inboxReadinessScore(item: InboxItem): number {
  if (item.completenessPercent != null) return item.completenessPercent;
  if (
    item.checklistReady != null &&
    item.checklistTotal != null &&
    item.checklistTotal > 0
  ) {
    return Math.round((item.checklistReady / item.checklistTotal) * 100);
  }
  return 0;
}

export function filterInboxItems(
  items: InboxItem[],
  filters: InboxFilters,
  custom: InboxViewPreset[] = [],
  nowMs: number = Date.now(),
): InboxItem[] {
  const f = resolveInboxFilters(filters, custom);
  const q = f.q?.toLowerCase();

  return items.filter((item) => {
    // Default feed: quarantine lives only in «Помойка», not mixed into all.
    if (
      (!f.lane || f.lane === "all") &&
      (!f.status || f.status === "all") &&
      item.status === "quarantine"
    ) {
      return false;
    }
    if (f.entityType && f.entityType !== "all" && item.entityType !== f.entityType) {
      return false;
    }
    if (f.source && f.source !== "all" && item.source !== f.source) {
      return false;
    }
    if (f.status && f.status !== "all" && item.status !== f.status) {
      return false;
    }
    if (
      f.reviewType &&
      f.reviewType !== "all" &&
      item.reviewType !== f.reviewType
    ) {
      return false;
    }
    if (f.lane && f.lane !== "all") {
      const lane = classifyLane(laneInputFromInboxItem(item)).lane;
      if (lane !== f.lane) return false;
    }
    if (
      f.sourceRef &&
      f.sourceRef !== "all" &&
      item.sourceRef !== f.sourceRef
    ) {
      return false;
    }
    if (f.minConfidence != null) {
      const conf = normalizeAiConfidence(item.aiConfidence);
      if (conf == null || conf < f.minConfidence) return false;
    }
    if (f.maxAgeHours != null) {
      const created = Date.parse(item.createdAt);
      if (Number.isNaN(created)) return false;
      const ageHours = (nowMs - created) / 3_600_000;
      if (ageHours > f.maxAgeHours) return false;
    }
    if (f.needsReview && !NEEDS_REVIEW_STATUSES.has(item.status)) {
      return false;
    }
    if (q) {
      const hay = `${item.title} ${item.sourceName} ${item.sourceRef ?? ""} ${item.status}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortInboxItems(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    // Past events sink — don't burn moderator time on expired affiches.
    const aPast =
      (a.entityType === "event" || a.reviewType === "event_verification") &&
      isEventPast(a.eventStartsAt);
    const bPast =
      (b.entityType === "event" || b.reviewType === "event_verification") &&
      isEventPast(b.eventStartsAt);
    if (aPast !== bPast) return aPast ? 1 : -1;
    const readyDiff = inboxReadinessScore(b) - inboxReadinessScore(a);
    if (readyDiff !== 0) return readyDiff;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });
}
