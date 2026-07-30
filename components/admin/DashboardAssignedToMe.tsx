"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  countAssignedTo,
  readInboxAssignments,
} from "@/lib/admin/inbox/assignment";

type Props = {
  userId: string;
};

/** Assigned-to-me uses existing localStorage assignment store (no DB). */
export function DashboardAssignedToMe({ userId }: Props) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    setCount(countAssignedTo(readInboxAssignments(), userId));
  }, [userId]);

  return (
    <Link
      href="/admin/review/inbox"
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 transition hover:border-slate-400 sm:rounded-xl sm:px-4 sm:py-3"
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-[11px]">
        Assigned to Me
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 sm:mt-1 sm:text-2xl">
        {count == null ? "—" : count}
      </p>
      <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-500 sm:mt-1 sm:text-xs">
        {count == null
          ? "Загрузка…"
          : "Из Inbox (локальные назначения) → открыть Inbox"}
      </p>
    </Link>
  );
}
