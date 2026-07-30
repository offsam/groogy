"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  readInboxSlideQueue,
  updateInboxSlideIndex,
  type InboxSlideQueue,
} from "@/components/admin/InboxMobileSlideDeck";

type Props = {
  taskId: string;
};

/** Mobile prev/next between Inbox tasks using the saved slide queue. */
export function ReviewWorkspaceQueueNav({ taskId }: Props) {
  const [queue, setQueue] = useState<InboxSlideQueue | null>(null);

  useEffect(() => {
    const q = readInboxSlideQueue();
    if (!q) return;
    const index = q.ids.indexOf(taskId);
    if (index < 0) return;
    const next = { ...q, index };
    setQueue(next);
    updateInboxSlideIndex(index);
  }, [taskId]);

  const nav = useMemo(() => {
    if (!queue) return null;
    const i = queue.index;
    return {
      prevUrl: i > 0 ? queue.urls[i - 1] : null,
      nextUrl: i < queue.urls.length - 1 ? queue.urls[i + 1] : null,
      label: `${i + 1} / ${queue.urls.length}`,
      prevIndex: i - 1,
      nextIndex: i + 1,
    };
  }, [queue]);

  if (!nav) return null;

  return (
    <div className="sticky bottom-0 z-30 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur sm:hidden">
      <div className="flex items-center justify-between gap-2">
        {nav.prevUrl ? (
          <Link
            href={nav.prevUrl}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
            onClick={() => updateInboxSlideIndex(nav.prevIndex)}
          >
            <ChevronLeft className="size-4" />
            Назад
          </Link>
        ) : (
          <span className="px-3 py-2 text-sm text-slate-300">Назад</span>
        )}
        <span className="text-xs tabular-nums text-slate-500">{nav.label}</span>
        {nav.nextUrl ? (
          <Link
            href={nav.nextUrl}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-3 py-2 text-sm font-semibold text-white"
            onClick={() => updateInboxSlideIndex(nav.nextIndex)}
          >
            Далее
            <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className="px-3 py-2 text-sm text-slate-300">Далее</span>
        )}
      </div>
    </div>
  );
}
