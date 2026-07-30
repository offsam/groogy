"use client";

import Link from "next/link";
import {
  RECOMMENDATION_CATEGORIES,
  recommendationCategoryId,
  type RecommendationEntityFilter,
} from "@/lib/import-review/recommendation-category";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import { yellowPagesEntityKind } from "@/lib/import-review/yellow-pages-preview";

const ENTITY_TABS: {
  id: RecommendationEntityFilter;
  label: string;
}[] = [
  { id: "all", label: "Все" },
  { id: "professional", label: "Профи" },
  { id: "business", label: "Бизнесы" },
  { id: "service", label: "Услуги" },
];

export function filterRecommendations(
  items: CommentRecommendation[],
  opts: {
    entity: RecommendationEntityFilter;
    category: string;
  },
): CommentRecommendation[] {
  return items.filter((item) => {
    if (opts.entity !== "all" && yellowPagesEntityKind(item) !== opts.entity) {
      return false;
    }
    if (
      opts.category !== "all" &&
      recommendationCategoryId(item.category_guess) !== opts.category
    ) {
      return false;
    }
    return true;
  });
}

export function recommendationFacetCounts(items: CommentRecommendation[]): {
  byEntity: Record<RecommendationEntityFilter, number>;
  byCategory: Record<string, number>;
} {
  const byEntity: Record<RecommendationEntityFilter, number> = {
    all: items.length,
    professional: 0,
    business: 0,
    service: 0,
  };
  const byCategory: Record<string, number> = { all: items.length };

  for (const item of items) {
    const kind = yellowPagesEntityKind(item);
    byEntity[kind] += 1;
    const cat = recommendationCategoryId(item.category_guess);
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  return { byEntity, byCategory };
}

type Props = {
  entity: RecommendationEntityFilter;
  category: string;
  items: CommentRecommendation[];
  /** Build href for filter change (entity + category preserved). */
  hrefFor: (next: {
    entity: RecommendationEntityFilter;
    category: string;
  }) => string;
  statusPendingHref: string;
  statusSuspectedHref: string;
  statusAllHref: string;
  status: string;
};

export function RecommendationQueueFilters({
  entity,
  category,
  items,
  hrefFor,
  statusPendingHref,
  statusSuspectedHref,
  statusAllHref,
  status,
}: Props) {
  const facets = recommendationFacetCounts(items);
  const categoryTabs = RECOMMENDATION_CATEGORIES.filter(
    (c) => (facets.byCategory[c.id] ?? 0) > 0,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Карточки как на сайте · клик — превью, одобрить или отклонить
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={statusPendingHref}
            className={
              status === "pending"
                ? "font-semibold text-brand-blue"
                : "text-slate-500 hover:text-brand-blue"
            }
          >
            Pending
          </Link>
          <span className="text-slate-300">·</span>
          <Link
            href={statusSuspectedHref}
            className={
              status === "suspected_duplicate"
                ? "font-semibold text-brand-blue"
                : "text-slate-500 hover:text-brand-blue"
            }
          >
            Подозрение на дубликат
          </Link>
          <span className="text-slate-300">·</span>
          <Link
            href={statusAllHref}
            className={
              status === "all"
                ? "font-semibold text-brand-blue"
                : "text-slate-500 hover:text-brand-blue"
            }
          >
            Все статусы
          </Link>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Тип
        </p>
        <div className="flex flex-wrap gap-2">
          {ENTITY_TABS.map((tab) => {
            const count = facets.byEntity[tab.id] ?? 0;
            const active = entity === tab.id;
            return (
              <Link
                key={tab.id}
                href={hrefFor({ entity: tab.id, category })}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-brand-blue text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {tab.label}
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    active ? "bg-white/20 text-white" : "bg-white text-slate-500"
                  }`}
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {categoryTabs.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Категория
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={hrefFor({ entity, category: "all" })}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                category === "all"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Все
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${
                  category === "all"
                    ? "bg-white/20 text-white"
                    : "bg-white text-slate-500"
                }`}
              >
                {facets.byCategory.all}
              </span>
            </Link>
            {categoryTabs.map((tab) => {
              const count = facets.byCategory[tab.id] ?? 0;
              const active = category === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={hrefFor({ entity, category: tab.id })}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      active
                        ? "bg-white/20 text-white"
                        : "bg-white text-slate-500"
                    }`}
                  >
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
