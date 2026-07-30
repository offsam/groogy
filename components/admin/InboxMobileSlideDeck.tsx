"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { InboxItem } from "@/lib/admin/inbox/types";
import {
  INBOX_ENTITY_LABELS,
  INBOX_REVIEW_TYPE_LABELS,
  INBOX_SOURCE_LABELS,
} from "@/lib/admin/inbox/labels";

export const INBOX_SLIDE_QUEUE_KEY = "krugi-inbox-slide-queue";

export type InboxSlideQueue = {
  ids: string[];
  urls: string[];
  titles: string[];
  index: number;
};

export function writeInboxSlideQueue(
  items: InboxItem[],
  index: number,
): void {
  const payload: InboxSlideQueue = {
    ids: items.map((i) => i.id),
    urls: items.map((i) => i.targetUrl),
    titles: items.map((i) => i.title),
    index,
  };
  try {
    sessionStorage.setItem(INBOX_SLIDE_QUEUE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function readInboxSlideQueue(): InboxSlideQueue | null {
  try {
    const raw = sessionStorage.getItem(INBOX_SLIDE_QUEUE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InboxSlideQueue;
    if (!Array.isArray(parsed.ids) || !Array.isArray(parsed.urls)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function updateInboxSlideIndex(index: number): void {
  const q = readInboxSlideQueue();
  if (!q) return;
  try {
    sessionStorage.setItem(
      INBOX_SLIDE_QUEUE_KEY,
      JSON.stringify({ ...q, index }),
    );
  } catch {
    // ignore
  }
}

type Props = {
  items: InboxItem[];
  startIndex?: number;
  open: boolean;
  onClose: () => void;
  onOpenTask: (item: InboxItem, index: number) => void;
};

/** Full-viewport vertical snap slides for mobile Inbox review. */
export function InboxMobileSlideDeck({
  items,
  startIndex = 0,
  open,
  onClose,
  onOpenTask,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !scrollerRef.current) return;
    const slide = scrollerRef.current.querySelector<HTMLElement>(
      `[data-slide-index="${startIndex}"]`,
    );
    slide?.scrollIntoView({ block: "start" });
  }, [open, startIndex]);

  if (!open || items.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[1100] flex flex-col bg-slate-950 text-white lg:hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5">
        <p className="text-sm font-medium">Слайды · {items.length}</p>
        <button
          type="button"
          aria-label="Закрыть"
          className="inline-flex size-9 items-center justify-center rounded-full bg-white/10"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </header>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overscroll-y-contain"
      >
        {items.map((item, index) => (
          <section
            key={item.id}
            data-slide-index={index}
            className="flex h-[calc(100dvh-3.25rem)] w-full snap-start snap-always flex-col justify-between px-4 py-5"
          >
            <div className="min-w-0 space-y-3 overflow-hidden">
              <p className="text-xs tabular-nums text-white/50">
                {index + 1} / {items.length}
              </p>
              <div className="flex min-w-0 items-start gap-2">
                <h2 className="min-w-0 flex-1 text-2xl font-bold leading-tight tracking-tight">
                  {item.title}
                </h2>
                <div
                  className="flex max-w-[42%] shrink-0 flex-wrap items-center justify-end gap-1 pt-1 text-[10px] font-semibold tabular-nums leading-none text-white/80"
                  title={`Полнота ${
                    item.completenessPercent != null
                      ? item.completenessPercent
                      : "—"
                  } · Чеклист ${
                    item.checklistReady != null && item.checklistTotal != null
                      ? `${item.checklistReady}/${item.checklistTotal}`
                      : "—"
                  } · AI ${
                    item.aiConfidence == null
                      ? "—"
                      : `${Math.round(
                          item.aiConfidence <= 1
                            ? item.aiConfidence * 100
                            : item.aiConfidence,
                        )}%`
                  } · P${item.priority}`}
                >
                  <span className="rounded bg-white/15 px-1.5 py-0.5" title="Полнота">
                    {item.completenessPercent != null
                      ? item.completenessPercent
                      : "—"}
                  </span>
                  {item.checklistReady != null &&
                  item.checklistTotal != null ? (
                    <span
                      className="rounded bg-white/15 px-1.5 py-0.5"
                      title="Чеклист"
                    >
                      {item.checklistReady}/{item.checklistTotal}
                    </span>
                  ) : null}
                  <span className="rounded bg-white/15 px-1.5 py-0.5">
                    AI{" "}
                    {item.aiConfidence == null
                      ? "—"
                      : `${Math.round(
                          item.aiConfidence <= 1
                            ? item.aiConfidence * 100
                            : item.aiConfidence,
                        )}%`}
                  </span>
                  <span className="rounded bg-white/15 px-1.5 py-0.5">
                    P{item.priority}
                  </span>
                </div>
              </div>
              <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-white/60">
                <span>{INBOX_REVIEW_TYPE_LABELS[item.reviewType]}</span>
                <span>·</span>
                <span>{INBOX_ENTITY_LABELS[item.entityType]}</span>
                <span>·</span>
                <span>
                  {INBOX_SOURCE_LABELS[item.source]}
                  {item.sourceName ? ` · ${item.sourceName}` : ""}
                </span>
              </p>
              <p className="text-sm uppercase tracking-wide text-white/40">
                {item.status}
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-center text-xs text-white/40">
                Листай вниз к следующей задаче
              </p>
              <button
                type="button"
                className="flex w-full items-center justify-center rounded-xl bg-brand-blue px-4 py-3.5 text-sm font-semibold text-white"
                onClick={() => onOpenTask(item, index)}
              >
                Открыть карточку
              </button>
              <Link
                href={item.targetUrl}
                className="block text-center text-xs text-white/50 underline"
                onClick={() => writeInboxSlideQueue(items, index)}
              >
                Или открыть workspace
              </Link>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
