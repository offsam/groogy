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
import type { TelegramSourceMeta } from "@/lib/import-review/telegram-sources";
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
  source: TelegramSourceMeta;
  items: CommentRecommendation[];
  total: number;
  status: string;
  entity: RecommendationEntityFilter;
  category: string;
};

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

function buildHref(
  source: TelegramSourceMeta,
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
  const path = `/admin/telegram-groups/${source.slug}`;
  return qs ? `${path}?${qs}` : path;
}

export function TelegramSourcePanel({
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
        Показано {filtered.length} из {total} · {source.regionHint}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Нет карточек по выбранным фильтрам в {source.shortTitle}.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const kind = yellowPagesEntityKind(item);
            const phones = (item.phones || []).slice(0, 2);
            const ig = (item.instagram || []).slice(0, 2);
            return (
              <div key={item.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 px-0.5">
                  <span className="rounded-md bg-brand-blue/10 px-2 py-0.5 text-[11px] font-semibold text-brand-blue">
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
                  {item.mention_count > 1 ? (
                    <span className="rounded-md bg-brand-green/15 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                      ×{item.mention_count}
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

                <div className="space-y-1 px-0.5 text-xs text-slate-600">
                  {phones.map((p) => (
                    <div key={p}>{formatPhone(p)}</div>
                  ))}
                  {ig.map((h) => (
                    <div key={h}>@{h}</div>
                  ))}
                </div>

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
