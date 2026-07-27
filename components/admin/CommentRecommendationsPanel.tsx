"use client";

import { useState } from "react";
import Link from "next/link";
import { BusinessCard } from "@/components/business/BusinessCard";
import { ProfessionalCard } from "@/components/professional/ProfessionalCard";
import { ServiceCard } from "@/components/services/ServiceCard";
import { RecommendationPreviewModal } from "@/components/admin/RecommendationPreviewModal";
import {
  filterRecommendations,
  recommendationFacetCounts,
} from "@/components/admin/RecommendationQueueFilters";
import {
  RECOMMENDATION_CATEGORIES,
  recommendationCategoryLabel,
} from "@/lib/import-review/recommendation-category";
import type {
  CommentRecommendation,
  RecommendationTargetBucket,
} from "@/lib/import-review/recommendation-queries";
import {
  yellowPagesEntityKind,
  yellowPagesToBusinessPreview,
  yellowPagesToProfessionalPreview,
  yellowPagesToServicePreview,
} from "@/lib/import-review/yellow-pages-preview";

type Props = {
  items: CommentRecommendation[];
  total: number;
  page: number;
  pageSize: number;
  bucket: RecommendationTargetBucket | "all";
  bucketCounts: Record<string, number>;
  status: string;
  category: string;
};

const BUCKET_TABS: {
  id: RecommendationTargetBucket | "all";
  label: string;
}[] = [
  { id: "all", label: "Все" },
  { id: "professional", label: "Профи" },
  { id: "business", label: "Бизнесы" },
  { id: "service", label: "Услуги" },
  { id: "other", label: "Прочее" },
  { id: "unclassified", label: "Без якоря" },
];

function OriginBadges({
  third,
  self,
}: {
  third: number;
  self: number;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {third > 0 ? (
        <span
          className="rounded-md bg-brand-green/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"
          title="Сколько раз рекомендовали другие"
        >
          чужие ×{third}
        </span>
      ) : null}
      {self > 0 ? (
        <span
          className="rounded-md bg-brand-orange/15 px-2 py-0.5 text-[11px] font-semibold text-brand-orange"
          title="Сколько раз рекламировали себя"
        >
          сами ×{self}
        </span>
      ) : null}
    </div>
  );
}

function originCounts(item: CommentRecommendation): {
  third: number;
  self: number;
} {
  const third = Math.max(0, Number(item.third_party_mention_count ?? 0));
  const self = Math.max(0, Number(item.self_ad_mention_count ?? 0));
  if (third > 0 || self > 0) {
    return { third, self };
  }
  if (
    item.source_channel === "facebook" &&
    (item.recommender_names?.length ?? 0) > 0
  ) {
    return { third: item.mention_count, self: 0 };
  }
  return { third: 0, self: item.mention_count };
}

function kindChip(kind: ReturnType<typeof yellowPagesEntityKind>): string {
  if (kind === "professional") return "профи";
  if (kind === "service") return "услуга";
  return "бизнес";
}

function CardGrid({
  items,
  empty,
  onOpen,
}: {
  items: CommentRecommendation[];
  empty: string;
  onOpen: (item: CommentRecommendation) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
        {empty}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const kind = yellowPagesEntityKind(item);
        const { third, self } = originCounts(item);
        return (
          <div key={item.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 px-0.5">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {kindChip(kind)}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {recommendationCategoryLabel(item.category_guess)}
                  </span>
                  {item.city ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                      {item.city}
                    </span>
                  ) : null}
                  <OriginBadges third={third} self={self} />
            </div>

            <button
              className="w-full rounded-2xl text-left transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
              type="button"
              onClick={() => onOpen(item)}
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
              onClick={() => onOpen(item)}
            >
              Открыть · одобрить / отклонить →
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function CommentRecommendationsPanel({
  items,
  total,
  page,
  pageSize,
  bucket,
  bucketCounts,
  status,
  category,
}: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const profi = items.filter((i) => i.kind !== "event");
  const filtered = filterRecommendations(profi, {
    entity: "all",
    category,
  });
  const facets = recommendationFacetCounts(profi);
  const categoryTabs = RECOMMENDATION_CATEGORIES.filter(
    (c) => (facets.byCategory[c.id] ?? 0) > 0,
  );
  const previewItem = previewId
    ? (profi.find((i) => i.id === previewId) ?? null)
    : null;

  function tabHref(nextBucket: string, nextCategory = category) {
    const q = new URLSearchParams();
    if (status && status !== "pending") q.set("status", status);
    if (nextBucket && nextBucket !== "all") q.set("bucket", nextBucket);
    if (nextCategory && nextCategory !== "all") q.set("category", nextCategory);
    if (page > 1 && nextBucket === bucket) q.set("page", String(page));
    const qs = q.toString();
    return qs ? `/admin/recommendations?${qs}` : "/admin/recommendations";
  }

  function pageHref(nextPage: number) {
    const q = new URLSearchParams();
    if (status && status !== "pending") q.set("status", status);
    if (bucket && bucket !== "all") q.set("bucket", bucket);
    if (category && category !== "all") q.set("category", category);
    if (nextPage > 1) q.set("page", String(nextPage));
    const qs = q.toString();
    return qs ? `/admin/recommendations?${qs}` : "/admin/recommendations";
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-500">
        Карточки как на сайте. Клик — превью,{" "}
        <strong className="font-medium text-slate-700">одобрить</strong> или{" "}
        <strong className="font-medium text-slate-700">отклонить</strong>. После
        одобрения карточка сразу появляется в нужном разделе и городе — вид не
        меняется.{" "}
        <span className="font-medium text-amber-900">Без якоря</span> — не
        переносим.
      </p>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Тип
        </p>
        <div className="flex flex-wrap gap-2">
          {BUCKET_TABS.map((tab) => {
            const active = bucket === tab.id;
            const count = bucketCounts[tab.id] ?? 0;
            return (
              <Link
                key={tab.id}
                href={tabHref(tab.id)}
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
              href={tabHref(bucket, "all")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                category === "all"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Все
            </Link>
            {categoryTabs.map((tab) => {
              const count = facets.byCategory[tab.id] ?? 0;
              const active = category === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={tabHref(bucket, tab.id)}
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

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            {BUCKET_TABS.find((t) => t.id === bucket)?.label || "Карточки"}
          </h2>
          <span className="text-sm text-slate-500">
            {filtered.length}
            {category !== "all" ? ` / ${profi.length}` : ""}
          </span>
        </div>
        <CardGrid
          empty="В этой корзине карточек нет"
          items={filtered}
          onOpen={(item) => setPreviewId(item.id)}
        />
      </section>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {total} всего · стр. {page}/{totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
                href={pageHref(page - 1)}
              >
                Назад
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
                href={pageHref(page + 1)}
              >
                Дальше
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">{total} карточек на странице</p>
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
