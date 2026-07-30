"use client";

import Link from "next/link";
import type { TelegramSourceMeta } from "@/lib/import-review/telegram-sources";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import { recommendationCategoryLabel } from "@/lib/import-review/recommendation-category";
import { yellowPagesEntityKind } from "@/lib/import-review/yellow-pages-preview";
import { reviewWorkspacePath } from "@/lib/admin/review-workspace/task-id";
import type { ImportSourceStats } from "@/lib/admin/imports/types";
import {
  formatImportPulledAt,
  isRecentlyImported,
} from "@/lib/admin/imports/recent-import";
import { ImportSourceStatsCard } from "@/components/admin/ImportSourceStatsCard";
import { telegramSourceInboxHref } from "@/lib/admin/imports/inbox-href";

type Props = {
  source: TelegramSourceMeta;
  items: CommentRecommendation[];
  total: number;
  stats: ImportSourceStats;
};

export function TelegramSourcePanel({
  source,
  items,
  total,
  stats,
}: Props) {
  const inboxHref = telegramSourceInboxHref(source.id);

  return (
    <div className="space-y-5">
      <ImportSourceStatsCard stats={stats} />

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={inboxHref}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Open in Inbox
        </Link>
        <p className="text-sm text-slate-500">
          Модерация только в Review Center. Здесь — история и диагностика
          источника.
        </p>
      </div>

      <p className="text-sm text-slate-500">
        Недавние записи: {items.length}
        {total > items.length ? ` (из ${total})` : ""} · {source.regionHint}
      </p>

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Нет импортированных записей для {source.shortTitle}.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {items.map((item) => {
            const kind = yellowPagesEntityKind(item);
            const title =
              item.display_name?.trim() ||
              item.comment_texts?.[0]?.trim()?.slice(0, 80) ||
              "Без названия";
            const isNew = isRecentlyImported(item.created_at);
            const pulledAt = formatImportPulledAt(item.created_at);
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
                    {isNew ? (
                      <span className="rounded bg-brand-green/15 px-1.5 py-0.5 font-medium text-brand-green">
                        Новое
                      </span>
                    ) : null}
                    <span title="Дата выгрузки в админку">
                      Выгружено {pulledAt}
                    </span>
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
