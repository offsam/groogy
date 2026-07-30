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
 * System Saved Views = filter presets over Inbox (not separate queue pages).
 * Custom views: merge via `listInboxViews(custom)` without changing IA.
 */
export const INBOX_SYSTEM_VIEWS: InboxViewPreset[] = [
  {
    id: "all",
    label: "All",
    description: "Все задачи из подключённых очередей",
    system: true,
    filters: {},
  },
  {
    id: "high_confidence",
    label: "High Confidence",
    description: `AI confidence ≥ ${Math.round(INBOX_HIGH_CONFIDENCE_THRESHOLD * 100)}%`,
    system: true,
    filters: { minConfidence: INBOX_HIGH_CONFIDENCE_THRESHOLD },
  },
  {
    id: "professionals",
    label: "Professionals",
    description: "Специалисты",
    system: true,
    filters: { entityType: "professional" },
  },
  {
    id: "businesses",
    label: "Businesses",
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
    label: "Jobs",
    description: "Вакансии",
    system: true,
    filters: { entityType: "job" },
  },
  {
    id: "events",
    label: "Events — ждут выкладки",
    description: "События из FB / Telegram / Eventbrite до Approve",
    system: true,
    filters: { entityType: "event" },
  },
  {
    id: "claims",
    label: "Claims",
    description: "Заявки на владение",
    system: true,
    filters: { reviewType: "ownership_claim" },
  },
  {
    id: "recommendations",
    label: "Recommendations",
    description: "Рекомендации из комментариев",
    system: true,
    filters: { reviewType: "recommendation" },
  },
  {
    id: "telegram",
    label: "Telegram",
    description: "Источники Telegram",
    system: true,
    filters: { source: "telegram" },
  },
  {
    id: "facebook",
    label: "Facebook",
    description: "Источники Facebook",
    system: true,
    filters: { source: "facebook" },
  },
  {
    id: "directories",
    label: "Directories",
    description: "Справочники / Yellow Pages",
    system: true,
    filters: { source: "directories" },
  },
  {
    id: "needs_review",
    label: "Needs Review",
    description: "in_review / needs_more_info",
    system: true,
    filters: { needsReview: true },
  },
  {
    id: "recently_imported",
    label: "Recently Imported",
    description: "Созданы за последние 48 часов",
    system: true,
    filters: { maxAgeHours: 48 },
  },
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

/** @deprecated use INBOX_SYSTEM_VIEWS — kept for existing imports */
export const INBOX_VIEWS = INBOX_SYSTEM_VIEWS;

const SYSTEM_IDS = new Set(
  INBOX_SYSTEM_VIEWS.map((v) => v.id as InboxSystemViewId),
);

/**
 * Merge system + optional custom presets (localStorage / future API).
 * Custom ids must not collide with system ids.
 */
export function listInboxViews(
  custom: InboxViewPreset[] = [],
): InboxViewPreset[] {
  const extras = custom.filter((v) => !SYSTEM_IDS.has(v.id as InboxSystemViewId));
  return [...INBOX_SYSTEM_VIEWS, ...extras];
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

  for (const view of listInboxViews(custom)) {
    if (view.id === "all") continue;
    const f = view.filters;
    const matches =
      (f.entityType ? entity === f.entityType : entity === "all") &&
      (f.source ? source === f.source : source === "all") &&
      (f.status ? status === f.status : status === "all") &&
      (f.reviewType ? reviewType === f.reviewType : reviewType === "all") &&
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

export function filterInboxItems(
  items: InboxItem[],
  filters: InboxFilters,
  custom: InboxViewPreset[] = [],
  nowMs: number = Date.now(),
): InboxItem[] {
  const f = resolveInboxFilters(filters, custom);
  const q = f.q?.toLowerCase();

  return items.filter((item) => {
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
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });
}
