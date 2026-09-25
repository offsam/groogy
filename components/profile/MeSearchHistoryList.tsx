"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { dismissSearchHistoryAction } from "@/lib/profile/search-history-actions";
import type { UserSearchHistoryFrame } from "@/types/profile-cabinet";

type Props = {
  searches: UserSearchHistoryFrame[];
};

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function MeSearchHistoryList({ searches }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function dismiss(id: string, queryNormalized: string) {
    startTransition(async () => {
      await dismissSearchHistoryAction(id, queryNormalized);
      router.refresh();
    });
  }

  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {searches.map((item) => (
        <li className="flex items-stretch" key={item.id}>
          <Link
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
            href={`/search?q=${encodeURIComponent(item.query)}`}
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
              {item.query}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
              {item.hitCount > 1 ? `${item.hitCount}× · ` : null}
              {formatWhen(item.lastSearchedAt)}
            </span>
          </Link>
          <button
            aria-label="Не актуально"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 border-l border-slate-100 px-3 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 disabled:opacity-50"
            disabled={pending}
            onClick={() => dismiss(item.id, item.queryNormalized)}
            title="Не актуально"
            type="button"
          >
            <X className="size-4" />
            <span className="hidden sm:inline">Не актуально</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
