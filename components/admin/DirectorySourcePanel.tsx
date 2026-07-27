"use client";

import { useState } from "react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { ProfessionalCard } from "@/components/professional/ProfessionalCard";
import { ServiceCard } from "@/components/services/ServiceCard";
import { RecommendationPreviewModal } from "@/components/admin/RecommendationPreviewModal";
import {
  filterRecommendations,
  RecommendationQueueFilters,
} from "@/components/admin/RecommendationQueueFilters";
import type { DirectorySourceMeta } from "@/lib/import-review/directory-sources";
import type { RecommendationEntityFilter } from "@/lib/import-review/recommendation-category";
import { recommendationCategoryLabel } from "@/lib/import-review/recommendation-category";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import {
  yellowPagesEntityKind,
  yellowPagesToBusinessPreview,
  yellowPagesToProfessionalPreview,
  yellowPagesToServicePreview,
} from "@/lib/import-review/yellow-pages-preview";

type Props = {
  source: DirectorySourceMeta;
  items: CommentRecommendation[];
  total: number;
  status: string;
  entity: RecommendationEntityFilter;
  category: string;
};

function buildHref(
  source: DirectorySourceMeta,
  next: {
    status: string;
    entity: RecommendationEntityFilter;
    category: string;
  },
) {
  const q = new URLSearchParams();
  if (next.status && next.status !== "pending") q.set("status", next.status);
  if (next.entity && next.entity !== "all") q.set("entity", next.entity);
  if (next.category && next.category !== "all") q.set("category", next.category);
  const qs = q.toString();
  return qs
    ? `/admin/directories/${source.slug}?${qs}`
    : `/admin/directories/${source.slug}`;
}

export function DirectorySourcePanel({
  source,
  items,
  total,
  status,
  entity,
  category,
}: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const filtered = filterRecommendations(items, { entity, category });
  const previewItem = previewId
    ? (filtered.find((i) => i.id === previewId) ??
      items.find((i) => i.id === previewId) ??
      null)
    : null;

  return (
    <div className="space-y-5">
      <RecommendationQueueFilters
        category={category}
        entity={entity}
        hrefFor={({ entity: e, category: c }) =>
          buildHref(source, { status, entity: e, category: c })
        }
        items={items}
        status={status}
        statusAllHref={buildHref(source, {
          status: "all",
          entity,
          category,
        })}
        statusPendingHref={buildHref(source, {
          status: "pending",
          entity,
          category,
        })}
      />

      <p className="text-sm text-slate-500">
        Показано {filtered.length} из {total}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Нет карточек по выбранным фильтрам из {source.shortTitle}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const kind = yellowPagesEntityKind(item);
            return (
              <div key={item.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 px-0.5">
                  <span className="rounded-md bg-brand-yellow/25 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
                    {kind === "professional"
                      ? "профи"
                      : kind === "service"
                        ? "услуга"
                        : "бизнес"}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {recommendationCategoryLabel(item.category_guess)}
                  </span>
                  {item.city ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                      {item.city}
                    </span>
                  ) : null}
                </div>

                <button
                  className="w-full rounded-2xl text-left transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                  type="button"
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

                <button
                  className="text-xs font-medium text-brand-blue hover:underline"
                  type="button"
                  onClick={() => setPreviewId(item.id)}
                >
                  Открыть · одобрить / отклонить →
                </button>
              </div>
            );
          })}
        </div>
      )}

      {previewItem ? (
        <RecommendationPreviewModal
          item={previewItem}
          onClose={() => setPreviewId(null)}
        />
      ) : null}
    </div>
  );
}
