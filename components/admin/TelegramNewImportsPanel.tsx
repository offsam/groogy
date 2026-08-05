"use client";

import { useState } from "react";
import Link from "next/link";
import { BusinessCard } from "@/components/business/BusinessCard";
import { ProfessionalCard } from "@/components/professional/ProfessionalCard";
import { ServiceCard } from "@/components/services/ServiceCard";
import { RecommendationPreviewModal } from "@/components/admin/RecommendationPreviewModal";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import { recommendationCategoryLabel } from "@/lib/import-review/recommendation-category";
import { formatImportPulledAt } from "@/lib/admin/imports/recent-import";
import {
  TELEGRAM_SOURCES,
  type TelegramSourceId,
} from "@/lib/import-review/telegram-sources";
import { importsInboxHref } from "@/lib/admin/imports/inbox-href";
import { reviewWorkspacePath } from "@/lib/admin/review-workspace/task-id";
import {
  yellowPagesEntityKind,
  yellowPagesToBusinessPreview,
  yellowPagesToProfessionalPreview,
  yellowPagesToServicePreview,
} from "@/lib/import-review/yellow-pages-preview";

type Props = {
  items: CommentRecommendation[];
  total: number;
  days: number;
  createdAfter: string;
  categories?: import("@/lib/import-review/category-options").ReviewCategoryOption[];
};

function telegramSourceTitle(directorySource: string | null): string {
  if (!directorySource) return "Telegram";
  const meta = TELEGRAM_SOURCES[directorySource as TelegramSourceId];
  return meta?.shortTitle ?? directorySource;
}

function gapLabels(item: CommentRecommendation): string[] {
  const out: string[] = [];
  if (!item.display_name?.trim()) out.push("имя");
  const hasContact =
    (item.phones?.length ?? 0) > 0 ||
    (item.instagram?.length ?? 0) > 0 ||
    (item.websites?.length ?? 0) > 0 ||
    Boolean(item.notes?.toLowerCase().includes("emails:"));
  if (!hasContact) out.push("контакт");
  if (!item.city?.trim()) out.push("город");
  if (!item.cover_image_url?.trim()) out.push("фото");
  const cat = (item.category_guess || "").trim().toLowerCase();
  if (
    !cat ||
    cat === "other" ||
    cat === "услуга / специалист" ||
    cat.includes("other")
  ) {
    out.push("категория");
  }
  return out;
}

export function TelegramNewImportsPanel({
  items,
  total,
  days,
  createdAfter,
  categories = [],
}: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewItem = items.find((i) => i.id === previewId) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-green">
          Imports · Telegram · Новое
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Telegram · новое
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Свежие pending за {days} дн. Клик по карточке открывает тот же Preview,
          что в Recommendations (просмотр как на сайте, completeness, approve /
          reject). Merge / поиск двойников — в Workspace.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          activity since {new Date(createdAfter).toLocaleString("ru-RU")} ·{" "}
          найдено {total}
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            href="/admin/imports/telegram"
            className="text-brand-blue hover:underline"
          >
            ← Все группы
          </Link>
          <Link
            href={importsInboxHref({
              view: "telegram",
              source: "telegram",
              reviewType: "recommendation",
            })}
            className="font-medium text-brand-blue hover:underline"
          >
            Open in Inbox →
          </Link>
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">
          Пока нет новых Telegram-записей за этот период.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const kind = yellowPagesEntityKind(item);
            const gaps = gapLabels(item);
            return (
              <div key={item.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5 px-0.5">
                  <span className="rounded-md bg-brand-green/15 px-2 py-0.5 text-[11px] font-semibold text-brand-green">
                    Новое
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {telegramSourceTitle(item.directory_source)}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {recommendationCategoryLabel(item.category_guess)}
                  </span>
                  {item.city ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                      {item.city}
                    </span>
                  ) : null}
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    {formatImportPulledAt(item.updated_at || item.created_at)}
                  </span>
                </div>

                <button
                  type="button"
                  className="w-full rounded-2xl text-left transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                  onClick={() => setPreviewId(item.id)}
                >
                  {kind === "professional" ? (
                    <ProfessionalCard
                      professional={yellowPagesToProfessionalPreview(item)}
                      preview
                    />
                  ) : kind === "service" ? (
                    <ServiceCard
                      listing={yellowPagesToServicePreview(item)}
                      preview
                    />
                  ) : (
                    <BusinessCard
                      business={yellowPagesToBusinessPreview(item)}
                      preview
                    />
                  )}
                </button>

                {gaps.length > 0 ? (
                  <p className="px-0.5 text-xs text-amber-800">
                    Пробелы: {gaps.join(", ")}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-3 px-0.5 text-xs">
                  <button
                    type="button"
                    className="font-medium text-brand-blue hover:underline"
                    onClick={() => setPreviewId(item.id)}
                  >
                    Preview · одобрить / отклонить →
                  </button>
                  <Link
                    href={reviewWorkspacePath("recommendation", item.id)}
                    className="font-medium text-slate-600 hover:underline"
                  >
                    Workspace · двойники
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewItem ? (
        <RecommendationPreviewModal
          categories={categories}
          item={previewItem}
          onClose={() => setPreviewId(null)}
          onDone={() => setPreviewId(null)}
        />
      ) : null}
    </div>
  );
}
