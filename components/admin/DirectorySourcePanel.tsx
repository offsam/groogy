"use client";

import Link from "next/link";
import type { DirectorySourceMeta } from "@/lib/import-review/directory-sources";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import { recommendationCategoryLabel } from "@/lib/import-review/recommendation-category";
import { yellowPagesEntityKind } from "@/lib/import-review/yellow-pages-preview";
import { reviewWorkspacePath } from "@/lib/admin/review-workspace/task-id";
import type { ImportSourceStats } from "@/lib/admin/imports/types";
import { ImportSourceStatsCard } from "@/components/admin/ImportSourceStatsCard";
import { directorySourceInboxHref } from "@/lib/admin/imports/inbox-href";
import { To4kaPipelinePanel } from "@/components/admin/To4kaPipelinePanel";
import { To4kaEnrichLiveStatus } from "@/components/admin/To4kaEnrichLiveStatus";

type Props = {
  source: DirectorySourceMeta;
  items: CommentRecommendation[];
  total: number;
  stats: ImportSourceStats;
};

export function DirectorySourcePanel({
  source,
  items,
  total,
  stats,
}: Props) {
  const inboxHref = directorySourceInboxHref(source.id);

  return (
    <div className="space-y-5">
      <ImportSourceStatsCard stats={stats} />

      {source.id === "to4ka" ? (
        <>
          <To4kaEnrichLiveStatus />
          <To4kaPipelinePanel />
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={inboxHref}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Open in Inbox
        </Link>
        <p className="text-sm text-slate-500">
          Модерация только в Review Center. Здесь — история и диагностика
          справочника.
        </p>
      </div>

      <p className="text-sm text-slate-500">
        Недавние записи: {items.length}
        {total > items.length ? ` (из ${total})` : ""}
      </p>

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Нет импортированных записей из {source.shortTitle}.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {items.map((item) => {
            const kind = yellowPagesEntityKind(item);
            const title =
              item.display_name?.trim() ||
              item.comment_texts?.[0]?.trim()?.slice(0, 80) ||
              "Без названия";
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium text-slate-900">{title}</p>
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>
                      {kind === "professional"
                        ? "Professional"
                        : kind === "service"
                          ? "Service"
                          : "Business"}
                    </span>
                    <span>{recommendationCategoryLabel(item.category_guess)}</span>
                    <span className="uppercase tracking-wide">{item.status}</span>
                    {item.city ? <span>{item.city}</span> : null}
                  </p>
                </div>
                <Link
                  href={reviewWorkspacePath("recommendation", item.id)}
                  className="shrink-0 text-sm font-medium text-brand-blue hover:underline"
                >
                  Open in Review Center →
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
