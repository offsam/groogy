"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { ExternalLink, Layers, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { signalAppNavigation } from "@/components/layout/NavigationProgress";
import {
  InboxMobileSlideDeck,
  writeInboxSlideQueue,
} from "@/components/admin/InboxMobileSlideDeck";
import {
  assignInboxTasks,
  clearInboxAssignments,
  countAssignedTo,
  readInboxAssignments,
  type InboxAssignmentMap,
} from "@/lib/admin/inbox/assignment";
import { runInboxBulkAction } from "@/lib/admin/inbox/bulk-actions";
import {
  runLaneBulkAction,
  runAttachLaneScanAction,
} from "@/lib/admin/lanes/actions";
import {
  ADMIN_LANE_IDS,
  ADMIN_LANE_LABELS,
  type AdminLaneId,
} from "@/lib/admin/lanes/types";
import type { AdminLaneCounts } from "@/lib/admin/lanes/counts";
import { priorityBand } from "@/lib/admin/inbox/priority";
import type {
  InboxFilters,
  InboxItem,
  InboxMetrics,
} from "@/lib/admin/inbox/types";
import { INBOX_SYSTEM_VIEWS, filterInboxItems } from "@/lib/admin/inbox/views";
import {
  INBOX_ENTITY_LABELS,
  INBOX_ENTITY_OPTIONS,
  INBOX_REVIEW_TYPE_LABELS,
  INBOX_REVIEW_TYPE_OPTIONS,
  INBOX_SOURCE_LABELS,
  INBOX_SOURCE_OPTIONS,
  INBOX_STATUS_OPTIONS,
} from "@/lib/admin/inbox/labels";
import type { ImportReviewStatus } from "@/types/import-review";
import { isRecentlyImported } from "@/lib/admin/imports/recent-import";
import { eventTimingLabel } from "@/lib/events/timing";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  items: InboxItem[];
  /** Unfiltered loaded set — for Assigned-to-me metric scope */
  allItems: InboxItem[];
  /** Exact queue total for current scope (DB) */
  totalUnfiltered: number;
  totalFiltered: number;
  /** Rows fetched into the working set (pre-filter) */
  loadedUnfiltered: number;
  byReviewType: Record<string, number>;
  /** Same lane numbers as /admin/queue tiles */
  laneCounts: AdminLaneCounts;
  errors: Array<{ source: string; message: string }>;
  activeView: string;
  resolvedFilters: InboxFilters;
  metrics: InboxMetrics;
  currentUser: { id: string; label: string };
};

const PAGE_SIZE = 20;

function formatConfidence(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAge(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "1 дн.";
  return `${days} дн.`;
}

const PRIORITY_STYLES = {
  high: "bg-brand-orange/15 text-brand-orange",
  medium: "bg-slate-100 text-slate-700",
  low: "bg-slate-50 text-slate-500",
} as const;

export function ReviewInboxPanel({
  items,
  allItems,
  totalUnfiltered,
  totalFiltered,
  loadedUnfiltered,
  byReviewType,
  laneCounts,
  errors,
  activeView,
  resolvedFilters,
  metrics,
  currentUser,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState(resolvedFilters.q ?? "");
  const deferredSearch = useDeferredValue(search);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const [listPage, setListPage] = useState(1);
  const [assignments, setAssignments] = useState<InboxAssignmentMap>({});
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] =
    useState<ImportReviewStatus>("in_review");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [slideStart, setSlideStart] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setAssignments(readInboxAssignments());
  }, []);

  const visibleItems = useMemo(() => {
    if (!deferredSearch.trim()) return items;
    return filterInboxItems(items, {
      ...resolvedFilters,
      q: deferredSearch.trim(),
    });
  }, [items, deferredSearch, resolvedFilters]);

  const laneChipCounts = laneCounts;

  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  const safePage = Math.min(listPage, pageCount);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return visibleItems.slice(start, start + PAGE_SIZE);
  }, [visibleItems, safePage]);

  const pageRangeLabel = useMemo(() => {
    if (visibleItems.length === 0) return "0";
    const start = (safePage - 1) * PAGE_SIZE + 1;
    const end = Math.min(safePage * PAGE_SIZE, visibleItems.length);
    return `${start}–${end}`;
  }, [visibleItems.length, safePage]);

  useEffect(() => {
    setListPage(1);
    setFocusIndex(0);
  }, [deferredSearch, activeView, resolvedFilters]);

  const assignedToMe = useMemo(
    () =>
      countAssignedTo(
        assignments,
        currentUser.id,
        allItems.map((i) => i.id),
      ),
    [assignments, allItems, currentUser.id],
  );

  function hrefWith(patch: Record<string, string | null>): string {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === "" || value === "all") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  }

  function viewHref(viewId: string): string {
    const preset =
      INBOX_SYSTEM_VIEWS.find((v) => v.id === viewId) ?? INBOX_SYSTEM_VIEWS[0]!;
    const next = new URLSearchParams();
    if (preset.id !== "all") next.set("view", preset.id);
    const src = preset.filters.source;
    if (src && src !== "all") next.set("source", src);
    const lane = preset.filters.lane;
    if (lane && lane !== "all") next.set("lane", lane);
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  }

  function onSelectChange(key: string, value: string) {
    const next: Record<string, string | null> = {
      // Drop view chip; server rematches from concrete filters (incl. lane).
      view: null,
      entity:
        resolvedFilters.entityType && resolvedFilters.entityType !== "all"
          ? resolvedFilters.entityType
          : null,
      source:
        resolvedFilters.source && resolvedFilters.source !== "all"
          ? resolvedFilters.source
          : null,
      status:
        resolvedFilters.status && resolvedFilters.status !== "all"
          ? resolvedFilters.status
          : null,
      reviewType:
        resolvedFilters.reviewType && resolvedFilters.reviewType !== "all"
          ? resolvedFilters.reviewType
          : null,
      sourceRef:
        resolvedFilters.sourceRef && resolvedFilters.sourceRef !== "all"
          ? resolvedFilters.sourceRef
          : null,
      lane:
        resolvedFilters.lane && resolvedFilters.lane !== "all"
          ? resolvedFilters.lane
          : null,
      minConfidence:
        resolvedFilters.minConfidence != null
          ? String(resolvedFilters.minConfidence)
          : null,
      maxAgeHours:
        resolvedFilters.maxAgeHours != null
          ? String(resolvedFilters.maxAgeHours)
          : null,
      needsReview: resolvedFilters.needsReview ? "1" : null,
    };
    next[key] = value === "all" ? null : value;
    // Source chip/group no longer applies when channel changes.
    if (key === "source") {
      next.sourceRef = null;
    }
    signalAppNavigation();
    router.push(hrefWith(next));
  }

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(pageItems.map((i) => i.id)));
  }, [pageItems]);

  function clearSelection() {
    setSelected(new Set());
  }

  const selectedItems = useMemo(
    () => visibleItems.filter((i) => selected.has(i.id)),
    [visibleItems, selected],
  );

  const runBulk = useCallback(
    (action: "approve" | "reject" | "archive" | "change_status") => {
      if (selectedItems.length === 0) return;
      setBulkError(null);
      setBulkMessage(null);
      setBulkAction(action);
      startTransition(async () => {
        try {
          const res = await runInboxBulkAction({
            action,
            targets: selectedItems.map((i) => ({
              id: i.id,
              sourceId: i.sourceId,
              reviewType: i.reviewType,
            })),
            status: action === "change_status" ? statusTarget : undefined,
          });
          if (res.failed > 0 || res.messages.length) {
            setBulkError(
              res.messages.join(" · ") ||
                `Ошибки: ${res.failed}, ok: ${res.processed}`,
            );
          } else {
            setBulkMessage(
              `Готово: ${res.processed}` +
                (res.skipped ? `, пропущено ${res.skipped}` : ""),
            );
            clearSelection();
            router.refresh();
          }
        } catch (err) {
          setBulkError(err instanceof Error ? err.message : "Bulk failed");
        } finally {
          setBulkAction(null);
        }
      });
    },
    [selectedItems, statusTarget, router],
  );

  const runLaneBulk = useCallback(
    (
      action:
        | "quarantine"
        | "reclaim"
        | "destroy"
        | "mark_seeking"
        | "apply_route"
        | "promote_ready"
        | "approve_ready",
    ) => {
      if (selectedItems.length === 0) return;
      if (
        action === "destroy" &&
        !window.confirm("Уничтожить выбранные из помойки навсегда?")
      ) {
        return;
      }
      setBulkError(null);
      setBulkMessage(null);
      setBulkAction(action);
      startTransition(async () => {
        try {
          const res = await runLaneBulkAction({
            action,
            targets: selectedItems.map((i) => ({
              sourceId: i.sourceId,
              reviewType:
                i.reviewType === "ownership_claim"
                  ? "import_review"
                  : i.reviewType,
            })),
          });
          if (res.failed > 0 || res.messages.length) {
            setBulkError(
              res.messages.join(" · ") ||
                `Ошибки: ${res.failed}, ok: ${res.processed}`,
            );
          } else {
            setBulkMessage(`Полоса: ${res.processed}`);
            clearSelection();
            router.refresh();
          }
        } catch (err) {
          setBulkError(err instanceof Error ? err.message : "Lane bulk failed");
        } finally {
          setBulkAction(null);
        }
      });
    },
    [selectedItems, router],
  );

  const runAttachScan = useCallback(() => {
    setBulkError(null);
    setBulkMessage(null);
    setBulkAction("attach_scan");
    startTransition(async () => {
      try {
        const res = await runAttachLaneScanAction();
        if (!res.ok) setBulkError(res.message);
        else {
          setBulkMessage(res.message);
          router.refresh();
        }
      } catch (err) {
        setBulkError(err instanceof Error ? err.message : "Scan failed");
      } finally {
        setBulkAction(null);
      }
    });
  }, [router]);

  function runAssign(toMe: boolean) {
    if (selectedItems.length === 0) return;
    const ids = selectedItems.map((i) => i.id);
    if (toMe) {
      setAssignments(
        assignInboxTasks(ids, {
          id: currentUser.id,
          label: currentUser.label,
        }),
      );
      setBulkMessage(`Assigned ${ids.length} → ${currentUser.label}`);
    } else {
      setAssignments(clearInboxAssignments(ids));
      setBulkMessage(`Unassigned ${ids.length}`);
    }
  }

  useEffect(() => {
    setFocusIndex((i) =>
      pageItems.length === 0 ? 0 : Math.min(i, pageItems.length - 1),
    );
  }, [pageItems.length, safePage]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!pageItems.length) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((i) => Math.min(pageItems.length - 1, i + 1));
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "x" || e.key === " ") {
        e.preventDefault();
        const item = pageItems[focusIndex];
        if (item) toggleSelect(item.id);
        return;
      }
      if (e.key === "Enter") {
        const item = pageItems[focusIndex];
        if (item) {
          signalAppNavigation();
          router.push(item.targetUrl);
        }
        return;
      }
      if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        selectAllVisible();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageItems, focusIndex, router, toggleSelect, selectAllVisible]);

  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-inbox-index="${focusIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  const entity = resolvedFilters.entityType ?? "all";
  const source = resolvedFilters.source ?? "all";
  const status = resolvedFilters.status ?? "all";
  const reviewType = resolvedFilters.reviewType ?? "all";
  const sourceRef =
    resolvedFilters.sourceRef && resolvedFilters.sourceRef !== "all"
      ? resolvedFilters.sourceRef
      : null;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Metrics — compact 2-col on mobile */}
      <div className="grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-4">
        {[
          {
            label: "В очереди",
            value: String(metrics.total),
            title:
              metrics.total !== totalUnfiltered &&
              !(
                resolvedFilters.lane &&
                resolvedFilters.lane !== "all"
              )
                ? `По текущему фильтру. Всего без фильтра: ${totalUnfiltered}`
                : loadedUnfiltered < metrics.total
                  ? `В базе ${metrics.total}. В списке сверху самые готовые (${loadedUnfiltered}).`
                  : "Сколько карточек в этой очереди (как на плашке)",
          },
          { label: "В списке", value: String(visibleItems.length) },
          { label: "На мне", value: String(assignedToMe) },
          {
            label: "Самая старая",
            value: formatAge(metrics.oldestTaskAt),
            title: metrics.oldestTaskAt
              ? formatDate(metrics.oldestTaskAt)
              : undefined,
          },
        ].map((m) => (
          <div
            key={m.label}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 sm:rounded-xl sm:px-3 sm:py-2.5"
            title={m.title}
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-[11px]">
              {m.label}
            </p>
            <p className="mt-0.5 text-base font-semibold tabular-nums text-slate-900 sm:text-xl">
              {m.value}
            </p>
          </div>
        ))}
      </div>

      {/* Views + mobile tools (not sticky on mobile — frees scroll) */}
      <div className="space-y-2 sm:sticky sm:top-0 sm:z-20 sm:-mx-1 sm:space-y-3 sm:bg-slate-50/95 sm:px-1 sm:py-2 sm:backdrop-blur sm:supports-[backdrop-filter]:bg-slate-50/85">
        <div className="flex items-start gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
            {INBOX_SYSTEM_VIEWS.map((view) => {
              const active = activeView === view.id;
              const laneId = view.id.startsWith("lane_")
                ? (view.id.slice(5) as AdminLaneId)
                : null;
              const count =
                laneId && ADMIN_LANE_IDS.includes(laneId)
                  ? laneChipCounts[laneId]
                  : view.id === "all"
                    ? totalUnfiltered
                    : null;
              return (
                <Link
                  key={view.id}
                  href={viewHref(view.id)}
                  title={view.description}
                  className={`flex min-h-[2.75rem] flex-col justify-center rounded-lg px-2 py-1.5 transition sm:min-h-[3.25rem] sm:px-2.5 ${
                    active
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:border-brand-blue/40"
                  }`}
                >
                  <span className="text-[11px] font-semibold leading-tight sm:text-xs">
                    {view.label}
                  </span>
                  {typeof count === "number" ? (
                    <span
                      className={`mt-0.5 text-sm font-bold tabular-nums sm:text-base ${
                        active ? "text-white/90" : "text-slate-900"
                      }`}
                    >
                      {count.toLocaleString("ru-RU")}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 sm:hidden"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal className="size-3.5" />
            Фильтры
          </button>
          {pageItems.length > 0 ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-blue px-2 py-1 text-[11px] font-semibold text-white sm:hidden"
              onClick={() => {
                setSlideStart(0);
                writeInboxSlideQueue(pageItems, 0);
                setSlidesOpen(true);
              }}
            >
              <Layers className="size-3.5" />
              Слайды
            </button>
          ) : null}
        </div>

        {sourceRef ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-blue/20 bg-brand-blue/5 px-3 py-2 text-xs text-slate-700 sm:px-4 sm:py-2.5 sm:text-sm">
            <span>
              Источник:{" "}
              <code className="rounded bg-white px-1.5 py-0.5 text-xs font-medium">
                {sourceRef}
              </code>
            </span>
            <Link
              href={hrefWith({ sourceRef: null })}
              className="font-medium text-brand-blue hover:underline"
            >
              Сбросить
            </Link>
          </div>
        ) : null}

        <div
          className={`${
            filtersOpen ? "grid" : "hidden"
          } gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid sm:grid-cols-2 lg:grid-cols-5`}
        >
          <label className="relative block text-xs font-medium text-slate-500 lg:col-span-1">
            Search
            <span className="relative mt-1 block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Название, источник…"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-2.5 text-sm text-slate-900"
              />
            </span>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Entity
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900"
              value={entity}
              onChange={(e) => onSelectChange("entity", e.target.value)}
            >
              {INBOX_ENTITY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt === "all" ? "All" : INBOX_ENTITY_LABELS[opt]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Source
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900"
              value={source}
              onChange={(e) => onSelectChange("source", e.target.value)}
            >
              {INBOX_SOURCE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt === "all" ? "All" : INBOX_SOURCE_LABELS[opt]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Status
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900"
              value={status}
              onChange={(e) => onSelectChange("status", e.target.value)}
            >
              {INBOX_STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt === "all" ? "All" : opt}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Review Type
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900"
              value={reviewType}
              onChange={(e) => onSelectChange("reviewType", e.target.value)}
            >
              {INBOX_REVIEW_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt === "all" ? "All" : INBOX_REVIEW_TYPE_LABELS[opt]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Bulk toolbar — compact / scrollable on mobile */}
        <div className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white px-2.5 py-2 [scrollbar-width:none] sm:flex-wrap sm:items-center sm:overflow-visible sm:px-3 [&::-webkit-scrollbar]:hidden">
          <label className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={
                pageItems.length > 0 &&
                pageItems.every((i) => selected.has(i.id))
              }
              onChange={(e) =>
                e.target.checked ? selectAllVisible() : clearSelection()
              }
            />
            Select ({selected.size})
          </label>
          <Button
            type="button"
            variant="primary"
            loading={pending && bulkAction === "approve"}
            disabled={pending || selected.size === 0}
            onClick={() => runBulk("approve")}
            className="shrink-0 text-xs"
          >
            {pending && bulkAction === "approve" ? "Одобряю…" : "OK / Approve"}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={pending && bulkAction === "approve_ready"}
            disabled={pending || selected.size === 0}
            onClick={() => runLaneBulk("approve_ready")}
            className="shrink-0 text-xs"
            title={ADMIN_LANE_LABELS.ready}
          >
            Готово → OK
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={pending && bulkAction === "attach_scan"}
            disabled={pending}
            onClick={() => runAttachScan()}
            className="shrink-0 text-xs"
            title={ADMIN_LANE_LABELS.attach}
          >
            Скан «Прикрепить»
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={pending && bulkAction === "apply_route"}
            disabled={pending || selected.size === 0}
            onClick={() => runLaneBulk("apply_route")}
            className="shrink-0 text-xs"
          >
            Разложить
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={pending && bulkAction === "mark_seeking"}
            disabled={pending || selected.size === 0}
            onClick={() => runLaneBulk("mark_seeking")}
            className="shrink-0 text-xs"
          >
            Я ищу
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={pending && bulkAction === "quarantine"}
            disabled={pending || selected.size === 0}
            onClick={() => runLaneBulk("quarantine")}
            className="shrink-0 text-xs"
          >
            В помойку
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={pending && bulkAction === "reclaim"}
            disabled={pending || selected.size === 0}
            onClick={() => runLaneBulk("reclaim")}
            className="shrink-0 text-xs"
          >
            Вернуть
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={pending && bulkAction === "destroy"}
            disabled={pending || selected.size === 0}
            onClick={() => runLaneBulk("destroy")}
            className="shrink-0 text-xs"
          >
            Уничтожить
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={pending && bulkAction === "reject"}
            disabled={pending || selected.size === 0}
            onClick={() => runBulk("reject")}
            className="shrink-0 text-xs"
          >
            {pending && bulkAction === "reject" ? "Отклоняю…" : "Reject"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={pending && bulkAction === "archive"}
            disabled={pending || selected.size === 0}
            onClick={() => runBulk("archive")}
            className="shrink-0 text-xs"
            title="Coming Soon"
          >
            Archive
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || selected.size === 0}
            onClick={() => runAssign(true)}
            className="shrink-0 text-xs"
          >
            Assign to me
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || selected.size === 0}
            onClick={() => runAssign(false)}
            className="shrink-0 text-xs"
          >
            Unassign
          </Button>
          <select
            value={statusTarget}
            onChange={(e) =>
              setStatusTarget(e.target.value as ImportReviewStatus)
            }
            className="shrink-0 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
            title="Change Status (Import Review only)"
            disabled={pending}
          >
            <option value="in_review">in_review</option>
            <option value="needs_more_info">needs_more_info</option>
            <option value="pending">pending</option>
            <option value="ready_to_publish">ready_to_publish</option>
          </select>
          <Button
            type="button"
            variant="secondary"
            loading={pending && bulkAction === "change_status"}
            disabled={pending || selected.size === 0}
            onClick={() => runBulk("change_status")}
            className="shrink-0 text-xs"
          >
            {pending && bulkAction === "change_status"
              ? "Меняю…"
              : "Change Status"}
          </Button>
          <span className="ml-auto hidden text-[11px] text-slate-400 sm:inline">
            j/k · x select · Enter open
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 sm:text-sm">
        <span>
          Страница{" "}
          <strong className="text-slate-900">{pageRangeLabel}</strong>
          {" · в списке "}
          <strong className="text-slate-900">{visibleItems.length}</strong>
          {visibleItems.length !== metrics.total ? (
            <>
              {" · в очереди "}
              <strong className="text-slate-900">{metrics.total}</strong>
            </>
          ) : null}
          {loadedUnfiltered < metrics.total ? (
            <>
              {" · сверху самые готовые из "}
              <strong className="text-slate-900">{metrics.total}</strong>
            </>
          ) : loadedUnfiltered < totalUnfiltered &&
            !(
              resolvedFilters.source &&
              resolvedFilters.source !== "all"
            ) &&
            !(
              resolvedFilters.sourceRef &&
              resolvedFilters.sourceRef !== "all"
            ) ? (
            <>
              {" · сверху самые готовые из "}
              <strong className="text-slate-900">{totalUnfiltered}</strong>
            </>
          ) : null}
          {deferredSearch.trim() && visibleItems.length !== totalFiltered
            ? ` (поиск внутри ${totalFiltered})`
            : ""}
        </span>
        {Object.entries(byReviewType).map(([key, count]) => (
          <span key={key} className="text-[11px] text-slate-500 sm:text-xs">
            {INBOX_REVIEW_TYPE_LABELS[
              key as keyof typeof INBOX_REVIEW_TYPE_LABELS
            ] ?? key}
            : {count}
          </span>
        ))}
      </div>

      {pending ? (
        <p
          className="inline-flex items-center gap-2 rounded-lg border border-brand-blue/25 bg-brand-blue/5 px-3 py-2 text-sm text-brand-blue-deep"
          role="status"
          aria-live="polite"
        >
          <BrandPinLoader size="sm" />
          Обрабатываю выбранные…
        </p>
      ) : null}

      {bulkError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {bulkError}
        </p>
      ) : null}
      {bulkMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {bulkMessage}
        </p>
      ) : null}

      {errors.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Часть источников не загрузилась:{" "}
          {errors.map((e) => `${e.source} (${e.message})`).join("; ")}
        </div>
      ) : null}

      {pageItems.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          Нет задач по текущим фильтрам.
        </p>
      ) : (
        <>
        <ul
          ref={listRef}
          className={`divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white sm:rounded-2xl ${
            pending ? "pointer-events-none opacity-60" : ""
          }`}
        >
          {pageItems.map((item, index) => {
            const band = priorityBand(item.priority);
            const assignment = assignments[item.id];
            const focused = index === focusIndex;
            return (
              <li
                key={item.id}
                data-inbox-index={index}
                className={focused ? "bg-brand-blue/5" : undefined}
              >
                <div className="flex items-center gap-2 px-2.5 py-2 sm:items-center sm:gap-3 sm:px-4 sm:py-3">
                  <input
                    type="checkbox"
                    className="shrink-0"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    aria-label={`Select ${item.title}`}
                  />
                  <Link
                    href={item.targetUrl}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2"
                    onFocus={() => setFocusIndex(index)}
                    onClick={() => writeInboxSlideQueue(pageItems, index)}
                  >
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 sm:text-base">
                          {item.title}
                        </p>
                        {(() => {
                          if (
                            item.entityType !== "event" &&
                            item.reviewType !== "event_verification"
                          ) {
                            return null;
                          }
                          const timing = eventTimingLabel(item.eventStartsAt);
                          if (timing.kind !== "past") return null;
                          return (
                            <span
                              className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white sm:text-[11px]"
                              title="Дата события уже прошла — не тратьте время на обогащение"
                            >
                              Уже прошло
                            </span>
                          );
                        })()}
                        <div
                          className="flex max-w-[46%] shrink-0 items-center justify-end gap-1 overflow-hidden text-[10px] font-semibold tabular-nums leading-none text-slate-600 sm:hidden"
                          title={`Полнота ${
                            item.completenessPercent != null
                              ? item.completenessPercent
                              : "—"
                          } · Чеклист ${
                            item.checklistReady != null &&
                            item.checklistTotal != null
                              ? `${item.checklistReady}/${item.checklistTotal}`
                              : "—"
                          } · AI ${formatConfidence(item.aiConfidence)} · P${item.priority}`}
                        >
                          <span
                            className="rounded bg-emerald-50 px-1 py-0.5 text-emerald-800"
                            title="Полнота"
                          >
                            {item.completenessPercent != null
                              ? item.completenessPercent
                              : "—"}
                          </span>
                          {item.checklistReady != null &&
                          item.checklistTotal != null ? (
                            <span
                              className="rounded bg-slate-100 px-1 py-0.5"
                              title="Чеклист"
                            >
                              {item.checklistReady}/{item.checklistTotal}
                            </span>
                          ) : null}
                          <span className="rounded bg-slate-100 px-1 py-0.5">
                            AI {formatConfidence(item.aiConfidence)}
                          </span>
                          <span
                            className={`rounded px-1 py-0.5 ${PRIORITY_STYLES[band]}`}
                          >
                            P{item.priority}
                          </span>
                        </div>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500 sm:text-xs">
                        {INBOX_ENTITY_LABELS[item.entityType]} ·{" "}
                        {INBOX_SOURCE_LABELS[item.source]}
                        {item.sourceName ? ` · ${item.sourceName}` : ""} ·{" "}
                        {item.status === "suspected_duplicate" ? (
                          <span className="font-medium text-amber-800">
                            подозрение на дубликат
                          </span>
                        ) : (
                          item.status
                        )}
                        {(item.entityType === "event" ||
                          item.reviewType === "event_verification") &&
                        (() => {
                          const timing = eventTimingLabel(item.eventStartsAt);
                          return (
                            <>
                              {" · "}
                              <span
                                className={
                                  timing.kind === "past"
                                    ? "font-semibold text-slate-800"
                                    : "text-slate-500"
                                }
                              >
                                {timing.text}
                              </span>
                            </>
                          );
                        })()}
                        {assignment ? ` → ${assignment.assigneeLabel}` : ""}
                      </p>
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 text-xs text-slate-500 sm:flex">
                      {(item.entityType === "event" ||
                        item.reviewType === "event_verification") &&
                      eventTimingLabel(item.eventStartsAt).kind === "past" ? (
                        <span
                          className="rounded bg-slate-800 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-white"
                          title="Дата события уже прошла — не тратьте время на обогащение"
                        >
                          Уже прошло
                        </span>
                      ) : null}
                      <span
                        className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold tabular-nums text-emerald-800"
                        title="Полнота"
                      >
                        {item.completenessPercent != null
                          ? item.completenessPercent
                          : "—"}
                      </span>
                      {item.checklistReady != null &&
                      item.checklistTotal != null ? (
                        <span
                          className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold tabular-nums text-slate-700"
                          title="Чеклист"
                        >
                          {item.checklistReady}/{item.checklistTotal}
                        </span>
                      ) : null}
                      <span
                        className={`rounded px-1.5 py-0.5 font-medium tabular-nums ${PRIORITY_STYLES[band]}`}
                        title="Priority Score"
                      >
                        P{item.priority}
                      </span>
                      <span
                        className="tabular-nums"
                        title="AI confidence"
                      >
                        AI {formatConfidence(item.aiConfidence)}
                      </span>
                      {item.reviewType === "recommendation" &&
                      isRecentlyImported(item.createdAt) ? (
                        <span className="rounded bg-brand-green/15 px-1.5 py-0.5 font-medium text-brand-green">
                          Новое
                        </span>
                      ) : null}
                      <span title="Дата выгрузки">
                        {formatDate(item.createdAt)}
                      </span>
                      <ExternalLink
                        className="size-3.5 text-slate-400"
                        aria-hidden
                      />
                    </div>
                  </Link>
                  <button
                    type="button"
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 sm:hidden"
                    aria-label="Слайды с этой задачи"
                    onClick={() => {
                      setSlideStart(index);
                      writeInboxSlideQueue(pageItems, index);
                      setSlidesOpen(true);
                    }}
                  >
                    <Layers className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {pageCount > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 disabled:opacity-40"
              disabled={safePage <= 1}
              onClick={() => {
                setListPage((p) => Math.max(1, p - 1));
                setFocusIndex(0);
              }}
            >
              ← Назад
            </button>
            <span className="tabular-nums text-slate-600">
              Стр. {safePage} / {pageCount}
            </span>
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 disabled:opacity-40"
              disabled={safePage >= pageCount}
              onClick={() => {
                setListPage((p) => Math.min(pageCount, p + 1));
                setFocusIndex(0);
              }}
            >
              Вперёд →
            </button>
          </div>
        ) : null}
        </>
      )}

      <InboxMobileSlideDeck
        items={pageItems}
        open={slidesOpen}
        startIndex={slideStart}
        onClose={() => setSlidesOpen(false)}
        onOpenTask={(item, index) => {
          writeInboxSlideQueue(pageItems, index);
          setSlidesOpen(false);
          signalAppNavigation();
          router.push(item.targetUrl);
        }}
      />
    </div>
  );
}
